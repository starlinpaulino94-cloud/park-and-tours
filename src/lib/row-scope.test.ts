import { describe, it, expect } from "vitest";
import { scopeFiltersFor, assertRowInScope, type ActorDeFila } from "@/lib/row-scope";

/**
 * QUE LOS DOS ÁMBITOS SE ACUMULEN, Y QUE LA LISTA Y EL DETALLE DIGAN LO MISMO.
 *
 * Son las dos propiedades por las que existe este módulo. La primera se puede
 * perder con un `else if` y la segunda cuando alguien toca una de las dos
 * rutas; ninguna de las dos se ve leyendo una sola función.
 */

const socio: ActorDeFila = { role: "partner", partnerId: "soc-1", isPartnerMember: true };
const vendedor: ActorDeFila = { role: "seller", sellerId: "v-1" };
const gerente: ActorDeFila = { role: "manager" };
/** El caso de la fase siguiente: el vendedor de un tour center. */
const vendedorDeSocio: ActorDeFila = {
  role: "seller", sellerId: "v-1", partnerId: "soc-1", isPartnerMember: true,
};

describe("los ámbitos se acumulan, no se eligen", () => {
  it("el socio se acota por socio", () => {
    expect(scopeFiltersFor("booking", socio)).toEqual([{ partner: "soc-1" }]);
  });

  it("el vendedor se acota por vendedor", () => {
    expect(scopeFiltersFor("booking", vendedor)).toEqual([
      { _or: [{ seller: "v-1" }, { seller: null }] },
    ]);
  });

  it("y quien es las dos cosas recibe LOS DOS filtros", () => {
    /**
     * Es el caso de la fase siguiente y la razón de que este módulo exista. Con
     * un `if/else if` entre actores se le aplicaría solo el primero — y en la
     * pareja socio/vendedor el primero es el MENOS restrictivo de los dos: ese
     * vendedor vería las ventas de todos sus compañeros del tour center.
     */
    const filtros = scopeFiltersFor("booking", vendedorDeSocio);
    expect(filtros).toHaveLength(2);
    expect(filtros).toContainEqual({ partner: "soc-1" });
    expect(filtros).toContainEqual({ _or: [{ seller: "v-1" }, { seller: null }] });
  });

  it("al personal interno no se le acota por ninguno de los dos", () => {
    expect(scopeFiltersFor("booking", gerente)).toEqual([]);
  });

  it("y una tabla que no es del socio ni compartida se deniega", () => {
    // Denegar por defecto es del ámbito del socio y no se pierde al unificar.
    expect(() => scopeFiltersFor("staff", socio)).toThrow(/No tienes acceso/);
  });
});

describe("el detalle dice lo mismo que la lista", () => {
  it("la fila de otro socio se rechaza", () => {
    expect(() => assertRowInScope("booking", socio, { _id: "b1", partner: "soc-2" }))
      .toThrow(/fuera de tu ámbito/);
    expect(() => assertRowInScope("booking", socio, { _id: "b1", partner: "soc-1" }))
      .not.toThrow();
  });

  it("la ficha del propio socio se compara por su identificador", () => {
    // En `partner` el campo es `_id`, no una referencia: es el caso que más
    // fácil se escribe mal porque no se parece a los demás.
    expect(() => assertRowInScope("partner", socio, { _id: "soc-2" })).toThrow(/fuera de tu ámbito/);
    expect(() => assertRowInScope("partner", socio, { _id: "soc-1" })).not.toThrow();
  });

  it("la venta de otro vendedor se rechaza", () => {
    expect(() => assertRowInScope("order", vendedor, { _id: "o1", seller: "v-2" }))
      .toThrow(/de otro vendedor/);
    // Y la de nadie sigue siendo legible: es la venta de la empresa.
    expect(() => assertRowInScope("order", vendedor, { _id: "o1", seller: null })).not.toThrow();
  });

  it("y la comisión sin beneficiario NO, porque es de un socio o un proveedor", () => {
    expect(() => assertRowInScope("commission", vendedor, { _id: "c1", seller: null }))
      .toThrow(/de otro vendedor/);
  });

  it("quien es las dos cosas tiene que pasar las DOS comprobaciones", () => {
    // Su propio socio pero otro vendedor: rechazada.
    expect(() => assertRowInScope("order", vendedorDeSocio, {
      _id: "o1", partner: "soc-1", seller: "v-2",
    })).toThrow(/de otro vendedor/);
    // Su propio vendedor pero otro socio: rechazada también.
    expect(() => assertRowInScope("order", vendedorDeSocio, {
      _id: "o1", partner: "soc-2", seller: "v-1",
    })).toThrow(/fuera de tu ámbito/);
    // Las dos suyas: pasa.
    expect(() => assertRowInScope("order", vendedorDeSocio, {
      _id: "o1", partner: "soc-1", seller: "v-1",
    })).not.toThrow();
  });

  it("la relación expandida se resuelve igual que la cruda", () => {
    // La fila puede traer el socio como objeto o como uuid según la expansión
    // que pidiera quien la leyó; las dos formas tienen que decidir lo mismo.
    expect(() => assertRowInScope("booking", socio, { _id: "b1", partner: { _id: "soc-2" } }))
      .toThrow(/fuera de tu ámbito/);
    expect(() => assertRowInScope("order", vendedor, { _id: "o1", seller: { _id: "v-1" } }))
      .not.toThrow();
  });

  it("sin fila no hay nada que comprobar", () => {
    expect(() => assertRowInScope("order", vendedor, null)).not.toThrow();
  });
});
