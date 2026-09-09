/**
 * Saldo y estado de una gift card.
 *
 * El saldo de una gift card es dinero del cliente en poder de la empresa, y
 * hasta ahora era un campo de formulario: `balance` y `status` estaban en el
 * CRUD genérico, así que cualquiera con permiso de escritura podía ponerle el
 * número que quisiera, sin rastro de quién ni por qué. `gift_card_movement`
 * existe desde la primera migración —con `movement_type`, `amount` y
 * `balance_after`— y nadie la escribía nunca, de modo que la pantalla prometía
 * "cada redención queda registrada como movimiento" y no había ni una.
 *
 * Cada cambio de saldo pasa ahora por aquí y deja su movimiento. La decisión
 * vive en funciones puras para poder probarla sin base de datos; las rutas solo
 * autorizan, persisten y auditan.
 *
 * SOBRE LA CONTABILIDAD. El libro mayor de este sistema es de base de efectivo
 * por decisión explícita (ver `src/lib/ledger-events.ts`): cada asiento refleja
 * un movimiento real de caja o banco, sin diferidos ni devengo. La venta de la
 * gift card ya registra `Dr Caja / Cr Ingresos` cuando se cobra la orden, así
 * que la redención NO debe volver a acreditar ingresos: duplicaría la venta. El
 * `2202 Pasivo por gift cards` del plan de cuentas pertenece al modelo de
 * devengo, que todavía no está implementado. Por eso estas acciones no asientan:
 * pasar a devengo es una decisión contable aparte, no un efecto colateral de
 * arreglar el control del saldo.
 */

export interface RedeemableGiftCard {
  status?: string | null;
  balance?: number | null;
  expires_at?: string | null;
}

/** Estados en los que la tarjeta ya no admite consumo. */
export const CLOSED_GIFT_CARD_STATUSES = new Set(["redeemed", "expired", "void"]);

export type GiftCardBlock =
  | "closed"   // redimida, expirada o anulada
  | "empty"    // sin saldo
  | "expired"; // pasó su vigencia aunque el estado no se haya actualizado

export const GIFT_CARD_BLOCK_MESSAGE: Record<GiftCardBlock, string> = {
  closed: "Esta gift card ya fue redimida, anulada o expiró",
  empty: "Esta gift card no tiene saldo disponible",
  expired: "Esta gift card está vencida",
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const giftCardBalance = (card: RedeemableGiftCard): number => round2(Number(card.balance ?? 0));

export const isGiftCardClosed = (card: RedeemableGiftCard): boolean =>
  CLOSED_GIFT_CARD_STATUSES.has(card.status || "");

export const isGiftCardExpired = (card: RedeemableGiftCard, now = new Date()): boolean =>
  Boolean(card.expires_at && new Date(card.expires_at).getTime() < now.getTime());

/**
 * Por qué no se puede consumir la tarjeta, o `null` si se puede.
 *
 * El orden importa: una tarjeta anulada se rechaza como anulada aunque además
 * esté vencida y sin saldo, para que el mensaje diga lo que de verdad pasó.
 */
export function giftCardBlocker(card: RedeemableGiftCard, now = new Date()): GiftCardBlock | null {
  if (isGiftCardClosed(card)) return "closed";
  if (isGiftCardExpired(card, now)) return "expired";
  if (giftCardBalance(card) <= 0) return "empty";
  return null;
}

export interface GiftCardMovementPlan {
  /** Importe del movimiento, positivo al consumir y negativo al devolver. */
  amount: number;
  balance_after: number;
  status: string;
  movement_type: "issue" | "redeem" | "refund" | "adjustment" | "expire";
}

/** Importe válido para un movimiento, o un mensaje de por qué no lo es. */
export function validateAmount(raw: unknown): { amount: number } | { error: string } {
  const amount = round2(Number(raw));
  if (!Number.isFinite(amount)) return { error: "El importe debe ser un número" };
  if (amount <= 0) return { error: "El importe debe ser mayor que cero" };
  return { amount };
}

/**
 * Consume saldo de la tarjeta.
 *
 * Pedir más de lo que queda se rechaza en vez de recortarse al saldo: recortar
 * en silencio dejaría la orden cobrada de menos sin que nadie lo notara, que es
 * la clase de error que esta acción viene a cerrar. La tarjeta queda `redeemed`
 * al agotarse y `partially_used` mientras le sobre saldo.
 */
export function applyRedemption(
  card: RedeemableGiftCard,
  amount: number
): GiftCardMovementPlan | { error: string } {
  const available = giftCardBalance(card);
  if (amount > available) {
    return { error: `El saldo disponible es ${available.toFixed(2)} y se intentó consumir ${amount.toFixed(2)}` };
  }
  const balance_after = round2(available - amount);
  return {
    amount,
    balance_after,
    status: balance_after <= 0 ? "redeemed" : "partially_used",
    movement_type: "redeem",
  };
}

/**
 * Devuelve saldo a la tarjeta, al reembolsar una compra que se pagó con ella.
 *
 * No puede superar lo emitido: una devolución mayor convertiría la tarjeta en
 * una fuente de dinero.
 */
export function applyRefund(
  card: RedeemableGiftCard & { initial_amount?: number | null },
  amount: number
): GiftCardMovementPlan | { error: string } {
  const issued = round2(Number(card.initial_amount ?? 0));
  const balance_after = round2(giftCardBalance(card) + amount);
  if (issued > 0 && balance_after > issued) {
    return { error: `La devolución dejaría un saldo de ${balance_after.toFixed(2)}, por encima de lo emitido (${issued.toFixed(2)})` };
  }
  return {
    amount: -amount,
    balance_after,
    status: balance_after > 0 ? "partially_used" : "redeemed",
    movement_type: "refund",
  };
}

/** Emisión: el saldo nace igual al importe emitido. */
export function applyIssue(amount: number): GiftCardMovementPlan {
  return { amount, balance_after: amount, status: "active", movement_type: "issue" };
}
