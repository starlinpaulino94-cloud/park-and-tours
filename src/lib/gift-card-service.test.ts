import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * EL ÚNICO SITIO QUE ESCRIBE UN SALDO DE GIFT CARD.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UNO Y NO TRES
 *
 * Consumir, devolver y anular hacen lo mismo: dejan el saldo nuevo en la
 * tarjeta, escriben la fila que lo explica y lo auditan. Con tres caminos, uno
 * acabaría escribiendo el saldo sin su movimiento — y un saldo de gift card sin
 * movimiento detrás es dinero que apareció sin que nadie pueda decir de dónde.
 *
 * Hasta la emisión pasa por aquí: la tarjeta nace en cero y se funde con su
 * primer movimiento, para que no haya una segunda vía.
 *
 * Lo que se prueba es eso: que las tres escrituras van siempre juntas y en el
 * orden que deja el menor destrozo si una falla.
 */

let db: FakeDb;
const auditadas: Record<string, unknown>[] = [];

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantCreate: (...a: [string, string, Record<string, unknown>]) => db.tenantCreate(...a),
    tenantUpdate: (...a: [string, string, string, Record<string, unknown>]) => db.tenantUpdate(...a),
  };
});
vi.mock("@/lib/audit", () => ({
  writeAudit: async (entrada: Record<string, unknown>) => { auditadas.push(entrada); },
}));

import { recordMovement } from "@/lib/gift-card-service";

const TARJETA = "gc-1";

const plan = (over: Record<string, unknown> = {}) => ({
  movement_type: "redeem", amount: 30, balance_after: 70, status: "active", ...over,
} as never);

beforeEach(() => {
  db = fakeDb();
  auditadas.length = 0;
  db.seed("gift_card", [{ _id: TARJETA, code: "GC-001", balance: 100, currency: "usd", status: "active" }]);
});

describe("un movimiento de saldo", () => {
  it("deja el saldo nuevo EN LA TARJETA y la fila que lo explica", async () => {
    await recordMovement({ companyId: "c1", userId: "u1" }, {
      cardId: TARJETA, label: "Consumo", plan: plan(),
      currency: "usd", notes: "pagó el tour",
      auditAction: "gift_card_redeemed", auditDescription: "Consumidos 30",
    });

    expect(db.row("gift_card", { _id: TARJETA })).toMatchObject({ balance: 70, status: "active" });
    expect(db.rows("gift_card_movement")[0]).toMatchObject({
      gift_card: TARJETA, movement_type: "redeem", amount: 30, balance_after: 70, notes: "pagó el tour",
    });
  });

  it("EL SALDO SE ESCRIBE ANTES QUE EL MOVIMIENTO", async () => {
    /**
     * El orden importa porque no hay transacción. Al revés —movimiento primero—,
     * un fallo a mitad dejaría una fila que dice «se consumieron 30» sobre una
     * tarjeta que sigue en 100: el listado y el saldo contando historias distintas,
     * y nadie sabiendo cuál es la buena.
     *
     * Se comprueba con el orden real de las escrituras, no leyendo el fichero.
     */
    await recordMovement({ companyId: "c1" }, {
      cardId: TARJETA, label: "Consumo", plan: plan(),
      auditAction: "gift_card_redeemed", auditDescription: "x",
    });
    expect(db.writes.map((w) => `${w.op}:${w.table}`))
      .toEqual(["update:gift_card", "create:gift_card_movement"]);
  });

  it("y el estado de la tarjeta sale del PLAN, no de aquí", async () => {
    // Que una tarjeta gastada pase a `used` lo decide el dominio: si lo decidiera
    // este servicio habría dos sitios calculando el mismo estado.
    await recordMovement({ companyId: "c1" }, {
      cardId: TARJETA, label: "Consumo",
      plan: plan({ amount: 100, balance_after: 0, status: "used" }),
      auditAction: "gift_card_redeemed", auditDescription: "x",
    });
    expect(db.row("gift_card", { _id: TARJETA })).toMatchObject({ balance: 0, status: "used" });
  });

  it("la orden se apunta solo si la hay", async () => {
    /**
     * `order` va condicional a propósito: escribir `undefined` en una referencia
     * la manda a la base como una columna vacía que PostgREST puede rechazar, y
     * entonces el movimiento entero no se guarda — con el saldo ya cambiado.
     */
    await recordMovement({ companyId: "c1" }, {
      cardId: TARJETA, label: "Consumo", plan: plan(),
      auditAction: "gift_card_redeemed", auditDescription: "x",
    });
    expect(db.rows("gift_card_movement")[0]).not.toHaveProperty("order");

    await recordMovement({ companyId: "c1" }, {
      cardId: TARJETA, label: "Consumo", plan: plan(), orderId: "ord-9",
      auditAction: "gift_card_redeemed", auditDescription: "x",
    });
    expect(db.rows("gift_card_movement")[1]).toMatchObject({ order: "ord-9" });
  });
});

describe("el rastro", () => {
  it("cada movimiento se audita con su importe y el saldo que dejó", async () => {
    // Sin el saldo posterior, la bitácora dice «se movieron 30» y hay que
    // reconstruir a mano en qué quedó la tarjeta.
    await recordMovement({ companyId: "c1", userId: "u1" }, {
      cardId: TARJETA, label: "Consumo", plan: plan(), currency: "usd",
      auditAction: "gift_card_redeemed", auditDescription: "Consumidos 30",
    });
    expect(auditadas[0]).toMatchObject({
      action: "gift_card_redeemed", entityType: "gift_card", entityId: TARJETA,
      metadata: { movement_type: "redeem", amount: 30, balance_after: 70, currency: "usd" },
    });
  });

  it("y una anulación se audita como AVISO, no como una nota más", async () => {
    /**
     * Anular una gift card es quitarle a alguien un dinero que ya tenía. En un
     * listado donde todo es `info`, eso se lee como cualquier otro apunte.
     */
    await recordMovement({ companyId: "c1" }, {
      cardId: TARJETA, label: "Anulación",
      plan: plan({ movement_type: "void", amount: 100, balance_after: 0, status: "void" }),
      auditAction: "gift_card_voided", auditDescription: "Anulada",
      severity: "warning",
    });
    expect(auditadas[0]).toMatchObject({ severity: "warning" });
  });

  it("sin severidad declarada, informativo", async () => {
    await recordMovement({ companyId: "c1" }, {
      cardId: TARJETA, label: "Consumo", plan: plan(),
      auditAction: "gift_card_redeemed", auditDescription: "x",
    });
    expect(auditadas[0]).toMatchObject({ severity: "info" });
  });
});
