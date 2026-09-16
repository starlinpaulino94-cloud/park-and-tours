import { describe, it, expect } from "vitest";
import { reorderThreshold, isLowStock } from "@/lib/inventory";

/**
 * El umbral de reposición decide dos cosas a la vez: qué sale en la lista de
 * compras y qué dispara el aviso de existencias bajas. Están atados a esta
 * función a propósito — con dos definiciones de «bajo», la pantalla señala lo
 * que la campana calla.
 */

describe("cuándo un artículo está bajo", () => {
  it("manda el punto de pedido cuando está puesto", () => {
    expect(reorderThreshold({ reorder_point: 10, min_stock: 4 })).toBe(10);
  });

  it("sin punto de pedido vale el mínimo", () => {
    expect(reorderThreshold({ min_stock: 4 })).toBe(4);
  });

  it("un artículo sin umbral NO tiene umbral, no tiene umbral cero", () => {
    /**
     * Con cero, cualquier artículo agotado se volvería «bajo» y la campana
     * avisaría de cosas que a nadie le importan: el sistema no sabe cuántas
     * unidades necesita esa empresa si nadie se lo dijo.
     */
    expect(reorderThreshold({})).toBeNull();
    expect(reorderThreshold({ min_stock: 0, reorder_point: 0 })).toBeNull();
    expect(reorderThreshold(null)).toBeNull();
    expect(isLowStock(0, {})).toBe(false);
  });

  it("estar EN el umbral ya es estar bajo", () => {
    // Avisar solo por debajo llega un movimiento tarde.
    expect(isLowStock(10, { reorder_point: 10 })).toBe(true);
    expect(isLowStock(11, { reorder_point: 10 })).toBe(false);
  });

  it("un saldo negativo también está bajo", () => {
    // Pasa en almacenes que admiten negativos; no avisar ahí sería absurdo.
    expect(isLowStock(-3, { min_stock: 2 })).toBe(true);
  });
});
