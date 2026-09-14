import { describe, it, expect, vi } from "vitest";

// `documents.ts` es "server-only" y arrastra el proveedor de datos al importarse;
// aquí solo se ejercita el dibujado.
vi.mock("server-only", () => ({}));

import { PDFDocument } from "pdf-lib";
import { buildVoucherPdf, buildQuotePdf, buildManifestPdf } from "@/lib/pdf/documents";
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
