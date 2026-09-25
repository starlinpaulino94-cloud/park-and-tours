import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";
import { fakeSupabase, type FakeSupabase } from "@/test/fake-supabase";

/**
 * LAS METAS Y SUS BONOS, CONTRA LA BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DÓNDE SE PUEDE EQUIVOCAR ESTE SERVICIO
 *
 * Las reglas —qué rango cubre una meta, cuándo está cumplida, cómo se reparte
 * un bono entre efectivo y especie— viven en `seller-goals.ts` y están
 * probadas. Lo que decide ESTE fichero es de quién son las cifras y qué paga
 * una liquidación, y las dos cosas son dinero que sale del banco:
 *
 *   · con qué alcance se juzga una meta al otorgar el bono, que no tiene por
 *     qué ser el mismo con el que se pinta en el tablero;
 *   · dónde se corta el día del rango;
 *   · y cuáles de los bonos de un vendedor paga ESTA liquidación.
 */

let db: FakeDb;
let sb: FakeSupabase;

vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => sb }));
vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantCreate: (...a: [string, string, Record<string, unknown>]) => db.tenantCreate(...a),
    tenantUpdate: (...a: [string, string, string, Record<string, unknown>]) => db.tenantUpdate(...a),
  };
});
const auditado = vi.fn();
vi.mock("@/lib/audit", () => ({ writeAudit: (...a: unknown[]) => auditado(...a) }));

import {
  actualsFor, goalsWithProgress, awardGoalBonus, bonusesOf, attachBonusesToSettlement,
} from "@/lib/seller-goals-service";

const ORG = "org-1";
const ctx = {
  companyId: ORG, userId: "usr-1",
  company: { _id: ORG, timezone: "America/Santo_Domingo" },
} as never;

const callado = async <T>(fn: () => Promise<T>): Promise<T> => {
  const real = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = real; }
};

/** Una meta de reservas de un vendedor concreto para septiembre de 2026. */
const META = {
  _id: "meta-1", organization_id: ORG, name: "Septiembre fuerte", status: "active",
  period: "custom", period_from: "2026-09-01", period_to: "2026-09-30",
  seller: "ven-1", target_bookings: 2, currency: "usd", reward: "Bono de 100",
  created_at: "2026-09-01T00:00:00.000Z",
};

const reserva = (over: Record<string, unknown>) => ({
  organization_id: ORG, status: "paid", adults: 2, children: 0, infants: 0,
  total_amount: 100, currency: "usd", seller_id: "ven-1", product_id: "prod-1", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb();
  sb = fakeSupabase(db);
  db.seed("seller", [
    { _id: "ven-1", organization_id: ORG, first_name: "Marisol", seller_type_id: "tipo-hotel", branch_id: "suc-1" },
    { _id: "ven-2", organization_id: ORG, first_name: "Aníbal", seller_type_id: "tipo-hotel", branch_id: "suc-1" },
    { _id: "ven-3", organization_id: ORG, first_name: "Rosa", seller_type_id: "tipo-calle", branch_id: "suc-2" },
  ]);
  db.seed("seller_goal", [META]);
});

/* ═════════════════════════ de quién son las cifras ══════════════════════ */

describe("lo conseguido de verdad", () => {
  it("cuenta reservas, ventas cerradas, pasajeros e ingresos", async () => {
    db.seed("booking", [
      reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z", status: "paid", adults: 2, infants: 1 }),
      reserva({ _id: "bk-2", created_at: "2026-09-11T15:00:00.000Z", status: "confirmed", total_amount: 50 }),
    ]);
    const out = await actualsFor(ORG, { sellerId: "ven-1" }, { from: "2026-09-01", to: "2026-09-30" });
    expect(out.bookings).toBe(2);
    expect(out.sales, "«confirmed» todavía no es dinero de verdad").toBe(1);
    expect(out.pax, "los bebés ocupan asiento y van en el manifiesto").toBe(5);
    expect(out.revenue).toBe(150);
  });

  it("una reserva cancelada no es una venta", async () => {
    db.seed("booking", [
      reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z", status: "cancelled" }),
      reserva({ _id: "bk-2", created_at: "2026-09-10T15:00:00.000Z", status: "pending" }),
    ]);
    const out = await actualsFor(ORG, { sellerId: "ven-1" }, { from: "2026-09-01", to: "2026-09-30" });
    expect(out.bookings).toBe(0);
  });

  it("los captados son personas, no eventos", async () => {
    // El mismo cliente captado dos veces es uno.
    db.seed("seller_attribution", [
      { _id: "a1", organization_id: ORG, seller_id: "ven-1", stage: "signup", customer_id: "cli-1", created_at: "2026-09-05T12:00:00.000Z" },
      { _id: "a2", organization_id: ORG, seller_id: "ven-1", stage: "signup", customer_id: "cli-1", created_at: "2026-09-06T12:00:00.000Z" },
      { _id: "a3", organization_id: ORG, seller_id: "ven-1", stage: "signup", visitor_id: "vis-9", created_at: "2026-09-07T12:00:00.000Z" },
    ]);
    const out = await actualsFor(ORG, { sellerId: "ven-1" }, { from: "2026-09-01", to: "2026-09-30" });
    expect(out.signups).toBe(2);
  });

  it("EL DÍA DEL RANGO ES EL DE LA EMPRESA", async () => {
    /**
     * El rango salía cortado en UTC. Una venta de las 21:00 del 30 de
     * septiembre en Santo Domingo son las 01:00 UTC del 1 de octubre: quedaba
     * FUERA de la meta de septiembre. El vendedor pierde de su premio lo que
     * vendió la última noche, que es cuando se vende.
     */
    db.seed("booking", [
      reserva({ _id: "bk-noche", created_at: "2026-10-01T01:00:00.000Z" }),
    ]);
    const enUtc = await actualsFor(ORG, { sellerId: "ven-1" }, { from: "2026-09-01", to: "2026-09-30" });
    const enLaEmpresa = await actualsFor(
      ORG, { sellerId: "ven-1" }, { from: "2026-09-01", to: "2026-09-30" }, "America/Santo_Domingo"
    );
    expect(enUtc.bookings, "en UTC se queda fuera").toBe(0);
    expect(enLaEmpresa.bookings, "en la zona de la empresa es del 30 de septiembre").toBe(1);
  });

  it("y la medianoche no cuenta en dos metas a la vez", async () => {
    // El límite de arriba es SEMIABIERTO: el primer instante del día siguiente
    // no pertenece al rango.
    db.seed("booking", [
      reserva({ _id: "bk-borde", created_at: "2026-10-01T04:00:00.000Z" }), // 00:00 del 1 de octubre, allá
    ]);
    const out = await actualsFor(
      ORG, { sellerId: "ven-1" }, { from: "2026-09-01", to: "2026-09-30" }, "America/Santo_Domingo"
    );
    expect(out.bookings).toBe(0);
  });

  it("una meta de grupo suma a todos los del tipo", async () => {
    db.seed("booking", [
      reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z", seller_id: "ven-1" }),
      reserva({ _id: "bk-2", created_at: "2026-09-11T15:00:00.000Z", seller_id: "ven-2" }),
      reserva({ _id: "bk-3", created_at: "2026-09-12T15:00:00.000Z", seller_id: "ven-3" }),
    ]);
    const out = await actualsFor(ORG, { sellerTypeId: "tipo-hotel" }, { from: "2026-09-01", to: "2026-09-30" });
    expect(out.bookings, "entró alguien de otro tipo").toBe(2);
  });

  it("un alcance que no cubre a nadie tiene sus cifras en cero, no las de la empresa", async () => {
    db.seed("booking", [reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z" })]);
    const out = await actualsFor(ORG, { sellerTypeId: "tipo-vacio" }, { from: "2026-09-01", to: "2026-09-30" });
    expect(out.bookings).toBe(0);
  });

  it("no poder resolver el alcance se dice en vez de salir al 0 %", async () => {
    sb.breakReads("seller");
    const gritos: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => { gritos.push(a.join(" ")); };
    try {
      await actualsFor(ORG, { sellerTypeId: "tipo-hotel" }, { from: "2026-09-01", to: "2026-09-30" });
    } finally {
      console.error = real;
    }
    expect(gritos.join(" ")).toMatch(/no se pudo resolver el alcance/);
  });

  it("la categoría se resuelve por producto, y solo si la meta la pide", async () => {
    db.seed("product", [
      { _id: "prod-1", organization_id: ORG, name: "Saona", category_id: "cat-mar" },
      { _id: "prod-2", organization_id: ORG, name: "Buggy", category_id: "cat-tierra" },
    ]);
    db.seed("booking", [
      reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z", product_id: "prod-1" }),
      reserva({ _id: "bk-2", created_at: "2026-09-11T15:00:00.000Z", product_id: "prod-2" }),
    ]);
    const out = await actualsFor(
      ORG, { sellerId: "ven-1", categoryId: "cat-mar" }, { from: "2026-09-01", to: "2026-09-30" }
    );
    expect(out.bookings).toBe(1);
  });
});

/* ═══════════════════════════════ el tablero ═════════════════════════════ */

describe("el tablero de metas", () => {
  it("pinta el progreso de las metas vivas, lo más cerca arriba", async () => {
    db.seed("seller_goal", [{
      ...META, _id: "meta-2", name: "Lejana", seller: "ven-2", target_bookings: 10,
    }]);
    db.seed("booking", [
      reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z", seller_id: "ven-1" }),
    ]);
    const out = await goalsWithProgress(ORG, { now: new Date("2026-09-15T12:00:00.000Z") });
    expect(out).toHaveLength(2);
    expect(out[0].goal._id, "lo más cerca de cumplirse tiene que ir arriba").toBe("meta-1");
  });

  it("una meta de grupo también es suya", async () => {
    // Filtrar por vendedor es filtrar por metas que le APLIQUEN: una meta de
    // «todos los hoteles» también es suya.
    db.seed("seller_goal", [{ ...META, _id: "meta-grupo", seller: null, seller_type: "tipo-hotel" }]);
    const out = await goalsWithProgress(ORG, {
      sellerId: "ven-2", now: new Date("2026-09-15T12:00:00.000Z"),
    });
    expect(out.map((g) => g.goal._id)).toContain("meta-grupo");
    expect(out.map((g) => g.goal._id), "vio la meta de un compañero").not.toContain("meta-1");
  });

  it("dice si está cumplida", async () => {
    db.seed("booking", [
      reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z" }),
      reserva({ _id: "bk-2", created_at: "2026-09-11T15:00:00.000Z" }),
    ]);
    const [meta] = await goalsWithProgress(ORG, { now: new Date("2026-09-15T12:00:00.000Z") });
    expect(meta.achieved).toBe(true);
  });
});

/* ════════════════════════════════ el bono ══════════════════════════════ */

describe("otorgar el bono de una meta", () => {
  const cumplida = () => db.seed("booking", [
    reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z" }),
    reserva({ _id: "bk-2", created_at: "2026-09-11T15:00:00.000Z" }),
  ]);

  it("una meta cumplida se otorga, y su condición queda congelada", async () => {
    // Dentro de seis meses la meta puede estar editada o borrada.
    cumplida();
    const out = await awardGoalBonus(ctx, { goalId: "meta-1", sellerId: "ven-1", amount: 100 });
    const bono = db.row("seller_bonus", { _id: out.bonusId })!;
    expect(bono.status).toBe("pending");
    expect(Number(bono.amount)).toBe(100);
    expect(JSON.parse(String(bono.condition))).toBeTruthy();
    expect(auditado.mock.calls.map((c) => (c[0] as { action: string }).action))
      .toContain("seller_bonus_awarded");
  });

  it("una meta sin cumplir no se otorga", async () => {
    await expect(
      awardGoalBonus(ctx, { goalId: "meta-1", sellerId: "ven-1", amount: 100 })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("EL BONO DE UNA META NO SE COBRA A NOMBRE DE OTRO", async () => {
    /**
     * El alcance se armaba con el `sellerId` del cuerpo de la petición y se
     * tiraba el de la meta, así que `goal.seller` no se comparaba con nadie: si
     * el otro daba los números por su cuenta, se le pagaba un premio que no era
     * suyo.
     */
    db.seed("booking", [
      reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z", seller_id: "ven-2" }),
      reserva({ _id: "bk-2", created_at: "2026-09-11T15:00:00.000Z", seller_id: "ven-2" }),
    ]);
    await expect(
      awardGoalBonus(ctx, { goalId: "meta-1", sellerId: "ven-2", amount: 100 })
    ).rejects.toThrow(/no entra en el alcance/);
    expect(db.rows("seller_bonus"), "se pagó un premio ajeno").toHaveLength(0);
  });

  it("y UNA META DE GRUPO se juzga por el grupo, no por una persona", async () => {
    /**
     * Con el alcance del cuerpo, una meta de «los hoteles» se medía contra las
     * cifras de uno solo: el tablero decía que estaba cumplida y el botón de
     * otorgar decía que no. Dos sitios calculando lo mismo acaban discrepando,
     * y la diferencia aparece en una discusión con el vendedor.
     */
    db.seed("seller_goal", [{ ...META, _id: "meta-grupo", seller: null, seller_type: "tipo-hotel" }]);
    db.seed("booking", [
      reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z", seller_id: "ven-1" }),
      reserva({ _id: "bk-2", created_at: "2026-09-11T15:00:00.000Z", seller_id: "ven-2" }),
    ]);
    const out = await awardGoalBonus(ctx, { goalId: "meta-grupo", sellerId: "ven-2", amount: 50 });
    expect(out.bonusId).toBeTruthy();
  });

  it("pero solo a quien está dentro del grupo", async () => {
    db.seed("seller_goal", [{ ...META, _id: "meta-grupo", seller: null, seller_type: "tipo-hotel" }]);
    db.seed("booking", [
      reserva({ _id: "bk-1", created_at: "2026-09-10T15:00:00.000Z", seller_id: "ven-1" }),
      reserva({ _id: "bk-2", created_at: "2026-09-11T15:00:00.000Z", seller_id: "ven-2" }),
    ]);
    await expect(
      awardGoalBonus(ctx, { goalId: "meta-grupo", sellerId: "ven-3", amount: 50 })
    ).rejects.toThrow(/no entra en el alcance/);
  });

  it("un mismo vendedor no cobra dos veces la misma meta", async () => {
    cumplida();
    await awardGoalBonus(ctx, { goalId: "meta-1", sellerId: "ven-1", amount: 100 });
    await expect(
      awardGoalBonus(ctx, { goalId: "meta-1", sellerId: "ven-1", amount: 100 })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("y la zona de la empresa llega hasta aquí: una venta de la última noche cuenta", async () => {
    /**
     * De poco sirve que `actualsFor` sepa cortar el mes si quien otorga el bono
     * no le pasa la zona. La venta de las 21:00 del 30 de septiembre en Santo
     * Domingo es 01:00 UTC del 1 de octubre: cortando en UTC el vendedor se
     * queda sin su premio por haber vendido la última noche.
     */
    db.seed("seller_goal", [{ ...META, _id: "meta-1t", target_bookings: 1 }]);
    db.seed("booking", [reserva({ _id: "bk-noche", created_at: "2026-10-01T01:00:00.000Z" })]);
    const out = await awardGoalBonus(ctx, { goalId: "meta-1t", sellerId: "ven-1", amount: 100 });
    expect(out.bonusId).toBeTruthy();
  });

  it("y una meta que no existe es 404", async () => {
    await expect(
      awardGoalBonus(ctx, { goalId: "meta-inventada", sellerId: "ven-1", amount: 100 })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("un importe negativo se guarda en cero, no en negativo", async () => {
    cumplida();
    const out = await awardGoalBonus(ctx, { goalId: "meta-1", sellerId: "ven-1", amount: -50 });
    expect(Number(db.row("seller_bonus", { _id: out.bonusId })!.amount)).toBe(0);
  });
});

/* ═══════════════════════ lo que paga una liquidación ════════════════════ */

describe("los bonos que paga una liquidación", () => {
  const bono = (over: Record<string, unknown>) => ({
    organization_id: ORG, seller: "ven-1", goal: "meta-1", amount: 100,
    currency: "usd", payout_kind: "cash", status: "approved",
    awarded_at: "2026-09-20T12:00:00.000Z", ...over,
  });

  it("engancha los aprobados y los deja liquidados", async () => {
    db.seed("seller_bonus", [bono({ _id: "b1" }), bono({ _id: "b2", amount: 50 })]);
    const totals = await attachBonusesToSettlement(ctx, "liq-1", "ven-1");
    expect(totals.cash).toBe(150);
    expect(db.row("seller_bonus", { _id: "b1" })!.status).toBe("settled");
    expect(db.row("seller_bonus", { _id: "b1" })!.settlement).toBe("liq-1");
  });

  it("LOS DE LIQUIDACIONES ANTERIORES NO SE VUELVEN A PAGAR", async () => {
    /**
     * Sumaba los doscientos bonos más recientes del vendedor, y `bonusTotals`
     * cuenta todo lo que esté `approved` **o `settled`**. O sea que los bonos ya
     * pagados en liquidaciones anteriores volvían a sumarse — y de aquí sale
     * `pending_total`, que es lo que se transfiere. La segunda liquidación le
     * pagaba otra vez los bonos de la primera, la tercera los de las dos, y
     * nadie lo ve porque cada liquidación por separado cuadra consigo misma.
     */
    db.seed("seller_bonus", [
      bono({ _id: "b-viejo", amount: 500, status: "settled", settlement: "liq-anterior" }),
      bono({ _id: "b-nuevo", amount: 100, status: "approved" }),
    ]);
    const totals = await attachBonusesToSettlement(ctx, "liq-2", "ven-1");
    expect(totals.cash, "se pagó otra vez un bono de una liquidación anterior").toBe(100);
    expect(totals.count).toBe(1);
  });

  it("lo que está en especie no se transfiere, pero se cuenta aparte", async () => {
    db.seed("seller_bonus", [
      bono({ _id: "b1", amount: 100, payout_kind: "cash" }),
      bono({ _id: "b2", amount: 80, payout_kind: "in_kind" }),
    ]);
    const totals = await attachBonusesToSettlement(ctx, "liq-1", "ven-1");
    expect(totals.cash).toBe(100);
    expect(totals.inKind).toBe(80);
  });

  it("un bono pendiente de aprobar no lo paga nadie todavía", async () => {
    db.seed("seller_bonus", [bono({ _id: "b1", status: "pending" })]);
    const totals = await attachBonusesToSettlement(ctx, "liq-1", "ven-1");
    expect(totals.cash).toBe(0);
    expect(db.row("seller_bonus", { _id: "b1" })!.status).toBe("pending");
  });

  it("sin bonos, la liquidación no suma nada", async () => {
    const totals = await attachBonusesToSettlement(ctx, "liq-1", "ven-1");
    expect(totals).toEqual({ cash: 0, inKind: 0, count: 0 });
  });

  it("la ficha del vendedor sí enseña su historial entero", async () => {
    // Es la pregunta contraria, y por eso son dos funciones: qué le han dado a
    // esta persona, no qué paga esta liquidación.
    db.seed("seller_bonus", [
      bono({ _id: "b-viejo", amount: 500, status: "settled", settlement: "liq-anterior" }),
      bono({ _id: "b-nuevo", amount: 100, status: "approved" }),
    ]);
    const { totals, rows } = await bonusesOf(ORG, "ven-1");
    expect(rows).toHaveLength(2);
    expect(totals.cash).toBe(600);
  });
});
