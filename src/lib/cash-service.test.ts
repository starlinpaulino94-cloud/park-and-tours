import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb, type FakeDb } from "@/test/fake-tenant";

/**
 * EL ARQUEO DE UNA SESIÓN, QUE NO TENÍA NINGUNA PRUEBA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ DECIDE ESTE SERVICIO, SI EL CUADRE LO HACE OTRO
 *
 * `cash-close.ts` calcula, y está probado. Lo que decide ESTE fichero es qué se
 * le da a calcular y cómo se lee lo contado — y ahí es donde el arqueo se puede
 * equivocar sin que ninguna cuenta falle:
 *
 *   · qué movimientos y qué cobros son de esta sesión;
 *   · qué tolerancia se aplica, que sale del cajón y no de la sesión;
 *   · **y qué significa que el cajero contara CERO**, que es distinto de que no
 *     haya contado.
 *
 * Lo piden tres sitios —la pantalla, el PDF que se archiva con el efectivo y la
 * revisión del supervisor— y los tres tienen que decir lo mismo. Un arqueo que
 * en pantalla cuadra y en el papel no, no sirve para nada.
 */

let db: FakeDb;

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: [string, string, Record<string, unknown>?]) => db.tenantQuery(...a),
    tenantFindOne: (...a: [string, string, string, Record<string, unknown>?]) => db.tenantFindOne(...a),
  };
});

import { loadCashClose } from "@/lib/cash-service";

const SESION = "cs-1";

beforeEach(() => {
  db = fakeDb();
  db.seed("cash_register", [{ _id: "reg-1", name: "Mostrador", difference_tolerance: 50 }]);
  db.seed("cash_session", [
    { _id: SESION, cash_register: "reg-1", currency: "usd", status: "open" },
    { _id: "cs-otra", cash_register: "reg-1", currency: "usd", status: "open" },
  ]);
});

const usd = (over: Record<string, unknown> = {}) => ({
  currency: "usd", cash_session: SESION, ...over,
});

describe("qué entra en el arqueo", () => {
  it("solo los movimientos y los cobros DE ESTA sesión", async () => {
    /**
     * Sin acotar por sesión, el arqueo del turno de la mañana llevaría dentro el
     * efectivo de la tarde: dos cajeros distintos respondiendo del mismo dinero.
     */
    db.seed("cash_movement", [
      { _id: "m1", ...usd({ movement_type: "sale", amount: 100, movement_at: "2026-04-10T12:00:00Z" }) },
      { _id: "m2", currency: "usd", cash_session: "cs-otra", movement_type: "sale", amount: 999 },
    ]);
    const arqueo = await loadCashClose("c1", SESION);
    expect(arqueo.movements.map((m) => m._id)).toEqual(["m1"]);
    expect(arqueo.currencies[0].cash_sales).toBe(100);
  });

  it("y los cobros que NO están completados no cuentan", async () => {
    // Un cobro pendiente o rechazado no es dinero en el cajón; contarlo le pediría
    // al cajero un efectivo que nunca entró.
    db.seed("payment", [
      { _id: "p1", ...usd({ method: "card", amount: 200, status: "completed" }) },
      { _id: "p2", ...usd({ method: "card", amount: 500, status: "pending" }) },
    ]);
    const arqueo = await loadCashClose("c1", SESION);
    expect(arqueo.card.expected).toBe(200);
  });
});

describe("la tolerancia sale del cajón, no de la sesión", () => {
  it("se lee del cajón expandido", async () => {
    // Cada mostrador tiene la suya: la del kiosco de la playa no puede ser la de
    // la caja central.
    const arqueo = await loadCashClose("c1", SESION);
    expect(arqueo.tolerance).toBe(50);
  });

  it("y sin cajón declarado es CERO, no «lo que sea»", async () => {
    /**
     * Cero es la tolerancia estricta: cualquier diferencia se marca. La
     * alternativa —un valor por defecto inventado— haría que un descuadre pasara
     * por bueno en una caja que nadie configuró.
     */
    db.seed("cash_session", [{ _id: "cs-sin-cajon", currency: "usd", status: "open" }]);
    const arqueo = await loadCashClose("c1", "cs-sin-cajon");
    expect(arqueo.tolerance).toBe(0);
    expect(arqueo.register).toBeNull();
  });
});

describe("lo que el cajero contó", () => {
  const conteo = (over: Record<string, unknown>) => ({
    _id: "cc-1", cash_session: SESION, kind: "close", currency: "usd", ...over,
  });

  it("manda el DESGLOSE cuando lo hay", async () => {
    // Dos billetes de 100 y uno de 50: lo que de verdad hay en el cajón.
    db.seed("cash_count", [conteo({
      counted_total: 999,
      breakdown: [{ denomination: 100, quantity: 2 }, { denomination: 50, quantity: 1 }],
    })]);
    const arqueo = await loadCashClose("c1", SESION);
    expect(arqueo.currencies[0].counted).toBe(250);
  });

  it("y sin desglose, el total guardado", async () => {
    db.seed("cash_count", [conteo({ counted_total: 320, breakdown: [] })]);
    expect((await loadCashClose("c1", SESION)).currencies[0].counted).toBe(320);
  });

  it("UN CONTEO DE CERO ES UN CONTEO, no la ausencia de conteo", async () => {
    /**
     * EL FALLO QUE ESTA PRUEBA EXISTE PARA FIJAR.
     *
     * Esto era `countTotal(...) || Number(stored.counted_total ?? 0)`, y ese `||`
     * se come el cero. Un cajón contado y vacío —el que se dejó sin fondo— da
     * `countTotal = 0`, que es falso, y caía al total guardado: el arqueo enseñaba
     * un contado que el cajero NO contó, y calculaba la diferencia y el veredicto
     * sobre él.
     *
     * Aquí el cajón está vacío y contado, y el esperado es 250. El papel tiene que
     * decir que FALTAN 250, no que cuadra.
     */
    db.seed("cash_movement", [
      { _id: "m1", ...usd({ movement_type: "sale", amount: 250, movement_at: "2026-04-10T12:00:00Z" }) },
    ]);
    db.seed("cash_count", [conteo({
      counted_total: 250,
      breakdown: [{ denomination: 100, quantity: 0 }, { denomination: 50, quantity: 0 }],
    })]);

    const moneda = (await loadCashClose("c1", SESION)).currencies[0];
    expect(moneda.counted, "se usó el total guardado en vez del desglose").toBe(0);
    expect(moneda.difference).toBe(-250);
    expect(moneda.verdict).toBe("short");
  });

  it("y sin ningún conteo NO se inventa un veredicto", async () => {
    /**
     * `null` y no «cuadra»: decir que cuadra sería firmar que alguien contó cuando
     * nadie contó, que es exactamente la diferencia entre un arqueo y un papel.
     */
    const moneda = (await loadCashClose("c1", SESION)).currencies[0];
    expect(moneda.counted).toBeNull();
    expect(moneda.difference).toBeNull();
    expect(moneda.verdict).toBeNull();
  });
});

describe("la conciliación del datáfono", () => {
  it("compara lo cobrado con tarjeta contra el lote del banco", async () => {
    db.seed("payment", [
      { _id: "p1", ...usd({ method: "card", amount: 300, status: "completed" }) },
    ]);
    db.seed("cash_session", [{
      _id: "cs-tarjeta", cash_register: "reg-1", currency: "usd", status: "open",
      card_batch_total: 280, card_batch_reference: "LOTE-77",
    }]);
    db.seed("payment", [
      { _id: "p2", currency: "usd", cash_session: "cs-tarjeta", method: "card", amount: 300, status: "completed" },
    ]);

    const arqueo = await loadCashClose("c1", "cs-tarjeta");
    expect(arqueo.card.expected).toBe(300);
    expect(arqueo.card.batch).toBe(280);
    expect(arqueo.card.difference).toBe(-20);
    expect(arqueo.card.reference).toBe("LOTE-77");
  });

  it("SIN LOTE NO HAY DIFERENCIA, y un lote de cero sí la hay", async () => {
    /**
     * `card_batch_total` se compara contra `null` y no por verdad: con un `||`, un
     * lote cerrado en cero —el datáfono que no cobró nada— se leería como «no hay
     * lote» y la conciliación desaparecería justo cuando dice algo.
     */
    db.seed("payment", [
      { _id: "p1", ...usd({ method: "card", amount: 300, status: "completed" }) },
    ]);
    expect((await loadCashClose("c1", SESION)).card.difference).toBeNull();

    db.seed("cash_session", [{
      _id: "cs-cero", cash_register: "reg-1", currency: "usd", status: "open", card_batch_total: 0,
    }]);
    db.seed("payment", [
      { _id: "p3", currency: "usd", cash_session: "cs-cero", method: "card", amount: 300, status: "completed" },
    ]);
    const cero = await loadCashClose("c1", "cs-cero");
    expect(cero.card.batch).toBe(0);
    expect(cero.card.difference).toBe(-300);
  });
});

describe("las monedas", () => {
  it("la de la sesión sale SIEMPRE, aunque no se moviera nada", async () => {
    // Un arqueo sin la moneda principal no es un arqueo: el cajero no tendría
    // dónde apuntar que contó cero.
    const arqueo = await loadCashClose("c1", SESION);
    expect(arqueo.currencies.map((c) => c.currency)).toEqual(["usd"]);
  });

  it("y una moneda secundaria con movimiento NO se pierde", async () => {
    /**
     * Sumar divisas distintas 1:1 no significa nada, así que cada una va en su
     * fila. Lo que no puede pasar es que desaparezca: serían pesos en el cajón de
     * los que el arqueo no dice nada.
     */
    db.seed("cash_movement", [
      { _id: "m1", ...usd({ movement_type: "sale", amount: 100, movement_at: "2026-04-10T12:00:00Z" }) },
      { _id: "m2", currency: "dop", cash_session: SESION, movement_type: "sale", amount: 6000, movement_at: "2026-04-10T13:00:00Z" },
    ]);
    const arqueo = await loadCashClose("c1", SESION);
    expect(arqueo.currencies.map((c) => c.currency).sort()).toEqual(["dop", "usd"]);
    expect(arqueo.currencies.find((c) => c.currency === "dop")!.cash_sales).toBe(6000);
  });
});
