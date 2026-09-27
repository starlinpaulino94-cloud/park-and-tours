import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * RR. HH. contra una base simulada.
 *
 * Aquí no se prueba aritmética —de eso va `hr.test.ts`—, sino las tres cosas
 * que solo se ven cuando hay datos de por medio: que el bloqueo por
 * certificación se dispare en la ESCRITURA, que una corrida de nómina no pague
 * dos veces el mismo día, y que anularla suelte lo que había reclamado.
 */

const tenantQuery = vi.fn();
const tenantFindOne = vi.fn();
const tenantCreate = vi.fn();
const tenantUpdate = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: unknown[]) => tenantQuery(...a),
    tenantFindOne: (...a: unknown[]) => tenantFindOne(...a),
    tenantCreate: (...a: unknown[]) => tenantCreate(...a),
    tenantUpdate: (...a: unknown[]) => tenantUpdate(...a),
  };
});

import {
  assertStaffAssignable, assertPayloadAssignable, findShiftConflict,
  generatePayrollRun, releasePayrollRun, policyFromRun, teamWeek,
} from "@/lib/hr-service";

const VENCIDA_BLOQUEANTE = {
  _id: "c1", name: "Primeros auxilios", blocks_assignment: true, expires_at: "2020-01-01",
};
const VIGENTE = { _id: "c2", name: "Idiomas", blocks_assignment: true, expires_at: "2099-01-01" };

beforeEach(() => {
  tenantQuery.mockReset();
  tenantFindOne.mockReset();
  tenantCreate.mockReset();
  tenantUpdate.mockReset();
});

describe("el bloqueo por certificación", () => {
  it("impide asignar y dice QUÉ certificación: «no se puede» sin motivo acaba en una llamada", async () => {
    tenantQuery.mockResolvedValue([VENCIDA_BLOQUEANTE]);
    await expect(assertStaffAssignable("org", "s1")).rejects.toThrow(/Primeros auxilios/);
  });

  it("es 409, no 403: no le faltan permisos a nadie, es que la asignación no se puede hacer", async () => {
    tenantQuery.mockResolvedValue([VENCIDA_BLOQUEANTE]);
    const err = await assertStaffAssignable("org", "s1").catch((e) => e);
    expect((err as { status?: number }).status).toBe(409);
    expect((err as { code?: string }).code).toBe("CERTIFICATION_BLOCKED");
  });

  it("deja pasar a quien lo tiene todo en regla", async () => {
    tenantQuery.mockResolvedValue([VIGENTE]);
    await expect(assertStaffAssignable("org", "s1")).resolves.toBeUndefined();
  });

  it("el turno pasa por la comprobación", async () => {
    tenantQuery.mockResolvedValue([VENCIDA_BLOQUEANTE]);
    await expect(assertPayloadAssignable("org", "shift", { staff: "s1" })).rejects.toThrow();
  });

  it("el recurso de la salida también: el guía sube al bote por ahí", async () => {
    tenantQuery.mockResolvedValue([VENCIDA_BLOQUEANTE]);
    await expect(assertPayloadAssignable("org", "departure_resource", { staff: "s1" })).rejects.toThrow();
  });

  it("la ruta de recogida comprueba conductor Y guía, no solo uno", async () => {
    tenantQuery.mockImplementation((_org: string, _t: string, opts: { _filter?: { staff?: string } }) =>
      Promise.resolve(opts?._filter?.staff === "guia" ? [VENCIDA_BLOQUEANTE] : [VIGENTE])
    );
    await expect(assertPayloadAssignable("org", "pickup_route", { driver: "chofer", guide: "guia" }))
      .rejects.toThrow(/Primeros auxilios/);
  });

  it("una tabla que no asigna trabajo no consulta nada", async () => {
    await expect(assertPayloadAssignable("org", "customer", { staff: "s1" })).resolves.toBeUndefined();
    expect(tenantQuery).not.toHaveBeenCalled();
  });

  it("un payload sin persona no consulta nada: editar la nota de un turno no debe leer certificaciones", async () => {
    await expect(assertPayloadAssignable("org", "shift", { notes: "x" })).resolves.toBeUndefined();
    expect(tenantQuery).not.toHaveBeenCalled();
  });
});

describe("solapes de turno", () => {
  it("mira también el día anterior y el siguiente: el turno de noche acaba al día siguiente", async () => {
    tenantQuery.mockResolvedValue([]);
    await findShiftConflict("org", {
      staff: "s1", shift_date: "2026-09-16",
      starts_at: "2026-09-16T22:00:00Z", ends_at: "2026-09-17T06:00:00Z",
    });
    const filtro = tenantQuery.mock.calls[0][2]._filter;
    expect(filtro.shift_date.gte).toBe("2026-09-15");
    expect(filtro.shift_date.lte).toBe("2026-09-17");
  });

  it("devuelve el turno que choca, no solo «hay choque»", async () => {
    tenantQuery.mockResolvedValue([{
      _id: "otro", shift_date: "2026-09-16",
      starts_at: "2026-09-16T06:00:00Z", ends_at: "2026-09-16T14:00:00Z",
    }]);
    const choque = await findShiftConflict("org", {
      staff: "s1", shift_date: "2026-09-16",
      starts_at: "2026-09-16T13:00:00Z", ends_at: "2026-09-16T20:00:00Z",
    });
    expect((choque as { _id?: string })?._id).toBe("otro");
  });

  it("un turno sin persona no puede chocar con nadie", async () => {
    expect(await findShiftConflict("org", { shift_date: "2026-09-16" })).toBeNull();
    expect(tenantQuery).not.toHaveBeenCalled();
  });
});

describe("la corrida de nómina", () => {
  const RUN = {
    _id: "run-1", status: "draft", period_start: "2026-09-01", period_end: "2026-09-15",
    period_type: "biweekly",
    sfs_employee_pct: 3.041, afp_employee_pct: 2.87,
    sfs_employer_pct: 7.09, afp_employer_pct: 7.1, risk_employer_pct: 1.2,
  };
  const EMPLEADO = {
    _id: "s1", full_name: "Ana", salary_type: "monthly", base_salary: 40_000,
    applies_social_security: true, currency: "dop",
  };
  const MARCAJES = [
    { _id: "a1", staff: "s1", attendance_date: "2026-09-01", clock_in: "2026-09-01T08:00:00Z", clock_out: "2026-09-01T17:00:00Z", break_min: 60, status: "present" },
    { _id: "a2", staff: "s1", attendance_date: "2026-09-02", clock_in: "2026-09-02T08:00:00Z", clock_out: "2026-09-02T17:00:00Z", break_min: 60, status: "present" },
  ];

  const armar = (rows: Record<string, unknown>[] = MARCAJES, staff: unknown = EMPLEADO) => {
    tenantFindOne.mockImplementation((_o: string, table: string) =>
      Promise.resolve(table === "payroll_run" ? RUN : staff)
    );
    tenantQuery.mockImplementation((_o: string, table: string) =>
      Promise.resolve(table === "attendance" ? rows : [])
    );
    tenantCreate.mockResolvedValue({ _id: "line-1" });
    tenantUpdate.mockResolvedValue({});
  };

  it("solo pide los marcajes que NADIE ha pagado: sin eso, regenerar paga dos veces", async () => {
    armar();
    await generatePayrollRun("org", "u1", "run-1");
    const filtro = tenantQuery.mock.calls.find((c) => c[1] === "attendance")![2]._filter;
    expect(filtro.payroll_run_id).toBeNull();
    expect(filtro.attendance_date).toEqual({ gte: "2026-09-01", lte: "2026-09-15" });
  });

  it("ata cada marcaje incluido a la corrida", async () => {
    armar();
    await generatePayrollRun("org", "u1", "run-1");
    const reclamos = tenantUpdate.mock.calls.filter((c) => c[1] === "attendance");
    expect(reclamos.map((c) => c[2]).sort()).toEqual(["a1", "a2"]);
    for (const r of reclamos) expect(r[3]).toEqual({ payroll_run_id: "run-1" });
  });

  it("escribe la línea ANTES de reclamar el marcaje: si se cae a medias, el día queda libre", async () => {
    armar();
    const orden: string[] = [];
    tenantCreate.mockImplementation(() => { orden.push("linea"); return Promise.resolve({ _id: "l" }); });
    tenantUpdate.mockImplementation((_o: string, table: string) => {
      if (table === "attendance") orden.push("reclamo");
      return Promise.resolve({});
    });
    await generatePayrollRun("org", "u1", "run-1");
    expect(orden.indexOf("linea")).toBeLessThan(orden.indexOf("reclamo"));
  });

  it("una corrida que no está en borrador no se puede generar", async () => {
    tenantFindOne.mockResolvedValue({ ...RUN, status: "approved" });
    await expect(generatePayrollRun("org", "u1", "run-1")).rejects.toThrow(/borrador/);
  });

  it("quien no tiene tarifa NO entra en la corrida, y se dice quién es", async () => {
    armar(MARCAJES, { _id: "s1", full_name: "Sin sueldo" });
    const r = await generatePayrollRun("org", "u1", "run-1");
    expect(r.lines).toHaveLength(0);
    expect(r.skipped).toEqual([{ staffName: "Sin sueldo", reason: expect.stringContaining("tarifa") }]);
    // Y sus marcajes quedan libres: no se le reclama nada a quien no se paga.
    expect(tenantUpdate.mock.calls.filter((c) => c[1] === "attendance")).toHaveLength(0);
  });

  it("los totales de la corrida se escriben con lo que suman las líneas", async () => {
    armar();
    const r = await generatePayrollRun("org", "u1", "run-1");
    const cabecera = tenantUpdate.mock.calls.find((c) => c[1] === "payroll_run")!;
    expect(cabecera[3].net_amount).toBe(r.totals.net);
    expect(cabecera[3].staff_count).toBe(1);
  });

  it("un marcaje sin persona no se cuela en la nómina de nadie", async () => {
    armar([{ _id: "x", attendance_date: "2026-09-01", status: "present", hours_worked: 8 }]);
    const r = await generatePayrollRun("org", "u1", "run-1");
    expect(r.lines).toHaveLength(0);
  });

  it("anular suelta los marcajes: si no, esas horas no se pagarían nunca", async () => {
    tenantQuery.mockResolvedValue([{ _id: "a1" }, { _id: "a2" }]);
    tenantUpdate.mockResolvedValue({});
    const sueltos = await releasePayrollRun("org", "run-1");
    expect(sueltos).toBe(2);
    for (const c of tenantUpdate.mock.calls) expect(c[3]).toEqual({ payroll_run_id: null });
  });
});

describe("los porcentajes viven en la corrida, no en el maestro", () => {
  it("se leen de la fila: lo pagado en marzo se explica con los números de marzo", () => {
    const p = policyFromRun({
      sfs_employee_pct: 1, afp_employee_pct: 2, sfs_employer_pct: 3,
      afp_employer_pct: 4, risk_employer_pct: 5,
      period_type: "monthly", period_start: "2026-03-01", period_end: "2026-03-31",
    });
    expect(p).toEqual({
      sfsEmployeePct: 1, afpEmployeePct: 2, sfsEmployerPct: 3,
      afpEmployerPct: 4, riskEmployerPct: 5, monthsInPeriod: 1,
    });
  });
});

describe("la semana del equipo", () => {
  it("marca a quien no puede recibir turnos y cuenta lo que está por vencer", async () => {
    tenantQuery.mockImplementation((_o: string, table: string) => {
      if (table === "staff") return Promise.resolve([{ _id: "s1", full_name: "Ana" }, { _id: "s2", full_name: "Luis" }]);
      if (table === "shift") return Promise.resolve([
        { _id: "t1", staff: "s1", shift_date: "2026-09-14", hours_planned: 8 },
      ]);
      const pronto = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      return Promise.resolve([
        { _id: "c1", staff: "s1", name: "Primeros auxilios", blocks_assignment: true, expires_at: "2020-01-01" },
        { _id: "c2", staff: "s2", name: "Salvamento", expires_at: pronto },
      ]);
    });
    const semana = await teamWeek("org", "2026-09-16");
    expect(semana.weekOf).toBe("2026-09-14");
    const ana = semana.staff.find((s) => s.staffId === "s1")!;
    const luis = semana.staff.find((s) => s.staffId === "s2")!;
    expect(ana.blocked).toBe(true);
    expect(ana.plannedHours).toBe(8);
    expect(luis.blocked).toBe(false);
    expect(luis.expiring).toBe(1);
  });
});


/**
 * LA NÓMINA DE UNA EMPRESA GRANDE (ola 9.13).
 *
 * `generatePayrollRun` leía los marcajes con `_limit: 5000`. Un parque con
 * trescientas personas y dos marcajes diarios llega a cinco mil en nueve días,
 * y lo que quedaba fuera NO SE PAGABA: no daba error, no salía en la corrida y
 * se quedaba con `payroll_run_id` nulo, así que volvería el mes siguiente… si
 * alguien mira un período ya cerrado. Nadie lo mira.
 *
 * `releasePayrollRun` tenía el mismo tope, y ahí la cabecera de la propia
 * función ya avisaba del desastre: un marcaje pegado a una corrida anulada «no
 * se pagaría nunca», porque la siguiente solo mira los de `payroll_run_id`
 * nulo. El tope hacía que eso ocurriera en silencio.
 */
describe("una corrida con más de cinco mil marcajes", () => {
  const RUN = {
    _id: "run-1", status: "draft", period_start: "2026-09-01", period_end: "2026-09-30",
    period_type: "monthly",
    sfs_employee_pct: 3.041, afp_employee_pct: 2.87,
    sfs_employer_pct: 7.09, afp_employer_pct: 7.1, risk_employer_pct: 1.2,
  };
  const EMPLEADO = {
    _id: "s1", full_name: "Ana", salary_type: "monthly", base_salary: 40_000,
    applies_social_security: true, currency: "dop",
  };

  /** Marcajes de un día distinto cada uno, para que ninguno se descarte. */
  function marcajes(cuantos: number) {
    return Array.from({ length: cuantos }, (_, i) => {
      const dia = String(1 + (i % 30)).padStart(2, "0");
      return {
        _id: `m-${String(i).padStart(5, "0")}`,
        staff: `s${i % 300}`,
        attendance_date: `2026-09-${dia}`,
        clock_in: `2026-09-${dia}T08:00:00Z`,
        clock_out: `2026-09-${dia}T17:00:00Z`,
        break_min: 60, status: "present",
      };
    });
  }

  /**
   * Un `tenantQuery` que respeta la VENTANA.
   *
   * Es lo que hace honesta esta prueba: devolviendo siempre las mismas filas,
   * una lectura que no avanza su cursor habría salido en verde.
   */
  function porVentanas(filas: Record<string, unknown>[]) {
    tenantFindOne.mockImplementation((_o: string, table: string) =>
      Promise.resolve(table === "payroll_run" ? RUN : EMPLEADO)
    );
    tenantQuery.mockImplementation((_o: string, table: string, opts: Record<string, number>) => {
      if (table !== "attendance") return Promise.resolve([]);
      const salto = Number(opts?._offset ?? 0);
      const limite = Number(opts?._limit ?? 50);
      return Promise.resolve(filas.slice(salto, salto + limite));
    });
    tenantCreate.mockResolvedValue({ _id: "line-1" });
    tenantUpdate.mockResolvedValue({});
  }

  it("reclama TODOS los marcajes del período, no los cinco mil primeros", async () => {
    porVentanas(marcajes(5300));

    await generatePayrollRun("org", "u1", "run-1");

    const reclamados = tenantUpdate.mock.calls.filter((c) => c[1] === "attendance");
    // Con el tope, trescientos marcajes se quedaban sin pagar y sin avisar.
    expect(reclamados).toHaveLength(5300);
    expect(new Set(reclamados.map((c) => c[2])).size).toBe(5300);
  });

  it("y anular la corrida los suelta TODOS: si no, esas horas no se pagan nunca", async () => {
    const filas = marcajes(5300).map((m) => ({ ...m, payroll_run_id: "run-1" }));
    tenantQuery.mockImplementation((_o: string, table: string, opts: Record<string, number>) => {
      if (table !== "attendance") return Promise.resolve([]);
      const salto = Number(opts?._offset ?? 0);
      const limite = Number(opts?._limit ?? 50);
      return Promise.resolve(filas.slice(salto, salto + limite));
    });
    tenantUpdate.mockResolvedValue({});

    const sueltos = await releasePayrollRun("org", "run-1");

    expect(sueltos).toBe(5300);
    const liberados = tenantUpdate.mock.calls.filter((c) => c[1] === "attendance");
    expect(liberados).toHaveLength(5300);
    for (const l of liberados.slice(0, 5)) expect(l[3]).toEqual({ payroll_run_id: null });
  });

  it("si de verdad no se pueden leer, no se genera media nómina", async () => {
    porVentanas(marcajes(10_600));
    await expect(generatePayrollRun("org", "u1", "run-1")).rejects.toThrow(/no se pudo leer/i);
  });
});
