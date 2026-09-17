import { describe, it, expect } from "vitest";
import {
  idKind, cleanTaxId, cleanNcf, periodOf, dgiiDate, amount, paymentCode,
  line606, line607, COLUMNS_606, COLUMNS_607, buildFile, fileName,
  purchaseProblems, saleProblems, totalsOf,
} from "@/lib/dgii";

/**
 * Un archivo fiscal mal generado no falla aquí: falla días después, sin decir
 * qué línea, y le cuesta una tarde al contador de la operadora. Por eso estas
 * pruebas van contra las formas concretas en que estos archivos se rechazan.
 */

describe("identificaciones", () => {
  it("nueve dígitos es RNC y once es cédula", () => {
    expect(idKind("131234567")).toBe("1");
    expect(idKind("00112345678")).toBe("2");
  });

  it("lo que no tiene esa forma es «otro», que es lo que espera para un extranjero", () => {
    expect(idKind("AB12345")).toBe("3");
    expect(idKind("")).toBe("3");
  });

  it("los guiones y los puntos se limpian antes de declarar", () => {
    // Es el rechazo más común de todos: el RNC se escribe de cinco maneras y la
    // DGII solo acepta dígitos.
    expect(cleanTaxId("1-31-23456-7")).toBe("131234567");
    expect(cleanTaxId("131.234.567")).toBe("131234567");
    expect(cleanTaxId(" 131234567 ")).toBe("131234567");
  });
});

describe("formatos de campo", () => {
  it("el período va como AAAAMM", () => {
    expect(periodOf("2026-09")).toBe("202609");
  });

  it("las fechas van como AAAAMMDD, y lo que no es fecha va vacío", () => {
    expect(dgiiDate("2026-09-16T14:00:00Z")).toBe("20260916");
    expect(dgiiDate(null)).toBe("");
    expect(dgiiDate("no es fecha")).toBe("");
  });

  it("los importes llevan punto decimal y dos decimales, sin miles", () => {
    expect(amount(1250.5)).toBe("1250.50");
    expect(amount(0)).toBe("0.00");
    // Y en las columnas que la DGII quiere en blanco, el cero es vacío.
    expect(amount(0, true)).toBe("");
    expect(amount(null, true)).toBe("");
  });

  it("el NCF va en mayúsculas y sin espacios", () => {
    expect(cleanNcf(" b0100000001 ")).toBe("B0100000001");
  });

  it("una forma de pago desconocida cae en «otras», no en vacío", () => {
    // Una columna vacía rechaza la línea entera.
    expect(paymentCode("cash")).toBe("01");
    expect(paymentCode("card")).toBe("04");
    expect(paymentCode("criptomoneda")).toBe("07");
    expect(paymentCode(null)).toBe("07");
  });
});

describe("la línea del 607 (ventas)", () => {
  const venta = {
    ncf: "B0100000015", customerTaxId: "131234567", issuedAt: "2026-09-10",
    services: 1000, goods: 0, itbis: 180, cash: 1180,
  };

  it("tiene exactamente las columnas del formato", () => {
    expect(line607(venta)).toHaveLength(COLUMNS_607.length);
  });

  it("el total facturado es la suma de servicios y bienes, no otra cosa", () => {
    const line = line607({ ...venta, services: 1000, goods: 250 });
    expect(line[7]).toBe("1000.00");
    expect(line[8]).toBe("250.00");
    expect(line[9]).toBe("1250.00");
  });

  it("una operadora declara servicios, y el ITBIS va aparte del total", () => {
    const line = line607(venta);
    expect(line[10]).toBe("180.00");
    // El ITBIS no se suma al monto facturado: son columnas distintas y sumarlo
    // duplicaría el impuesto en la declaración.
    expect(line[9]).toBe("1000.00");
  });

  it("el tipo de ingreso por defecto es operaciones, con dos dígitos", () => {
    expect(line607(venta)[4]).toBe("01");
    expect(line607({ ...venta, incomeType: "2" })[4]).toBe("02");
  });
});

describe("la línea del 606 (compras)", () => {
  const compra = {
    supplierTaxId: "101234567", ncf: "B0100000099", date: "2026-09-05",
    paidDate: "2026-09-20", services: 500, itbis: 90, goodsServiceType: "09",
    paymentMethod: "transfer",
  };

  it("tiene exactamente las columnas del formato", () => {
    expect(line606(compra)).toHaveLength(COLUMNS_606.length);
  });

  it("lleva las dos fechas: la del comprobante y la del pago", () => {
    const line = line606(compra);
    expect(line[5]).toBe("20260905");
    expect(line[6]).toBe("20260920");
  });

  it("sin tipo de bien o servicio cae a «otras deducciones», no a vacío", () => {
    expect(line606({ ...compra, goodsServiceType: null })[2]).toBe("09");
  });

  it("la forma de pago va traducida al código de la DGII", () => {
    expect(line606(compra)[22]).toBe("03");
  });
});

describe("el archivo", () => {
  it("la cabecera lleva el tipo, el RNC, el período y CUÁNTAS líneas van", () => {
    /**
     * Ese conteo es lo primero que valida la DGII: si no cuadra, rechaza el
     * archivo entero sin mirar el contenido.
     */
    const file = buildFile("606", "1-31-23456-7", "2026-09", [["a"], ["b"]]);
    const [header] = file.split("\r\n");
    expect(header).toBe("606|131234567|202609|2");
  });

  it("las columnas van separadas por barra y las filas por CRLF", () => {
    const file = buildFile("607", "131234567", "2026-09", [["x", "y"]]);
    expect(file.split("\r\n")[1]).toBe("x|y");
    expect(file.endsWith("\r\n")).toBe(true);
  });

  it("un mes sin movimiento genera archivo igual, con cero líneas", () => {
    // Hay que declarar aunque no haya habido ventas: un mes sin archivo es un
    // incumplimiento, no un mes tranquilo.
    expect(buildFile("606", "131234567", "2026-09", []).split("\r\n")[0]).toBe("606|131234567|202609|0");
  });

  it("el nombre del archivo es el que espera quien lo sube", () => {
    expect(fileName("607", "131234567", "2026-09")).toBe("DGII_607_131234567_202609.TXT");
  });
});

describe("lo que no se puede declarar se avisa ANTES", () => {
  /**
   * La alternativa es generar el archivo igual y que la DGII lo rechace días
   * después, sin decir qué línea: eso convierte un problema de cinco minutos en
   * revisar el mes entero a mano.
   */
  it("una compra sin NCF no entra", () => {
    expect(purchaseProblems({ supplierTaxId: "131234567", date: "2026-09-01", goodsServiceType: "09" }))
      .toContain("sin_ncf");
  });

  it("una compra sin RNC del proveedor tampoco", () => {
    expect(purchaseProblems({ ncf: "B01", date: "2026-09-01", goodsServiceType: "09" }))
      .toContain("sin_rnc");
  });

  it("un RNC con dígitos de más se señala por lo que es", () => {
    const problems = purchaseProblems({ ncf: "B01", supplierTaxId: "12345", date: "2026-09-01", goodsServiceType: "09" });
    expect(problems).toContain("rnc_invalido");
    expect(problems).not.toContain("sin_rnc");
  });

  it("una compra completa no tiene problemas", () => {
    expect(purchaseProblems({
      ncf: "B0100000099", supplierTaxId: "101234567", date: "2026-09-05", goodsServiceType: "09",
    })).toEqual([]);
  });

  it("una venta a consumidor final sin RNC es correcta", () => {
    // Es el caso más común de una operadora: el turista no tiene RNC, y marcar
    // eso como error llenaría la pantalla de falsos problemas cada mes.
    expect(saleProblems({ ncf: "B0200000001", issuedAt: "2026-09-10" })).toEqual([]);
  });

  it("pero una venta sin NCF no se puede declarar", () => {
    expect(saleProblems({ issuedAt: "2026-09-10" })).toContain("sin_ncf");
  });
});

describe("los totales que cuadra el contador", () => {
  it("suma facturado e ITBIS por separado", () => {
    const totals = totalsOf([
      { services: 1000, itbis: 180 },
      { services: 500, goods: 250, itbis: 135 },
    ]);
    expect(totals.rows).toBe(2);
    expect(totals.invoiced).toBe(1750);
    expect(totals.itbis).toBe(315);
  });
});
