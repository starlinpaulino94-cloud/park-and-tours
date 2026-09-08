/**
 * Redención de pases de acceso.
 *
 * `access_ticket.status` y `entries_used` son estado de consumo: revertir un
 * pase redimido o poner el contador a cero vuelve a armar una entrada ya usada.
 * Por eso salen del CRUD genérico —igual que `voucher.status` (AUD-B02/B14) y
 * `departure.status` (AUD-B02/B16)— y se mueven solo por esta acción.
 *
 * La decisión vive aquí, en funciones puras, para poder probarla sin base de
 * datos; la ruta se limita a autorizar, persistir y auditar.
 */

export interface RedeemableTicket {
  status?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  entries_allowed?: number | null;
  entries_used?: number | null;
}

/** Estados en los que el pase ya no admite uso. */
export const CLOSED_TICKET_STATUSES = new Set(["redeemed", "expired", "void", "transferred"]);

export type RedeemBlock =
  | "closed"        // anulado, transferido o ya redimido
  | "exhausted"     // sin entradas restantes
  | "not_yet_valid" // aún no empieza su vigencia
  | "expired";      // pasó su vigencia

/** Entradas que le quedan; `null` significa ilimitadas. */
export function remainingEntries(t: RedeemableTicket): number | null {
  if (t.entries_allowed == null) return null;
  return Math.max(0, t.entries_allowed - (t.entries_used ?? 0));
}

/**
 * Predicados de vigencia, compartidos por la puerta y por el listado.
 *
 * `status` es un campo almacenado que se queda obsoleto solo: un pase con
 * `valid_to` en el pasado sigue diciendo "Emitido" hasta que algo lo actualice.
 * Por eso la fecha manda, y por eso estos predicados viven aquí en vez de
 * repetirse en cada pantalla que necesita saber si un pase sirve.
 */
export const isExpired = (t: RedeemableTicket, now = new Date()): boolean =>
  Boolean(t.valid_to && new Date(t.valid_to).getTime() < now.getTime());

export const isNotYetValid = (t: RedeemableTicket, now = new Date()): boolean =>
  Boolean(t.valid_from && new Date(t.valid_from).getTime() > now.getTime());

export const isExhausted = (t: RedeemableTicket): boolean => remainingEntries(t) === 0;

export const isClosed = (t: RedeemableTicket): boolean => CLOSED_TICKET_STATUSES.has(t.status || "");

/** Utilizable de verdad: ni cerrado, ni fuera de vigencia, ni agotado. */
export const isUsable = (t: RedeemableTicket, now = new Date()): boolean =>
  redeemBlocker(t, now) === null;

/** Vence dentro de `days` días (y todavía no ha vencido). */
export function expiresWithin(t: RedeemableTicket, days: number, now = new Date()): boolean {
  if (!t.valid_to || isExpired(t, now)) return false;
  return new Date(t.valid_to).getTime() - now.getTime() <= days * 86_400_000;
}

/**
 * Por qué no se puede validar el pase, o `null` si se puede.
 *
 * El orden importa: un pase anulado se rechaza como anulado aunque además esté
 * vencido, para que el mensaje diga lo que de verdad pasó.
 */
export function redeemBlocker(t: RedeemableTicket, now = new Date()): RedeemBlock | null {
  if (isClosed(t)) return "closed";
  if (isExhausted(t)) return "exhausted";
  if (isNotYetValid(t, now)) return "not_yet_valid";
  if (isExpired(t, now)) return "expired";
  return null;
}

/** Solo un vencimiento puede forzarse (con rango de gestión y auditoría). */
export const FORCEABLE_BLOCKS = new Set<RedeemBlock>(["expired"]);

export const BLOCK_MESSAGE: Record<RedeemBlock, string> = {
  closed: "Este pase ya fue redimido, anulado o transferido",
  exhausted: "Este pase ya consumió todas sus entradas",
  not_yet_valid: "Este pase todavía no está vigente",
  expired: "Este pase está vencido",
};

export interface RedemptionResult {
  entries_used: number;
  status: string;
  redeemed_at: string | null;
  remaining: number | null;
}

/**
 * Consume una entrada y devuelve el nuevo estado.
 *
 * Un pase con tope pasa a `partially_used` mientras le queden entradas y a
 * `redeemed` cuando se agota (fijando `redeemed_at`). Uno sin tope nunca se
 * agota: queda `active`.
 */
export function applyRedemption(t: RedeemableTicket, now = new Date()): RedemptionResult {
  const used = (t.entries_used ?? 0) + 1;
  const allowed = t.entries_allowed ?? null;

  if (allowed == null) {
    return { entries_used: used, status: "active", redeemed_at: null, remaining: null };
  }
  const remaining = Math.max(0, allowed - used);
  return remaining === 0
    ? { entries_used: used, status: "redeemed", redeemed_at: now.toISOString(), remaining }
    : { entries_used: used, status: "partially_used", redeemed_at: null, remaining };
}
