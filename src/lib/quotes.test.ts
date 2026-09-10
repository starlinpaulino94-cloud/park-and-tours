import { describe, it, expect } from "vitest";
import { lineGross, lineDiscount, lineTotal, quoteTotals } from "@/lib/quotes";

describe("cotizaciones — importe de una línea", () => {
  it("multiplica cantidad por precio", () => {
    expect(lineGross({ quantity: 4, unit_price: 25.5 })).toBe(102);
  });

  it("aplica el descuento sobre el bruto", () => {
    expect(lineDiscount({ quantity: 4, unit_price: 25, discount_percent: 10 })).toBe(10);
    expect(lineTotal({ quantity: 4, unit_price: 25, discount_percent: 10 })).toBe(90);
  });

  it("un descuento fuera de rango no suma importe ni deja la línea en negativo", () => {
    // Un 150% teclado por error convertiría la línea en un abono.
    expect(lineTotal({ quantity: 2, unit_price: 50, discount_percent: 150 })).toBe(0);
    expect(lineTotal({ quantity: 2, unit_price: 50, discount_percent: -20 })).toBe(100);
  });

  it("los campos vacíos valen cero, no NaN", () => {
    expect(lineTotal({})).toBe(0);
    expect(lineTotal({ quantity: null, unit_price: undefined })).toBe(0);
    expect(lineTotal({ quantity: "x" as unknown as number, unit_price: 10 })).toBe(0);
  });

  it("redondea a centavos", () => {
    expect(lineTotal({ quantity: 3, unit_price: 33.333 })).toBe(100);
  });
});

describe("cotizaciones — totales", () => {
  const lines = [
    { quantity: 2, unit_price: 100 },                          // 200
    { quantity: 1, unit_price: 50, discount_percent: 20 },      // 50 − 10 = 40
  ];

  it("suma el bruto y el descuento por separado", () => {
    expect(quoteTotals(lines)).toEqual({ subtotal: 250, discount: 10, total: 240 });
  });

  it("el impuesto se recibe, no se inventa", () => {
    // Depende del perfil fiscal del inquilino: calcularlo aquí sería adivinar.
    expect(quoteTotals(lines, 43.2).total).toBe(283.2);
  });

  it("una cotización sin líneas vale cero", () => {
    expect(quoteTotals([])).toEqual({ subtotal: 0, discount: 0, total: 0 });
  });

  it("el total siempre cuadra con la suma de las líneas", () => {
    const { subtotal, discount, total } = quoteTotals(lines);
    expect(total).toBe(subtotal - discount);
    expect(lines.reduce((s, l) => s + lineTotal(l), 0)).toBe(total);
  });
});
