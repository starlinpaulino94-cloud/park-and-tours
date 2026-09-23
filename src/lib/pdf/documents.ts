import "server-only";
import QRCode from "qrcode";
import { PdfBuilder } from "@/lib/pdf/doc";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatTime, formatPercent } from "@/lib/format";
import { DOC_DICTIONARY, normalizeLocale, translator, formatDateFor, formatTimeFor, DEFAULT_LOCALE } from "@/lib/i18n";
import { formatTaxId } from "@/lib/invoicing";
import { depositDue, optionBreakdown, lineGross } from "@/lib/quotes";
import { documentBrand, type CompanyBranding, type DocumentKind } from "@/lib/branding";
import { fetchLogo } from "@/lib/pdf/logo";
import { APP_URL } from "@/lib/stripe";
import type { ManifestRow, PickupStop, PaxSummary } from "@/lib/manifest";
import { montoEnLetras } from "@/lib/monto-en-letras";

/**
 * Los tres documentos que la empresa entrega.
 *
 * Hasta ahora el sistema no producía ni uno: el voucher viajaba como un código
 * de texto dentro de un correo, la cotización había que copiarla a mano a un
 * documento aparte, y el manifiesto solo existía como pantalla. Los tres se
 * imprimen, se adjuntan y se enseñan en una puerta, así que llevan lo que hace
 * falta para eso —un QR que se pueda escanear, el desglose que sostiene el
 * precio, la lista de quién viaja— y nada más.
 */

/**
 * Lo que un documento necesita saber de la empresa que lo emite.
 *
 * Antes eran cinco campos sueltos y el documento salía siempre del mismo verde.
 * Ahora es la ficha de marca completa (0055): `documentBrand` la resuelve —el
 * color validado, el logo incrustable, el RNC etiquetado, las condiciones que
 * tocan a ESTE documento— y `PdfBuilder` la pinta.
 */
type CompanyInfo = CompanyBranding;

/**
 * La marca y el logo listos para el constructor.
 *
 * El logo se baja aquí y no en cada ruta: son seis documentos y seis llamantes,
 * y bastaba con que uno se olvidara para que ESE documento saliera sin logo sin
 * que nadie supiera por qué. `fetchLogo` nunca lanza — un almacenamiento lento
 * o un enlace roto dejan el documento sin logo, no sin documento.
 */
async function brandFor(company: CompanyInfo | null, kind: DocumentKind) {
  const brand = documentBrand(company, kind);
  return { brand, logo: await fetchLogo(brand.logo, APP_URL) };
}

/* ------------------------------------------------------------------ voucher */

export interface VoucherData {
  /**
   * El idioma del huésped. El voucher lo enseña ÉL en la puerta, a veces a
   * alguien que no lo emitió: un documento con las etiquetas en un idioma que
   * no lee no es un documento, es un papel.
   */
  language?: string | null;
  /**
   * La marca del tour center que vendió, cuando la venta es suya.
   *
   * El turista compró en su mostrador y no sabe que detrás hay una operadora.
   * `null` deja el documento como siempre.
   */
  brand_override?: CompanyBranding | null;
  /**
   * EL NETO NO VIAJA EN EL PAPEL QUE ENTREGA EL SOCIO.
   *
   * `total_amount` de una reserva B2B es lo que el tour center le paga a la
   * operadora, no lo que el turista pagó en el mostrador. Imprimirlo le enseña
   * al cliente el margen de quien se lo vendió — en el documento que ese mismo
   * vendedor le está poniendo en la mano.
   *
   * Y no se pone a cero: un total en cero dice «esto no costó nada», que es
   * otra afirmación falsa. El bloque entero desaparece y en su lugar va una
   * línea que remite a quien cobró.
   */
  hide_amounts?: boolean;
  booking_number?: string | null;
  voucher_code?: string | null;
  status?: string | null;
  customer_name?: string | null;
  product_name?: string | null;
  modality_name?: string | null;
  travel_date?: string | null;
  adults?: number | null;
  children?: number | null;
  infants?: number | null;
  pax_total?: number | null;
  pickup_hotel?: string | null;
  pickup_time?: string | null;
  pickup_location?: string | null;
  room_number?: string | null;
  meeting_point?: string | null;
  total_amount?: number | null;
  paid_amount?: number | null;
  balance_amount?: number | null;
  currency?: string | null;
  inclusions?: string | null;
  exclusions?: string | null;
  recommendations?: string | null;
  restrictions?: string | null;
  instructions?: string | null;
  conditions?: string | null;
  cancellation_policy?: string | null;
  notes?: string | null;
  sold_by?: string | null;
  extras?: { description: string; quantity: number; amount: number }[];
}

/**
 * El voucher: el papel que el cliente enseña en la puerta.
 *
 * El QR codifica el código del voucher, que es lo que valida el check-in. Sin él
 * el documento obliga a teclear el código a mano delante de una cola, que es
 * exactamente lo que un voucher existe para evitar.
 */
export async function buildVoucherPdf(company: CompanyInfo | null, data: VoucherData): Promise<Uint8Array> {
  const currency = data.currency || "usd";
  // El idioma sale de la ficha del cliente. Sin idioma, español: el respaldo
  // nunca es una clave de diccionario en un documento impreso.
  const locale = normalizeLocale(data.language) ?? DEFAULT_LOCALE;
  const t = translator(DOC_DICTIONARY, locale);
  /**
   * La identidad es del socio; las condiciones y el pie, de la operadora.
   *
   * `brandFor` sacaría las condiciones de la ficha del socio —que no las
   * tiene—, así que el documento saldría sin la letra pequeña justo en el
   * caso en que más falta hace. Se toman aparte.
   */
  const { brand: marca, logo } = await brandFor(data.brand_override ?? company, "voucher");
  const brand = data.brand_override
    ? { ...marca, terms: documentBrand(company, "voucher").terms }
    : marca;
  const pdf = await PdfBuilder.create({
    kind: "VOUCHER",
    reference: data.booking_number,
    company,
    footer: company?.name || undefined,
    brand,
    logo,
  });

  pdf.heading(data.product_name || t("doc.booking"));
  if (data.modality_name) pdf.paragraph(data.modality_name, 10);
  pdf.gap(4);

  if (data.voucher_code) {
    // Margen 1 y 240 px: legible impreso en blanco y negro y escaneado desde una
    // pantalla de móvil, que es como se presenta la mitad de las veces.
    const png = await QRCode.toBuffer(data.voucher_code, { type: "png", margin: 1, width: 240 });
    await pdf.image(new Uint8Array(png), 110, { alignRight: true });
    pdf.gap(-100);
  }

  pdf.row(t("doc.booking"), data.booking_number || "—", { strong: true });
  if (data.voucher_code) pdf.row(t("doc.voucherCode"), data.voucher_code);
  pdf.row(t("doc.customer"), data.customer_name || "—");
  pdf.row(t("doc.date"), data.travel_date ? `${formatDateFor(locale, data.travel_date)} · ${formatTimeFor(locale, data.travel_date)}` : t("doc.tbc"));

  const pax = [
    data.adults ? `${data.adults} ${t(data.adults === 1 ? "doc.adult" : "doc.adults")}` : "",
    data.children ? `${data.children} ${t(data.children === 1 ? "doc.child" : "doc.children")}` : "",
    data.infants ? `${data.infants} ${t(data.infants === 1 ? "doc.infant" : "doc.infants")}` : "",
  ].filter(Boolean).join(" · ") || `${formatNumber(data.pax_total ?? 0)} pax`;
  pdf.row(t("doc.pax"), pax);
  pdf.gap(6);

  pdf.eyebrow(t("doc.pickup"));
  if (data.pickup_hotel || data.pickup_time) {
    pdf.row(t("doc.time"), data.pickup_time || t("doc.tbc"));
    pdf.row(t("doc.place"), [data.pickup_hotel, data.room_number ? `${t("doc.room")} ${data.room_number}` : ""].filter(Boolean).join(" · ") || data.pickup_location || "—");
  } else {
    pdf.paragraph(data.meeting_point || data.pickup_location || t("doc.meetingPointFallback"));
  }
  pdf.gap(8);

  if (data.extras?.length) {
    pdf.eyebrow(t("doc.extras"));
    pdf.table(
      [{ header: t("doc.concept"), width: 4 }, { header: t("doc.qty"), width: 0.8, align: "right" }, { header: t("doc.amount"), width: 1.2, align: "right" }],
      data.extras.map((e) => [e.description, formatNumber(e.quantity), formatMoney(e.amount, currency)])
    );
    pdf.gap(10);
  }

  if (data.hide_amounts) {
    // Ni el total ni el saldo: los dos son de la relación entre el tour center
    // y la operadora, no de lo que el turista pagó. Se le dice con quién
    // arregla cualquier cobro, que es lo único que le sirve.
    pdf.notice(t("doc.showNotice"));
  } else {
    pdf.eyebrow(t("doc.amount"));
    pdf.row(t("doc.total"), formatMoney(data.total_amount ?? 0, currency), { strong: true });
    pdf.row(t("doc.paid"), formatMoney(data.paid_amount ?? 0, currency));
    const balance = data.balance_amount ?? 0;
    pdf.row(t("doc.balance"), formatMoney(balance, currency));
    pdf.gap(6);

    if (balance > 0.009) {
      // Que el cliente lo sepa antes de subir al vehículo evita la discusión en
      // la puerta, que es donde peor se resuelve.
      pdf.notice(t("doc.balanceNotice", { amount: formatMoney(balance, currency) }));
    } else {
      pdf.notice(t("doc.showNotice"));
    }
  }

  pdf.block(t("doc.includes"), data.inclusions);
  pdf.block(t("doc.excludes"), data.exclusions);
  pdf.block(t("doc.bring"), data.recommendations);
  pdf.block(t("doc.restrictions"), data.restrictions);
  pdf.block(t("doc.instructions"), data.instructions);
  pdf.block(t("doc.terms"), data.conditions);
  pdf.block(t("doc.cancellationPolicy"), data.cancellation_policy);
  pdf.block(t("doc.notes"), data.notes);
  if (data.sold_by) pdf.block(t("doc.soldBy"), data.sold_by);

  // 0055 — las condiciones que la empresa configuró para SUS vouchers. Van al
  // final y no en la cabecera: el cliente busca primero la fecha y el punto de
  // encuentro, y estas son la letra que se lee cuando hay discusión en la
  // puerta. Las de la reserva concreta (`data.conditions`) siguen mandando
  // sobre estas: lo pactado en la venta gana a la plantilla.
  if (brand.terms) pdf.block(t("doc.terms"), brand.terms);

  return pdf.finish();
}

/* -------------------------------------------------------------- cotización */

export interface QuotePdfData {
  code?: string | null;
  title?: string | null;
  status?: string | null;
  version?: number | null;
  issued_at?: string | null;
  valid_until?: string | null;
  event_date?: string | null;
  pax?: number | null;
  currency?: string | null;
  tax_percent?: number | null;
  subtotal?: number | null;
  discount?: number | null;
  tax?: number | null;
  total?: number | null;
  deposit_type?: string | null;
  deposit_percent?: number | null;
  deposit_amount?: number | null;
  deposit_due_date?: string | null;
  balance_due_date?: string | null;
  customer_name?: string | null;
  company_name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  seller_name?: string | null;
  inclusions?: string | null;
  exclusions?: string | null;
  cancellation_policy?: string | null;
  payment_terms?: string | null;
  terms?: string | null;
  notes?: string | null;
}

export interface QuotePdfLine {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  discount_percent?: number | null;
  line_total?: number | null;
  is_optional?: boolean | null;
  option_id?: string | null;
  service_date?: string | null;
}

export interface QuotePdfOption {
  _id: string;
  name?: string;
  description?: string | null;
  sort_order?: number | null;
  is_recommended?: boolean | null;
  is_selected?: boolean | null;
}

/**
 * La cotización: el documento que decide la venta.
 *
 * Lleva el desglose entero porque un total sin desglose no se negocia — el
 * cliente pregunta "¿y si quitamos el almuerzo?" y sin las líneas no hay
 * respuesta— y presenta las alternativas una debajo de otra con su precio
 * cerrado, que es como se comparan.
 */
export async function buildQuotePdf(
  company: CompanyInfo | null,
  quote: QuotePdfData,
  lines: QuotePdfLine[],
  options: QuotePdfOption[]
): Promise<Uint8Array> {
  const currency = quote.currency || "usd";
  const money = (value: number | null | undefined) => formatMoney(value ?? 0, currency);

  const { brand, logo } = await brandFor(company, "quote");
  const pdf = await PdfBuilder.create({
    kind: "COTIZACIÓN",
    reference: quote.code,
    company,
    footer: company?.name || undefined,
    brand,
    logo,
  });

  pdf.heading(quote.title || quote.code || "Propuesta");
  pdf.gap(2);

  const client = quote.customer_name || quote.company_name || quote.contact_name || "—";
  pdf.row("Para", client);
  if (quote.contact_name && quote.contact_name !== client) pdf.row("Atención", quote.contact_name);
  const contact = [quote.contact_email, quote.contact_phone].filter(Boolean).join(" · ");
  if (contact) pdf.row("Contacto", contact);
  pdf.row("Emitida", quote.issued_at ? formatDate(quote.issued_at) : "—");
  pdf.row("Válida hasta", quote.valid_until ? formatDate(quote.valid_until) : "Sin plazo");
  if (quote.event_date) pdf.row("Fecha del viaje", formatDate(quote.event_date));
  if (quote.pax) pdf.row("Pasajeros", formatNumber(quote.pax));
  if (quote.seller_name) pdf.row("Tu asesor", quote.seller_name);
  pdf.gap(10);

  const common = lines.filter((l) => !l.option_id);
  const lineRow = (line: QuotePdfLine): string[] => [
    [line.description || "Servicio", line.is_optional ? "(opcional)" : ""].filter(Boolean).join(" "),
    line.service_date ? formatDate(line.service_date) : "",
    formatNumber(line.quantity ?? 0),
    money(line.unit_price),
    line.discount_percent ? `-${formatPercent(line.discount_percent)}` : "",
    money(line.is_optional ? lineGross(line) : line.line_total),
  ];
  const columns = [
    { header: "Concepto", width: 3.4 },
    { header: "Fecha", width: 1.1 },
    { header: "Cant.", width: 0.7, align: "right" as const },
    { header: "Precio", width: 1.1, align: "right" as const },
    { header: "Dto.", width: 0.7, align: "right" as const },
    { header: "Importe", width: 1.2, align: "right" as const },
  ];

  if (options.length === 0) {
    pdf.eyebrow("Desglose");
    pdf.table(columns, common.map(lineRow));
    pdf.gap(10);
    pdf.row("Subtotal", money(quote.subtotal));
    if ((quote.discount ?? 0) > 0) pdf.row("Descuento", `- ${money(quote.discount)}`);
    pdf.row(quote.tax_percent ? `Impuesto (${formatPercent(quote.tax_percent)})` : "Impuesto", money(quote.tax));
    pdf.row("Total", money(quote.total), { strong: true });
  } else {
    // Con alternativas, cada una se presenta entera: lo común más lo suyo, y su
    // total cerrado. Es lo que el cliente compara.
    const breakdown = optionBreakdown(options, lines, quote.tax_percent);
    if (common.length > 0) {
      pdf.eyebrow("Incluido en todas las opciones");
      pdf.table(columns, common.map(lineRow));
      pdf.gap(8);
    }
    for (const option of breakdown) {
      const own = lines.filter((l) => l.option_id === option.option_id);
      const label = [
        option.name,
        option.is_selected ? "· ESCOGIDA" : option.is_recommended ? "· RECOMENDADA" : "",
      ].filter(Boolean).join(" ");
      pdf.eyebrow(label);
      const description = options.find((o) => o._id === option.option_id)?.description;
      if (description) pdf.paragraph(description, 9);
      pdf.table(columns, own.map(lineRow));
      pdf.gap(6);
      pdf.row("Total de esta opción", money(option.total), { strong: true });
      pdf.gap(10);
    }
  }

  pdf.gap(4);
  const { deposit, balance } = depositDue(quote, quote.total ?? 0);
  if (deposit > 0) {
    pdf.notice(
      `Para reservar se requiere un anticipo de ${money(deposit)}` +
      (quote.deposit_due_date ? ` antes del ${formatDate(quote.deposit_due_date)}` : "") +
      `. El saldo de ${money(balance)}` +
      (quote.balance_due_date ? ` vence el ${formatDate(quote.balance_due_date)}` : " se liquida antes del viaje") + "."
    );
  }

  pdf.block("Qué incluye", quote.inclusions);
  pdf.block("Qué no incluye", quote.exclusions);
  pdf.block("Política de cancelación", quote.cancellation_policy);
  pdf.block("Forma de pago", quote.payment_terms);
  pdf.block("Condiciones", quote.terms);
  pdf.block("Notas", quote.notes);

  // Las notas internas NO se imprimen: son el coste del proveedor y el margen
  // negociable. Ponerlas en el documento del cliente es enseñarle la mano.

  return pdf.finish();
}

/* ---------------------------------------------------------------- factura */

export interface InvoicePdfData {
  ncf?: string | null;
  ncf_type?: string | null;
  number?: string | null;
  invoice_type?: string | null;
  status?: string | null;
  issued_at?: string | null;
  due_date?: string | null;
  ncf_expires_at?: string | null;
  customer_name?: string | null;
  customer_tax_id?: string | null;
  customer_address?: string | null;
  order_number?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  discount?: number | null;
  tax?: number | null;
  tax_rate?: number | null;
  total?: number | null;
  paid_amount?: number | null;
  balance?: number | null;
  notes?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  /** NCF de la factura que esta nota de crédito anula. */
  credit_note_of?: string | null;
  company_tax_id?: string | null;
  tax_name?: string | null;
}

export interface InvoicePdfLine {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  discount?: number | null;
  tax_rate?: number | null;
  tax_amount?: number | null;
  total?: number | null;
  is_exempt?: boolean | null;
}

/**
 * El comprobante fiscal impreso.
 *
 * Lo que lleva no es decorativo: el NCF y su vencimiento, el RNC de las dos
 * partes y el desglose del ITBIS son lo que hace válido el documento ante la
 * DGII. Un PDF bonito sin el NCF no sirve para nada, y uno con el NCF pero sin
 * desglose no se puede declarar.
 */
export async function buildInvoicePdf(
  company: (CompanyInfo & { tax_id?: string | null }) | null,
  invoice: InvoicePdfData,
  lines: InvoicePdfLine[]
): Promise<Uint8Array> {
  const currency = invoice.currency || "dop";
  const money = (v: number | null | undefined) => formatMoney(v ?? 0, currency);
  const isCreditNote = invoice.invoice_type === "credit_note";

  const { brand, logo } = await brandFor(company, "invoice");
  const pdf = await PdfBuilder.create({
    kind: isCreditNote ? "NOTA DE CRÉDITO" : "FACTURA",
    reference: invoice.ncf,
    company,
    footer: company?.name || undefined,
    brand,
    logo,
  });

  // El NCF va arriba y grande: es el dato por el que se busca el documento.
  pdf.heading(invoice.ncf || "Sin NCF", 18);
  pdf.row("Tipo de comprobante", String(invoice.ncf_type || "").toUpperCase());
  if (invoice.number) pdf.row("Documento interno", invoice.number);
  pdf.row("Fecha de emisión", invoice.issued_at ? formatDate(invoice.issued_at) : "—");
  if (invoice.ncf_expires_at) pdf.row("NCF válido hasta", formatDate(invoice.ncf_expires_at));
  if (invoice.due_date) pdf.row("Vence", formatDate(invoice.due_date));
  if (invoice.credit_note_of) pdf.row("Modifica el comprobante", invoice.credit_note_of);
  pdf.gap(8);

  pdf.eyebrow("Emisor");
  pdf.row("Razón social", company?.name || "—");
  if (company?.tax_id) pdf.row("RNC", formatTaxId(company.tax_id));
  pdf.gap(6);

  pdf.eyebrow("Receptor");
  pdf.row("Razón social", invoice.customer_name || "Consumidor final");
  // Sin RNC en el receptor, un crédito fiscal no es deducible: mejor que se vea
  // vacío a que parezca completo.
  pdf.row("RNC / Cédula", invoice.customer_tax_id ? formatTaxId(invoice.customer_tax_id) : "No aportado");
  if (invoice.customer_address) pdf.row("Dirección", invoice.customer_address);
  if (invoice.order_number) pdf.row("Orden", invoice.order_number);
  pdf.gap(10);

  pdf.eyebrow("Detalle");
  pdf.table(
    [
      { header: "Concepto", width: 3.8 },
      { header: "Cant.", width: 0.6, align: "right" },
      { header: "Precio", width: 1.1, align: "right" },
      { header: "Dto.", width: 0.9, align: "right" },
      { header: "ITBIS", width: 0.9, align: "right" },
      { header: "Importe", width: 1.2, align: "right" },
    ],
    lines.map((l) => [
      [l.description || "Servicio", l.is_exempt ? "(exento)" : ""].filter(Boolean).join(" "),
      formatNumber(l.quantity ?? 0),
      money(l.unit_price),
      (l.discount ?? 0) > 0 ? `- ${money(l.discount)}` : "",
      money(l.tax_amount),
      money(l.total),
    ])
  );
  pdf.gap(10);

  pdf.row("Subtotal", money(invoice.subtotal));
  if ((invoice.discount ?? 0) > 0) pdf.row("Descuento", `- ${money(invoice.discount)}`);
  pdf.row(
    `${invoice.tax_name || "ITBIS"}${invoice.tax_rate ? ` (${formatPercent(invoice.tax_rate)})` : ""}`,
    money(invoice.tax)
  );
  pdf.row("Total", money(invoice.total), { strong: true });

  // El importe en letras, justo debajo del total y no al final del documento:
  // es la línea con la que se comprueba la cifra, y separarlas obliga a buscar.
  // Una cifra en números se altera cambiando un dígito; en letras hay que
  // reescribir la línea entera. Por eso lo llevan los cheques y por eso se
  // espera en una factura formal.
  pdf.block("Importe en letras", montoEnLetras(invoice.total, currency));

  if ((invoice.paid_amount ?? 0) > 0) {
    pdf.row("Pagado", money(invoice.paid_amount));
    pdf.row("Saldo", money(invoice.balance));
  }
  pdf.gap(8);

  if (invoice.voided_at) {
    pdf.notice(
      `COMPROBANTE ANULADO el ${formatDate(invoice.voided_at)}` +
      (invoice.void_reason ? `. Motivo: ${invoice.void_reason}` : "") +
      ". Este documento no tiene validez fiscal."
    );
  } else if (isCreditNote) {
    pdf.notice(`Esta nota de crédito anula el comprobante ${invoice.credit_note_of || ""}.`.trim());
  }

  pdf.block("Notas", invoice.notes);
  // 0055 — el texto legal del comprobante. En la República Dominicana cambia
  // según el régimen de cada empresa, así que hasta ahora habría que pedirle a
  // quien programa que lo añadiera al código.
  // Con etiqueta y no en blanco: `block("")` dibujaría un rótulo vacío y dejaría
  // una línea suelta encima del texto.
  if (brand.terms) pdf.block("Nota legal", brand.terms);
  return pdf.finish();
}

/* -------------------------------------------------------------- manifiesto */

export interface ManifestPdfData {
  product_name?: string | null;
  departure_at?: string | null;
  meeting_point?: string | null;
  capacity?: number | null;
  vehicles?: { plate?: string | null; name?: string | null; capacity?: number | null }[];
  staff?: { name?: string; role?: string | null; phone?: string | null }[];
  notes?: string | null;
}

/**
 * El manifiesto: la hoja que el guía se lleva al autobús.
 *
 * En papel importa una cosa por encima de todo: que la lista quepa y se lea de
 * un vistazo en movimiento. Por eso va en tabla y ordenada por recogida, con las
 * paradas agrupadas antes de la lista nominal.
 */
export async function buildManifestPdf(
  company: CompanyInfo | null,
  data: ManifestPdfData,
  rows: ManifestRow[],
  stops: PickupStop[],
  summary: PaxSummary
): Promise<Uint8Array> {
  const { brand, logo } = await brandFor(company, "manifest");
  const pdf = await PdfBuilder.create({
    kind: "MANIFIESTO",
    reference: data.departure_at ? formatDate(data.departure_at) : undefined,
    company,
    footer: `Generado ${formatDateTime(new Date().toISOString())}`,
    brand,
    logo,
  });

  pdf.heading(data.product_name || "Salida");
  pdf.paragraph(
    [
      data.departure_at ? `${formatDate(data.departure_at)} · ${formatTime(data.departure_at)}` : "Sin fecha",
      data.meeting_point ? `Punto de encuentro: ${data.meeting_point}` : "",
    ].filter(Boolean).join("  ·  "),
    10
  );
  pdf.gap(6);

  pdf.row("Reservas", formatNumber(summary.bookings));
  pdf.row("Plazas", `${formatNumber(summary.seats)}${data.capacity ? ` de ${formatNumber(data.capacity)}` : ""}`, { strong: true });
  pdf.row("Desglose", `${summary.adults} adultos · ${summary.children} niños · ${summary.infants} bebés`);
  const toCollect = Object.entries(summary.to_collect_by_currency)
    .map(([currency, amount]) => formatMoney(amount, currency)).join(" + ");
  if (toCollect) pdf.row("Por cobrar a bordo", toCollect);
  if (data.vehicles?.length) {
    pdf.row("Vehículos", data.vehicles.map((v) => `${v.plate || v.name}${v.capacity ? ` (${v.capacity})` : ""}`).join(" · "));
  }
  if (data.staff?.length) {
    pdf.row("Personal", data.staff.map((s) => `${s.name}${s.phone ? ` ${s.phone}` : ""}`).join(" · "));
  }
  pdf.gap(10);

  if (stops.length > 0) {
    pdf.eyebrow(`Hoja de ruta · ${stops.length} paradas`);
    pdf.table(
      [
        { header: "#", width: 0.35, align: "right" },
        { header: "Hora", width: 0.8 },
        { header: "Hotel", width: 3 },
        { header: "Zona", width: 1.4 },
        { header: "Pax", width: 0.6, align: "right" },
      ],
      stops.map((stop, i) => [
        String(i + 1), stop.time, stop.hotel, stop.zone || "", String(stop.seats),
      ])
    );
    pdf.gap(12);
  }

  pdf.eyebrow(`Pasajeros · ${rows.length} reservas`);
  pdf.table(
    [
      { header: "#", width: 0.3, align: "right" },
      { header: "Hora", width: 0.65 },
      { header: "Pasajero", width: 2.1 },
      { header: "Hotel / hab.", width: 2 },
      { header: "Teléfono", width: 1.2 },
      { header: "Pax", width: 0.75 },
      { header: "Cobrar", width: 0.9, align: "right" },
      { header: "OK", width: 0.4 },
    ],
    rows.map((row, i) => [
      String(i + 1),
      row.pickup_time,
      row.lead_name,
      [row.pickup_hotel, row.room ? `· ${row.room}` : ""].filter(Boolean).join(" ") || row.pickup_location || "Punto de encuentro",
      row.phone,
      `${row.adults}A ${row.children}N ${row.infants}B`,
      row.paid ? "" : formatMoney(row.balance, row.currency),
      // Casilla vacía a propósito: el guía marca a mano quien sube.
      "[  ]",
    ]),
    { size: 8 }
  );

  // Lo que no cabe en una tabla pero no puede perderse.
  const withRequirements = rows.filter((r) => r.requirements.length > 0);
  if (withRequirements.length > 0) {
    pdf.gap(12);
    pdf.eyebrow("Requerimientos especiales");
    for (const row of withRequirements) {
      pdf.paragraph(`${row.lead_name}: ${row.requirements.join(" · ")}`, 9);
    }
  }

  const unnamed = rows.reduce((s, r) => s + r.unnamed_pax, 0);
  if (unnamed > 0) {
    pdf.gap(10);
    pdf.notice(`${unnamed} pasajero(s) viajan sin nombre registrado. El manifiesto no cubre el seguro así: complétalos antes de salir.`);
  }

  pdf.block("Notas de la salida", data.notes);
  return pdf.finish();
}

/* ----------------------------------------------------------- arqueo de caja */

export interface CashClosePdfData {
  code?: string | null;
  register?: string | null;
  branch?: string | null;
  cashier?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  status?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  difference_reason?: string | null;
  deposit_reference?: string | null;
  notes?: string | null;
  card: { expected: number; batch: number | null; difference: number | null; reference: string | null };
}

export interface CashClosePdfCurrency {
  currency: string;
  opening: number;
  sales: number;
  refunds: number;
  cash_sales: number;
  cash_refunds: number;
  expenses: number;
  withdrawals: number;
  deposits: number;
  adjustments: number;
  card: number;
  transfer: number;
  other_methods: number;
  expected: number;
  counted: number | null;
  difference: number | null;
  breakdown: { denomination: number; quantity: number }[];
}

/**
 * El acta del arqueo.
 *
 * Se imprime, se firma y se archiva con el efectivo que va a la bóveda: es el
 * papel que sostiene un faltante tres meses después, cuando ya nadie recuerda
 * el turno. Por eso lleva el desglose por denominación y no solo el total —un
 * acta que dice "faltaban 2.000" no prueba nada; una que dice "se contaron
 * tres billetes de 1.000 donde debía haber cinco", sí.
 */
export async function buildCashClosePdf(
  company: CompanyInfo | null,
  data: CashClosePdfData,
  currencies: CashClosePdfCurrency[]
): Promise<Uint8Array> {
  const { brand, logo } = await brandFor(company, "cash");
  const pdf = await PdfBuilder.create({
    kind: "ARQUEO DE CAJA",
    reference: data.code,
    company,
    footer: `Generado ${formatDateTime(new Date().toISOString())}`,
    brand,
    logo,
  });

  pdf.heading(data.register || "Caja");
  pdf.paragraph(
    [
      data.branch,
      data.cashier ? `Cajero: ${data.cashier}` : "",
      data.opened_at ? `Apertura ${formatDateTime(data.opened_at)}` : "",
      data.closed_at ? `Cierre ${formatDateTime(data.closed_at)}` : "",
    ].filter(Boolean).join("  ·  "),
    9.5
  );
  pdf.gap(8);

  for (const row of currencies) {
    const label = row.currency.toUpperCase();
    pdf.eyebrow(`${label} · movimientos del turno`);
    pdf.row("Fondo de apertura", formatMoney(row.opening, row.currency));
    pdf.row("Cobros en efectivo", formatMoney(row.cash_sales, row.currency));
    if (row.cash_refunds) pdf.row("Reembolsos en efectivo", `-${formatMoney(row.cash_refunds, row.currency)}`);
    if (row.expenses) pdf.row("Gastos pagados en caja", `-${formatMoney(row.expenses, row.currency)}`);
    if (row.withdrawals) pdf.row("Retiros", `-${formatMoney(row.withdrawals, row.currency)}`);
    if (row.deposits) pdf.row("Entradas de efectivo", formatMoney(row.deposits, row.currency));
    if (row.adjustments) pdf.row("Ajustes", formatMoney(row.adjustments, row.currency));
    pdf.row("Efectivo esperado", formatMoney(row.expected, row.currency), { strong: true });

    if (row.card || row.transfer || row.other_methods) {
      pdf.gap(4);
      pdf.paragraph("No entra al cajón — lo liquida el banco o queda por cobrar:", 8.5);
      if (row.card) pdf.row("Tarjeta", formatMoney(row.card, row.currency));
      if (row.transfer) pdf.row("Transferencia y link", formatMoney(row.transfer, row.currency));
      if (row.other_methods) pdf.row("Cheque y crédito", formatMoney(row.other_methods, row.currency));
    }

    if (row.breakdown.length > 0) {
      pdf.gap(8);
      pdf.eyebrow(`${label} · conteo físico`);
      pdf.table(
        [
          { header: "Denominación", width: 1.4, align: "right" },
          { header: "Piezas", width: 1, align: "right" },
          { header: "Importe", width: 1.4, align: "right" },
        ],
        row.breakdown
          .filter((line) => Number(line.quantity) > 0)
          .sort((a, b) => Number(b.denomination) - Number(a.denomination))
          .map((line) => [
            formatMoney(Number(line.denomination), row.currency),
            formatNumber(Number(line.quantity)),
            formatMoney(Number(line.denomination) * Number(line.quantity), row.currency),
          ])
      );
    }

    pdf.gap(6);
    if (row.counted != null) {
      pdf.row("Efectivo contado", formatMoney(row.counted, row.currency), { strong: true });
      const difference = row.difference ?? 0;
      const verdict = Math.abs(difference) < 0.01 ? "cuadrada" : difference > 0 ? "sobrante" : "faltante";
      pdf.row("Diferencia", `${formatMoney(difference, row.currency)} (${verdict})`, { strong: true });
    } else {
      pdf.row("Efectivo contado", "pendiente de contar");
    }
    pdf.gap(14);
  }

  if (data.card.batch != null) {
    pdf.eyebrow("Conciliación del datáfono");
    pdf.row("Cobrado con tarjeta", formatMoney(data.card.expected, currencies[0]?.currency));
    pdf.row("Cierre de lote del banco", formatMoney(data.card.batch, currencies[0]?.currency));
    pdf.row("Diferencia", formatMoney(data.card.difference ?? 0, currencies[0]?.currency), { strong: true });
    if (data.card.reference) pdf.row("Referencia del lote", data.card.reference);
    pdf.gap(12);
  }

  if (data.difference_reason) pdf.block("Justificación de la diferencia", data.difference_reason);
  if (data.deposit_reference) pdf.row("Depósito / bóveda", data.deposit_reference);
  if (data.notes) pdf.block("Observaciones", data.notes);

  if (data.approved_by) {
    pdf.gap(6);
    pdf.notice(
      `Arqueo revisado por ${data.approved_by}${data.approved_at ? ` el ${formatDateTime(data.approved_at)}` : ""}.`
    );
  } else if (data.status === "pending_approval") {
    pdf.gap(6);
    pdf.notice("Este arqueo está a la espera de revisión por un supervisor.");
  }

  pdf.gap(24);
  pdf.rule();
  pdf.gap(6);
  pdf.paragraph("Firma del cajero                                        Firma del supervisor", 9);

  return pdf.finish();
}

/* ----------------------------------------------- estado de cuenta de proveedor */

export interface SupplierStatementPdfData {
  code?: string | null;
  supplier_name?: string | null;
  supplier_tax_id?: string | null;
  period_from?: string | null;
  period_to?: string | null;
  status?: string | null;
  invoice_number?: string | null;
  invoice_ncf?: string | null;
  invoice_date?: string | null;
  currency: string;
  services: number;
  confirmed: number;
  adjustments: number;
  retention_isr: number;
  retention_itbis: number;
  retention_total: number;
  net: number;
  taxable_base: number;
  dispute_reason?: string | null;
  notes?: string | null;
}

export interface SupplierStatementPdfLine {
  concept: string;
  booking_number?: string | null;
  departure_at?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  unit_cost?: number | null;
  amount: number;
  confirmed_amount?: number | null;
  variance: number;
}

/**
 * El estado de cuenta que se le manda al proveedor.
 *
 * Es el papel con el que se discute el viernes, así que lleva las dos columnas
 * que importan una al lado de la otra: lo que dice el manifiesto y lo que dice
 * su factura. Un estado de cuenta con un solo total no sirve para discutir
 * nada —"me cobras 40 pax y yo llevé 37" necesita ver las dos cifras.
 */
export async function buildSupplierStatementPdf(
  company: CompanyInfo | null,
  data: SupplierStatementPdfData,
  lines: SupplierStatementPdfLine[]
): Promise<Uint8Array> {
  const { brand, logo } = await brandFor(company, "statement");
  const pdf = await PdfBuilder.create({
    kind: "ESTADO DE CUENTA",
    reference: data.code,
    company,
    footer: `Generado ${formatDateTime(new Date().toISOString())}`,
    brand,
    logo,
  });

  pdf.heading(data.supplier_name || "Proveedor");
  pdf.paragraph(
    [
      data.supplier_tax_id ? `RNC/Cédula ${formatTaxId(data.supplier_tax_id)}` : "",
      data.period_from && data.period_to
        ? `Período ${formatDate(data.period_from)} — ${formatDate(data.period_to)}`
        : "",
    ].filter(Boolean).join("  ·  "),
    9.5
  );
  pdf.gap(8);

  const anyConfirmed = lines.some((line) => line.confirmed_amount != null);

  pdf.eyebrow(`Servicios operados · ${lines.length}`);
  pdf.table(
    anyConfirmed
      ? [
          { header: "Fecha", width: 0.85 },
          { header: "Reserva", width: 1 },
          { header: "Concepto", width: 2.1 },
          { header: "Cant.", width: 0.55, align: "right" },
          { header: "Operado", width: 1, align: "right" },
          { header: "Facturado", width: 1, align: "right" },
          { header: "Dif.", width: 0.8, align: "right" },
        ]
      : [
          { header: "Fecha", width: 0.9 },
          { header: "Reserva", width: 1.1 },
          { header: "Concepto", width: 2.6 },
          { header: "Cant.", width: 0.6, align: "right" },
          { header: "Unitario", width: 1, align: "right" },
          { header: "Importe", width: 1.1, align: "right" },
        ],
    lines.map((line) => {
      const when = line.departure_at ? formatDate(line.departure_at) : "—";
      const concept = [line.concept, line.product_name].filter(Boolean).join(" · ");
      return anyConfirmed
        ? [
            when,
            line.booking_number || "—",
            concept,
            line.quantity != null ? formatNumber(line.quantity) : "",
            formatMoney(line.amount, data.currency),
            line.confirmed_amount != null ? formatMoney(line.confirmed_amount, data.currency) : "—",
            Math.abs(line.variance) < 0.01 ? "" : formatMoney(line.variance, data.currency),
          ]
        : [
            when,
            line.booking_number || "—",
            concept,
            line.quantity != null ? formatNumber(line.quantity) : "",
            line.unit_cost != null ? formatMoney(line.unit_cost, data.currency) : "",
            formatMoney(line.amount, data.currency),
          ];
    })
  );
  pdf.gap(12);

  pdf.row("Servicios operados", formatMoney(data.services, data.currency));
  if (anyConfirmed) pdf.row("Facturado por el proveedor", formatMoney(data.confirmed, data.currency));
  if (data.adjustments) pdf.row("Ajustes acordados", formatMoney(data.adjustments, data.currency));

  if (data.retention_total > 0) {
    pdf.gap(4);
    pdf.row("Base imponible", formatMoney(data.taxable_base, data.currency));
    if (data.retention_isr) pdf.row("Retención de ISR", `-${formatMoney(data.retention_isr, data.currency)}`);
    if (data.retention_itbis) pdf.row("Retención de ITBIS", `-${formatMoney(data.retention_itbis, data.currency)}`);
  }

  pdf.gap(4);
  pdf.row("Neto a pagar", formatMoney(data.net, data.currency), { strong: true });
  pdf.gap(10);

  if (data.invoice_number) {
    pdf.block(
      "Comprobante del proveedor",
      [
        `Factura ${data.invoice_number}`,
        data.invoice_ncf ? `NCF ${data.invoice_ncf}` : "",
        data.invoice_date ? `del ${formatDate(data.invoice_date)}` : "",
      ].filter(Boolean).join("  ·  ")
    );
  } else {
    pdf.notice(
      "Falta la factura del proveedor. El gasto se sostiene ante la DGII con su comprobante, " +
      "así que esta liquidación no se puede pagar hasta recibirlo."
    );
  }

  if (data.dispute_reason) pdf.notice(data.dispute_reason);
  if (data.notes) pdf.block("Observaciones", data.notes);

  pdf.gap(24);
  pdf.rule();
  pdf.gap(6);
  pdf.paragraph("Conforme el proveedor                                        Por la empresa", 9);

  return pdf.finish();
}
