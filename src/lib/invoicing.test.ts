import { describe, it, expect } from "vitest";
import {
  formatNcf, isElectronic, creditNoteTypeFor, ncfTypeFor, normalizeTaxId, formatTaxId,
  lineAmounts, invoiceTotals, voidBlocker, invoiceBalance, paymentStatus, sequenceHealth,
  VOID_BLOCK_MESSAGE,
} from "@/lib/invoicing";

describe("facturación — el número del comprobante", () => {
  it("un NCF de la serie B son 11 caracteres; un e-CF, 13", () => {
    // Usar el mismo ancho para los dos produce comprobantes que la DGII rechaza
    // sin decir por qué.
    expect(formatNcf("b02", 45)).toBe("B0200000045");
    expect(formatNcf("b02", 45)).toHaveLength(11);
    expect(formatNcf("e32", 45)).toBe("E320000000045");
    expect(formatNcf("e32", 45)).toHaveLength(13);
  });

  it("no se pierde un dígito al llegar al final del rango", () => {
    expect(formatNcf("b01", 99999999)).toBe("B0199999999");
  });

  it("distingue el comprobante electrónico del impreso", () => {
    expect(isElectronic("e31")).toBe(true);
    expect(isElectronic("b01")).toBe(false);
  });

  it("la nota de crédito es de la serie de la factura que anula", () => {
    // Un e-CF no se anula con un B04, ni al revés.
    expect(creditNoteTypeFor("b01")).toBe("b04");
    expect(creditNoteTypeFor("e31")).toBe("e34");
  });
});

describe("facturación — qué comprobante le toca al cliente", () => {
  it("con RNC, crédito fiscal; sin identificación, consumo", () => {
    // Emitir consumo a una empresa le impide deducirse el ITBIS; emitir crédito
    // fiscal sin RNC es un comprobante que la DGII rechaza.
    expect(ncfTypeFor({ tax_id: "131234567" })).toBe("b01");
    expect(ncfTypeFor({ tax_id: null })).toBe("b02");
  });

  it("en electrónico, los equivalentes de la serie E", () => {
    expect(ncfTypeFor({ tax_id: "131234567" }, true)).toBe("e31");
    expect(ncfTypeFor({}, true)).toBe("e32");
  });

  it("gobierno y régimen especial tienen el suyo", () => {
    expect(ncfTypeFor({ tax_id: "131234567", is_government: true })).toBe("b15");
    expect(ncfTypeFor({ tax_id: "131234567", is_special_regime: true })).toBe("b14");
  });

  it("un RNC mal tecleado no convierte la factura en crédito fiscal", () => {
    // 8 dígitos no es un RNC: emitir B01 con eso es un comprobante inválido.
    expect(ncfTypeFor({ tax_id: "1312345" })).toBe("b02");
  });
});

describe("facturación — la identificación fiscal", () => {
  it("acepta RNC de 9 y cédula de 11, con la puntuación que sea", () => {
    // El mismo contribuyente se teclea de cinco formas, y en el 606 dos escrituras
    // del mismo RNC son dos contribuyentes.
    expect(normalizeTaxId("1-31-23456-7")).toBe("131234567");
    expect(normalizeTaxId("131 234 567")).toBe("131234567");
    expect(normalizeTaxId("001-1234567-8")).toBe("00112345678");
  });

  it("rechaza lo que no tiene forma de identificación", () => {
    expect(normalizeTaxId("12345")).toBeNull();
    expect(normalizeTaxId("")).toBeNull();
    expect(normalizeTaxId(null)).toBeNull();
  });

  it("se muestra con su puntuación habitual", () => {
    expect(formatTaxId("131234567")).toBe("1-31-23456-7");
    expect(formatTaxId("00112345678")).toBe("001-1234567-8");
    // Lo que no es válido se enseña tal cual: es un dato que alguien escribió.
    expect(formatTaxId("pendiente")).toBe("pendiente");
  });
});

describe("facturación — importes de una línea", () => {
  it("añade el impuesto cuando el precio no lo lleva", () => {
    expect(lineAmounts({ quantity: 2, unit_price: 100, tax_rate: 18 }))
      .toEqual({ base: 200, tax_amount: 36, total: 236 });
  });

  it("lo extrae cuando el precio ya lo lleva dentro", () => {
    // El precio de mostrador al turista incluye el ITBIS; el de agencia no.
    // Calcular uno como el otro desvía el impuesto declarado un 18% justo.
    expect(lineAmounts({ quantity: 1, unit_price: 236, tax_rate: 18 }, true))
      .toEqual({ base: 200, tax_amount: 36, total: 236 });
  });

  it("el descuento baja la base sobre la que se calcula el impuesto", () => {
    expect(lineAmounts({ quantity: 1, unit_price: 100, discount: 10, tax_rate: 18 }))
      .toEqual({ base: 90, tax_amount: 16.2, total: 106.2 });
  });

  it("un descuento mayor que la línea no la deja en negativo", () => {
    expect(lineAmounts({ quantity: 1, unit_price: 100, discount: 150 }).total).toBe(0);
  });

  it("una línea exenta no lleva impuesto aunque traiga tasa", () => {
    expect(lineAmounts({ quantity: 1, unit_price: 100, tax_rate: 18, is_exempt: true }))
      .toEqual({ base: 100, tax_amount: 0, total: 100 });
  });
});

describe("facturación — totales", () => {
  const lines = [
    { quantity: 2, unit_price: 100, tax_rate: 18 },
    { quantity: 1, unit_price: 50, tax_rate: 0 },
    { quantity: 1, unit_price: 30, tax_rate: 16 },
  ];

  it("suma base, impuesto y total", () => {
    const t = invoiceTotals(lines);
    expect(t.subtotal).toBe(280);
    expect(t.tax).toBe(36 + 4.8);
    expect(t.total).toBe(320.8);
  });

  it("desglosa el impuesto por tasa: es lo que pide el 607", () => {
    // Una factura mixta con una sola tasa en la cabecera no se puede declarar.
    expect(invoiceTotals(lines).tax_by_rate).toEqual({ "18": 36, "16": 4.8 });
  });

  it("separa lo exento", () => {
    expect(invoiceTotals(lines).exempt_total).toBe(50);
  });

  it("una factura sin líneas vale cero y no rompe", () => {
    expect(invoiceTotals([])).toMatchObject({ subtotal: 0, tax: 0, total: 0, exempt_total: 0 });
  });
});

describe("facturación — anulación y cobro", () => {
  const issued = { status: "issued", invoice_type: "sale", ncf: "B0200000001", total: 236, paid_amount: 0 };

  it("una factura emitida se anula con nota de crédito", () => {
    expect(voidBlocker(issued)).toBeNull();
  });

  it("un borrador no se anula: se descarta antes de gastar el número", () => {
    expect(voidBlocker({ status: "draft", invoice_type: "sale" })).toBe("not_issued");
  });

  it("no se anula dos veces ni se anula una nota de crédito", () => {
    expect(voidBlocker({ ...issued, voided_at: "2026-01-01" })).toBe("already_voided");
    expect(voidBlocker({ ...issued, invoice_type: "credit_note" })).toBe("is_credit_note");
  });

  it("cada bloqueo dice qué hacer", () => {
    for (const message of Object.values(VOID_BLOCK_MESSAGE)) {
      expect(message.length).toBeGreaterThan(15);
    }
  });

  it("el saldo manda sobre el estado guardado", () => {
    // `status` se queda atrás en cuanto entra un pago.
    const now = new Date("2026-03-10T00:00:00Z");
    expect(invoiceBalance({ total: 236, paid_amount: 100 })).toBe(136);
    expect(paymentStatus({ ...issued, paid_amount: 100 }, now)).toBe("partially_paid");
    expect(paymentStatus({ ...issued, paid_amount: 236 }, now)).toBe("paid");
    expect(paymentStatus(issued, now, "2026-03-01")).toBe("overdue");
    expect(paymentStatus(issued, now, "2026-04-01")).toBe("issued");
  });

  it("una anulada no se vuelve vencida por la fecha", () => {
    const now = new Date("2026-03-10T00:00:00Z");
    expect(paymentStatus({ ...issued, voided_at: "2026-02-01" }, now, "2026-03-01")).toBe("voided");
  });
});

describe("facturación — salud de la secuencia", () => {
  const now = new Date("2026-03-10T00:00:00Z");

  it("avisa con margen, no cuando ya no se puede facturar", () => {
    // Pedirle un rango nuevo a la DGII no es inmediato.
    const health = sequenceHealth({ next_number: 960, max_number: 1000, expires_at: "2027-01-01" }, now);
    expect(health).toMatchObject({ remaining: 41, level: "warning" });
    expect(health.message).toContain("41");
  });

  it("agotada y vencida son estados distintos, y los dos bloquean", () => {
    expect(sequenceHealth({ next_number: 1001, max_number: 1000 }, now))
      .toMatchObject({ remaining: 0, level: "danger" });
    expect(sequenceHealth({ next_number: 1, max_number: 1000, expires_at: "2026-01-01" }, now))
      .toMatchObject({ expired: true, level: "danger" });
  });

  it("avisa también del vencimiento próximo, aunque queden números", () => {
    expect(sequenceHealth({ next_number: 1, max_number: 100000, expires_at: "2026-03-25" }, now))
      .toMatchObject({ level: "warning", days_left: 15 });
  });

  it("una secuencia holgada no genera ruido", () => {
    expect(sequenceHealth({ next_number: 10, max_number: 100000, expires_at: "2028-01-01" }, now))
      .toMatchObject({ level: "ok", message: null });
  });

  it("sin tope declarado no se inventa un restante", () => {
    expect(sequenceHealth({ next_number: 500 }, now).remaining).toBeNull();
  });
});
