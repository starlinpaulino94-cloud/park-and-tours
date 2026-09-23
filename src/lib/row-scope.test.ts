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

/**
 * EL VENDEDOR DEL TOUR CENTER (Fase 5).
 *
 * El actor que en 4.5 solo existía en una prueba. Aquí se comprueba quién lo
 * es de verdad, que es lo que 4.5 no podía comprobar: entonces nadie recibía
 * ficha de vendedor viniendo de un socio.
 */
const agenteConFicha: ActorDeFila = {
  role: "partner", partnerId: "soc-1", isPartnerMember: true,
  partnerRole: "agent", sellerId: "v-1",
};
const agenteSinFicha: ActorDeFila = {
  role: "partner", partnerId: "soc-1", isPartnerMember: true, partnerRole: "agent",
};
const adminDeSocio: ActorDeFila = {
  role: "partner", partnerId: "soc-1", isPartnerMember: true,
  partnerRole: "admin", sellerId: "v-9",
};

describe("el sub-login del vendedor del tour center", () => {
  it("el agente CON ficha se acota además a lo suyo", () => {
    const filtros = scopeFiltersFor("booking", agenteConFicha);
    expect(filtros).toHaveLength(2);
    expect(filtros).toContainEqual({ partner: "soc-1" });
    expect(filtros).toContainEqual({ _or: [{ seller: "v-1" }, { seller: null }] });
  });

  it("el agente SIN ficha se acota solo a su empresa", () => {
    /**
     * Y ésta es la asimetría que hay que tener escrita: dentro de la operadora
     * el ROL declara que alguien está acotado, así que sin ficha se acota a
     * «lo de nadie». En un tour center el rol no puede decir nada —todos
     * tienen el mismo— y la señal es la ficha. Sin ficha, acotar a «lo de
     * nadie» dejaría el portal vacío a todos los tour centers que no usan
     * vendedores, que son la mayoría al principio.
     */
    expect(scopeFiltersFor("booking", agenteSinFicha)).toEqual([{ partner: "soc-1" }]);
  });

  it("quien administra el tour center no se acota a una persona, tenga ficha o no", () => {
    // Es el equivalente del gerente que además vende: su pantalla de equipo
    // existe para ver lo de todos los suyos.
    expect(scopeFiltersFor("booking", adminDeSocio)).toEqual([{ partner: "soc-1" }]);
  });

  it("y en el detalle pasa las DOS comprobaciones", () => {
    expect(() => assertRowInScope("order", agenteConFicha, {
      _id: "o1", partner: "soc-1", seller: "v-2",
    })).toThrow(/de otro vendedor/);
    expect(() => assertRowInScope("order", agenteConFicha, {
      _id: "o1", partner: "soc-2", seller: "v-1",
    })).toThrow(/fuera de tu ámbito/);
    expect(() => assertRowInScope("order", agenteConFicha, {
      _id: "o1", partner: "soc-1", seller: "v-1",
    })).not.toThrow();
  });

  it("la tabla de vendedores es PROPIA del socio, nunca compartida", () => {
    /**
     * El cuidado específico del plan. Como compartida, «sin filtro de socio»:
     * el tour center leería las fichas internas de la operadora con la
     * comisión, la meta y el techo de descuento de cada vendedor propio.
     */
    expect(scopeFiltersFor("seller", adminDeSocio)).toContainEqual({ partner: "soc-1" });
    expect(() => assertRowInScope("seller", adminDeSocio, { _id: "v-9", partner: null }))
      .toThrow(/fuera de tu ámbito/);
  });

  it("y las cuatro tablas sin columna de socio siguen denegadas", () => {
    // Decidido de antemano, como pedía el plan: no tienen dimensión de socio,
    // así que acotarlas exigiría una subconsulta que el armador no expresa.
    for (const tabla of ["seller_goal", "seller_bonus", "seller_link", "seller_attribution"]) {
      expect(() => scopeFiltersFor(tabla, adminDeSocio), tabla).toThrow(/No tienes acceso/);
      expect(() => scopeFiltersFor(tabla, agenteConFicha), tabla).toThrow(/No tienes acceso/);
    }
  });
});
