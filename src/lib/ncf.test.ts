import { describe, it, expect } from "vitest";
import { validarNcf, tipoDeNcf, normalizarNcf, NOMBRE_DEL_TIPO, TIPOS_DE_NCF } from "@/lib/ncf";

/**
 * EL NÚMERO DE COMPROBANTE QUE LA OPERADORA VA A DECLARAR.
 *
 * Un dígito de más aquí es un 606 rechazado por la DGII semanas después, cuando
 * ya nadie se acuerda de qué factura era.
 */

describe("el NCF de la factura que se recibe", () => {
  it("acepta la serie B con sus once caracteres", () => {
    for (const ncf of ["B0100000001", "B0200000042", "B0400000007", "B1100000001", "B1500000001"]) {
      expect(validarNcf(ncf).ok, ncf).toBe(true);
    }
  });

  it("y el electrónico con sus trece", () => {
    for (const ncf of ["E310000000001", "E320000000042", "E450000000001"]) {
      expect(validarNcf(ncf).ok, ncf).toBe(true);
    }
  });

  it("RECHAZA EL QUE TIENE UN DÍGITO DE MÁS O DE MENOS", () => {
    // Es el error que de verdad ocurre al copiar a mano, y el que la DGII
    // devuelve semanas después.
    expect(validarNcf("B010000000").ok).toBe(false);
    expect(validarNcf("B01000000012").ok).toBe(false);
    expect(validarNcf("E31000000001").ok).toBe(false);
  });

  it("y el tipo que no existe", () => {
    // B03 no es un tipo de comprobante; que empiece por B y tenga la longitud
    // correcta no lo convierte en uno.
    expect(validarNcf("B0300000001").ok).toBe(false);
    expect(validarNcf("E990000000001").ok).toBe(false);
  });

  it("el vacío se dice como vacío, no como malformado", () => {
    // Son dos mensajes distintos: «escribe el número» y «ese número no tiene la
    // forma correcta» mandan a sitios diferentes.
    expect(validarNcf("").motivo).toBe("vacio");
    expect(validarNcf(null).motivo).toBe("vacio");
    expect(validarNcf("B0300000001").motivo).toBe("forma");
  });

  it("EL MENSAJE TRAE UN EJEMPLO", () => {
    // «Formato inválido» obliga a buscar el formato en algún sitio, y ese sitio
    // no existe.
    expect(validarNcf("XYZ").mensaje).toMatch(/B0100000001/);
  });

  it("se normaliza antes de guardar: espacios, guiones y minúsculas", () => {
    // Lo que se pega desde un PDF trae de todo. Guardarlo tal cual haría que el
    // índice único no viera dos veces el mismo número.
    expect(normalizarNcf(" b01-0000 0001 ")).toBe("B0100000001");
    const v = validarNcf("b01 00000001");
    expect(v.ok).toBe(true);
    expect(v.ncf).toBe("B0100000001");
  });

  it("EL TIPO SALE DEL NÚMERO, no se pregunta aparte", () => {
    /**
     * Con dos campos —«tipo» y «número»— un formulario admite que digan cosas
     * distintas, y entonces el 606 sale con un tipo que no es el del
     * comprobante.
     */
    expect(tipoDeNcf("B0100000001")).toBe("b01");
    expect(tipoDeNcf("E340000000001")).toBe("e34");
    expect(tipoDeNcf("no es un ncf")).toBeNull();
    expect(validarNcf("B0200000001").tipo).toBe("b02");
  });

  it("y todos los tipos declarados tienen nombre", () => {
    // Un código sin nombre obliga al proveedor a adivinar entre siglas.
    for (const tipo of TIPOS_DE_NCF) {
      expect(NOMBRE_DEL_TIPO[tipo], tipo).toBeTruthy();
    }
  });
});
