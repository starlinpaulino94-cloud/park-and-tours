import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Recibir mercancía, con la base simulada.
 *
 * Lo que importa aquí es el ORDEN de las escrituras y qué se escribe en cada
 * una: un fallo a medias tiene que dejar el almacén diciendo la verdad, nunca
 * una orden que dice «recibida» con el estante vacío.
 */

const tenantQuery = vi.fn();
const tenantFindOne = vi.fn();
const tenantUpdate = vi.fn();
const postMovement = vi.fn();

vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    tenantQuery: (...a: unknown[]) => tenantQuery(...a),
    tenantFindOne: (...a: unknown[]) => tenantFindOne(...a),
    tenantUpdate: (...a: unknown[]) => tenantUpdate(...a),
  };
});
vi.mock("@/lib/inventory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inventory")>();
  return { ...actual, postMovement: (...a: unknown[]) => postMovement(...a) };
});

import { receivePurchaseOrder, receivedByLine, purchaseOrderState } from "@/lib/purchasing-service";

const ORDEN = {
  _id: "po1", code: "OC-001", status: "approved", currency: "dop",
  warehouse: "w1", receipt_count: 0,
};
const LINEAS = [
  { _id: "l1", description: "Camisetas", quantity: 10, quantity_received: 0, unit_cost: 200, inventory_item: "i1" },
  { _id: "l2", description: "Flete", quantity: 1, quantity_received: 0, unit_cost: 1500 },
];

function armar(order = ORDEN, lineas = LINEAS, movimientos: unknown[] = []) {
  tenantFindOne.mockImplementation(() => Promise.resolve(order));
  tenantQuery.mockImplementation((_o: string, table: string) =>
    Promise.resolve(table === "purchase_order_line" ? lineas : table === "stock_movement" ? movimientos : [])
  );
  tenantUpdate.mockResolvedValue({});
  postMovement.mockResolvedValue({ legs: [] });
}

beforeEach(() => {
  tenantQuery.mockReset();
  tenantFindOne.mockReset();
  tenantUpdate.mockReset();
  postMovement.mockReset();
});

describe("cuánto se ha recibido de cada línea", () => {
  it("se cuenta sumando movimientos, con la devolución restando", () => {
    armar(ORDEN, LINEAS, [
      { quantity: 6, movement_type: "receipt", purchase_order_line: "l1" },
      { quantity: 4, movement_type: "receipt", purchase_order_line: "l1" },
      { quantity: 2, movement_type: "return", purchase_order_line: "l1" },
    ]);
    return receivedByLine("org", "po1").then((r) => expect(r).toEqual({ l1: 8 }));
  });

  it("un movimiento sin línea no se atribuye a ninguna", async () => {
    armar(ORDEN, LINEAS, [{ quantity: 5, movement_type: "receipt" }]);
    expect(await receivedByLine("org", "po1")).toEqual({});
  });
});

describe("registrar la recepción", () => {
  it("mueve stock solo de las líneas con artículo", async () => {
    armar();
    const r = await receivePurchaseOrder("org", "u1", "po1", [
      { lineId: "l1", quantity: 10 },
      { lineId: "l2", quantity: 1 },
    ]);
    expect(postMovement).toHaveBeenCalledTimes(1);
    expect(postMovement.mock.calls[0][1]).toMatchObject({
      warehouse: "w1", inventory_item: "i1", movement_type: "receipt",
      quantity: 10, unit_cost: 200, purchase_order: "po1", purchase_order_line: "l1",
    });
    expect(r.received).toHaveLength(2);
  });

  it("el movimiento se escribe ANTES de tocar la línea y la cabecera", async () => {
    armar();
    const orden: string[] = [];
    postMovement.mockImplementation(() => { orden.push("movimiento"); return Promise.resolve({ legs: [] }); });
    tenantUpdate.mockImplementation((_o: string, table: string) => {
      orden.push(table === "purchase_order" ? "cabecera" : "linea");
      return Promise.resolve({});
    });
    await receivePurchaseOrder("org", "u1", "po1", [{ lineId: "l1", quantity: 10 }]);
    expect(orden).toEqual(["movimiento", "linea", "cabecera"]);
  });

  it("una recepción parcial deja la orden a medias, no recibida", async () => {
    armar();
    const r = await receivePurchaseOrder("org", "u1", "po1", [{ lineId: "l1", quantity: 4 }]);
    expect(r.status).toBe("partially_received");
    const cabecera = tenantUpdate.mock.calls.find((c) => c[1] === "purchase_order")!;
    expect(cabecera[3].status).toBe("partially_received");
  });

  it("recibirlo todo la cierra y cuenta la recepción", async () => {
    armar();
    const r = await receivePurchaseOrder("org", "u1", "po1", [
      { lineId: "l1", quantity: 10 },
      { lineId: "l2", quantity: 1 },
    ]);
    expect(r.status).toBe("received");
    const cabecera = tenantUpdate.mock.calls.find((c) => c[1] === "purchase_order")!;
    expect(cabecera[3].receipt_count).toBe(1);
    expect(cabecera[3].last_received_by).toBe("u1");
  });

  it("contra un borrador no se recibe: nadie aprobó ese gasto", async () => {
    armar({ ...ORDEN, status: "draft" });
    await expect(receivePurchaseOrder("org", "u1", "po1", [{ lineId: "l1", quantity: 1 }]))
      .rejects.toThrow(/aprobar/);
    expect(postMovement).not.toHaveBeenCalled();
  });

  it("sin almacén no se recibe: no se sabría dónde entra", async () => {
    armar({ ...ORDEN, warehouse: null });
    await expect(receivePurchaseOrder("org", "u1", "po1", [{ lineId: "l1", quantity: 1 }]))
      .rejects.toThrow(/almacén/);
  });

  it("si nada se puede recibir, no se escribe nada en absoluto", async () => {
    armar();
    await expect(receivePurchaseOrder("org", "u1", "po1", [{ lineId: "l1", quantity: 99 }]))
      .rejects.toThrow(/No se pudo recibir/);
    expect(postMovement).not.toHaveBeenCalled();
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  it("el exceso confirmado sí entra, y queda anotado en el motivo", async () => {
    armar();
    await receivePurchaseOrder("org", "u1", "po1", [{ lineId: "l1", quantity: 12 }], { allowOver: true });
    expect(postMovement.mock.calls[0][1].reason).toMatch(/exceso/);
  });

  it("el costo facturado llega al movimiento: el costo promedio se recalcula con lo pagado", async () => {
    armar();
    await receivePurchaseOrder("org", "u1", "po1", [{ lineId: "l1", quantity: 10, unitCost: 250 }]);
    expect(postMovement.mock.calls[0][1].unit_cost).toBe(250);
  });

  it("lo ya recibido según los movimientos cuenta para el tope", async () => {
    armar(ORDEN, LINEAS, [{ quantity: 8, movement_type: "receipt", purchase_order_line: "l1" }]);
    await expect(receivePurchaseOrder("org", "u1", "po1", [{ lineId: "l1", quantity: 5 }]))
      .rejects.toThrow(/No se pudo recibir/);
  });

  it("un almacén indicado a mano gana al de la orden", async () => {
    armar();
    await receivePurchaseOrder("org", "u1", "po1", [{ lineId: "l1", quantity: 2 }], { warehouse: "w9" });
    expect(postMovement.mock.calls[0][1].warehouse).toBe("w9");
  });
});

describe("el estado de la orden para la pantalla", () => {
  it("dice qué falta por llegar en líneas, unidades y dinero", async () => {
    armar(ORDEN, LINEAS, [{ quantity: 4, movement_type: "receipt", purchase_order_line: "l1" }]);
    const estado = await purchaseOrderState("org", "po1");
    expect(estado.states[0].received).toBe(4);
    expect(estado.pending.units).toBe(7); // 6 camisetas + 1 flete
    expect(estado.pending.value).toBe(6 * 200 + 1500);
  });
});
