/**
 * El dominio de un comprobante fiscal dominicano.
 *
 * La factura se tecleaba entera —el NCF, el subtotal, el impuesto y el total—, y
 * eso rompe de tres formas que la DGII ve: NCF repetidos, huecos en la secuencia
 * que hay que justificar en el 606/607 meses después, y totales que no cuadran
 * con la venta. Aquí vive lo que decide cada uno de esos números, en funciones
 * puras, para que la pantalla, la emisión y el PDF digan lo mismo y una prueba
 * pueda afirmarlo sin base de datos.
 */

export type NcfType = "b01" | "b02" | "b04" | "b14" | "b15" | "e31" | "e32" | "e34" | "e44" | "e45";

/**
 * Anatomía del número según su serie.
 *
 * Un NCF de la serie B son 11 caracteres: `B` + dos dígitos de tipo + ocho de
 * secuencia. Un e-CF de la serie E son 13: `E` + tipo + DIEZ de secuencia. Usar
 * el mismo ancho para los dos produce comprobantes que la DGII rechaza sin
 * decir por qué.
 */
const SEQUENCE_WIDTH: Record<"b" | "e", number> = { b: 8, e: 10 };

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** `b02` + 45 -> `B0200000045`; `e32` + 45 -> `E320000000045`. */
export function formatNcf(ncfType: string, sequence: number): string {
  const type = String(ncfType || "").toLowerCase();
  const serie = type.startsWith("e") ? "e" : "b";
  const width = SEQUENCE_WIDTH[serie];
  const digits = Math.max(Math.floor(num(sequence)), 0);
  return `${type.toUpperCase()}${String(digits).padStart(width, "0")}`;
}

/** ¿Es un comprobante electrónico (e-CF) o uno de la serie B? */
export const isElectronic = (ncfType: string): boolean =>
  String(ncfType || "").toLowerCase().startsWith("e");

/** La nota de crédito que corresponde a cada serie. */
const CREDIT_NOTE_OF: Record<string, NcfType> = { b: "b04", e: "e34" };

/**
 * Qué tipo de comprobante lleva una anulación.
 *
 * Una factura de crédito fiscal se anula con una nota de crédito de SU serie: un
 * e-CF no se anula con un B04, ni al revés.
 */
export const creditNoteTypeFor = (ncfType: string): NcfType =>
  CREDIT_NOTE_OF[isElectronic(ncfType) ? "e" : "b"];

export interface CustomerFiscalInfo {
  tax_id?: string | null;
  name?: string | null;
  is_government?: boolean | null;
  is_special_regime?: boolean | null;
}

/**
 * Qué comprobante le toca a este cliente.
 *
 * Con RNC va crédito fiscal (B01/E31), porque el cliente necesita deducirse el
 * ITBIS; sin identificación, consumo (B02/E32). Emitir un consumo a una empresa
 * le impide deducir el impuesto, y emitir un crédito fiscal sin RNC es un
 * comprobante que la DGII rechaza.
 */
export function ncfTypeFor(customer: CustomerFiscalInfo, electronic = false): NcfType {
  const serie = electronic ? "e" : "b";
  if (customer.is_government) return serie === "e" ? "e45" : "b15";
  if (customer.is_special_regime) return serie === "e" ? "e44" : "b14";
  const hasTaxId = Boolean(normalizeTaxId(customer.tax_id));
  if (hasTaxId) return serie === "e" ? "e31" : "b01";
  return serie === "e" ? "e32" : "b02";
}

/**
 * RNC (9 dígitos) o cédula (11) sin guiones.
 *
 * Se guarda normalizado porque el mismo contribuyente se teclea de cinco formas
 * distintas —con guiones, con espacios, con puntos— y un 606 con el mismo RNC
 * escrito de dos maneras son dos contribuyentes para la DGII.
 */
export function normalizeTaxId(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length !== 9 && digits.length !== 11) return null;
  return digits;
}

/** Cómo se muestra: `1-31-12345-6` para RNC, `001-1234567-8` para cédula. */
export function formatTaxId(raw: unknown): string {
  const id = normalizeTaxId(raw);
  if (!id) return String(raw ?? "").trim();
  return id.length === 9
    ? `${id.slice(0, 1)}-${id.slice(1, 3)}-${id.slice(3, 8)}-${id.slice(8)}`
    : `${id.slice(0, 3)}-${id.slice(3, 10)}-${id.slice(10)}`;
}

/* ------------------------------------------------------------------ importes */

export interface InvoiceLineInput {
  quantity?: number | null;
  unit_price?: number | null;
  discount?: number | null;
  tax_rate?: number | null;
  is_exempt?: boolean | null;
}

export interface InvoiceLineAmounts {
  base: number;
  tax_amount: number;
  total: number;
}

/**
 * Importes de una línea.
 *
 * `taxIncluded` distingue los dos mundos que conviven en el sector: el precio de
 * mostrador al turista ya lleva el ITBIS dentro, y el precio a una agencia se
 * factura más impuesto. Calcular uno como el otro desvía el impuesto declarado
 * en un 18% justo — ni un redondeo ni una discusión: una diferencia que la
 * declaración enseña.
 */
export function lineAmounts(line: InvoiceLineInput, taxIncluded = false): InvoiceLineAmounts {
  const gross = round2(num(line.quantity) * num(line.unit_price));
  const discount = Math.min(Math.max(num(line.discount), 0), gross);
  const charged = round2(gross - discount);
  const rate = line.is_exempt ? 0 : Math.max(num(line.tax_rate), 0);

  if (rate === 0) return { base: charged, tax_amount: 0, total: charged };

  if (taxIncluded) {
    // El importe cobrado YA lleva el impuesto: se extrae, no se añade.
    const base = round2(charged / (1 + rate / 100));
    return { base, tax_amount: round2(charged - base), total: charged };
  }
  const tax = round2((charged * rate) / 100);
  return { base: charged, tax_amount: tax, total: round2(charged + tax) };
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** Desglose por tasa: lo que pide el formato 607. */
  tax_by_rate: Record<string, number>;
  exempt_total: number;
}

/** Totales de la factura a partir de sus líneas. */
export function invoiceTotals(lines: InvoiceLineInput[], taxIncluded = false): InvoiceTotals {
  let subtotal = 0, discount = 0, tax = 0, total = 0, exempt = 0;
  const byRate: Record<string, number> = {};

  for (const line of lines) {
    const amounts = lineAmounts(line, taxIncluded);
    const gross = round2(num(line.quantity) * num(line.unit_price));
    subtotal += amounts.base;
    discount += Math.min(Math.max(num(line.discount), 0), gross);
    tax += amounts.tax_amount;
    total += amounts.total;
    const rate = line.is_exempt ? 0 : Math.max(num(line.tax_rate), 0);
    if (rate === 0) exempt += amounts.base;
    else byRate[String(rate)] = round2((byRate[String(rate)] ?? 0) + amounts.tax_amount);
  }

  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    tax: round2(tax),
    total: round2(total),
    tax_by_rate: byRate,
    exempt_total: round2(exempt),
  };
}

/* -------------------------------------------------------- estado del documento */

export interface InvoiceState {
  status?: string | null;
  invoice_type?: string | null;
  ncf?: string | null;
  voided_at?: string | null;
  total?: number | null;
  paid_amount?: number | null;
}

export type VoidBlock = "already_voided" | "not_issued" | "is_credit_note";

export const VOID_BLOCK_MESSAGE: Record<VoidBlock, string> = {
  already_voided: "Esta factura ya está anulada",
  not_issued: "Una factura en borrador no se anula: se descarta antes de emitirla",
  is_credit_note: "Una nota de crédito no se anula con otra nota de crédito",
};

/**
 * Qué impide anular.
 *
 * En República Dominicana una factura emitida NO se borra: se anula emitiendo
 * una nota de crédito que la referencia. Borrarla dejaría un hueco en la
 * secuencia que hay que justificar, y el comprobante ya está en manos del
 * cliente y probablemente en su declaración.
 */
export function voidBlocker(invoice: InvoiceState): VoidBlock | null {
  if (invoice.voided_at || invoice.status === "voided") return "already_voided";
  if (invoice.invoice_type === "credit_note") return "is_credit_note";
  if (!invoice.ncf || invoice.status === "draft") return "not_issued";
  return null;
}

/** Saldo por cobrar de la factura. */
export const invoiceBalance = (invoice: InvoiceState): number =>
  round2(Math.max(num(invoice.total) - num(invoice.paid_amount), 0));

/**
 * Estado de cobro derivado del saldo.
 *
 * `status` es un campo almacenado y se queda atrás en cuanto entra un pago; el
 * saldo manda, igual que la fecha manda sobre el estado de una cotización.
 */
export function paymentStatus(invoice: InvoiceState, now: Date, dueDate?: string | null): string {
  if (invoice.voided_at || invoice.status === "voided") return "voided";
  if (!invoice.ncf || invoice.status === "draft") return "draft";
  const balance = invoiceBalance(invoice);
  if (balance <= 0.009) return "paid";
  if (num(invoice.paid_amount) > 0) return "partially_paid";
  if (dueDate && new Date(dueDate).getTime() < now.getTime()) return "overdue";
  return "issued";
}

/* ------------------------------------------------------------ la secuencia */

export interface SequenceState {
  ncf_type?: string | null;
  next_number?: number | null;
  max_number?: number | null;
  expires_at?: string | null;
  status?: string | null;
}

export interface SequenceHealth {
  remaining: number | null;
  expired: boolean;
  /** Días que faltan para el vencimiento de la autorización. */
  days_left: number | null;
  level: "ok" | "warning" | "danger";
  message: string | null;
}

/**
 * Cuánto le queda a una secuencia.
 *
 * Quedarse sin NCF es dejar de facturar, y pedirle un rango nuevo a la DGII no
 * es inmediato. Por eso el aviso no espera al agotamiento: salta con margen.
 */
export function sequenceHealth(seq: SequenceState, now: Date = new Date()): SequenceHealth {
  const next = Math.max(Math.floor(num(seq.next_number)), 1);
  const max = seq.max_number === null || seq.max_number === undefined
    ? null : Math.floor(num(seq.max_number));
  const remaining = max === null ? null : Math.max(max - next + 1, 0);

  let daysLeft: number | null = null;
  let expired = false;
  if (seq.expires_at) {
    const until = new Date(seq.expires_at).getTime();
    if (Number.isFinite(until)) {
      daysLeft = Math.floor((until - now.getTime()) / 86_400_000);
      expired = daysLeft < 0;
    }
  }

  if (seq.status === "inactive") {
    return { remaining, expired, days_left: daysLeft, level: "danger", message: "La secuencia está desactivada" };
  }
  if (expired) {
    return { remaining, expired, days_left: daysLeft, level: "danger", message: "La autorización venció: no se puede facturar con esta secuencia" };
  }
  if (remaining !== null && remaining === 0) {
    return { remaining, expired, days_left: daysLeft, level: "danger", message: "La secuencia se agotó: solicita un rango nuevo a la DGII" };
  }
  if (remaining !== null && remaining <= 50) {
    return { remaining, expired, days_left: daysLeft, level: "warning", message: `Quedan ${remaining} comprobantes: pide el rango nuevo antes de agotarlo` };
  }
  if (daysLeft !== null && daysLeft <= 30) {
    return { remaining, expired, days_left: daysLeft, level: "warning", message: `La autorización vence en ${daysLeft} días` };
  }
  return { remaining, expired, days_left: daysLeft, level: "ok", message: null };
}
