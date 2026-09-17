import { describe, it, expect } from "vitest";
import {
  commitmentFor, committedOf, transition, groupCommitments,
  availableAfter, canCommit,
} from "@/lib/stock-commitment";

/**
 * Lo que se prueba aquí es la diferencia entre «lo que hay» y «lo que puedo
 * vender». Confundirlas tiene dos formas: vender cuarenta almuerzos cuando
 * quedan treinta, y decir que quedan treinta cuando veinticinco ya están
 * vendidos para el jueves.
 */

const ALMUERZO = {
  _id: "e1", consumes_stock: true, inventory_item: "i1", warehouse: "w1", stock_per_unit: 1,
};

describe("qué compromete una venta", () => {
  it("un extra que no consume stock no compromete nada: la recogida en el hotel no sale de un estante", () => {
    expect(commitmentFor({ ...ALMUERZO, consumes_stock: false }, 4)).toBeNull();
  });

  it("sin artículo o sin almacén no hay nada que apartar", () => {
    expect(commitmentFor({ ...ALMUERZO, inventory_item: null }, 4)).toBeNull();
    expect(commitmentFor({ ...ALMUERZO, warehouse: null }, 4)).toBeNull();
  });

  it("vender cero no compromete nada", () => {
    expect(commitmentFor(ALMUERZO, 0)).toBeNull();
    expect(commitmentFor(ALMUERZO, -3)).toBeNull();
  });

  it("cuatro almuerzos apartan cuatro unidades", () => {
    expect(commitmentFor(ALMUERZO, 4)).toEqual({ itemId: "i1", warehouseId: "w1", quantity: 4 });
  });

  it("un pack de tres apartan tres por cada uno vendido", () => {
    expect(commitmentFor({ ...ALMUERZO, stock_per_unit: 3 }, 2)?.quantity).toBe(6);
  });

  it("sin unidades por unidad se asume una: el valor por defecto no puede ser cero", () => {
    expect(commitmentFor({ ...ALMUERZO, stock_per_unit: null }, 5)?.quantity).toBe(5);
    expect(commitmentFor({ ...ALMUERZO, stock_per_unit: 0 }, 5)?.quantity).toBe(5);
  });

  it("acepta la referencia expandida igual que el id suelto", () => {
    expect(commitmentFor({ ...ALMUERZO, inventory_item: { _id: "i1" }, warehouse: { _id: "w1" } }, 2))
      .toEqual({ itemId: "i1", warehouseId: "w1", quantity: 2 });
  });
});

describe("lo que una línea ya vendida tiene comprometido", () => {
  it("se lee de la propia línea, no del catálogo: el extra pudo cambiar después", () => {
    expect(committedOf({ inventory_item: "i9", warehouse: "w9", stock_quantity: 7 }))
      .toEqual({ itemId: "i9", warehouseId: "w9", quantity: 7 });
  });

  it("una línea sin compromiso devuelve null", () => {
    expect(committedOf({ name: "Recogida" })).toBeNull();
    expect(committedOf({ inventory_item: "i1", warehouse: "w1", stock_quantity: 0 })).toBeNull();
  });
});

describe("las transiciones", () => {
  it("lo reservado se consume o se libera", () => {
    expect(transition("reserved", "consume")).toEqual({ ok: true, next: "consumed" });
    expect(transition("reserved", "release")).toEqual({ ok: true, next: "released" });
  });

  it("lo consumido no se vuelve a consumir: sería descontar dos veces el mismo almuerzo", () => {
    const r = transition("consumed", "consume");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.noop).toBe(true);
  });

  it("devolver lo ya entregado NO es liberar una reserva, y se distingue", () => {
    // Liberar sumaría unidades sin movimiento; las unidades salieron de verdad.
    const r = transition("consumed", "release");
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.noop).toBe(false);
      expect(r.reason).toMatch(/devolución/);
    }
  });

  it("lo ya liberado no se libera otra vez", () => {
    const r = transition("released", "release");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.noop).toBe(true);
  });

  it("una línea que nunca comprometió nada no es un error, es una recogida en el hotel", () => {
    const r = transition(null, "consume");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.noop).toBe(true);
  });
});

describe("agrupar antes de escribir", () => {
  it("dos extras del mismo artículo son una sola escritura sobre el saldo", () => {
    const g = groupCommitments([
      { itemId: "i1", warehouseId: "w1", quantity: 4 },
      { itemId: "i1", warehouseId: "w1", quantity: 2 },
      { itemId: "i1", warehouseId: "w2", quantity: 1 },
    ]);
    expect(g).toHaveLength(2);
    expect(g.find((c) => c.warehouseId === "w1")!.quantity).toBe(6);
  });

  it("no inventa grupos donde no los hay", () => {
    expect(groupCommitments([])).toEqual([]);
  });
});

describe("lo disponible no es lo que hay", () => {
  it("treinta con veinticinco vendidos dan para cinco, no para treinta", () => {
    const nivel = { quantity: 30, reserved: 25 };
    expect(availableAfter(nivel, 5)).toBe(0);
    expect(canCommit(nivel, 5)).toBe(true);
    expect(canCommit(nivel, 6)).toBe(false);
  });

  it("un almacén que admite negativos deja pasar igual", () => {
    expect(canCommit({ quantity: 0, reserved: 0 }, 10, true)).toBe(true);
  });

  it("un saldo sin datos no revienta el cálculo", () => {
    expect(availableAfter({}, 3)).toBe(-3);
  });
});
