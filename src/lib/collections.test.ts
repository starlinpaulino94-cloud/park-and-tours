import { describe, it, expect } from "vitest";
import {
  effectivePolicy, balanceDueDate, buildSchedule, allocate, unallocate,
  statusFor, collectionStatus, agingBucketFor, creditCheck, holdUntil, daysBetween, dayOf,
  type Installment,
} from "@/lib/collections";

const NOW = new Date("2026-04-01T10:00:00Z");

describe("la política de anticipo", () => {
  it("la del producto se usa cuando la venta no pactó nada", () => {
    const policy = effectivePolicy({}, { deposit_type: "percent", deposit_percent: 30, balance_due_days: 15 });
    expect(policy).toMatchObject({ deposit_type: "percent", deposit_percent: 30, balance_due_days: 15 });
  });

  it("la de la venta pisa a la del producto", () => {
    const policy = effectivePolicy(
      { deposit_type: "amount", deposit_amount: 50 },
      { deposit_type: "percent", deposit_percent: 30 }
    );
    expect(policy).toMatchObject({ deposit_type: "amount", deposit_amount: 50 });
  });

  it("'sin anticipo' en la venta es una decisión, no un hueco", () => {
    const policy = effectivePolicy({ deposit_type: "none" }, { deposit_type: "percent", deposit_percent: 50 });
    expect(policy.deposit_type).toBe("none");
  });

  it("sin política en ningún lado, no hay anticipo", () => {
    expect(effectivePolicy(null, null).deposit_type).toBe("none");
  });
});

describe("cuándo vence el saldo", () => {
  it("son N días antes de la salida", () => {
    expect(balanceDueDate("2026-05-20T08:00:00Z", 15, NOW)).toBe("2026-05-05");
  });

  it("una reserva de última hora no nace vencida: vence hoy", () => {
    // Salida en tres días con política de quince: la fecha calculada ya pasó.
    expect(balanceDueDate("2026-04-04T08:00:00Z", 15, NOW)).toBe("2026-04-01");
  });

  it("nunca después de la salida", () => {
    expect(balanceDueDate("2026-04-05T08:00:00Z", 0, NOW)).toBe("2026-04-05");
  });

  it("una salida que ya pasó vence el día de la salida, no hoy", () => {
    expect(balanceDueDate("2026-03-10T08:00:00Z", 15, NOW)).toBe("2026-03-10");
  });

  it("sin salida no hay fecha que derivar", () => {
    expect(balanceDueDate(null, 15, NOW)).toBeNull();
  });
});

describe("el plan de cobro", () => {
  it("anticipo del 30% y saldo", () => {
    const plan = buildSchedule({
      total: 1000, policy: { deposit_type: "percent", deposit_percent: 30 },
      depositDueDate: "2026-04-01", balanceDueDate: "2026-05-05", now: NOW,
    });
    expect(plan).toEqual([
      { sequence: 1, kind: "deposit", due_date: "2026-04-01", amount: 300 },
      { sequence: 2, kind: "balance", due_date: "2026-05-05", amount: 700 },
    ]);
  });

  it("sin anticipo, todo el total es el saldo", () => {
    const plan = buildSchedule({ total: 500, balanceDueDate: "2026-05-05", now: NOW });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: "balance", amount: 500 });
  });

  it("las cuotas suman EXACTAMENTE el total aunque no sea divisible", () => {
    const plan = buildSchedule({
      total: 100, installments: 3, depositDueDate: "2026-04-01",
      balanceDueDate: "2026-07-01", now: NOW,
    });
    expect(plan.map((p) => p.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(plan.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(100, 10);
  });

  it("el céntimo del redondeo va a la última cuota, no al anticipo", () => {
    const plan = buildSchedule({
      total: 100, policy: { deposit_type: "percent", deposit_percent: 33.333 },
      installments: 2, depositDueDate: "2026-04-01", balanceDueDate: "2026-06-01", now: NOW,
    });
    expect(plan[0].amount).toBe(33.33);
    expect(plan.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(100, 10);
    expect(plan.at(-1)!.kind).toBe("balance");
  });

  it("un anticipo mayor que el total se queda en el total y no deja saldo", () => {
    const plan = buildSchedule({
      total: 200, policy: { deposit_type: "amount", deposit_amount: 500 },
      depositDueDate: "2026-04-01", balanceDueDate: "2026-05-01", now: NOW,
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: "deposit", amount: 200 });
  });

  it("las cuotas intermedias se reparten entre las dos fechas", () => {
    const plan = buildSchedule({
      total: 900, installments: 3, depositDueDate: "2026-04-01",
      balanceDueDate: "2026-07-01", now: NOW,
    });
    // Del 1 de abril al 1 de julio hay 91 días: la cuota del medio cae al 46.
    expect(plan.map((p) => p.due_date)).toEqual(["2026-04-01", "2026-05-17", "2026-07-01"]);
  });

  it("ninguna cuota vence antes que el anticipo", () => {
    const plan = buildSchedule({
      total: 300, installments: 3, depositDueDate: "2026-05-01",
      balanceDueDate: "2026-04-01", now: NOW,
    });
    expect(plan.every((p) => p.due_date >= "2026-05-01")).toBe(true);
  });

  it("una venta en cero no genera plan", () => {
    expect(buildSchedule({ total: 0, now: NOW })).toEqual([]);
  });
});

describe("imputar un cobro", () => {
  const plan = (): Installment[] => [
    { _id: "a", sequence: 1, kind: "deposit", due_date: "2026-04-01", amount: 300, paid_amount: 0 },
    { _id: "b", sequence: 2, kind: "installment", due_date: "2026-05-01", amount: 300, paid_amount: 0 },
    { _id: "c", sequence: 3, kind: "balance", due_date: "2026-06-01", amount: 400, paid_amount: 0 },
  ];

  it("va a la cuota más antigua primero", () => {
    const { allocations, unapplied } = allocate(plan(), 300, NOW);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ applied: 300, balance: 0, status: "paid" });
    expect(unapplied).toBe(0);
  });

  it("un cobro grande se reparte sin pasarse de ninguna", () => {
    const { allocations } = allocate(plan(), 450, NOW);
    expect(allocations.map((a) => a.applied)).toEqual([300, 150]);
    expect(allocations[1].status).toBe("partially_paid");
  });

  it("el sobrepago se devuelve sin imputar", () => {
    const { allocations, unapplied } = allocate(plan(), 1200, NOW);
    expect(allocations.map((a) => a.applied)).toEqual([300, 300, 400]);
    expect(unapplied).toBe(200);
  });

  it("una cuota perdonada no recibe dinero", () => {
    const schedule = plan();
    schedule[0].status = "waived";
    const { allocations } = allocate(schedule, 100, NOW);
    expect(allocations[0].installment._id).toBe("b");
  });

  it("un reembolso deshace por la cuota MÁS RECIENTE", () => {
    const schedule = plan().map((i) => ({ ...i, paid_amount: i.amount }));
    const { allocations } = unallocate(schedule, 400, NOW);
    expect(allocations).toHaveLength(1);
    expect(allocations[0].installment._id).toBe("c");
    expect(allocations[0].paid_amount).toBe(0);
  });

  it("un reembolso mayor que lo cobrado devuelve el resto sin imputar", () => {
    const schedule = plan().map((i) => ({ ...i, paid_amount: i.amount }));
    const { unapplied } = unallocate(schedule, 1200, NOW);
    expect(unapplied).toBe(200);
  });

  it("no se pierde un céntimo repartiendo entre muchas cuotas", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      _id: String(i), sequence: i + 1, due_date: `2026-0${i + 1}-01`,
      amount: 14.29, paid_amount: 0,
    }));
    const { allocations, unapplied } = allocate(many, 100.03, NOW);
    const applied = allocations.reduce((s, a) => s + a.applied, 0);
    expect(Math.round((applied + unapplied) * 100) / 100).toBe(100.03);
  });
});

describe("el estado de cada cuota y de la venta", () => {
  it("vencida manda sobre pagada en parte", () => {
    expect(statusFor({ due_date: "2026-03-01", amount: 100, paid_amount: 40 }, NOW)).toBe("overdue");
  });

  it("pagada del todo no vence aunque la fecha pasara", () => {
    expect(statusFor({ due_date: "2026-03-01", amount: 100, paid_amount: 100 }, NOW)).toBe("paid");
  });

  it("perdonada se queda perdonada", () => {
    expect(statusFor({ status: "waived", amount: 100, paid_amount: 0, due_date: "2026-01-01" }, NOW)).toBe("waived");
  });

  it("una venta con todo cobrado queda liquidada", () => {
    expect(collectionStatus([{ amount: 100, paid_amount: 100, due_date: "2026-05-01" }], NOW)).toBe("settled");
  });

  it("basta una cuota vencida para que la venta esté vencida", () => {
    expect(collectionStatus([
      { amount: 100, paid_amount: 100, due_date: "2026-03-01" },
      { amount: 100, paid_amount: 0, due_date: "2026-03-15" },
    ], NOW)).toBe("overdue");
  });

  it("una cuota que vence esta semana avisa", () => {
    expect(collectionStatus([{ amount: 100, paid_amount: 0, due_date: "2026-04-05" }], NOW)).toBe("due_soon");
  });

  it("una cuota lejana está al día", () => {
    expect(collectionStatus([{ amount: 100, paid_amount: 0, due_date: "2026-08-01" }], NOW)).toBe("on_track");
  });

  it("una venta sin plan no tiene estado de cobro", () => {
    expect(collectionStatus([], NOW)).toBe("none");
  });

  it("las cuotas anuladas no cuentan como deuda", () => {
    expect(collectionStatus([{ status: "cancelled", amount: 500, paid_amount: 0, due_date: "2026-01-01" }], NOW))
      .toBe("none");
  });
});

describe("la antigüedad de la deuda", () => {
  it("por vencer es corriente", () => {
    expect(agingBucketFor("2026-04-30", NOW)).toBe("current");
    expect(agingBucketFor("2026-04-01", NOW)).toBe("current");
  });

  it("los tramos son los de la pantalla", () => {
    expect(agingBucketFor("2026-03-25", NOW)).toBe("d1_30");
    expect(agingBucketFor("2026-02-20", NOW)).toBe("d31_60");
    expect(agingBucketFor("2026-01-20", NOW)).toBe("d61_90");
    expect(agingBucketFor("2025-11-01", NOW)).toBe("d90_plus");
  });

  it("los bordes caen del lado correcto", () => {
    expect(agingBucketFor("2026-03-02", NOW)).toBe("d1_30"); // 30 días
    expect(agingBucketFor("2026-03-01", NOW)).toBe("d31_60"); // 31 días
  });
});

describe("el límite de crédito", () => {
  it("un socio sin límite fijado no se bloquea", () => {
    expect(creditCheck({ credit_limit: 0 }, 9999, 500).allowed).toBe(true);
    expect(creditCheck(null, 9999, 500).allowed).toBe(true);
  });

  it("una venta que cabe pasa, y dice cuánto queda", () => {
    const verdict = creditCheck({ credit_limit: 1000 }, 400, 300);
    expect(verdict.allowed).toBe(true);
    expect(verdict.available).toBe(600);
  });

  it("una venta que se pasa se rechaza explicándolo", () => {
    const verdict = creditCheck({ credit_limit: 1000 }, 900, 200);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("límite de crédito");
  });

  it("justo en el límite pasa", () => {
    expect(creditCheck({ credit_limit: 1000 }, 700, 300).allowed).toBe(true);
  });
});

describe("la retención de la plaza", () => {
  it("expira a las horas pactadas", () => {
    expect(holdUntil("2026-04-01T10:00:00Z", 48)).toBe("2026-04-03T10:00:00.000Z");
  });

  it("nunca después de la salida", () => {
    expect(holdUntil("2026-04-01T10:00:00Z", 48, "2026-04-02T08:00:00Z")).toBe("2026-04-02T08:00:00.000Z");
  });

  it("una retención de cero horas sigue dando una hora", () => {
    expect(holdUntil("2026-04-01T10:00:00Z", 0)).toBe("2026-04-01T11:00:00.000Z");
  });
});

describe("utilidades de fecha", () => {
  it("un vencimiento es un día, no un instante", () => {
    expect(dayOf("2026-04-01T23:59:00Z")).toBe("2026-04-01");
    expect(dayOf(null)).toBeNull();
    expect(dayOf("no es una fecha")).toBeNull();
  });

  it("los días se cuentan por día natural", () => {
    expect(daysBetween("2026-04-01", "2026-04-08")).toBe(7);
    expect(daysBetween("2026-04-08", "2026-04-01")).toBe(-7);
  });
});
