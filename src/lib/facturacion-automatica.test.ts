import { describe, it, expect } from "vitest";
import { decidirFactura, explicarDecision, MOTIVO_TEXTO } from "@/lib/facturacion-automatica";

const saldada = { total: 100, paid_total: 100, status: "paid" };

describe("cuándo se factura sola", () => {
  it("una venta saldada se factura", () => {
    expect(decidirFactura(saldada, "payment")).toEqual({ facturar: true, motivo: null });
  });

  it("un abono a cuenta NO quema un NCF", () => {
    /**
     * Un NCF consume secuencia, se declara en el 607, y deshacerlo exige una
     * nota de crédito que consume OTRO. Facturar en el primer abono de una
     * venta que luego se cancela deja dos comprobantes quemados y un 607 que
     * hay que explicar.
     */
    expect(decidirFactura({ total: 100, paid_total: 40 }, "payment"))
      .toEqual({ facturar: false, motivo: "queda_saldo" });
  });

  it("una devolución nunca factura", () => {
    // Documentar una devolución como venta es exactamente al revés.
    for (const tipo of ["refund", "credit_note"]) {
      expect(decidirFactura(saldada, tipo).motivo, tipo).toBe("es_devolucion");
    }
  });

  it("una venta anulada no se documenta como vendida", () => {
    for (const estado of ["cancelled", "refunded", "voided"]) {
      expect(decidirFactura({ ...saldada, status: estado }, "payment").motivo, estado)
        .toBe("venta_anulada");
    }
  });

  it("un cobro suelto, sin orden, no factura", () => {
    expect(decidirFactura(null, "payment").motivo).toBe("sin_orden");
  });

  it("una venta de importe cero no factura", () => {
    // Una cortesía o una corrección a cero no es una venta que declarar.
    expect(decidirFactura({ total: 0, paid_total: 0 }, "payment").motivo).toBe("sin_importe");
  });

  it("un centavo de diferencia por redondeo SÍ cuenta como saldada", () => {
    /**
     * Los importes son numeric(14,2) y el reparto entre líneas deja residuos.
     * Si un céntimo impidiera facturar, habría ventas cobradas enteras que no
     * sacan comprobante y nadie sabría por qué.
     */
    expect(decidirFactura({ total: 100, paid_total: 99.995 }, "payment").facturar).toBe(true);
  });

  it("un peso de menos NO cuenta como saldada", () => {
    expect(decidirFactura({ total: 100, paid_total: 99 }, "payment").motivo).toBe("queda_saldo");
  });

  it("un sobrepago factura igual: el saldo está cubierto", () => {
    expect(decidirFactura({ total: 100, paid_total: 120 }, "payment").facturar).toBe(true);
  });

  it("los totales que llegan como texto desde la base deciden igual", () => {
    expect(decidirFactura({ total: "100", paid_total: "100" } as never, "payment").facturar).toBe(true);
  });

  it("cada motivo tiene un texto que explica por qué", () => {
    // Va a la bitácora. «No se facturó» sin motivo convierte cada duda en una
    // investigación.
    for (const [motivo, texto] of Object.entries(MOTIVO_TEXTO)) {
      expect(texto.length, motivo).toBeGreaterThan(10);
    }
    expect(explicarDecision({ facturar: true, motivo: null })).toContain("saldada");
    expect(explicarDecision({ facturar: false, motivo: "queda_saldo" })).toContain("saldo");
  });
});

describe("la factura nunca tumba un cobro", () => {
  it("la ruta de cobros emite en mejor esfuerzo, no en el camino crítico", async () => {
    /**
     * EL INVARIANTE QUE NO SE PUEDE PERDER.
     *
     * Si la secuencia de NCF está agotada o falta el perfil fiscal, el dinero
     * ENTRÓ igual. Tumbar el cobro por no poder emitir el comprobante convierte
     * un problema administrativo en un descuadre de caja: el cliente pagó, el
     * cajero tiene el efectivo en la mano y el sistema dice que no pasó nada.
     *
     * Es la misma regla que ya sigue la contabilidad en esa ruta.
     */
    const { readFileSync } = await import("node:fs");
    const ruta = readFileSync("src/app/api/payments/route.ts", "utf8");

    const i = ruta.indexOf("issueInvoice(");
    expect(i, "la ruta de cobros ya no emite factura").toBeGreaterThan(-1);

    // La llamada tiene que estar dentro de un try, y el catch NO puede relanzar.
    const antes = ruta.slice(Math.max(0, i - 400), i);
    expect(antes, "la emisión no está protegida por un try").toMatch(/try\s*\{/);

    const despues = ruta.slice(i, i + 1400);
    const catchBloque = /catch\s*\(\s*err\s*\)\s*\{([\s\S]*?)\n\s*\}/.exec(despues)?.[1] ?? "";
    expect(catchBloque, "no se captura el fallo de la emisión").toBeTruthy();
    expect(catchBloque, "el catch relanza y tumbaría el cobro").not.toMatch(/\bthrow\b/);

    // Y el fallo se cuenta, en vez de tragarse en silencio.
    expect(despues, "un fallo de emisión no queda registrado").toMatch(/invoice_issue_failed/);
    expect(ruta, "la respuesta no dice si hubo factura").toMatch(/factura_error/);
  });

  it("el cobro se devuelve siempre, con factura o sin ella", async () => {
    const { readFileSync } = await import("node:fs");
    const ruta = readFileSync("src/app/api/payments/route.ts", "utf8");
    // La respuesta lleva el pago SIEMPRE; `factura` va como añadido.
    expect(ruta).toMatch(/return ok\(\{ \.\.\.payment, factura/);
  });
});
