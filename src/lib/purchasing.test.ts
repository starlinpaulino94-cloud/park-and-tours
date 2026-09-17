import { describe, it, expect } from "vitest";
import {
  RECEIVABLE_STATUS, receiveBlocker, lineStates, receiptPlan,
  statusAfterReceipt, applyPlan, pendingSummary,
} from "@/lib/purchasing";

/**
 * Recibir mercancía es donde el dinero comprado se convierte en stock. Lo que
 * se prueba aquí son las formas concretas en que esa conversión sale mal: la
 * que cuenta dos veces, la que se cuela sin que nadie la vea, y la que da por
 * cerrada una orden que el proveedor todavía debe.
 */

const LINEAS = [
  { _id: "l1", description: "Camisetas", quantity: 10, quantity_received: 0, unit_cost: 200, inventory_item: "i1" },
  { _id: "l2", description: "Flete", quantity: 1, quantity_received: 0, unit_cost: 1500 },
];

describe("cuándo se puede recibir", () => {
  it("no contra un borrador: nadie aprobó ese gasto", () => {
    expect(receiveBlocker("draft", "w1")).toMatch(/aprobar/);
  });

  it("no contra una orden cancelada ni rechazada", () => {
    expect(receiveBlocker("cancelled", "w1")).toMatch(/cancelada/);
    expect(receiveBlocker("rejected", "w1")).toMatch(/cancelada/);
  });

  it("no contra una ya recibida completa", () => {
    expect(receiveBlocker("received", "w1")).toMatch(/completa/);
  });

  it("sí contra una aprobada, enviada o a medio recibir", () => {
    for (const s of RECEIVABLE_STATUS) expect(receiveBlocker(s, "w1")).toBeNull();
  });

  it("sin almacén no se recibe: no se sabría dónde entra", () => {
    expect(receiveBlocker("approved", null)).toMatch(/almacén/);
  });
});

describe("lo recibido se cuenta por los movimientos, no por la columna", () => {
  it("el libro de movimientos gana a `quantity_received`", () => {
    // La columna dice 10; los movimientos dicen 4. Solo uno de los dos tiene
    // detrás unidades físicas, y no es la columna —que es editable a mano—.
    const [camisetas] = lineStates([{ ...LINEAS[0], quantity_received: 10 }], { l1: 4 });
    expect(camisetas.received).toBe(4);
    expect(camisetas.pending).toBe(6);
  });

  it("sin movimientos de esa línea se cae en la columna: es lo único que hay de antes", () => {
    const [camisetas] = lineStates([{ ...LINEAS[0], quantity_received: 3 }], {});
    expect(camisetas.received).toBe(3);
  });

  it("una línea sin artículo es un servicio y no mueve stock", () => {
    const estados = lineStates(LINEAS);
    expect(estados[0].movesStock).toBe(true);
    expect(estados[1].movesStock).toBe(false);
  });

  it("una cantidad negativa en la base no produce un pendiente absurdo", () => {
    const [l] = lineStates([{ _id: "x", quantity: -5, unit_cost: 10 }]);
    expect(l.ordered).toBe(0);
    expect(l.pending).toBe(0);
  });
});

describe("el plan de recepción", () => {
  const estados = lineStates(LINEAS);

  it("recibir de más se rechaza por defecto: esas unidades también se pagan", () => {
    const plan = receiptPlan(estados, [{ lineId: "l1", quantity: 12 }]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.problems[0].reason).toMatch(/pasa lo pedido/);
  });

  it("…y se acepta si se confirma expresamente, marcada como sobre-recepción", () => {
    const plan = receiptPlan(estados, [{ lineId: "l1", quantity: 12 }], { allowOver: true });
    expect(plan.accepted[0].receiving).toBe(12);
    expect(plan.accepted[0].over).toBe(true);
  });

  it("recibir exactamente lo pedido NO es sobre-recepción", () => {
    const plan = receiptPlan(estados, [{ lineId: "l1", quantity: 10 }]);
    expect(plan.accepted[0].over).toBe(false);
  });

  it("cantidad cero o negativa no escribe un movimiento vacío", () => {
    const plan = receiptPlan(estados, [{ lineId: "l1", quantity: 0 }, { lineId: "l1", quantity: -3 }]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.problems).toHaveLength(2);
  });

  it("una línea de otra orden no se cuela", () => {
    const plan = receiptPlan(estados, [{ lineId: "ajena", quantity: 1 }]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.problems[0].reason).toMatch(/no es de esta orden/);
  });

  it("el costo de la factura gana al del pedido: se paga lo facturado", () => {
    const plan = receiptPlan(estados, [{ lineId: "l1", quantity: 10, unitCost: 250 }]);
    expect(plan.accepted[0].cost).toBe(250);
    expect(plan.totalCost).toBe(2500);
  });

  it("sin costo en la recepción se usa el del pedido", () => {
    const plan = receiptPlan(estados, [{ lineId: "l1", quantity: 10 }]);
    expect(plan.accepted[0].cost).toBe(200);
  });

  it("un costo de cero en la factura se respeta: una muestra gratis vale cero", () => {
    const plan = receiptPlan(estados, [{ lineId: "l1", quantity: 2, unitCost: 0 }]);
    expect(plan.accepted[0].cost).toBe(0);
  });

  it("solo llegan al almacén las líneas con artículo; el flete cambia estado y nada más", () => {
    const plan = receiptPlan(estados, [
      { lineId: "l1", quantity: 10 },
      { lineId: "l2", quantity: 1 },
    ]);
    expect(plan.accepted).toHaveLength(2);
    expect(plan.movements.map((m) => m.lineId)).toEqual(["l1"]);
  });

  it("lo ya recibido cuenta para el tope: 6 más 6 pasan de 10 aunque 6 solo no pase", () => {
    const parcial = lineStates(LINEAS, { l1: 6 });
    expect(receiptPlan(parcial, [{ lineId: "l1", quantity: 6 }]).problems).toHaveLength(1);
    expect(receiptPlan(parcial, [{ lineId: "l1", quantity: 4 }]).accepted).toHaveLength(1);
  });
});

describe("cómo queda la orden", () => {
  const estados = lineStates(LINEAS);

  it("una sola línea a medias la deja parcial: el proveedor todavía debe algo", () => {
    const plan = receiptPlan(estados, [{ lineId: "l1", quantity: 10 }]);
    expect(statusAfterReceipt(applyPlan(estados, plan))).toBe("partially_received");
  });

  it("con todo recibido queda completa", () => {
    const plan = receiptPlan(estados, [
      { lineId: "l1", quantity: 10 },
      { lineId: "l2", quantity: 1 },
    ]);
    expect(statusAfterReceipt(applyPlan(estados, plan))).toBe("received");
  });

  it("recibir de más también la cierra: no queda pendiente", () => {
    const plan = receiptPlan(estados, [
      { lineId: "l1", quantity: 12 },
      { lineId: "l2", quantity: 1 },
    ], { allowOver: true });
    const despues = applyPlan(estados, plan);
    expect(despues[0].pending).toBe(0);
    expect(statusAfterReceipt(despues)).toBe("received");
  });

  it("lo que queda por llegar se resume en líneas, unidades y dinero", () => {
    const plan = receiptPlan(estados, [{ lineId: "l1", quantity: 4 }]);
    const resumen = pendingSummary(applyPlan(estados, plan));
    expect(resumen.lines).toBe(2);
    expect(resumen.units).toBe(7); // 6 camisetas + 1 flete
    expect(resumen.value).toBe(6 * 200 + 1500);
  });
});
