import { describe, it, expect } from "vitest";
import { enteroEnLetras, montoEnLetras } from "@/lib/monto-en-letras";

describe("las trampas del castellano", () => {
  it("16 y 21 son una palabra, no dos", () => {
    // «diez y seis» y «veinte y uno» son el error clásico del bucle ingenuo.
    expect(enteroEnLetras(16)).toBe("DIECISÉIS");
    expect(enteroEnLetras(21)).toBe("VEINTIÚN");
    expect(enteroEnLetras(22)).toBe("VEINTIDÓS");
    expect(enteroEnLetras(29)).toBe("VEINTINUEVE");
  });

  it("de 30 en adelante SÍ van separadas por «y»", () => {
    expect(enteroEnLetras(31)).toBe("TREINTA Y UN");
    expect(enteroEnLetras(45)).toBe("CUARENTA Y CINCO");
    expect(enteroEnLetras(99)).toBe("NOVENTA Y NUEVE");
  });

  it("100 es «cien» pero 101 es «ciento uno»", () => {
    // «CIEN UNO» no existe, y es lo que sale si se trata el 100 como los demás.
    expect(enteroEnLetras(100)).toBe("CIEN");
    expect(enteroEnLetras(101)).toBe("CIENTO UN");
    expect(enteroEnLetras(115)).toBe("CIENTO QUINCE");
  });

  it("las centenas irregulares no siguen el patrón", () => {
    expect(enteroEnLetras(500)).toBe("QUINIENTOS");
    expect(enteroEnLetras(700)).toBe("SETECIENTOS");
    expect(enteroEnLetras(900)).toBe("NOVECIENTOS");
    expect(enteroEnLetras(200)).toBe("DOSCIENTOS");
  });

  it("mil nunca lleva «un» delante, pero veintiún mil sí", () => {
    expect(enteroEnLetras(1000)).toBe("MIL");
    expect(enteroEnLetras(1001)).toBe("MIL UN");
    expect(enteroEnLetras(2000)).toBe("DOS MIL");
    expect(enteroEnLetras(21000)).toBe("VEINTIÚN MIL");
  });

  it("el millón sí lo lleva, y pluraliza", () => {
    expect(enteroEnLetras(1_000_000)).toBe("UN MILLÓN");
    expect(enteroEnLetras(2_000_000)).toBe("DOS MILLONES");
    expect(enteroEnLetras(1_500_000)).toBe("UN MILLÓN QUINIENTOS MIL");
  });

  it("el cero se dice", () => {
    expect(enteroEnLetras(0)).toBe("CERO");
  });
});

describe("el importe de la factura", () => {
  it("se escribe como se espera en una factura dominicana", () => {
    expect(montoEnLetras(2500, "dop")).toBe("SON: DOS MIL QUINIENTOS PESOS DOMINICANOS CON 00/100");
  });

  it("los centavos van en cifras sobre cien", () => {
    expect(montoEnLetras(1234.45, "dop")).toContain("CON 45/100");
    expect(montoEnLetras(99.05, "dop")).toContain("CON 05/100");
  });

  it("una unidad va en singular", () => {
    expect(montoEnLetras(1, "dop")).toBe("SON: UN PESO DOMINICANO CON 00/100");
    expect(montoEnLetras(1, "usd")).toContain("UN DÓLAR ESTADOUNIDENSE");
  });

  it("el redondeo sube la parte ENTERA, no deja 100 centavos", () => {
    /**
     * Truncando entero y centavos por separado, 0.995 saldría como «CERO CON
     * 100/100», que no es una cantidad. Y sobre todo: la línea en letras tiene
     * que coincidir con el total impreso al lado, o es peor que no tenerla.
     */
    expect(montoEnLetras(0.995, "dop")).toBe("SON: UN PESO DOMINICANO CON 00/100");
    expect(montoEnLetras(1.999, "dop")).toBe("SON: DOS PESOS DOMINICANOS CON 00/100");
  });

  it("un importe negativo lo dice, no lo esconde", () => {
    // Aparece en notas de crédito; callar el signo cambiaría el sentido.
    expect(montoEnLetras(-50, "dop")).toContain("MENOS CINCUENTA");
  });

  it("una moneda desconocida no revienta el documento", () => {
    expect(montoEnLetras(10, "xyz")).toBe("SON: DIEZ PESOS CON 00/100");
  });

  it("un importe ilegible no rompe la factura", () => {
    // Mejor una línea a cero que un PDF que no se genera.
    expect(montoEnLetras(null)).toContain("CERO");
    expect(montoEnLetras(undefined)).toContain("CERO");
    expect(montoEnLetras(NaN)).toContain("CERO");
  });
});
