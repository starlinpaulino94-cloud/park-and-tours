/**
 * Aritmética de una cotización.
 *
 * La pantalla mostraba el desglose económico de una cotización pero no había
 * ninguna forma de crear una, ni de añadirle una línea: el módulo entero era una
 * tabla vacía con un embudo de conversión que nunca podía moverse.
 *
 * Los totales se calculan aquí, en funciones puras, para que la pantalla y
 * cualquier flujo futuro (convertir a orden, duplicar una propuesta) obtengan el
 * mismo número. Una cotización cuyo total no cuadra con sus líneas es una
 * promesa que la empresa no puede sostener delante del cliente.
 */

export interface QuoteLineInput {
  quantity?: number | null;
  unit_price?: number | null;
  discount_percent?: number | null;
}

export interface QuoteTotals {
  subtotal: number;
  discount: number;
  total: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Importe bruto de una línea, antes de su descuento. */
export const lineGross = (line: QuoteLineInput): number =>
  round2(num(line.quantity) * num(line.unit_price));

/** Descuento de la línea, acotado al 0–100% para que nunca sume importe. */
export function lineDiscount(line: QuoteLineInput): number {
  const pct = Math.min(Math.max(num(line.discount_percent), 0), 100);
  return round2((lineGross(line) * pct) / 100);
}

/** Importe final de la línea: es lo que se guarda en `line_total`. */
export const lineTotal = (line: QuoteLineInput): number =>
  round2(lineGross(line) - lineDiscount(line));

/**
 * Totales de la cotización a partir de sus líneas.
 *
 * El impuesto NO se calcula aquí: depende del perfil fiscal del inquilino y se
 * fija a mano en la cabecera, así que se recibe y se suma tal cual en vez de
 * inventar una tasa.
 */
export function quoteTotals(lines: QuoteLineInput[], tax = 0): QuoteTotals {
  const subtotal = round2(lines.reduce((sum, l) => sum + lineGross(l), 0));
  const discount = round2(lines.reduce((sum, l) => sum + lineDiscount(l), 0));
  return { subtotal, discount, total: round2(subtotal - discount + round2(num(tax))) };
}
