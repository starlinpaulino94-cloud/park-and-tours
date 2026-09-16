import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * El ciclo vender → embarcar → cancelar, con la base simulada.
 *
 * Tres cosas se comprueban aquí y ninguna es aritmética: que apartar no escriba
 * movimientos fantasma, que consumir suelte la reserva ANTES de mover (o el
 * disponible sale descontado dos veces), y que un almacén roto no tumbe la
 * venta de un cliente que está delante del mostrador.
 */

const tenantQuery = vi.fn();
const tenantUpdate = vi.fn();
const tenantCreate = vi.fn();
const postMovement = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: unknown[]) => tenantQuery(...a),
    tenantUpdate: (...a: unknown[]) => tenantUpdate(...a),
    tenantCreate: (...a: unknown[]) => tenantCreate(...a),
  };
});
vi.mock("@/lib/inventory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inventory")>();
  return { ...actual, postMovement: (...a: unknown[]) => postMovement(...a) };
});

import { reserveForSale, settleBookingStock } from "@/lib/stock-commitment-service";

const ALMUERZO = {
  _id: "e1", consumes_stock: true, inventory_item: "i1", warehouse: "w1", stock_per_unit: 1,
};

beforeEach(() => {
  tenantQuery.mockReset();
  tenantUpdate.mockReset();
  tenantCreate.mockReset();
  postMovement.mockReset();
  tenantUpdate.mockResolvedValue({});
  tenantCreate.mockResolvedValue({ _id: "nuevo" });
  postMovement.mockResolvedValue({ legs: [] });
});

describe("vender aparta", () => {
  it("sube lo reservado y NO escribe ningún movimiento: la mercancía no ha salido", async () => {
    tenantQuery.mockResolvedValue([{ _id: "lv1", quantity: 30, reserved: 0 }]);
    await reserveForSale("org", [{ bookingExtraId: "be1", offer: ALMUERZO, soldUnits: 4 }]);

    expect(postMovement).not.toHaveBeenCalled();
    const saldo = tenantUpdate.mock.calls.find((c) => c[1] === "stock_level")!;
    expect(saldo[3]).toEqual({ reserved: 4, available: 26 });
  });

  it("congela el artículo y el almacén en la línea vendida, igual que el precio", async () => {
    tenantQuery.mockResolvedValue([{ _id: "lv1", quantity: 30, reserved: 0 }]);
    await reserveForSale("org", [{ bookingExtraId: "be1", offer: ALMUERZO, soldUnits: 4 }]);
    const linea = tenantUpdate.mock.calls.find((c) => c[1] === "booking_extra")!;
    expect(linea[3]).toEqual({
      inventory_item: "i1", warehouse: "w1", stock_quantity: 4, stock_state: "reserved",
    });
  });

  it("avisa cuando se vendió más de lo disponible, pero no lo impide", async () => {
    tenantQuery.mockResolvedValue([{ _id: "lv1", quantity: 30, reserved: 28 }]);
    const avisos = await reserveForSale("org", [{ bookingExtraId: "be1", offer: ALMUERZO, soldUnits: 4 }]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/solo quedan 2/);
    // Y aun así se apartó: quien decide si hay comida es el operador.
    expect(tenantUpdate.mock.calls.some((c) => c[1] === "booking_extra")).toBe(true);
  });

  it("un extra que no sale del almacén no toca nada", async () => {
    await reserveForSale("org", [
      { bookingExtraId: "be1", offer: { ...ALMUERZO, consumes_stock: false }, soldUnits: 4 },
    ]);
    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(tenantQuery).not.toHaveBeenCalled();
  });

  it("si el almacén falla, la venta sigue: no se propaga el error", async () => {
    tenantQuery.mockRejectedValue(new Error("base caída"));
    await expect(reserveForSale("org", [{ bookingExtraId: "be1", offer: ALMUERZO, soldUnits: 4 }]))
      .resolves.toEqual([]);
  });

  it("el primer movimiento de ese par crea su saldo con la reserva puesta", async () => {
    tenantQuery.mockResolvedValue([]);
    await reserveForSale("org", [{ bookingExtraId: "be1", offer: ALMUERZO, soldUnits: 3 }]);
    expect(tenantCreate.mock.calls[0][2]).toMatchObject({ reserved: 3, quantity: 0, available: -3 });
  });
});

describe("embarcar consume", () => {
  const RESERVADA = [{
    _id: "be1", name: "Almuerzo", inventory_item: "i1", warehouse: "w1",
    stock_quantity: 4, stock_state: "reserved",
  }];

  it("suelta la reserva ANTES de mover: si no, el disponible se descuenta dos veces", async () => {
    const orden: string[] = [];
    tenantQuery.mockImplementation((_o: string, table: string) =>
      Promise.resolve(table === "booking_extra" ? RESERVADA : [{ _id: "lv1", quantity: 30, reserved: 4 }])
    );
    tenantUpdate.mockImplementation((_o: string, table: string) => {
      if (table === "stock_level") orden.push("suelta-reserva");
      return Promise.resolve({});
    });
    postMovement.mockImplementation(() => { orden.push("movimiento"); return Promise.resolve({ legs: [] }); });

    await settleBookingStock("org", "b1", "consume", "u1");
    expect(orden).toEqual(["suelta-reserva", "movimiento"]);
  });

  it("escribe un consumo real atado a la línea vendida", async () => {
    tenantQuery.mockImplementation((_o: string, table: string) =>
      Promise.resolve(table === "booking_extra" ? RESERVADA : [{ _id: "lv1", quantity: 30, reserved: 4 }])
    );
    const r = await settleBookingStock("org", "b1", "consume", "u1");
    expect(r.consumed).toBe(1);
    expect(postMovement.mock.calls[0][1]).toMatchObject({
      warehouse: "w1", inventory_item: "i1", movement_type: "consumption",
      quantity: 4, booking_extra: "be1", user: "u1",
    });
  });

  it("lo ya consumido no se consume otra vez", async () => {
    tenantQuery.mockImplementation((_o: string, table: string) =>
      Promise.resolve(table === "booking_extra" ? [{ ...RESERVADA[0], stock_state: "consumed" }] : [])
    );
    const r = await settleBookingStock("org", "b1", "consume");
    expect(r.consumed).toBe(0);
    expect(r.skipped).toBe(1);
    expect(postMovement).not.toHaveBeenCalled();
  });
});

describe("cancelar libera", () => {
  it("baja la reserva y NO escribe movimiento: nunca salió nada", async () => {
    tenantQuery.mockImplementation((_o: string, table: string) =>
      Promise.resolve(table === "booking_extra"
        ? [{ _id: "be1", name: "Almuerzo", inventory_item: "i1", warehouse: "w1", stock_quantity: 4, stock_state: "reserved" }]
        : [{ _id: "lv1", quantity: 30, reserved: 4 }])
    );
    const r = await settleBookingStock("org", "b1", "release");
    expect(r.released).toBe(1);
    expect(postMovement).not.toHaveBeenCalled();
    const saldo = tenantUpdate.mock.calls.find((c) => c[1] === "stock_level")!;
    expect(saldo[3]).toEqual({ reserved: 0, available: 30 });
  });

  it("cancelar DESPUÉS del embarque no devuelve unidades que ya salieron", async () => {
    tenantQuery.mockImplementation((_o: string, table: string) =>
      Promise.resolve(table === "booking_extra"
        ? [{ _id: "be1", name: "Almuerzo", inventory_item: "i1", warehouse: "w1", stock_quantity: 4, stock_state: "consumed" }]
        : [{ _id: "lv1", quantity: 26, reserved: 0 }])
    );
    const r = await settleBookingStock("org", "b1", "release");
    expect(r.released).toBe(0);
    expect(r.problems[0]).toMatch(/devolución/);
    expect(tenantUpdate.mock.calls.filter((c) => c[1] === "stock_level")).toHaveLength(0);
  });

  it("una reserva sin extras de almacén no hace nada y no falla", async () => {
    tenantQuery.mockResolvedValue([]);
    const r = await settleBookingStock("org", "b1", "release");
    expect(r).toEqual({ consumed: 0, released: 0, skipped: 0, problems: [] });
  });
});
