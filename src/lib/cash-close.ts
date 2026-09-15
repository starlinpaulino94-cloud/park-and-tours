/**
 * El arqueo de caja.
 *
 * Cerrar una caja no es escribir cuánto había: es contar el dinero físico,
 * compararlo con lo que el sistema dice que debería haber, y explicar la
 * diferencia. Este módulo resuelve las tres partes que tienen enjundia y las
 * deja fuera de la base de datos, donde se pueden probar:
 *
 *  1. **Qué se cuenta.** Las denominaciones reales de cada moneda. Un cajero
 *     dominicano cuenta billetes de 2000, 1000, 500, 200, 100 y 50, y monedas
 *     de 25, 10, 5 y 1 — no un total. El desglose es lo que permite rastrear un
 *     faltante ("faltan dos de 1000") y repetir el conteo al día siguiente.
 *
 *  2. **Cuánto debería haber, POR MONEDA.** La misma caja recibe pesos y
 *     dólares en el mismo turno. Sumarlos en un solo número —que es lo que
 *     hacía `expected_cash`— convierte 100 USD y 100 DOP en 200 de nada.
 *
 *  3. **Qué cuenta como efectivo.** Solo lo cobrado en efectivo llega al cajón.
 *     La tarjeta la liquida el banco, la transferencia entra al banco, el
 *     cheque se deposita y el crédito queda por cobrar. Todos ellos abren un
 *     movimiento en la sesión porque forman parte del turno, pero ninguno se
 *     cuenta al arquear.
 */

export type MovementKind =
  | "opening" | "closing" | "sale" | "refund"
  | "expense" | "withdrawal" | "deposit" | "adjustment";

/** Movimiento de caja tal como vive en `cash_movement`. */
export interface CashMovementInput {
  movement_type?: string | null;
  amount?: number | null;
  currency?: string | null;
}

/** Cobro tal como vive en `payment`, acotado a lo que el arqueo necesita. */
export interface CashPaymentInput {
  method?: string | null;
  amount?: number | null;
  currency?: string | null;
  payment_type?: string | null;
}

/** Una línea del conteo: tantas piezas de tal denominación. */
export interface CountLine {
  denomination: number;
  quantity: number;
}

/** Lo que pasó en el turno para UNA moneda. */
export interface CurrencySummary {
  currency: string;
  /** Fondo con el que se abrió el turno en esta moneda. */
  opening: number;
  /** Todo lo que pasó por la caja, cobrado como se cobrara. */
  sales: number;
  refunds: number;
  /** Solo lo que entró y salió del cajón en billetes. */
  cash_sales: number;
  cash_refunds: number;
  expenses: number;
  withdrawals: number;
  deposits: number;
  adjustments: number;
  /** Cobros que NO entran al cajón, desglosados para poder conciliarlos. */
  card: number;
  transfer: number;
  other_methods: number;
  /** Efectivo que debería estar en el cajón al cerrar. */
  expected: number;
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Denominaciones en circulación, de mayor a menor.
 *
 * No es un catálogo editable a propósito: las denominaciones de una moneda no
 * las decide la empresa, y una tabla configurable solo añade una forma de que
 * el conteo no cuadre con lo que el cajero tiene en la mano.
 */
export const DENOMINATIONS: Record<string, number[]> = {
  // República Dominicana. La moneda de 1 peso sigue circulando; la de 0.25 y
  // 0.50 ya no, y por eso no están: ofrecerlas invita a conteos imposibles.
  dop: [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1],
  usd: [100, 50, 20, 10, 5, 2, 1, 0.25, 0.1, 0.05, 0.01],
  eur: [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01],
  mxn: [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5],
  cop: [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50],
  brl: [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05],
};

/** A partir de qué valor una pieza es billete y no moneda (para agrupar la UI). */
const COIN_CEILING: Record<string, number> = { dop: 25, usd: 0.25, eur: 2, mxn: 10, cop: 1000, brl: 1 };

/**
 * Monedas que el sistema sabe contar.
 *
 * Es la misma lista que el enum `currency` de la base —una guarda lo verifica—,
 * así que sirve de validación en la frontera: una moneda que no está aquí no
 * tiene denominaciones y no se puede arquear.
 */
export function isKnownCurrency(currency?: string | null): boolean {
  return Object.prototype.hasOwnProperty.call(DENOMINATIONS, String(currency || "").toLowerCase());
}

export function denominationsFor(currency?: string | null): number[] {
  return DENOMINATIONS[String(currency || "").toLowerCase()] ?? DENOMINATIONS.usd;
}

/** True si esa pieza es moneda (y no billete) en esa divisa. */
export function isCoin(currency: string | null | undefined, denomination: number): boolean {
  const ceiling = COIN_CEILING[String(currency || "").toLowerCase()] ?? 0.25;
  return denomination <= ceiling;
}

/**
 * Total del conteo.
 *
 * En centavos enteros: contar 300 monedas de 0.05 en coma flotante se va del
 * céntimo, y un céntimo de descuadre obliga a justificar un arqueo que estaba
 * bien.
 */
export function countTotal(lines: CountLine[] | null | undefined): number {
  let cents = 0;
  for (const line of lines ?? []) {
    const value = Math.round(num(line?.denomination) * 100);
    const qty = Math.trunc(num(line?.quantity));
    if (value <= 0 || qty <= 0) continue;
    cents += value * qty;
  }
  return round2(cents / 100);
}

/**
 * Denominaciones del conteo que no existen en esa moneda.
 *
 * Un 250 tecleado donde iba un 25 cuadra la caja con dinero que no existe. Se
 * rechaza el conteo entero antes que aceptar un total inventado.
 */
export function invalidDenominations(
  lines: CountLine[] | null | undefined,
  currency?: string | null
): number[] {
  const valid = new Set(denominationsFor(currency).map((d) => Math.round(d * 100)));
  const bad: number[] = [];
  for (const line of lines ?? []) {
    const value = Math.round(num(line?.denomination) * 100);
    const qty = Math.trunc(num(line?.quantity));
    if (qty <= 0) continue;
    if (!valid.has(value)) bad.push(round2(value / 100));
  }
  return [...new Set(bad)];
}

/** Métodos de cobro que SÍ dejan dinero en el cajón. Solo uno. */
const IN_DRAWER = new Set(["cash"]);

/** Un reembolso o una nota de crédito sale de la caja: su signo es negativo. */
function signedPayment(p: CashPaymentInput): number {
  const amount = Math.abs(num(p.amount));
  return p.payment_type === "refund" || p.payment_type === "credit_note" ? -amount : amount;
}

/** Cuánto mueve el efectivo cada tipo de movimiento, con su signo real. */
export function movementDelta(movement: CashMovementInput): number {
  const raw = num(movement.amount);
  switch (movement.movement_type) {
    // El fondo de apertura se contabiliza aparte; el cierre es un registro del
    // conteo, no un movimiento de dinero. Sumar cualquiera de los dos duplica.
    case "opening":
    case "closing":
      return 0;
    case "expense":
    case "withdrawal":
      return -Math.abs(raw);
    case "deposit":
      return Math.abs(raw);
    case "refund":
      return -Math.abs(raw);
    // El ajuste conserva su signo: un ajuste que solo puede sumar no es un
    // ajuste, es una entrada.
    case "adjustment":
      return raw;
    case "sale":
      return raw;
    default:
      return 0;
  }
}

/**
 * Lo que pasó en el turno, una fila por moneda con movimiento.
 *
 * El esperado sale de los movimientos y se le restan los cobros que no son en
 * efectivo, porque cada cobro de la sesión abre su movimiento sea cual sea el
 * método: sin esa resta, la tarjeta inflaría el cajón.
 */
export function summarizeCash(
  movements: CashMovementInput[] | null | undefined,
  payments: CashPaymentInput[] | null | undefined,
  extraCurrencies: (string | null | undefined)[] = []
): CurrencySummary[] {
  const rows = new Map<string, CurrencySummary>();
  const row = (currency: string | null | undefined): CurrencySummary => {
    const key = String(currency || "usd").toLowerCase();
    let found = rows.get(key);
    if (!found) {
      found = {
        currency: key, opening: 0, sales: 0, refunds: 0,
        cash_sales: 0, cash_refunds: 0, expenses: 0,
        withdrawals: 0, deposits: 0, adjustments: 0,
        card: 0, transfer: 0, other_methods: 0, expected: 0,
      };
      rows.set(key, found);
    }
    return found;
  };

  for (const currency of extraCurrencies) if (currency) row(currency);

  for (const movement of movements ?? []) {
    const r = row(movement.currency);
    const raw = num(movement.amount);
    switch (movement.movement_type) {
      case "opening": r.opening += Math.abs(raw); break;
      case "sale": r.sales += raw; r.cash_sales += raw; break;
      case "refund": r.refunds += Math.abs(raw); r.cash_refunds += Math.abs(raw); break;
      case "expense": r.expenses += Math.abs(raw); break;
      case "withdrawal": r.withdrawals += Math.abs(raw); break;
      case "deposit": r.deposits += Math.abs(raw); break;
      case "adjustment": r.adjustments += raw; break;
      default: break;
    }
    r.expected += movementDelta(movement);
  }

  for (const payment of payments ?? []) {
    const method = String(payment.method || "cash").toLowerCase();
    if (IN_DRAWER.has(method)) continue;
    const r = row(payment.currency);
    const signed = signedPayment(payment);
    if (method === "card") r.card += signed;
    else if (method === "transfer" || method === "link") r.transfer += signed;
    else r.other_methods += signed;
    // Abrió movimiento como parte del turno, pero no dejó dinero en el cajón.
    r.expected -= signed;
    // Y tampoco cuenta como venta o devolución EN EFECTIVO. Hay que mirar el
    // signo: un reembolso con tarjeta descuenta de los reembolsos en efectivo,
    // no los aumenta.
    if (signed >= 0) r.cash_sales -= signed;
    else r.cash_refunds += signed;
  }

  for (const r of rows.values()) {
    r.expected = round2(r.expected + r.opening);
    r.opening = round2(r.opening);
    r.sales = round2(r.sales);
    r.refunds = round2(r.refunds);
    r.cash_sales = round2(r.cash_sales);
    r.cash_refunds = round2(r.cash_refunds);
    r.expenses = round2(r.expenses);
    r.withdrawals = round2(r.withdrawals);
    r.deposits = round2(r.deposits);
    r.adjustments = round2(r.adjustments);
    r.card = round2(r.card);
    r.transfer = round2(r.transfer);
    r.other_methods = round2(r.other_methods);
  }

  return [...rows.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Contado menos esperado: positivo sobra, negativo falta. */
export function differenceOf(expected: number, counted: number): number {
  return round2(num(counted) - num(expected));
}

export type DifferenceVerdict = "balanced" | "short" | "over";

/**
 * Cómo se califica una diferencia.
 *
 * La tolerancia absorbe el redondeo del vuelto, no un faltante: por defecto es
 * cero y cualquier descuadre se ve.
 */
export function classifyDifference(difference: number, tolerance = 0): DifferenceVerdict {
  const diff = num(difference);
  const limit = Math.abs(num(tolerance)) + 0.009;
  if (Math.abs(diff) <= limit) return "balanced";
  return diff > 0 ? "over" : "short";
}

/** Un cierre con cualquier descuadre fuera de tolerancia va a revisión. */
export function needsApproval(differences: number[], tolerance = 0): boolean {
  return differences.some((d) => classifyDifference(d, tolerance) !== "balanced");
}

/** Mapa moneda → importe, que es como viajan los totales por moneda en jsonb. */
export function byCurrencyMap(entries: { currency: string; amount: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of entries) out[entry.currency] = round2(entry.amount);
  return out;
}
