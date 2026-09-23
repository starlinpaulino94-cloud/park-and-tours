import { describe, it, expect } from "vitest";
import { excesoDeDescuento, mensajeExceso } from "@/lib/techo-descuento";

/**
 * EL CAMPO EXISTÍA Y NO SERVÍA PARA NADA.
 *
 * `seller.max_discount_pct` está en el esquema desde 0005, la pantalla lo pide
 * («Descuento máximo autorizado») y se guarda — y no se aplicaba en ningún
 * cálculo. La operadora configuraba un techo, creía haber acotado lo que sus
 * vendedores regalan, y el sistema aceptaba un 90 % igual que un 5 %.
 */

describe("el techo", () => {
  it("deja pasar lo que cabe, incluido el borde exacto", () => {
    expect(excesoDeDescuento([{ discount_pct: 5 }], 5)).toBeNull();
    expect(excesoDeDescuento([{ discount_pct: 4.9 }], 5)).toBeNull();
  });

  it("rechaza lo que se pasa, y dice cuánto se pidió y cuánto cabe", () => {
    // «No puedes» sin decir hasta dónde obliga a probar por tanteo con el
    // cliente delante.
    expect(excesoDeDescuento([{ discount_pct: 20, product_id: "p1" }], 5))
      .toEqual({ pedido: 20, techo: 5, productId: "p1" });
  });

  it("mira TODAS las líneas, no solo la primera", () => {
    // Un carrito con cinco excursiones y el descuento grande en la cuarta es
    // exactamente como se salta un techo que solo mira la primera.
    expect(excesoDeDescuento(
      [{ discount_pct: 1 }, { discount_pct: 2 }, { discount_pct: 40, product_id: "p4" }],
      5
    )).toMatchObject({ pedido: 40, productId: "p4" });
  });

  it("SIN TECHO DECLARADO no hay techo", () => {
    /**
     * `null` es «nadie lo ha configurado» y no se convierte en cero. Si la
     * ausencia valiera cero, activar esto le quitaría de golpe la capacidad de
     * descontar a todas las empresas que nunca rellenaron el campo — que son
     * todas, porque el campo no hacía nada.
     */
    expect(excesoDeDescuento([{ discount_pct: 90 }], null)).toBeNull();
    expect(excesoDeDescuento([{ discount_pct: 90 }], undefined)).toBeNull();
  });

  it("pero un CERO declarado sí es un techo", () => {
    // «Esta persona no puede descontar» tiene que poder expresarse, y es la
    // razón por la que la ausencia no puede valer cero.
    expect(excesoDeDescuento([{ discount_pct: 1 }], 0)).toMatchObject({ pedido: 1, techo: 0 });
    expect(excesoDeDescuento([{ discount_pct: 0 }], 0)).toBeNull();
  });

  it("una línea sin descuento no se pasa de ningún techo", () => {
    expect(excesoDeDescuento([{}, { discount_pct: null }], 0)).toBeNull();
  });

  it("un techo ilegible no bloquea la venta", () => {
    // Un dato corrupto en una ficha no puede dejar a esa persona sin poder
    // vender: se ignora y se sigue, que es lo mismo que «sin techo».
    expect(excesoDeDescuento([{ discount_pct: 50 }], Number.NaN)).toBeNull();
  });

  it("el mensaje dice hasta dónde SÍ se puede", () => {
    expect(mensajeExceso({ pedido: 20, techo: 5, productId: null }))
      .toContain("tu autorización llega al 5 %");
  });
});
