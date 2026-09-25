import { describe, it, expect } from "vitest";
import { vetoDeAceptacion, vetoDeFactura, accionesPara } from "@/lib/conformidad-proveedor";

describe("la conformidad, que es la otra mitad de la disputa", () => {
  it("una liquidación emitida se puede aceptar", () => {
    expect(vetoDeAceptacion({ status: "pending" })).toBeNull();
    expect(vetoDeAceptacion({ status: "approved" })).toBeNull();
  });

  it("UNA PAGADA TAMBIÉN, y es el caso que importa", () => {
    /**
     * «Me pagaste lo correcto» es una conformidad que llega después del pago.
     * Cerrarla al pagar convertiría el pago en un finiquito unilateral — la
     * misma razón por la que se puede disputar lo ya pagado.
     */
    expect(vetoDeAceptacion({ status: "paid" })).toBeNull();
  });

  it("una anulada no: no hay nada que aceptar", () => {
    expect(vetoDeAceptacion({ status: "void" })?.status).toBe(409);
  });

  it("y una EN DISPUTA tampoco, o la conformidad taparía el desacuerdo", () => {
    // Primero se resuelve la disputa. Aceptar encima dejaría una fila diciendo
    // que hay acuerdo sobre algo que sigue abierto.
    expect(vetoDeAceptacion({ status: "disputed" })?.status).toBe(409);
  });

  it("dos veces no son dos conformidades", () => {
    expect(vetoDeAceptacion({ status: "pending", accepted_at: "2026-09-20T10:00:00Z" })?.status).toBe(409);
  });
});

describe("la factura del proveedor", () => {
  it("se registra una vez", () => {
    expect(vetoDeFactura({ status: "pending" })).toBeNull();
  });

  it("y NO SE SOBRESCRIBE", () => {
    /**
     * Un NCF es un documento fiscal emitido: corregirlo no es editar un campo,
     * es emitir una nota de crédito y otra factura. Dejar que se pise haría que
     * el 606 de la operadora dijera un número y el papel del proveedor otro —
     * y el que se queda con el problema es quien declara.
     */
    const veto = vetoDeFactura({ status: "pending", supplier_ncf: "B0100000001" });
    expect(veto?.status).toBe(409);
    expect(veto?.mensaje).toMatch(/habla con la operadora/i);
  });

  it("ni sobre una anulada", () => {
    expect(vetoDeFactura({ status: "void" })?.status).toBe(409);
  });
});

describe("los botones los decide el servidor", () => {
  it("una emitida admite las tres cosas", () => {
    expect(accionesPara({ status: "pending" })).toEqual({ aceptar: true, disputar: true, facturar: true });
  });

  it("una en disputa no se acepta ni se vuelve a disputar, pero sí se factura", () => {
    // Facturar no es estar de acuerdo: el proveedor emite su factura por lo que
    // él sostiene, y esa es justamente la conversación.
    expect(accionesPara({ status: "disputed" })).toEqual({ aceptar: false, disputar: false, facturar: true });
  });

  it("y una anulada, ninguna", () => {
    expect(accionesPara({ status: "void" })).toEqual({ aceptar: false, disputar: false, facturar: false });
  });

  it("LA PANTALLA NO DECIDE, PREGUNTA", () => {
    /**
     * Si cada botón tuviera su condición escrita en el navegador, el día que
     * cambie una regla habría que acordarse de cambiarla en dos sitios — y el
     * que se quede viejo es el que enseña un botón que el servidor rechaza.
     */
    const ya = { status: "pending", accepted_at: "2026-09-20T10:00:00Z", supplier_ncf: "B0100000001" };
    expect(accionesPara(ya)).toEqual({ aceptar: false, disputar: true, facturar: false });
  });
});
