import { describe, it, expect } from "vitest";
import { plazasLibres, plazasParaMostrar, plazasDeProducto } from "@/lib/plazas";

describe("las plazas libres de una salida", () => {
  it("usa la caché cuando está", () => {
    expect(plazasLibres({ capacity: 40, booked_pax: 10, available_pax: 30 })).toBe(30);
  });

  it("SIN caché las calcula, en vez de decir que está agotada", () => {
    /**
     * EL FALLO DEL QUE NACE ESTE MÓDULO.
     *
     * El punto de venta hacía `available_pax ?? 0`. Con el sembrador SQL —que
     * inserta las salidas sin rellenar la caché— el catálogo entero salía con
     * «0 plazas» en rojo y al añadir algo saltaba «Solo quedan 0 plazas»,
     * con las salidas completamente vacías.
     */
    expect(plazasLibres({ capacity: 40, booked_pax: 12, pending_pax: 3 })).toBe(25);
    expect(plazasLibres({ capacity: 40 })).toBe(40);
  });

  it("una caché a cero SÍ es agotado: es un dato, no un hueco", () => {
    // La distinción entera: 0 guardado significa «se llenó»; ausente significa
    // «nadie lo ha calculado».
    expect(plazasLibres({ capacity: 40, booked_pax: 40, available_pax: 0 })).toBe(0);
  });

  it("sin caché y sin cupo devuelve null, no cero", () => {
    // Cero afirmaría que está llena. Null dice que no se sabe, que es la
    // verdad, y deja que la pantalla lo cuente bien.
    expect(plazasLibres({ booked_pax: 5 })).toBeNull();
    expect(plazasLibres({})).toBeNull();
    expect(plazasLibres(null)).toBeNull();
  });

  it("los números que llegan como texto desde la base cuentan igual", () => {
    expect(plazasLibres({ capacity: "40", booked_pax: "12" })).toBe(28);
    expect(plazasLibres({ available_pax: "7" })).toBe(7);
  });

  it("no devuelve negativos aunque haya sobreventa", () => {
    // «−3 plazas» en una tarjeta no significa nada para quien vende.
    expect(plazasLibres({ capacity: 10, booked_pax: 13 })).toBe(0);
    expect(plazasLibres({ available_pax: -5 })).toBe(0);
  });
});

describe("lo que se pinta", () => {
  it("distingue agotado de desconocido", () => {
    expect(plazasParaMostrar({ capacity: 10, available_pax: 0 })).toEqual({ libres: 0, desconocido: false });
    expect(plazasParaMostrar({})).toEqual({ libres: 0, desconocido: true });
  });
});

describe("las plazas de un producto", () => {
  it("suma las de sus salidas", () => {
    expect(plazasDeProducto([{ available_pax: 10 }, { capacity: 20, booked_pax: 5 }]))
      .toEqual({ libres: 25, desconocido: false });
  });

  it("un producto sin salidas es desconocido, no agotado", () => {
    /**
     * En la pantalla son dos frases distintas: «Sin salidas programadas» y
     * «0 plazas» en rojo. La segunda dice que se llenó, que es mentira.
     */
    expect(plazasDeProducto([])).toEqual({ libres: 0, desconocido: true });
    expect(plazasDeProducto(null)).toEqual({ libres: 0, desconocido: true });
  });

  it("si ninguna salida sabe su cupo, el total tampoco", () => {
    expect(plazasDeProducto([{ booked_pax: 2 }, { booked_pax: 3 }]))
      .toEqual({ libres: 0, desconocido: true });
  });

  it("una salida sin datos no anula a las que sí los tienen", () => {
    expect(plazasDeProducto([{ available_pax: 8 }, { booked_pax: 2 }]))
      .toEqual({ libres: 8, desconocido: false });
  });
});
