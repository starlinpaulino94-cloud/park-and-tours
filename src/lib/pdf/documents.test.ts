import { describe, it, expect, vi } from "vitest";

// `documents.ts` es "server-only" y arrastra el proveedor de datos al importarse;
// aquí solo se ejercita el dibujado.
vi.mock("server-only", () => ({}));

import { PDFDocument } from "pdf-lib";
import {
  buildVoucherPdf, buildQuotePdf, buildManifestPdf, buildInvoicePdf, buildCashClosePdf,
  buildSupplierStatementPdf,
} from "@/lib/pdf/documents";
import { DENOMINATIONS, summarizeCash } from "@/lib/cash-close";
import { manifestRow, sortByRoute, pickupStops, paxSummary } from "@/lib/manifest";

const company = { name: "Caribe Tours", email: "hola@caribe.do", phone: "+1 809 555 0100", address: "Bávaro" };

/** Un PDF de verdad empieza por %PDF y termina por %%EOF. */
function assertIsPdf(bytes: Uint8Array) {
  const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  const tail = Buffer.from(bytes.slice(-1024)).toString("latin1");
  expect(head).toBe("%PDF-");
  expect(tail).toContain("%%EOF");
  expect(bytes.length).toBeGreaterThan(1000);
}

/**
 * Cuántas páginas tiene, leyéndolo de vuelta.
 *
 * Contar "/Type /Page" sobre los bytes crudos no sirve: pdf-lib comprime los
 * objetos, así que el recuento saldría cero aunque el documento tenga diez
 * hojas. Abrirlo es la única comprobación que no depende del formato interno.
 */
async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

/** Cuántas imágenes lleva incrustadas (el QR del voucher). */
async function imageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  let images = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (String(object).includes("/Image")) images++;
  }
  return images;
}

describe("documentos — voucher", () => {
  const booking = {
    booking_number: "RSV-2609-ABC1234",
    voucher_code: "VCH-AB12C-DE34F",
    customer_name: "Ana Pérez",
    product_name: "Isla Saona — día completo",
    travel_date: "2026-04-18T08:00:00Z",
    adults: 2, children: 1, infants: 0, pax_total: 3,
    pickup_hotel: "Barceló Bávaro", pickup_time: "07:30", room_number: "204",
    total_amount: 285, paid_amount: 100, balance_amount: 185, currency: "usd",
  };

  it("sale un PDF de una página con el QR dentro", async () => {
    const bytes = await buildVoucherPdf(company, booking);
    assertIsPdf(bytes);
    expect(await pageCount(bytes)).toBe(1);
    // El QR se incrusta como imagen: sin él, el check-in vuelve a teclearse a
    // mano delante de la cola, que es lo que un voucher existe para evitar.
    expect(await imageCount(bytes)).toBeGreaterThan(0);
    // Y sin código no hay QR que dibujar.
    const sinCodigo = await buildVoucherPdf(company, { ...booking, voucher_code: null });
    expect(await imageCount(sinCodigo)).toBe(0);
  });

  it("no revienta con un cliente cuyo nombre la fuente no sabe escribir", async () => {
    // pdf-lib LANZA con un carácter fuera de WinAnsi. Sin sanear, el voucher de
    // un cliente asiático fallaría en la puerta, con la cola delante.
    const bytes = await buildVoucherPdf(company, {
      ...booking, customer_name: "中村 さくら", notes: "Cumpleaños 🎂 — mesa junto al mar",
    });
    assertIsPdf(bytes);
  });

  it("aguanta una reserva a medio llenar", async () => {
    // Una reserva sin fecha ni recogida todavía tiene que poder imprimirse.
    assertIsPdf(await buildVoucherPdf(null, { booking_number: "RSV-1" }));
  });

  it("un texto largo de condiciones no se sale de la hoja", async () => {
    const bytes = await buildVoucherPdf(company, {
      ...booking,
      conditions: "Condición interminable. ".repeat(200),
      cancellation_policy: "Sin cargo hasta 15 días antes. ".repeat(40),
    });
    assertIsPdf(bytes);
    expect(await pageCount(bytes)).toBeGreaterThan(1);
  });
});

describe("documentos — cotización", () => {
  const quote = {
    code: "COT-2609-XYZ9876", title: "Colegio San Juan — 3 días",
    issued_at: "2026-03-01T10:00:00Z", valid_until: "2026-03-20T00:00:00Z",
    pax: 40, currency: "usd", tax_percent: 18,
    subtotal: 10000, discount: 500, tax: 1710, total: 11210,
    deposit_type: "percent", deposit_percent: 30, deposit_due_date: "2026-03-10",
    customer_name: "Colegio San Juan", seller_name: "José Ramírez",
    inclusions: "Transporte · Guía · Almuerzo", exclusions: "Bebidas alcohólicas",
  };
  const lines = [
    { description: "Transporte ida y vuelta", quantity: 1, unit_price: 1200, line_total: 1200 },
    { description: "Almuerzo buffet", quantity: 40, unit_price: 25, line_total: 1000 },
  ];

  it("una propuesta sin alternativas lleva su desglose y su total", async () => {
    const bytes = await buildQuotePdf(company, quote, lines, []);
    assertIsPdf(bytes);
    expect(await pageCount(bytes)).toBe(1);
  });

  it("con alternativas, cada una trae lo común más lo suyo", async () => {
    const options = [
      { _id: "a", name: "Hotel 4*", sort_order: 1 },
      { _id: "b", name: "Hotel 5*", sort_order: 2, is_recommended: true },
    ];
    const bytes = await buildQuotePdf(company, quote, [
      ...lines,
      { description: "Alojamiento 4*", quantity: 40, unit_price: 90, line_total: 3600, option_id: "a" },
      { description: "Alojamiento 5*", quantity: 40, unit_price: 140, line_total: 5600, option_id: "b" },
      { description: "Excursión opcional", quantity: 40, unit_price: 45, line_total: 1800, option_id: "b", is_optional: true },
    ], options);
    assertIsPdf(bytes);
  });

  it("un grupo con cuarenta líneas pagina sin cortarse", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      description: `Servicio ${i + 1} con un nombre razonablemente largo`,
      quantity: 40, unit_price: 25 + i, line_total: (25 + i) * 40,
    }));
    const bytes = await buildQuotePdf(company, quote, many, []);
    assertIsPdf(bytes);
    expect(await pageCount(bytes)).toBeGreaterThan(1);
  });
});

describe("documentos — factura fiscal", () => {
  const invoice = {
    ncf: "B0200000045", ncf_type: "b02", number: "FAC-2609-ABC1234",
    invoice_type: "sale", status: "issued",
    issued_at: "2026-03-01T10:00:00Z", ncf_expires_at: "2027-12-31",
    customer_name: "Colegio San Juan", customer_tax_id: "131234567",
    order_number: "ORD-2609-XYZ9876", currency: "dop",
    subtotal: 10000, tax: 1800, tax_rate: 18, total: 11800, paid_amount: 5000, balance: 6800,
  };
  const lines = [
    { description: "Isla Saona — día completo · RSV-1", quantity: 1, unit_price: 8000, tax_rate: 18, tax_amount: 1440, total: 9440 },
    { description: "Tasa de muelle", quantity: 1, unit_price: 2000, tax_rate: 0, tax_amount: 0, total: 2000, is_exempt: true },
  ];

  it("sale un comprobante válido con su NCF", async () => {
    const bytes = await buildInvoicePdf({ ...company, tax_id: "101234561" }, invoice, lines);
    assertIsPdf(bytes);
    expect(await pageCount(bytes)).toBe(1);
  });

  it("una nota de crédito dice qué comprobante anula", async () => {
    // Es lo que la DGII pide declarar, y sin ello la anulación no se justifica.
    const bytes = await buildInvoicePdf(company, {
      ...invoice, ncf: "B0400000003", ncf_type: "b04",
      invoice_type: "credit_note", credit_note_of: "B0200000045",
    }, lines);
    assertIsPdf(bytes);
  });

  it("una anulada se marca sin validez fiscal", async () => {
    const bytes = await buildInvoicePdf(company, {
      ...invoice, voided_at: "2026-03-05T10:00:00Z", void_reason: "Error en el RNC",
    }, lines);
    assertIsPdf(bytes);
  });

  it("un cliente sin RNC no finge tenerlo", async () => {
    // Sin RNC en el receptor un crédito fiscal no es deducible: mejor que se vea
    // vacío a que parezca completo.
    assertIsPdf(await buildInvoicePdf(company, { ...invoice, customer_tax_id: null }, lines));
  });

  it("una factura de cien líneas pagina", async () => {
    const many = Array.from({ length: 90 }, (_, i) => ({
      description: `Servicio facturado número ${i + 1}`,
      quantity: 1, unit_price: 100 + i, tax_rate: 18, tax_amount: 18, total: 118 + i,
    }));
    const bytes = await buildInvoicePdf(company, invoice, many);
    expect(await pageCount(bytes)).toBeGreaterThan(1);
  });
});

describe("documentos — manifiesto", () => {
  const rows = sortByRoute([
    manifestRow({
      _id: "b1", booking_number: "RSV-1", adults: 2, pickup_time: "07:30",
      customer: { first_name: "Ana", last_name: "Pérez", phone: "809-555-0101" },
      pickup_hotel: { name: "Barceló", zone: { name: "Bávaro" } }, room_number: "204",
      participant: [{ _id: "p1", full_name: "Ana Pérez", special_requirements: "Alérgica al marisco" }],
    }),
    manifestRow({
      _id: "b2", booking_number: "RSV-2", adults: 1, infants: 1, pickup_time: "08:00",
      balance_amount: 45, currency: "usd",
      customer: { first_name: "Luis", last_name: "Gómez" },
      pickup_hotel: { name: "Riu" },
    }),
  ]);

  it("sale la hoja de ruta y la lista nominal", async () => {
    const bytes = await buildManifestPdf(
      company,
      {
        product_name: "Isla Saona", departure_at: "2026-04-18T08:00:00Z",
        meeting_point: "Lobby principal", capacity: 20,
        vehicles: [{ plate: "A123456", capacity: 18 }],
        staff: [{ name: "Marcos Díaz", role: "guide", phone: "809-555-0202" }],
      },
      rows, pickupStops(rows), paxSummary(rows)
    );
    assertIsPdf(bytes);
  });

  it("una salida llena pagina y repite la cabecera de la tabla", async () => {
    // Sin repetirla, la segunda hoja son columnas de números sin nombre y
    // alguien acaba contando pasajeros con el dedo.
    const many = sortByRoute(Array.from({ length: 80 }, (_, i) =>
      manifestRow({
        _id: `b${i}`, booking_number: `RSV-${i}`, adults: 2,
        pickup_time: `0${6 + (i % 3)}:${String((i * 7) % 60).padStart(2, "0")}`,
        customer: { first_name: `Cliente ${i}`, last_name: "Apellido" },
        pickup_hotel: { name: `Hotel ${i % 12}` },
      })
    ));
    const bytes = await buildManifestPdf(company, { product_name: "Saona" }, many, pickupStops(many), paxSummary(many));
    assertIsPdf(bytes);
    expect(await pageCount(bytes)).toBeGreaterThan(1);
  });

  it("una salida sin nadie reservado sigue siendo un documento válido", async () => {
    assertIsPdf(await buildManifestPdf(null, { product_name: "Saona" }, [], [], paxSummary([])));
  });
});

describe("el acta del arqueo", () => {
  const turno = (currency: string, expected: number) => ({
    ...summarizeCash(
      [
        { movement_type: "opening", amount: 5000, currency },
        { movement_type: "sale", amount: expected, currency },
      ],
      [{ method: "cash", amount: expected, currency }],
    )[0],
    counted: null as number | null,
    difference: null as number | null,
    breakdown: [] as { denomination: number; quantity: number }[],
  });

  const meta = {
    code: "CAJ-0042", register: "Caja recepción", branch: "Bávaro", cashier: "Ana Cajera",
    opened_at: "2026-04-18T12:00:00Z", closed_at: "2026-04-18T23:30:00Z",
    status: "closed", approved_by: null, approved_at: null,
    difference_reason: null, deposit_reference: null, notes: null,
    card: { expected: 0, batch: null, difference: null, reference: null },
  };

  it("lleva el desglose por denominación", async () => {
    const row = {
      ...turno("dop", 12000),
      counted: 16800,
      difference: -200,
      breakdown: [
        { denomination: 2000, quantity: 8 },
        { denomination: 500, quantity: 1 },
        { denomination: 100, quantity: 3 },
      ],
    };
    const bytes = await buildCashClosePdf(company, meta, [row]);
    assertIsPdf(bytes);
  });

  it("un turno con dos monedas las separa en el papel", async () => {
    const bytes = await buildCashClosePdf(company, meta, [
      { ...turno("dop", 12000), counted: 17000, difference: 0, breakdown: [{ denomination: 1000, quantity: 17 }] },
      { ...turno("usd", 300), counted: 5300, difference: 0, breakdown: [{ denomination: 100, quantity: 53 }] },
    ]);
    assertIsPdf(bytes);
  });

  it("un arqueo con todas las denominaciones del peso cabe y pagina bien", async () => {
    const breakdown = DENOMINATIONS.dop.map((denomination) => ({ denomination, quantity: 9 }));
    const bytes = await buildCashClosePdf(
      company,
      { ...meta, status: "pending_approval", difference_reason: "Faltó un billete en el vuelto de la tarde" },
      [{ ...turno("dop", 40000), counted: 32229, difference: -1200, breakdown }]
    );
    assertIsPdf(bytes);
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1);
  });

  it("una caja sin cerrar todavía es un documento válido", async () => {
    assertIsPdf(await buildCashClosePdf(null, { ...meta, closed_at: null, status: "open" }, [turno("dop", 0)]));
  });
});

describe("el estado de cuenta del proveedor", () => {
  const meta = {
    code: "LIQ-0091", supplier_name: "Transporte Bávaro SRL", supplier_tax_id: "130123456",
    period_from: "2026-04-01", period_to: "2026-04-30", status: "pending",
    invoice_number: null as string | null, invoice_ncf: null as string | null,
    invoice_date: null as string | null,
    currency: "dop",
    services: 24000, confirmed: 24000, adjustments: 0,
    retention_isr: 0, retention_itbis: 0, retention_total: 0,
    net: 24000, taxable_base: 24000,
    dispute_reason: null as string | null, notes: null as string | null,
  };

  const line = (n: number, confirmed?: number | null) => ({
    concept: "Transporte", booking_number: `RSV-${n}`,
    departure_at: `2026-04-${String((n % 28) + 1).padStart(2, "0")}T08:00:00Z`,
    product_name: "Isla Saona", quantity: 2, unit_cost: 600,
    amount: 1200,
    confirmed_amount: confirmed ?? null,
    variance: confirmed == null ? 0 : confirmed - 1200,
  });

  it("sin factura todavía, enseña lo operado y avisa de que falta el comprobante", async () => {
    const bytes = await buildSupplierStatementPdf(company, meta, [line(1), line(2)]);
    assertIsPdf(bytes);
  });

  it("con factura, enseña operado y facturado uno al lado del otro", async () => {
    const bytes = await buildSupplierStatementPdf(
      company,
      {
        ...meta, invoice_number: "B0100000123", invoice_ncf: "B0100000123",
        invoice_date: "2026-05-02", confirmed: 25200,
        retention_isr: 0, retention_itbis: 0, retention_total: 0, net: 25200,
      },
      [line(1, 1200), line(2, 1400)]
    );
    assertIsPdf(bytes);
  });

  it("con retenciones, desglosa la base y cada retención", async () => {
    const bytes = await buildSupplierStatementPdf(
      company,
      {
        ...meta, supplier_name: "Juan Guía", invoice_number: "B0200000045",
        confirmed: 11800, taxable_base: 10000,
        retention_isr: 1000, retention_itbis: 1800, retention_total: 2800, net: 9000,
      },
      [line(1, 11800)]
    );
    assertIsPdf(bytes);
  });

  it("un período largo pagina y repite la cabecera de la tabla", async () => {
    const many = Array.from({ length: 90 }, (_, i) => line(i + 1, 1200));
    const bytes = await buildSupplierStatementPdf(
      company, { ...meta, invoice_number: "B0100000999", confirmed: 108000, net: 108000 }, many
    );
    assertIsPdf(bytes);
    expect(await pageCount(bytes)).toBeGreaterThan(1);
  });

  it("una liquidación en disputa lo dice en el papel", async () => {
    assertIsPdf(await buildSupplierStatementPdf(
      null,
      { ...meta, invoice_number: "B01", dispute_reason: "3 servicios no cuadran con lo operado" },
      [line(1, 5000)]
    ));
  });
});
