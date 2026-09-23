import { describe, it, expect } from "vitest";
import {
  duenoDeLaCaja, esCajaDeLaOperadora, noPuedeAbrirLaCaja, filtroDeArqueo,
} from "@/lib/caja-identidad";

const interno = { esDeSocio: false as const };
const cajero = { esDeSocio: false as const, sellerId: null };
const delSocio = { esDeSocio: true as const, partnerId: "s-1" };
const otroSocio = { esDeSocio: true as const, partnerId: "s-2" };

describe("de quién es una caja", () => {
  it("lee la referencia cruda y la expandida igual", () => {
    expect(duenoDeLaCaja({ partner: "s-1" }).partnerId).toBe("s-1");
    expect(duenoDeLaCaja({ partner: { _id: "s-1" } }).partnerId).toBe("s-1");
    expect(duenoDeLaCaja({ partner_id: "s-1" }).partnerId).toBe("s-1");
  });

  it("SIN SOCIO ES DE LA OPERADORA, que es lo que significa el hueco", () => {
    // Las cajas que ya existen se quedan con la columna nula y siguen siendo lo
    // que eran. La migración no rellena nada a propósito.
    expect(esCajaDeLaOperadora({})).toBe(true);
    expect(esCajaDeLaOperadora(null)).toBe(true);
    expect(esCajaDeLaOperadora({ partner: "s-1" })).toBe(false);
  });
});

describe("quién puede abrir un turno", () => {
  it("el personal interno abre las de la casa", () => {
    expect(noPuedeAbrirLaCaja({ name: "Mostrador" }, interno)).toBeNull();
  });

  it("EL SOCIO NO ABRE LA CAJA DE LA OPERADORA", () => {
    /**
     * Es la dirección que no se piensa. Dejarle abrirla metería su efectivo en
     * el cajón de la casa —que es justo el descuadre que esta fase existe para
     * evitar— y el arqueo interno lo contaría como propio, porque esos
     * movimientos no llevarían socio.
     */
    expect(noPuedeAbrirLaCaja({ name: "Mostrador" }, delSocio))
      .toContain("no entra en su arqueo");
  });

  it("y el interno no abre la de un socio", () => {
    // Su arqueo lo firma el socio: un turno abierto por la operadora en el
    // mostrador de otro es un arqueo que nadie puede defender.
    expect(noPuedeAbrirLaCaja({ partner: "s-1" }, interno)).toContain("lo firma él");
  });

  it("ni un socio la de otro", () => {
    expect(noPuedeAbrirLaCaja({ partner: "s-1" }, otroSocio)).toContain("otro tour center");
    expect(noPuedeAbrirLaCaja({ partner: "s-1" }, delSocio)).toBeNull();
  });

  it("sin ficha de socio no se abre NINGUNA caja", () => {
    /**
     * Fallar hacia el silencio. Lo contrario —caer en la rama de la operadora—
     * le daría a un usuario marcado como de socio, pero sin ficha, la caja de
     * la casa.
     */
    const sinFicha = { esDeSocio: true as const, partnerId: null };
    expect(noPuedeAbrirLaCaja({ name: "Mostrador" }, sinFicha)).toContain("no está asociado");
    expect(noPuedeAbrirLaCaja({ partner: "s-1" }, sinFicha)).toContain("no está asociado");
  });

  it("la caja de un vendedor es suya", () => {
    /**
     * Un turno de vendedor abierto por otra persona es un arqueo con el nombre
     * equivocado: al cuadrar, la diferencia se le apunta a quien no estuvo ahí.
     */
    expect(noPuedeAbrirLaCaja({ seller: "v-1" }, { ...cajero, sellerId: "v-1" })).toBeNull();
    expect(noPuedeAbrirLaCaja({ seller: "v-1" }, { ...cajero, sellerId: "v-2" }))
      .toContain("otro vendedor");
    expect(noPuedeAbrirLaCaja({ seller: "v-1" }, cajero)).toContain("otro vendedor");
  });

  it("el administrador del tour center responde por el mostrador de los suyos", () => {
    const admin = { esDeSocio: true as const, partnerId: "s-1", esAdminDeSocio: true };
    expect(noPuedeAbrirLaCaja({ partner: "s-1", seller: "v-1" }, admin)).toBeNull();
    // Pero sigue sin poder abrir la de otro tour center.
    expect(noPuedeAbrirLaCaja({ partner: "s-2", seller: "v-1" }, admin)).toContain("otro tour center");
  });

  it("una caja inactiva no se abre", () => {
    expect(noPuedeAbrirLaCaja({ status: "inactive" }, interno)).toContain("inactiva");
  });
});

describe("el filtro del arqueo", () => {
  it("EL ARQUEO INTERNO EXIGE partner NULO, no la ausencia de filtro", () => {
    /**
     * El criterio del plan es que un arqueo de la operadora no incluya NI UN
     * movimiento de caja de socio, y eso es una condición que hay que escribir.
     * Omitir el filtro —que es lo que hace la política de la base, donde el
     * interno lo ve todo— haría que el arqueo sumara el efectivo de los tour
     * centers como propio.
     */
    expect(filtroDeArqueo(interno)).toEqual({ partner: null });
  });

  it("y el del socio, el suyo", () => {
    expect(filtroDeArqueo(delSocio)).toEqual({ partner: "s-1" });
  });

  it("sin ficha de socio el filtro no cae en el de la operadora", () => {
    // Devolver `{ partner: null }` aquí le enseñaría la caja de la casa a quien
    // está marcado como de socio y no tiene ficha.
    const filtro = filtroDeArqueo({ esDeSocio: true, partnerId: null });
    expect(filtro).not.toEqual({ partner: null });
    expect(filtro.partner).toBe("__sin_socio__");
  });
});
