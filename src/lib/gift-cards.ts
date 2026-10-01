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
 * SOBRE LA CONTABILIDAD. La gift card es la única excepción a la base de
 * efectivo del libro mayor (ver `src/lib/ledger-events.ts`), y no por gusto: al
 * emitirla entra dinero por un servicio que todavía no se ha dado, así que
 * reconocerlo como venta infla el mes en que se vendió el plástico y deja vacío
 * el mes en que de verdad se viaja. El saldo vendido y sin usar es una DEUDA con
 * el portador mientras no se gasta, y ese es el papel de `2202 Pasivo por gift
 * cards`, que estaba en el plan base desde el primer día sin que ningún asiento
 * lo tocara.
 *
 *   Emitir   (`postGiftCardIssued`):  Dr caja o banco / Cr 2202
 *   Consumir (`/api/payments`):       Dr 2202         / Cr 4101 Ingresos
 *
 * Las dos mitades se cierran solas y el pasivo dice en todo momento cuánto saldo
 * queda vendido sin usar. Lo que NO se hace es acreditar ingresos dos veces: la
 * redención es la única que los reconoce.
 *
 * Estas funciones puras no asientan nada por su cuenta —son decisiones sobre el
 * saldo, no sobre el libro—; asientan las rutas que las llaman.
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

/**
 * ¿PUEDE ESTA TARJETA PAGAR ESTO? UNA SOLA DEFINICIÓN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTÁ AQUÍ Y NO EN CADA RUTA
 *
 * Desde el 30-sep hay DOS sitios que consumen saldo: la acción del cajón
 * (`/api/gift-cards/:id/redeem`) y el cobro de una orden con método `gift_card`
 * (`/api/payments`). Las tres comprobaciones —que la tarjeta se pueda usar, que
 * el importe valga, y que la moneda sea la misma— tenían que estar en los dos.
 *
 * Copiarlas era la salida fácil y es exactamente el fallo que esta rama lleva
 * cerrando: con dos definiciones, la que se queda desactualizada es siempre la
 * que nadie mira. Y aquí el que se queda atrás cobra de menos, o cobra una
 * tarjeta cerrada, o mezcla divisas 1:1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA MONEDA NO SE CONVIERTE
 *
 * Una tarjeta en dólares no paga una orden en pesos sin una tasa explícita, y
 * aquí no hay ninguna. Mezclarlas 1:1 descuadraría el saldo y el ingreso a la
 * vez, y nadie lo vería hasta cuadrar el pasivo de gift cards a fin de mes.
 *
 * Devuelve el `status` HTTP junto al mensaje porque los tres casos no son el
 * mismo: un importe mal escrito es culpa de quien llama (400) y una tarjeta
 * vencida o sin saldo es un estado del mundo (409).
 */
export function planDePagoConTarjeta(
  card: RedeemableGiftCard & { currency?: string | null },
  rawAmount: unknown,
  currency?: string | null,
  /**
   * El instante contra el que se mide la vigencia. Es un parámetro y no el reloj
   * a secas porque si no, la única regla de aquí que depende del tiempo solo se
   * puede probar esperando a que el calendario coopere — y una prueba que caduca
   * es una prueba que alguien borra el día que se pone roja sola.
   */
  now = new Date()
): { plan: GiftCardMovementPlan } | { error: string; status: 400 | 409 } {
  const parsed = validateAmount(rawAmount);
  if ("error" in parsed) return { error: parsed.error, status: 400 };

  const blocker = giftCardBlocker(card, now);
  if (blocker) return { error: GIFT_CARD_BLOCK_MESSAGE[blocker], status: 409 };

  if (currency && card.currency && currency !== card.currency) {
    return {
      error: `La tarjeta está en ${card.currency.toUpperCase()} y el cobro en ${currency.toUpperCase()}`,
      status: 409,
    };
  }

  const plan = applyRedemption(card, parsed.amount);
  if ("error" in plan) return { error: plan.error, status: 409 };
  return { plan };
}

/** Emisión: el saldo nace igual al importe emitido. */
export function applyIssue(amount: number): GiftCardMovementPlan {
  return { amount, balance_after: amount, status: "active", movement_type: "issue" };
}
