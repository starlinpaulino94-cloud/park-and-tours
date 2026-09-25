import "server-only";
import { tenantQuery, tenantFindOne, tenantCreate, tenantUpdate, TenantError } from "@/lib/tenant";
import { refId } from "@/lib/types";
import { leerTodoElRecurso } from "@/lib/barrido";
import {
  assignmentBlock, certificationState, conflictingShift, plannedHours,
  attendanceHours, hourlyRateFor, payrollLine, payrollTotals, monthsInPeriod,
  dayOf, weekKey,
  type CertificationLike, type ShiftLike, type AttendanceLike,
  type PayrollEntry, type PayrollLineDraft, type PayrollPolicy, type PeriodType,
  type StaffLike,
} from "@/lib/hr";

/**
 * RR. HH. contra la base: el sitio donde las reglas de `hr.ts` tocan datos.
 *
 * Tres decisiones de fondo:
 *
 *  · **El bloqueo se comprueba al ASIGNAR, no al mirar.** Una pantalla que
 *    pinta la certificación en rojo no impide nada: el encargado asigna igual
 *    desde el móvil a las seis de la mañana. La comprobación va en la escritura
 *    —turno y recurso de salida—, que es por donde pasa todo el mundo.
 *
 *  · **La nómina RECLAMA sus marcajes.** Cada asistencia incluida queda atada a
 *    la corrida en el momento de incluirla. Es la misma defensa que usan las
 *    liquidaciones de proveedor, y por la misma razón: sin ella, dos
 *    generaciones a la vez pagan el mismo día dos veces.
 *
 *  · **La corrida congela sus porcentajes.** Los tipos de la TSS se copian a la
 *    corrida al generarla. Cuando cambien, lo pagado en marzo seguirá
 *    explicándose con los números de marzo.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/* ═══════════════════════════════════════════ el bloqueo por certificación */

/** Tablas cuya escritura asigna trabajo a una persona. */
export const ASSIGNING_TABLES = new Set(["shift", "departure_resource", "pickup_route"]);

/** Los campos por los que cada una apunta a la persona asignada. */
const STAFF_FIELDS: Record<string, string[]> = {
  shift: ["staff"],
  departure_resource: ["staff"],
  // Una ruta de recogida lleva conductor y guía, y los dos son asignaciones.
  pickup_route: ["driver", "guide"],
};

/** Las certificaciones de una persona. */
export async function certificationsOf(companyId: string, staffId: string): Promise<CertificationLike[]> {
  return tenantQuery<CertificationLike>(companyId, "certification", {
    _filter: { staff: staffId },
    _limit: 100,
  });
}

/**
 * Impide asignar a quien tiene una certificación obligatoria vencida.
 *
 * Lanza 409, no 403: no es que al usuario le falten permisos —es que la
 * asignación no se puede hacer—. El mensaje dice QUÉ certificación, porque «no
 * se puede» sin el motivo acaba en una llamada telefónica.
 */
export async function assertStaffAssignable(
  companyId: string,
  staffId: string,
  today = new Date().toISOString().slice(0, 10)
): Promise<void> {
  const certs = await certificationsOf(companyId, staffId);
  const block = assignmentBlock(certs, today);
  if (block) {
    throw Object.assign(new TenantError(block.reason, 409), {
      code: "CERTIFICATION_BLOCKED",
      certifications: block.certifications,
    });
  }
}

/**
 * La comprobación para la API genérica: mira el payload, saca a quién se
 * asigna y lo verifica.
 *
 * Se hace sobre el payload ya limpio, así que un campo que el recurso no acepta
 * nunca llega hasta aquí.
 */
export async function assertPayloadAssignable(
  companyId: string,
  table: string,
  payload: Record<string, unknown>
): Promise<void> {
  const fields = STAFF_FIELDS[table];
  if (!fields) return;
  const ids = fields
    .map((f) => (payload[f] === undefined ? null : refId(payload[f])))
    .filter((x): x is string => Boolean(x));
  // Sin duplicados: el mismo guía puede ir en dos campos de la misma fila.
  for (const id of new Set(ids)) {
    await assertStaffAssignable(companyId, id);
  }
}

/* ═════════════════════════════════════════════════════════════════ turnos */

/**
 * El turno que choca con este, si lo hay.
 *
 * Solo mira los turnos de la MISMA persona en un margen de un día por cada
 * lado: un turno de noche empieza el 16 y acaba el 17, así que mirar solo el
 * día del turno dejaría pasar justo el solape que más duele.
 */
export async function findShiftConflict(
  companyId: string,
  candidate: ShiftLike & { staff?: unknown }
): Promise<ShiftLike | null> {
  const staffId = refId(candidate.staff);
  const day = dayOf(candidate.shift_date);
  if (!staffId || !day) return null;

  const from = new Date(`${day}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${day}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 1);

  const vecinos = await tenantQuery<ShiftLike>(companyId, "shift", {
    _filter: {
      staff: staffId,
      shift_date: { gte: from.toISOString().slice(0, 10), lte: to.toISOString().slice(0, 10) },
    },
    _limit: 50,
  });
  return conflictingShift(vecinos, candidate);
}

/* ═══════════════════════════════════════════════════════════════ marcajes */

/** El marcaje de una persona en un día, si existe. */
export async function attendanceFor(
  companyId: string,
  staffId: string,
  day: string
): Promise<AttendanceLike | null> {
  const rows = await tenantQuery<AttendanceLike>(companyId, "attendance", {
    _filter: { staff: staffId, attendance_date: day },
    _limit: 1,
  });
  return rows[0] ?? null;
}

/* ═══════════════════════════════════════════════════════════════ la nómina */

export interface RunPolicyRow {
  sfs_employee_pct?: number | null;
  afp_employee_pct?: number | null;
  sfs_employer_pct?: number | null;
  afp_employer_pct?: number | null;
  risk_employer_pct?: number | null;
  period_type?: string | null;
  period_start?: string | null;
  period_end?: string | null;
}

/** Los porcentajes que esta corrida congeló, con su equivalencia en meses. */
export function policyFromRun(run: RunPolicyRow): PayrollPolicy {
  return {
    sfsEmployeePct: num(run.sfs_employee_pct),
    afpEmployeePct: num(run.afp_employee_pct),
    sfsEmployerPct: num(run.sfs_employer_pct),
    afpEmployerPct: num(run.afp_employer_pct),
    riskEmployerPct: num(run.risk_employer_pct),
    monthsInPeriod: monthsInPeriod(
      (run.period_type || "biweekly") as PeriodType,
      String(run.period_start || ""),
      String(run.period_end || "")
    ),
  };
}

interface AttendanceRow extends AttendanceLike {
  _id?: string;
  id?: string;
}

export interface GeneratedRun {
  runId: string;
  lines: PayrollLineDraft[];
  totals: ReturnType<typeof payrollTotals>;
  claimed: number;
  skipped: { staffName: string; reason: string }[];
}

/**
 * Genera la corrida: recoge los marcajes del periodo, los agrupa por persona,
 * calcula cada línea y ata los marcajes a la corrida.
 *
 * Los marcajes que YA pertenecen a otra corrida no entran: eso es lo que
 * convierte un reintento en algo inofensivo.
 */
export async function generatePayrollRun(
  companyId: string,
  userId: string,
  runId: string
): Promise<GeneratedRun> {
  const run = await tenantFindOne<Record<string, unknown>>(companyId, "payroll_run", runId);
  if (String(run.status || "draft") !== "draft") {
    throw new TenantError("Solo se puede generar una corrida en borrador.", 409);
  }
  const start = dayOf(run.period_start);
  const end = dayOf(run.period_end);
  if (!start || !end) throw new TenantError("La corrida no tiene periodo.", 400);

  const policy = policyFromRun(run as RunPolicyRow);

  // Marcajes del periodo que nadie ha pagado todavía.
  /**
   * LOS MARCAJES DEL PERÍODO, TODOS.
   *
   * De aquí sale lo que se le paga a cada persona. Con el tope de cinco mil, los
   * marcajes que quedaban fuera **no se pagaban**: no daban error, no salían en
   * la corrida y seguían con `payroll_run_id` nulo, así que volverían el mes
   * siguiente… si alguien mira un período que ya se cerró. Nadie lo mira.
   *
   * Un parque con trescientas personas y dos marcajes diarios llega a cinco mil
   * en nueve días.
   */
  const rows = await leerTodoElRecurso<AttendanceRow>("attendance", (limite, salto) =>
    tenantQuery(companyId, "attendance", {
      _filter: {
        attendance_date: { gte: start, lte: end },
        payroll_run_id: null,
      },
      _sort: { attendance_date: "asc", _id: "asc" },
      _limit: limite, _offset: salto,
    }));

  const porPersona = new Map<string, { entries: PayrollEntry[]; attendanceIds: string[] }>();
  for (const row of rows) {
    const staffId = refId(row.staff);
    if (!staffId) continue;
    const day = dayOf(row.attendance_date);
    if (!day) continue;
    const hours = attendanceHours(row);
    const acc = porPersona.get(staffId) || { entries: [], attendanceIds: [] };
    acc.entries.push({ date: day, regular: hours.regular, overtime: hours.overtime });
    const id = String(row._id || row.id || "");
    if (id) acc.attendanceIds.push(id);
    porPersona.set(staffId, acc);
  }

  const lines: PayrollLineDraft[] = [];
  const skipped: { staffName: string; reason: string }[] = [];
  let claimed = 0;

  for (const [staffId, acc] of porPersona) {
    const staff = await tenantFindOne<StaffLike>(companyId, "staff", staffId).catch(() => null);
    if (!staff) continue;

    // Sin tarifa no hay nómina que calcular, y una línea a cero escondida entre
    // veinte se paga a cero sin que nadie lo note. Se dice en voz alta.
    if (hourlyRateFor(staff) <= 0) {
      skipped.push({
        staffName: String(staff.full_name || "Sin nombre"),
        reason: "No tiene sueldo ni tarifa por hora configurados.",
      });
      continue;
    }

    const draft = payrollLine(staff, acc.entries, policy);
    lines.push(draft);

    await tenantCreate(companyId, "payroll_line", {
      payroll_run_id: runId,
      staff_id: staffId,
      staff_name: draft.staffName,
      payroll_code: draft.payrollCode,
      social_security_id: draft.socialSecurityId,
      days_worked: draft.daysWorked,
      regular_hours: draft.regularHours,
      overtime_hours: draft.overtimeHours,
      extra_overtime_hours: draft.extraOvertimeHours,
      hourly_rate: draft.hourlyRate,
      regular_amount: draft.regularAmount,
      overtime_amount: draft.overtimeAmount,
      other_earnings: draft.otherEarnings,
      gross_amount: draft.grossAmount,
      sfs_employee: draft.sfsEmployee,
      afp_employee: draft.afpEmployee,
      isr_amount: draft.isrAmount,
      other_deductions: draft.otherDeductions,
      deductions_amount: draft.deductionsAmount,
      net_amount: draft.netAmount,
      employer_cost: draft.employerCost,
      currency: draft.currency,
    });

    // Reclamar DESPUÉS de escribir la línea: si algo se cae a medias, el
    // marcaje sigue libre para la siguiente generación en vez de quedar
    // atrapado en una corrida que no llegó a tener su línea.
    for (const id of acc.attendanceIds) {
      await tenantUpdate(companyId, "attendance", id, { payroll_run_id: runId });
      claimed += 1;
    }
  }

  const totals = payrollTotals(lines);
  await tenantUpdate(companyId, "payroll_run", runId, {
    gross_amount: totals.gross,
    deductions_amount: totals.deductions,
    net_amount: totals.net,
    employer_cost: totals.employerCost,
    staff_count: totals.staffCount,
  });

  console.log(`[payroll] corrida ${runId}: ${lines.length} personas, ${claimed} marcajes reclamados`);
  return { runId, lines, totals, claimed, skipped };
}

/**
 * Suelta los marcajes de una corrida anulada.
 *
 * Sin esto, anular una corrida dejaría el trabajo de esa quincena reclamado
 * para siempre: la siguiente corrida no lo vería y esas horas no se pagarían
 * nunca.
 */
export async function releasePayrollRun(companyId: string, runId: string): Promise<number> {
  /**
   * Y al deshacer una corrida, TODOS los suyos.
   *
   * La cabecera de esta función ya lo dice: un marcaje que se queda pegado a una
   * corrida anulada «no se pagaría nunca», porque la siguiente corrida solo mira
   * los que tienen `payroll_run_id` nulo. El tope de cinco mil hacía que ese
   * desastre —el que la función existe para evitar— ocurriera en silencio en
   * cuanto la corrida pasaba de cinco mil marcajes.
   */
  const rows = await leerTodoElRecurso<AttendanceRow>("attendance", (limite, salto) =>
    tenantQuery(companyId, "attendance", {
      _filter: { payroll_run_id: runId },
      _sort: { attendance_date: "asc", _id: "asc" },
      _limit: limite, _offset: salto,
    }));
  for (const row of rows) {
    const id = String(row._id || row.id || "");
    if (id) await tenantUpdate(companyId, "attendance", id, { payroll_run_id: null });
  }
  return rows.length;
}

/** Las líneas ya guardadas de una corrida, en la forma que espera el dominio. */
export async function linesOf(companyId: string, runId: string): Promise<PayrollLineDraft[]> {
  // Las líneas de la corrida, enteras: el total de la nómina es su suma, y una
  // línea que no se lee es una persona a la que no se le paga.
  const rows = await leerTodoElRecurso<Record<string, unknown>>("payroll_line", (limite, salto) =>
    tenantQuery(companyId, "payroll_line", {
      _filter: { payroll_run_id: runId },
      _sort: { staff_name: "asc", _id: "asc" },
      _limit: limite, _offset: salto,
    }));
  return rows.map((r) => ({
    staffId: refId(r.staff) || null,
    staffName: String(r.staff_name || ""),
    payrollCode: (r.payroll_code as string) ?? null,
    socialSecurityId: (r.social_security_id as string) ?? null,
    daysWorked: num(r.days_worked),
    regularHours: num(r.regular_hours),
    overtimeHours: num(r.overtime_hours),
    extraOvertimeHours: num(r.extra_overtime_hours),
    hourlyRate: num(r.hourly_rate),
    regularAmount: num(r.regular_amount),
    overtimeAmount: num(r.overtime_amount),
    otherEarnings: num(r.other_earnings),
    grossAmount: num(r.gross_amount),
    sfsEmployee: num(r.sfs_employee),
    afpEmployee: num(r.afp_employee),
    isrAmount: num(r.isr_amount),
    otherDeductions: num(r.other_deductions),
    deductionsAmount: num(r.deductions_amount),
    netAmount: num(r.net_amount),
    employerCost: num(r.employer_cost),
    currency: String(r.currency || "dop"),
  }));
}

/* ══════════════════════════════════════════════════ el resumen del equipo */

export interface TeamWeek {
  weekOf: string;
  staff: {
    staffId: string;
    name: string;
    plannedHours: number;
    shifts: number;
    blocked: boolean;
    blockReason: string | null;
    expiring: number;
  }[];
}

/**
 * La semana del equipo, con lo que hace falta ver de un vistazo: quién cubre
 * cuántas horas y a quién no se le puede asignar nada.
 */
export async function teamWeek(companyId: string, anyDay: string): Promise<TeamWeek> {
  const start = weekKey(dayOf(anyDay) || anyDay);
  const endDate = new Date(`${start}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  const end = endDate.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  // Los turnos de la semana y las acreditaciones, enteros: es la misma pantalla
  // que decide quién trabaja, y un turno que no se lee es un hueco de cobertura
  // que nadie ve. `staff` se queda con su tope de 300 a propósito: es una cota
  // real —el personal activo de una operadora—, no un barrido.
  const [staff, shifts, certs] = await Promise.all([
    tenantQuery<StaffLike>(companyId, "staff", { _filter: { status: "active" }, _limit: 300 }),
    leerTodoElRecurso<ShiftLike>("shift", (limite, salto) =>
      tenantQuery(companyId, "shift", {
        _filter: { shift_date: { gte: start, lte: end } },
        _sort: { shift_date: "asc", _id: "asc" },
        _limit: limite, _offset: salto,
      })),
    leerTodoElRecurso<CertificationLike>("certification", (limite, salto) =>
      tenantQuery(companyId, "certification", {
        _sort: { expires_at: "asc", _id: "asc" },
        _limit: limite, _offset: salto,
      })),
  ]);

  const certsBy = new Map<string, CertificationLike[]>();
  for (const c of certs) {
    const sid = refId(c.staff);
    if (!sid) continue;
    certsBy.set(sid, [...(certsBy.get(sid) || []), c]);
  }

  return {
    weekOf: start,
    staff: staff.map((s) => {
      const sid = String(s._id || s.id || "");
      const suyos = shifts.filter((sh) => refId(sh.staff) === sid);
      const misCerts = certsBy.get(sid) || [];
      const block = assignmentBlock(misCerts, today);
      return {
        staffId: sid,
        name: String(s.full_name || "Sin nombre"),
        plannedHours: round2(suyos.reduce((acc, sh) => acc + plannedHours(sh), 0)),
        shifts: suyos.length,
        blocked: Boolean(block),
        blockReason: block?.reason ?? null,
        expiring: misCerts.filter((c) => certificationState(c, today) === "expiring").length,
      };
    }),
  };
}
