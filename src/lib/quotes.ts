/**
 * El dominio de una cotización.
 *
 * Una propuesta de grupo no es una cabecera con un total: es un documento que se
 * negocia por rondas, que puede ofrecer alternativas entre las que el cliente
 * escoge, que pide un anticipo con fecha y que, cuando se acepta, tiene que
 * convertirse en la reserva exacta que se prometió. Todo eso se decide aquí, en
 * funciones puras, para que la pantalla, las acciones del servidor y cualquier
 * documento futuro (el PDF que se manda al cliente) obtengan el mismo número y
 * la misma respuesta a "¿se puede enviar esto?".
 *
 * Reglas que sostiene este módulo:
 *
 *  · Una línea `is_optional` es un extra ofrecido, no vendido: nunca suma al
 *    total. Sumarla infla la propuesta y el cliente recibe un precio que no
 *    aceptó.
 *  · Una línea sin `option_id` es común a todas las opciones. Con opciones, el
 *    precio de cada una es "lo común + lo suyo": así una propuesta de hotel 4*
 *    contra 5* comparte el transporte sin duplicarlo.
 *  · El impuesto sale de una tasa (el ITBIS es 18% en RD), no de un importe
 *    tecleado, para que una revisión de precio lo recalcule sola.
 *  · El margen excluye impuesto: el ITBIS no es ingreso de la empresa.
 */

export interface QuoteLineInput {
  quantity?: number | null;
  unit_price?: number | null;
  unit_cost?: number | null;
  discount_percent?: number | null;
  /** Extra ofrecido: se presenta pero no entra en el total. */
  is_optional?: boolean | null;
  /** Opción a la que pertenece. Vacío = línea común a todas. */
  option_id?: string | null;
}

export interface QuoteTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  cost_total: number;
  margin_amount: number;
  margin_percent: number | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const clampPct = (v: unknown) => Math.min(Math.max(num(v), 0), 100);

/* ------------------------------------------------------------------ líneas */

/** Importe bruto de una línea, antes de su descuento. */
export const lineGross = (line: QuoteLineInput): number =>
  round2(num(line.quantity) * num(line.unit_price));

/** Descuento de la línea, acotado al 0–100% para que nunca sume importe. */
export function lineDiscount(line: QuoteLineInput): number {
  return round2((lineGross(line) * clampPct(line.discount_percent)) / 100);
}

/** Importe final de la línea: es lo que se guarda en `line_total`. */
export const lineTotal = (line: QuoteLineInput): number =>
  round2(lineGross(line) - lineDiscount(line));

/**
 * Coste de la línea. El descuento es comercial: se lo come el margen, no el
 * proveedor, así que el coste se calcula sobre la cantidad completa.
 */
export const lineCost = (line: QuoteLineInput): number =>
  round2(num(line.quantity) * num(line.unit_cost));

/** Las líneas que de verdad suman: un extra opcional se ofrece, no se cobra. */
export const billableLines = <T extends QuoteLineInput>(lines: T[]): T[] =>
  lines.filter((l) => !l.is_optional);

/* ------------------------------------------------------------------ totales */

/**
 * Totales de un conjunto de líneas.
 *
 * `taxPercent` manda cuando viene: es la forma correcta de guardar un ITBIS,
 * porque sobrevive a un cambio de precio. `fallbackTax` existe para las
 * cotizaciones anteriores a la tasa, que llevan el importe tecleado a mano.
 */
export function totalsOf(
  lines: QuoteLineInput[],
  opts: { taxPercent?: number | null; fallbackTax?: number | null } = {}
): QuoteTotals {
  const billable = billableLines(lines);
  const subtotal = round2(billable.reduce((s, l) => s + lineGross(l), 0));
  const discount = round2(billable.reduce((s, l) => s + lineDiscount(l), 0));
  const cost = round2(billable.reduce((s, l) => s + lineCost(l), 0));
  const net = round2(subtotal - discount);

  const pct = opts.taxPercent;
  const tax = pct === null || pct === undefined || !Number.isFinite(Number(pct))
    ? round2(Math.max(num(opts.fallbackTax), 0))
    : round2((net * Math.max(num(pct), 0)) / 100);

  const margin = round2(net - cost);
  return {
    subtotal,
    discount,
    tax,
    total: round2(net + tax),
    cost_total: cost,
    margin_amount: margin,
    // Sin ingreso no hay margen que expresar en porcentaje: devolver 0 diría
    // "margen cero", que es una afirmación distinta de "no se puede calcular".
    margin_percent: net > 0 ? round2((margin / net) * 100) : null,
  };
}

/**
 * Totales de la cotización a partir de sus líneas.
 * @deprecated Se mantiene por compatibilidad; `totalsOf` es la forma completa.
 */
export function quoteTotals(lines: QuoteLineInput[], tax = 0): QuoteTotals {
  return totalsOf(lines, { fallbackTax: tax });
}

export interface QuoteOptionInput {
  _id: string;
  name?: string;
  sort_order?: number | null;
  is_recommended?: boolean | null;
  is_selected?: boolean | null;
}

export interface OptionBreakdown extends QuoteTotals {
  option_id: string;
  name: string;
  is_selected: boolean;
  is_recommended: boolean;
}

/**
 * Desglose de cada alternativa: lo común más lo suyo.
 *
 * Las líneas comunes se suman a TODAS las opciones en vez de repetirse dentro de
 * cada una. Duplicarlas era la única forma de expresarlo antes, y bastaba con
 * editar una para que las dos propuestas dejaran de cuadrar entre sí.
 */
export function optionBreakdown<L extends QuoteLineInput>(
  options: QuoteOptionInput[],
  lines: L[],
  taxPercent?: number | null
): OptionBreakdown[] {
  const common = lines.filter((l) => !l.option_id);
  return [...options]
    .sort((a, b) => num(a.sort_order) - num(b.sort_order))
    .map((opt) => ({
      option_id: opt._id,
      name: opt.name || "Opción",
      is_selected: Boolean(opt.is_selected),
      is_recommended: Boolean(opt.is_recommended),
      ...totalsOf([...common, ...lines.filter((l) => l.option_id === opt._id)], { taxPercent }),
    }));
}

/**
 * Los totales que van a la cabecera.
 *
 * Con opciones, la cabecera no puede sumarlas todas: el cliente compra UNA. Vale
 * la escogida; si todavía no ha escogido, la recomendada; y si no hay
 * recomendada, la primera del orden en que se le presentaron. Sumarlas era
 * contar tres veces el mismo negocio en el embudo.
 */
export function headerTotals<L extends QuoteLineInput>(
  options: QuoteOptionInput[],
  lines: L[],
  taxPercent?: number | null,
  fallbackTax?: number | null
): QuoteTotals & { option_id: string | null; from: number | null; to: number | null } {
  if (options.length === 0) {
    return { ...totalsOf(lines, { taxPercent, fallbackTax }), option_id: null, from: null, to: null };
  }
  const breakdown = optionBreakdown(options, lines, taxPercent);
  const chosen =
    breakdown.find((o) => o.is_selected) ??
    breakdown.find((o) => o.is_recommended) ??
    breakdown[0];
  const totals = breakdown.map((o) => o.total);
  const { option_id, name: _name, is_selected: _s, is_recommended: _r, ...rest } = chosen;
  return { ...rest, option_id, from: Math.min(...totals), to: Math.max(...totals) };
}

/* ------------------------------------------------------------------ depósito */

export interface DepositInput {
  deposit_type?: string | null;
  deposit_percent?: number | null;
  deposit_amount?: number | null;
}

/**
 * Anticipo exigido y saldo restante.
 *
 * Un anticipo mayor que el total no existe: se acota al total para que el saldo
 * nunca salga negativo y el cliente no reciba un documento que se contradice.
 */
export function depositDue(quote: DepositInput, total: number): { deposit: number; balance: number } {
  const t = round2(Math.max(num(total), 0));
  let deposit = 0;
  if (quote.deposit_type === "percent") deposit = round2((t * clampPct(quote.deposit_percent)) / 100);
  else if (quote.deposit_type === "amount") deposit = round2(Math.max(num(quote.deposit_amount), 0));
  deposit = Math.min(deposit, t);
  return { deposit, balance: round2(t - deposit) };
}

/* -------------------------------------------------------------- vigencia */

export interface QuoteState {
  status?: string | null;
  valid_until?: string | null;
  customer?: unknown;
  contact_email?: string | null;
  order?: unknown;
  version?: number | null;
}

/** Estados en los que la propuesta sigue en juego. */
export const OPEN_STATUSES = new Set(["draft", "sent", "negotiating"]);
/** Estados ganados. */
export const WON_STATUSES = new Set(["accepted", "converted"]);
/** Estados ya resueltos de una u otra forma. */
export const DECIDED_STATUSES = new Set(["accepted", "converted", "rejected", "expired"]);

export const isOpen = (q: QuoteState): boolean => OPEN_STATUSES.has(q.status || "");

/** Vencida por fecha, diga lo que diga el `status` almacenado. */
export function isExpired(q: QuoteState, now: Date = new Date()): boolean {
  if (!q.valid_until) return false;
  const until = new Date(q.valid_until).getTime();
  return Number.isFinite(until) && until < now.getTime();
}

/**
 * Estado real de la propuesta.
 *
 * `status` es un campo almacenado: una cotización pasada de plazo sigue diciendo
 * "Enviada" hasta que alguien la toque. Aquí manda la fecha, que es lo que el
 * cliente tiene delante.
 */
export function derivedStatus(q: QuoteState, now: Date = new Date()): string {
  if (isOpen(q) && isExpired(q, now)) return "expired";
  return q.status || "draft";
}

/* --------------------------------------------------------- máquina de estados */

export type SendBlock = "no_lines" | "no_recipient" | "no_validity" | "already_decided" | "superseded";
export type DecideBlock = "not_sent" | "already_decided" | "superseded" | "expired";
export type ConvertBlock = "not_accepted" | "already_converted" | "no_customer" | "no_sellable_line" | "no_option_selected";
export type ReviseBlock = "already_converted" | "superseded";

export const BLOCK_MESSAGE: Record<SendBlock | DecideBlock | ConvertBlock | ReviseBlock, string> = {
  no_lines: "Una cotización sin líneas no dice ningún precio: añade el desglose antes de enviarla",
  no_recipient: "No hay a quién enviarla: asigna un cliente o escribe el correo del contacto",
  no_validity: "Una propuesta sin fecha de vigencia no se puede sostener: ponle plazo",
  already_decided: "Esta cotización ya está decidida",
  superseded: "Esta versión fue reemplazada por una revisión posterior",
  not_sent: "El cliente todavía no la ha recibido: envíala antes de registrar su respuesta",
  expired: "La cotización venció: revísala con un plazo nuevo antes de aceptarla",
  not_accepted: "Solo se convierte en reserva una cotización aceptada",
  already_converted: "Esta cotización ya generó su orden",
  no_customer: "La reserva necesita un cliente registrado: asígnaselo a la cotización",
  no_sellable_line: "Ninguna línea apunta a un producto del catálogo, así que no hay nada que reservar",
  no_option_selected: "La propuesta ofrece alternativas: marca cuál escogió el cliente",
};

/** Bloqueos que un responsable puede saltarse dejando constancia del motivo. */
export const FORCEABLE_DECIDE_BLOCKS = new Set<DecideBlock>(["expired"]);

/** Qué impide enviar la propuesta al cliente, o `null` si se puede enviar. */
export function sendBlocker(q: QuoteState, lines: QuoteLineInput[]): SendBlock | null {
  if (q.status === "superseded") return "superseded";
  if (DECIDED_STATUSES.has(q.status || "")) return "already_decided";
  if (billableLines(lines).length === 0) return "no_lines";
  if (!q.customer && !q.contact_email?.trim()) return "no_recipient";
  if (!q.valid_until) return "no_validity";
  return null;
}

/** Qué impide registrar la respuesta del cliente. */
export function decideBlocker(q: QuoteState, now: Date = new Date()): DecideBlock | null {
  if (q.status === "superseded") return "superseded";
  if (DECIDED_STATUSES.has(q.status || "")) return "already_decided";
  if (q.status !== "sent" && q.status !== "negotiating") return "not_sent";
  if (isExpired(q, now)) return "expired";
  return null;
}

/** Qué impide convertirla en orden de venta. */
export function convertBlocker(
  q: QuoteState,
  lines: { product?: unknown; option_id?: string | null; is_optional?: boolean | null }[],
  options: QuoteOptionInput[] = []
): ConvertBlock | null {
  if (q.status === "converted" || q.order) return "already_converted";
  if (q.status !== "accepted") return "not_accepted";
  if (!q.customer) return "no_customer";
  const selected = options.find((o) => o.is_selected);
  if (options.length > 0 && !selected) return "no_option_selected";
  const inScope = lines.filter(
    (l) => !l.is_optional && (!l.option_id || l.option_id === selected?._id)
  );
  if (!inScope.some((l) => l.product)) return "no_sellable_line";
  return null;
}

/** Qué impide abrir una revisión nueva. */
export function reviseBlocker(q: QuoteState): ReviseBlock | null {
  if (q.status === "converted" || q.order) return "already_converted";
  if (q.status === "superseded") return "superseded";
  return null;
}

/* ------------------------------------------------------------------ códigos */

/** Código sin su sufijo de versión: `COT-2609-ABC1234-v3` -> `COT-2609-ABC1234`. */
export const baseCode = (code: string | null | undefined): string =>
  (code || "").trim().replace(/-v\d+$/i, "");

/**
 * Código de una versión concreta: `COT-2609-ABC1234-v2`.
 *
 * La revisión conserva el código base para que cliente y vendedor sigan hablando
 * del mismo documento; lo que cambia es el sufijo. Es idempotente, así que
 * aplicarlo sobre un código que ya lleva versión no la duplica.
 */
export function versionedCode(code: string | null | undefined, version?: number | null): string {
  const base = baseCode(code);
  const v = Math.max(Math.floor(num(version)), 1);
  if (!base) return "";
  return v > 1 ? `${base}-v${v}` : base;
}

/**
 * Pax de una línea para convertirla en reserva.
 *
 * Sin desglose explícito, la cantidad son adultos: es lo que asume cualquiera
 * que teclee "4 × City Tour", y es el único supuesto que no inventa niños.
 */
export function linePax(line: { quantity?: number | null; adults?: number | null; children?: number | null; infants?: number | null }): {
  adults: number; children: number; infants: number;
} {
  const adults = Math.floor(num(line.adults));
  const children = Math.floor(num(line.children));
  const infants = Math.floor(num(line.infants));
  if (adults + children + infants > 0) {
    return { adults: Math.max(adults, 0), children: Math.max(children, 0), infants: Math.max(infants, 0) };
  }
  return { adults: Math.max(Math.floor(num(line.quantity)), 1), children: 0, infants: 0 };
}
