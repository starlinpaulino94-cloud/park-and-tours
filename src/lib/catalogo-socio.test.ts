import { describe, it, expect } from "vitest";
import { autorizadosDe, noAutorizados, mensajeNoAutorizado } from "@/lib/catalogo-socio";

describe("qué tiene autorizado un tour center", () => {
  it("las filas activas, y solo ésas", () => {
    /**
     * Desautorizar pone la fila inactiva en vez de borrarla: queda el rastro de
     * que ese producto estuvo autorizado, que es lo que se mira cuando un socio
     * reclama una reserva que «antes sí podía hacer».
     */
    const set = autorizadosDe([
      { product: "p-1", status: "active" },
      { product: "p-2", status: "inactive" },
      { product: "p-3" },
    ]);
    expect([...set].sort()).toEqual(["p-1", "p-3"]);
  });

  it("la referencia expandida y la cruda cuentan igual", () => {
    expect(autorizadosDe([{ product: { _id: "p-1" } }]).has("p-1")).toBe(true);
    expect(autorizadosDe([{ product_id: "p-2" }]).has("p-2")).toBe(true);
  });

  it("sin filas, NINGUNO — que es lo contrario de lo que hacía antes", () => {
    /**
     * EL FALLO, EN UNA LÍNEA.
     *
     * El catálogo del portal hacía `authorizedIds.length ? filtrar : no
     * filtrar`. Y como `authorized_products` no existía en ninguna tabla ni en
     * el mapa de relaciones, la lista estaba vacía SIEMPRE: ese filtro no se
     * aplicó nunca, ni una vez.
     */
    expect(autorizadosDe([]).size).toBe(0);
    expect(autorizadosDe(null).size).toBe(0);
  });
});

describe("lo que la venta lleva y el socio no puede vender", () => {
  const autorizados = new Set(["p-1", "p-2"]);

  it("devuelve TODOS los prohibidos, no el primero", () => {
    /**
     * Quien reserva por API manda un carrito de una vez. Contestarle de uno en
     * uno le obliga a reintentar tantas veces como productos prohibidos lleve,
     * descubriendo su contrato a base de errores.
     */
    expect(noAutorizados(["p-1", "p-9", "p-8"], autorizados)).toEqual(["p-9", "p-8"]);
  });

  it("sin repetir", () => {
    expect(noAutorizados(["p-9", "p-9"], autorizados)).toEqual(["p-9"]);
  });

  it("un carrito entero autorizado no da nada", () => {
    expect(noAutorizados(["p-1", "p-2"], autorizados)).toEqual([]);
  });

  it("una línea sin producto no es una línea prohibida", () => {
    // La validación de que falta el producto es otra, y con otro mensaje.
    expect(noAutorizados([null, undefined, ""], autorizados)).toEqual([]);
  });

  it("y el mensaje nombra los productos cuando se saben", () => {
    // Un 403 con uuids dentro obliga a quien integra a cruzarlos a mano contra
    // su catálogo para entender qué le están negando.
    const nombres = new Map([["p-9", "Isla Saona"]]);
    expect(mensajeNoAutorizado(["p-9"], nombres)).toMatch(/Isla Saona/);
    expect(mensajeNoAutorizado(["p-9"])).toMatch(/p-9/);
    expect(mensajeNoAutorizado(["p-9", "p-8"], nombres)).toMatch(/Isla Saona, p-8/);
  });
});
