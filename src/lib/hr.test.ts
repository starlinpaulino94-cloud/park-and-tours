import { describe, it, expect } from "vitest";
import {
  certificationState, certificationBlocks, assignmentBlock, certificationsToRenew,
  EXPIRING_WINDOW_DAYS,
  shiftsOverlap, conflictingShift, plannedHours, publishDecision,
  workedHours, splitDaily, attendanceHours, clockDecision,
  weekKey, weeklyOvertime, hourlyRateFor, isrAnnual, isrMonthly,
  payrollLine, payrollTotals, payrollCsv, PAYROLL_COLUMNS, defaultPolicy,
  periodFor, monthsInPeriod, payrollTransition, MONTHLY_HOURS,
  WEEKLY_REGULAR_HOURS, WEEKLY_OVERTIME_CAP, DAILY_REGULAR_HOURS,
} from "@/lib/hr";

/**
 * Lo que se prueba aquí no es aritmética: es lo que le pasa a una persona
 * cuando el cálculo falla. Un guía con el curso vencido subiendo a un bote, una
 * quincena en la que faltan tres horas extra, un ISR retenido de más. Cada
 * prueba de este archivo existe porque el error correspondiente no se ve hasta
 * que alguien reclama.
 */

const HOY = "2026-09-16";

describe("certificaciones: el calendario manda, salvo cuando manda una persona", () => {
  it("una certificación vencida es vencida aunque diga «vigente» en la ficha", () => {
    expect(certificationState({ status: "valid", expires_at: "2026-09-15" }, HOY)).toBe("expired");
  });

  it("avisa dentro de la ventana de renovación y no antes", () => {
    const dentro = new Date(Date.parse(`${HOY}T00:00:00Z`) + EXPIRING_WINDOW_DAYS * 86_400_000)
      .toISOString().slice(0, 10);
    const fuera = new Date(Date.parse(`${HOY}T00:00:00Z`) + (EXPIRING_WINDOW_DAYS + 1) * 86_400_000)
      .toISOString().slice(0, 10);
    expect(certificationState({ expires_at: dentro }, HOY)).toBe("expiring");
    expect(certificationState({ expires_at: fuera }, HOY)).toBe("valid");
  });

  it("el día exacto del vencimiento todavía vale: se vence al acabar el día", () => {
    expect(certificationState({ expires_at: HOY }, HOY)).toBe("expiring");
  });

  it("revocada gana al calendario aunque falten años", () => {
    expect(certificationState({ status: "revoked", expires_at: "2030-01-01" }, HOY)).toBe("revoked");
  });

  it("pendiente no es válida por mucho margen que tenga", () => {
    expect(certificationState({ status: "pending", expires_at: "2030-01-01" }, HOY)).toBe("pending");
  });

  it("sin fecha de vencimiento no caduca: un título no expira", () => {
    expect(certificationState({ name: "Licenciatura" }, HOY)).toBe("valid");
  });
});

describe("certificaciones: qué bloquea y qué no", () => {
  it("solo bloquea la que está marcada como bloqueante", () => {
    const vencida = { name: "Primeros auxilios", expires_at: "2026-01-01" };
    expect(certificationBlocks(vencida, HOY)).toBe(false);
    expect(certificationBlocks({ ...vencida, blocks_assignment: true }, HOY)).toBe(true);
  });

  it("estar a punto de vencer avisa pero NO bloquea: si no, un lunes la empresa se queda sin guías", () => {
    const porVencer = { name: "Salvamento", blocks_assignment: true, expires_at: "2026-09-20" };
    expect(certificationState(porVencer, HOY)).toBe("expiring");
    expect(certificationBlocks(porVencer, HOY)).toBe(false);
    expect(assignmentBlock([porVencer], HOY)).toBeNull();
  });

  it("una revocada bloqueante impide asignar aunque su fecha esté lejísimos", () => {
    const b = assignmentBlock(
      [{ name: "Licencia de conducir", blocks_assignment: true, status: "revoked", expires_at: "2031-01-01" }],
      HOY
    );
    expect(b).not.toBeNull();
    expect(b!.reason).toContain("revocada");
    expect(b!.certifications[0].state).toBe("revoked");
  });

  it("sin certificaciones no hay bloqueo: no todo el personal necesita papeles", () => {
    expect(assignmentBlock([], HOY)).toBeNull();
  });

  it("cuando son varias, el motivo las nombra todas", () => {
    const b = assignmentBlock(
      [
        { name: "Primeros auxilios", blocks_assignment: true, expires_at: "2026-01-01" },
        { name: "Salvamento", blocks_assignment: true, expires_at: "2026-02-01" },
        { name: "Idiomas", blocks_assignment: true, expires_at: "2030-01-01" },
      ],
      HOY
    );
    expect(b!.certifications).toHaveLength(2);
    expect(b!.reason).toContain("Primeros auxilios");
    expect(b!.reason).toContain("Salvamento");
    expect(b!.reason).not.toContain("Idiomas");
  });

  it("para renovar lista vencidas y por vencer, y deja fuera las que están bien", () => {
    const lista = certificationsToRenew(
      [
        { name: "A", expires_at: "2026-01-01" },
        { name: "B", expires_at: "2026-09-30" },
        { name: "C", expires_at: "2027-09-30" },
      ],
      HOY
    );
    expect(lista.map((x) => x.state)).toEqual(["expired", "expiring"]);
  });
});

describe("turnos", () => {
  const turno = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
    shift_date: from.slice(0, 10), starts_at: from, ends_at: to, ...extra,
  });

  it("el relevo no es solape: uno acaba a las 14:00 y el otro empieza a las 14:00", () => {
    expect(shiftsOverlap(
      turno("2026-09-16T06:00:00Z", "2026-09-16T14:00:00Z"),
      turno("2026-09-16T14:00:00Z", "2026-09-16T22:00:00Z"),
    )).toBe(false);
  });

  it("un minuto de pisada ya es pisada", () => {
    expect(shiftsOverlap(
      turno("2026-09-16T06:00:00Z", "2026-09-16T14:01:00Z"),
      turno("2026-09-16T14:00:00Z", "2026-09-16T22:00:00Z"),
    )).toBe(true);
  });

  it("dos turnos del mismo día sin horario cuentan como el mismo hueco", () => {
    expect(shiftsOverlap({ shift_date: "2026-09-16" }, { shift_date: "2026-09-16" })).toBe(true);
    expect(shiftsOverlap({ shift_date: "2026-09-16" }, { shift_date: "2026-09-17" })).toBe(false);
  });

  it("un turno cancelado no ocupa a nadie", () => {
    const existentes = [turno("2026-09-16T06:00:00Z", "2026-09-16T14:00:00Z", { _id: "x", status: "cancelled" })];
    expect(conflictingShift(existentes, turno("2026-09-16T08:00:00Z", "2026-09-16T12:00:00Z"))).toBeNull();
  });

  it("editar un turno no lo hace chocar consigo mismo", () => {
    const yo = turno("2026-09-16T06:00:00Z", "2026-09-16T14:00:00Z", { _id: "mio" });
    expect(conflictingShift([yo], { ...yo, ends_at: "2026-09-16T15:00:00Z" })).toBeNull();
  });

  it("detecta el choque y devuelve CUÁL, para poder decírselo al encargado", () => {
    const otro = turno("2026-09-16T06:00:00Z", "2026-09-16T14:00:00Z", { _id: "otro", role_label: "Mañana" });
    const choque = conflictingShift([otro], turno("2026-09-16T13:00:00Z", "2026-09-16T20:00:00Z"));
    expect((choque as { _id?: string })?._id).toBe("otro");
  });

  it("las horas previstas descuentan el descanso", () => {
    expect(plannedHours(turno("2026-09-16T06:00:00Z", "2026-09-16T15:00:00Z", { break_min: 60 }))).toBe(8);
  });

  it("si alguien declaró las horas, se respeta lo declarado", () => {
    expect(plannedHours(turno("2026-09-16T06:00:00Z", "2026-09-16T15:00:00Z", { hours_planned: 6 }))).toBe(6);
  });

  it("publicar exige persona, fecha y estado planificado", () => {
    expect(publishDecision({ status: "planned", staff: "s1", shift_date: "2026-09-16" })).toEqual({ ok: true });
    expect(publishDecision({ status: "planned", shift_date: "2026-09-16" }).ok).toBe(false);
    expect(publishDecision({ status: "confirmed", staff: "s1", shift_date: "2026-09-16" }).ok).toBe(false);
    expect(publishDecision({ status: "planned", staff: "s1" }).ok).toBe(false);
  });
});

describe("marcajes y horas", () => {
  it("el turno de noche cruza la medianoche y sale positivo", () => {
    expect(workedHours("2026-09-16T22:00:00Z", "2026-09-17T06:00:00Z")).toBe(8);
  });

  it("el descanso se resta", () => {
    expect(workedHours("2026-09-16T08:00:00Z", "2026-09-16T17:00:00Z", 60)).toBe(8);
  });

  it("una salida anterior a la entrada no inventa horas negativas", () => {
    expect(workedHours("2026-09-16T17:00:00Z", "2026-09-16T08:00:00Z")).toBe(0);
  });

  it("lo que pasa de la jornada diaria es extraordinario", () => {
    expect(splitDaily(11)).toEqual({ regular: DAILY_REGULAR_HOURS, overtime: 3 });
    expect(splitDaily(6)).toEqual({ regular: 6, overtime: 0 });
  });

  it("un día de vacaciones no suma horas por mucho marcaje que tenga", () => {
    expect(attendanceHours({
      status: "vacation", clock_in: "2026-09-16T08:00:00Z", clock_out: "2026-09-16T17:00:00Z",
    })).toEqual({ worked: 0, regular: 0, overtime: 0 });
  });

  it("sin salida marcada se respeta lo que anotó el encargado en vez de pagar cero", () => {
    expect(attendanceHours({ status: "present", clock_in: "2026-09-16T08:00:00Z", hours_worked: 7 }).worked).toBe(7);
  });

  it("los marcajes ganan a lo tecleado: el reloj no se negocia", () => {
    const h = attendanceHours({
      status: "present", clock_in: "2026-09-16T08:00:00Z", clock_out: "2026-09-16T13:00:00Z", hours_worked: 9,
    });
    expect(h.worked).toBe(5);
  });
});

describe("fichar", () => {
  it("fichar la entrada dos veces no pisa la hora real de llegada", () => {
    const r = clockDecision({ clock_in: "2026-09-16T08:00:00Z" }, "in", "2026-09-16T08:03:00Z");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("already_in");
  });

  it("no se puede fichar salida sin haber fichado entrada", () => {
    const r = clockDecision(null, "out", "2026-09-16T17:00:00Z");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("not_in");
  });

  it("al fichar salida se calculan y se guardan las horas", () => {
    const r = clockDecision(
      { clock_in: "2026-09-16T08:00:00Z", break_min: 60, status: "present" },
      "out",
      "2026-09-16T18:00:00Z"
    );
    expect(r.ok).toBe(true);
    if (r.ok === true) {
      expect(r.hours).toEqual({ worked: 9, regular: 8, overtime: 1 });
      expect(r.patch.hours_worked).toBe(9);
      expect(r.patch.regular_hours).toBe(8);
      expect(r.patch.overtime_hours).toBe(1);
    }
  });

  it("un día ya pagado en nómina no se puede volver a fichar", () => {
    const r = clockDecision({ payroll_run_id: "run-1", clock_in: "2026-09-16T08:00:00Z" }, "out", "2026-09-16T17:00:00Z");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("locked");
  });

  it("después de cerrar la jornada, volver a fichar entrada no la reabre", () => {
    const r = clockDecision(
      { clock_in: "2026-09-16T08:00:00Z", clock_out: "2026-09-16T17:00:00Z" },
      "in",
      "2026-09-16T18:00:00Z"
    );
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe("already_out");
  });
});

describe("horas extra: el reparto es semanal, no diario", () => {
  it("la semana empieza el lunes", () => {
    expect(weekKey("2026-09-16")).toBe("2026-09-14"); // miércoles → lunes
    expect(weekKey("2026-09-14")).toBe("2026-09-14");
    expect(weekKey("2026-09-20")).toBe("2026-09-14"); // domingo → mismo lunes
  });

  it("seis jornadas de 8 h son 48: las 4 últimas son extra aunque ningún día pasara de 8", () => {
    const dias = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]
      .map((d) => ({ date: d, regular: 8, overtime: 0 }));
    const r = weeklyOvertime(dias);
    expect(r.regular).toBe(WEEKLY_REGULAR_HOURS);
    expect(r.overtime).toBe(4);
    expect(r.extraOvertime).toBe(0);
    expect(r.days).toBe(6);
  });

  it("lo que pasa de 68 horas semanales se separa: se paga al 100 %, no al 35 %", () => {
    const dias = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]
      .map((d) => ({ date: d, regular: 8, overtime: 4 })); // 72 h en la semana
    const r = weeklyOvertime(dias);
    expect(r.regular).toBe(WEEKLY_REGULAR_HOURS);
    expect(r.extraOvertime).toBe(72 - WEEKLY_OVERTIME_CAP);
    expect(r.overtime).toBe(WEEKLY_OVERTIME_CAP - WEEKLY_REGULAR_HOURS);
  });

  it("dos semanas no se suman entre sí: cada una tiene su propio tope", () => {
    const r = weeklyOvertime([
      { date: "2026-09-14", regular: 8, overtime: 0 },
      { date: "2026-09-15", regular: 8, overtime: 0 },
      { date: "2026-09-16", regular: 8, overtime: 0 },
      { date: "2026-09-17", regular: 8, overtime: 0 },
      { date: "2026-09-18", regular: 8, overtime: 0 }, // 40 h, sin extra
      { date: "2026-09-21", regular: 8, overtime: 0 },
      { date: "2026-09-22", regular: 8, overtime: 0 },
      { date: "2026-09-23", regular: 8, overtime: 0 },
      { date: "2026-09-24", regular: 8, overtime: 0 },
      { date: "2026-09-25", regular: 8, overtime: 0 }, // otras 40 h
    ]);
    expect(r.regular).toBe(80);
    expect(r.overtime).toBe(0);
  });

  it("un día sin horas no cuenta como día trabajado", () => {
    expect(weeklyOvertime([{ date: "2026-09-16", regular: 0, overtime: 0 }]).days).toBe(0);
  });
});

describe("tarifa por hora", () => {
  it("un sueldo mensual se divide entre las horas del mes, no entre 240", () => {
    expect(MONTHLY_HOURS).toBeCloseTo(190.6667, 3);
    expect(hourlyRateFor({ salary_type: "monthly", base_salary: 38133.34 })).toBeCloseTo(200, 1);
  });

  it("una tarifa por hora explícita gana a cualquier cálculo", () => {
    expect(hourlyRateFor({ salary_type: "monthly", base_salary: 40000, hourly_rate: 150 })).toBe(150);
  });

  it("el que cobra por día se convierte con la jornada de 8 horas", () => {
    expect(hourlyRateFor({ salary_type: "daily", daily_rate: 1600 })).toBe(200);
  });

  it("sin nada con qué calcular, la tarifa es cero y no NaN", () => {
    expect(hourlyRateFor({})).toBe(0);
  });
});

describe("ISR", () => {
  it("por debajo del mínimo exento no se retiene nada", () => {
    expect(isrAnnual(400_000)).toBe(0);
    expect(isrMonthly(30_000)).toBe(0);
  });

  it("el primer tramo grava solo el excedente", () => {
    expect(isrAnnual(500_000)).toBeCloseTo((500_000 - 416_220) * 0.15, 2);
  });

  it("el segundo tramo arranca de su base, no desde cero", () => {
    expect(isrAnnual(700_000)).toBeCloseTo(31_216 + (700_000 - 624_329) * 0.2, 2);
  });

  it("el tramo alto es el 25 % sobre su propio excedente", () => {
    expect(isrAnnual(1_000_000)).toBeCloseTo(79_776 + (1_000_000 - 867_123) * 0.25, 2);
  });

  it("la escala es ANUAL: aplicarla al sueldo del mes dejaría exento a todo el mundo", () => {
    // 60.000 al mes son 720.000 al año: hay retención, aunque 60.000 esté muy
    // por debajo del mínimo exento anual.
    expect(isrMonthly(60_000)).toBeGreaterThan(0);
    expect(isrAnnual(60_000)).toBe(0);
  });
});

describe("línea de nómina", () => {
  const empleado = {
    _id: "s1", full_name: "Ana Reyes", payroll_code: "E-001", social_security_id: "12345678",
    salary_type: "monthly", base_salary: 80_000, applies_social_security: true, currency: "dop",
  };
  /**
   * Una quincena de verdad: once días laborables. Con una quincena de tres días
   * el ISR sale cero y la prueba no prueba nada — que es exactamente lo que le
   * pasaba a este bloque antes.
   */
  const quincena = [
    "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04",
    "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
    "2026-09-14", "2026-09-15",
  ].map((date) => ({ date, regular: 8, overtime: 0 }));
  const conExtra = quincena.map((d, i) => (i === 0 ? { ...d, overtime: 2 } : d));

  it("con esta quincena el ISR NO es cero: si lo fuera, lo de abajo no probaría nada", () => {
    expect(payrollLine(empleado, quincena, defaultPolicy(0.5)).isrAmount).toBeGreaterThan(0);
  });

  it("la Seguridad Social se descuenta ANTES del ISR: calcularlo sobre el bruto retiene de más", () => {
    const l = payrollLine(empleado, quincena, defaultPolicy(0.5));
    const base = l.grossAmount - l.sfsEmployee - l.afpEmployee;
    const sobreBruto = isrMonthly(l.grossAmount / 0.5) * 0.5;
    expect(l.isrAmount).toBeCloseTo(isrMonthly(base / 0.5) * 0.5, 1);
    expect(l.isrAmount).toBeLessThan(sobreBruto);
  });

  it("el neto es el bruto menos TODAS las deducciones", () => {
    const l = payrollLine(empleado, quincena, defaultPolicy(0.5), { otherDeductions: 500 });
    expect(l.deductionsAmount).toBeCloseTo(l.sfsEmployee + l.afpEmployee + l.isrAmount + 500, 2);
    expect(l.netAmount).toBeCloseTo(l.grossAmount - l.deductionsAmount, 2);
  });

  it("la hora extra se paga con recargo, no a tarifa normal", () => {
    const l = payrollLine(empleado, conExtra, defaultPolicy(0.5));
    expect(l.overtimeHours).toBe(2);
    expect(l.overtimeAmount).toBeCloseTo(2 * l.hourlyRate * 1.35, 2);
  });

  it("los otros ingresos entran en el bruto y por tanto cotizan", () => {
    const base = payrollLine(empleado, quincena, defaultPolicy(0.5));
    const con = payrollLine(empleado, quincena, defaultPolicy(0.5), { otherEarnings: 5_000 });
    expect(con.grossAmount).toBeCloseTo(base.grossAmount + 5_000, 2);
    expect(con.sfsEmployee).toBeGreaterThan(base.sfsEmployee);
  });

  it("al que no cotiza no se le descuenta TSS: el externo factura, no es empleado", () => {
    const l = payrollLine({ ...empleado, applies_social_security: false }, quincena, defaultPolicy(0.5));
    expect(l.sfsEmployee).toBe(0);
    expect(l.afpEmployee).toBe(0);
    expect(l.employerCost).toBe(l.grossAmount);
  });

  it("el costo de empresa suma los aportes patronales sobre el bruto", () => {
    const p = defaultPolicy(0.5);
    const l = payrollLine(empleado, quincena, p);
    const pct = p.sfsEmployerPct + p.afpEmployerPct + p.riskEmployerPct;
    expect(l.employerCost).toBeCloseTo(l.grossAmount * (1 + pct / 100), 2);
  });

  it("una nómina mensual del mismo sueldo retiene el doble de ISR que la quincenal, no más", () => {
    const mes = [...quincena, ...quincena.map((d) => ({ ...d, date: d.date.replace("-09-", "-10-") }))];
    const quincenal = payrollLine(empleado, quincena, defaultPolicy(0.5));
    const mensual = payrollLine(empleado, mes, defaultPolicy(1));
    expect(mensual.isrAmount).toBeCloseTo(quincenal.isrAmount * 2, 0);
  });

  it("sin días trabajados todo es cero, y el neto no se va a negativo", () => {
    const l = payrollLine(empleado, [], defaultPolicy(0.5));
    expect(l.grossAmount).toBe(0);
    expect(l.netAmount).toBe(0);
    expect(l.daysWorked).toBe(0);
  });

  it("copia nombre y NSS: la nómina de septiembre debe seguir diciendo a quién se pagó", () => {
    const l = payrollLine(empleado, quincena, defaultPolicy(0.5));
    expect(l.staffName).toBe("Ana Reyes");
    expect(l.socialSecurityId).toBe("12345678");
    expect(l.payrollCode).toBe("E-001");
  });
});

/** Un lector de CSV mínimo, para comprobar el escape en vez de fiarse de él. */
function campos(fila: string): string[] {
  const out: string[] = [];
  let cur = "";
  let dentro = false;
  for (let i = 0; i < fila.length; i++) {
    const c = fila[i];
    if (dentro) {
      if (c === '"' && fila[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') dentro = false;
      else cur += c;
    } else if (c === '"') dentro = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

describe("totales y archivo para el contador", () => {
  const p = defaultPolicy(0.5);
  const dias = [{ date: "2026-09-14", regular: 8, overtime: 0 }];
  const lineas = [
    payrollLine({ _id: "a", full_name: "Ana", salary_type: "monthly", base_salary: 40_000, applies_social_security: true }, dias, p),
    payrollLine({ _id: "b", full_name: "Luis", salary_type: "daily", daily_rate: 1_200 }, dias, p),
  ];

  it("los totales suman lo que suman las líneas", () => {
    const t = payrollTotals(lineas);
    expect(t.staffCount).toBe(2);
    expect(t.gross).toBeCloseTo(lineas[0].grossAmount + lineas[1].grossAmount, 2);
    expect(t.net).toBeCloseTo(lineas[0].netAmount + lineas[1].netAmount, 2);
  });

  it("la cabecera y las filas salen de la misma lista: no se pueden desalinear", () => {
    const csv = payrollCsv(lineas);
    const filas = csv.split("\n");
    expect(filas[0].split(",")).toHaveLength(PAYROLL_COLUMNS.length);
    expect(filas[1].split(",")).toHaveLength(PAYROLL_COLUMNS.length);
    expect(filas).toHaveLength(2 + lineas.length); // cabecera + líneas + totales
    expect(filas[filas.length - 1]).toContain("TOTALES");
  });

  it("un nombre con coma no parte la fila en dos", () => {
    const csv = payrollCsv([payrollLine({ _id: "c", full_name: "Reyes, Ana" }, dias, p)]);
    const fila = csv.split("\n")[1];
    expect(fila).toContain('"Reyes, Ana"');
    // La coma de dentro de las comillas NO cuenta como separador: partir por
    // comas a secas es justo el error que corre la columna del ISR al neto.
    expect(campos(fila)).toHaveLength(PAYROLL_COLUMNS.length);
    expect(campos(fila)[1]).toBe("Reyes, Ana");
  });
});

describe("periodos", () => {
  it("la primera quincena acaba el 15 y la segunda en el último día del mes", () => {
    expect(periodFor("biweekly", "2026-09-10")).toEqual({ start: "2026-09-01", end: "2026-09-15" });
    expect(periodFor("biweekly", "2026-09-16")).toEqual({ start: "2026-09-16", end: "2026-09-30" });
  });

  it("febrero acaba el 28 o el 29, no el 30", () => {
    expect(periodFor("monthly", "2026-02-10").end).toBe("2026-02-28");
    expect(periodFor("monthly", "2028-02-10").end).toBe("2028-02-29");
  });

  it("la semana va de lunes a domingo", () => {
    expect(periodFor("weekly", "2026-09-16")).toEqual({ start: "2026-09-14", end: "2026-09-20" });
  });

  it("el periodo dice cuántos meses cubre, que es lo que el ISR necesita", () => {
    expect(monthsInPeriod("monthly", "2026-09-01", "2026-09-30")).toBe(1);
    expect(monthsInPeriod("biweekly", "2026-09-01", "2026-09-15")).toBe(0.5);
  });
});

describe("estados de la corrida", () => {
  it("no se paga lo que no se aprobó", () => {
    expect(payrollTransition("draft", "pay").ok).toBe(false);
    expect(payrollTransition("approved", "pay")).toEqual({ ok: true, next: "paid" });
  });

  it("no se aprueba dos veces", () => {
    expect(payrollTransition("approved", "approve").ok).toBe(false);
  });

  it("una corrida pagada no se anula: se ajusta en la siguiente", () => {
    const r = payrollTransition("paid", "cancel");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toContain("ajuste");
  });

  it("un borrador sí se anula", () => {
    expect(payrollTransition("draft", "cancel")).toEqual({ ok: true, next: "cancelled" });
  });
});
