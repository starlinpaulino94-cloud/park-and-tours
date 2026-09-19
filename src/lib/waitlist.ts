/**
 * La lista de espera — a quién le toca, por cuántas plazas y hasta cuándo.
 *
 * Puro a propósito: no toca la base ni lee la sesión. Las reglas de a quién se
 * le ofrece una plaza que se acaba de liberar hay que poder probarlas de una en
 * una, porque cada una de ellas es una conversación con un cliente que se
 * quedó fuera.
 */

import { holdUntil } from "@/lib/collections";

/* ═══════════════════════════════════════════════════ 1 · la cola y su orden ══ */

export type WaitlistStatus = "waiting" | "offered" | "converted" | "expired" | "cancelled";

export interface WaitlistEntryLike {
  _id?: string | null;
  id?: string | null;
  pax?: number | null;
  status?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  offered_at?: string | null;
  offer_expires_at?: string | null;
  customer?: unknown;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  booking?: unknown;
  notes?: string | null;
}

const idOf = (e: WaitlistEntryLike): string => String(e._id ?? e.id ?? "");
const paxOf = (e: WaitlistEntryLike): number => Math.max(0, Math.floor(Number(e.pax ?? 0)) || 0);
const bornAt = (e: WaitlistEntryLike): number => {
  const raw = e.created_at ?? e.createdAt ?? "";
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/**
 * La cola, por orden de llegada.
 *
 * Sin prioridades y sin orden manual, que es una decisión de producto escrita
 * también en la migración: el orden de llegada es lo único que un cliente
 * acepta sin discutir y lo único que el vendedor puede defender delante de él.
 *
 * Empate a milisegundo —dos altas en la misma petición— se rompe por
 * identificador, no al azar: una cola que cambia de orden cada vez que se
 * consulta no es una cola.
 */
export function queueOf(entries: WaitlistEntryLike[]): WaitlistEntryLike[] {
  return entries
    .filter((e) => String(e.status || "waiting") === "waiting")
    .sort((a, b) => {
      const d = bornAt(a) - bornAt(b);
      return d !== 0 ? d : idOf(a).localeCompare(idOf(b));
    });
}

/** Cuánta gente espera de verdad: lo que cuenta `departure.waitlist_pax`. */
export function waitingPax(entries: WaitlistEntryLike[]): number {
  return queueOf(entries).reduce((s, e) => s + paxOf(e), 0);
}

/* ══════════════════════════════════════════════ 2 · a quién se le ofrece ══ */

export interface OfferPick {
  entry: WaitlistEntryLike;
  pax: number;
}

/**
 * Quiénes se llevan las plazas que se acaban de liberar.
 *
 * SE RESPETA EL ORDEN, PERO NO SE PARA EN EL PRIMERO QUE NO CABE.
 *
 * Una familia de cinco esperando delante de una pareja, con tres plazas libres:
 * si la cola se parara ahí, las tres plazas saldrían vacías y los dos clientes
 * se quedarían sin viajar. Se salta a quien no cabe y se sigue bajando.
 *
 * Y NO SE PARTE UNA ESPERA. Ofrecerle tres plazas a una familia de cinco es
 * ofrecerle dejar a dos en tierra; quien se apuntó por cinco quiere cinco. Se
 * queda en la cola, en su sitio, para la próxima liberación.
 */
export function pickForSeats(entries: WaitlistEntryLike[], freeSeats: number): OfferPick[] {
  let quedan = Math.max(0, Math.floor(Number(freeSeats) || 0));
  if (quedan <= 0) return [];

  const elegidos: OfferPick[] = [];
  for (const entry of queueOf(entries)) {
    const pax = paxOf(entry);
    if (pax <= 0 || pax > quedan) continue;
    elegidos.push({ entry, pax });
    quedan -= pax;
    if (quedan <= 0) break;
  }
  return elegidos;
}

/* ═════════════════════════════════════════════ 3 · la ventana de la oferta ══ */

/**
 * Veinticuatro horas.
 *
 * Es el plazo que aguanta una operación turística: bastante para que alguien
 * que está de excursión conteste esa tarde o a la mañana siguiente, y poco como
 * para no bloquear una plaza que el de al lado compraría hoy. Más corto
 * castigaría a quien no mira el teléfono en el catamarán; más largo convierte
 * la lista en una forma de secuestrar asientos.
 */
export const OFFER_HOURS = 24;

/**
 * Hasta cuándo se le guarda la plaza.
 *
 * Nunca más allá de la salida, que es lo que hace `holdUntil` —el mismo
 * ayudante que usa la retención de una venta normal—: una plaza guardada para
 * un viaje que ya salió no la reclama nadie.
 */
export function offerDeadline(
  now: string | Date,
  departureAt: string | Date | null | undefined,
  hours: number = OFFER_HOURS
): string {
  return holdUntil(now, hours, departureAt ?? null);
}

/** ¿Se le pasó el turno? */
export function offerExpired(entry: WaitlistEntryLike, now: Date = new Date()): boolean {
  if (String(entry.status || "") !== "offered") return false;
  const limite = Date.parse(String(entry.offer_expires_at ?? ""));
  if (!Number.isFinite(limite)) return false;
  return limite <= now.getTime();
}

/* ══════════════════════════════════════════════════ 4 · cómo acaba cada una ══ */

export interface BookingLike {
  status?: string | null;
  paid_amount?: number | null;
}

/**
 * El desenlace de una espera, mirando también su reserva.
 *
 * `converted` NO se deduce de que exista la reserva: se deduce de que se haya
 * COBRADO algo. Una reserva creada por una oferta y nunca pagada es una plaza
 * que se guardó y se perdió, y contarla como venta recuperada le daría a la
 * lista un mérito que no tuvo — que es justo el número que la operadora va a
 * mirar para decidir si el módulo sirve.
 */
export function outcomeOf(
  entry: WaitlistEntryLike,
  booking: BookingLike | null | undefined,
  now: Date = new Date()
): WaitlistStatus {
  const declarado = String(entry.status || "waiting");
  if (declarado === "cancelled" || declarado === "expired") return declarado;
  if (declarado === "converted") return "converted";

  if (booking) {
    const estado = String(booking.status || "");
    if (Number(booking.paid_amount ?? 0) > 0.009) return "converted";
    if (estado === "cancelled" || estado === "refunded" || estado === "partially_refunded") {
      return "expired";
    }
  }

  if (declarado === "offered") return offerExpired(entry, now) ? "expired" : "offered";
  return "waiting";
}

/* ═════════════════════════════════════════════════════ 5 · lo que se ve ══ */

export interface WaitlistSummary {
  /** Cuántas esperas hay en la cola. */
  waiting: number;
  /** Cuánta gente suman: es lo que mide la demanda que se está perdiendo. */
  waitingPax: number;
  offered: number;
  converted: number;
  expired: number;
  cancelled: number;
  /** Pax que la lista llegó a sentar en la guagua. */
  convertedPax: number;
}

export function summarize(
  rows: { entry: WaitlistEntryLike; booking?: BookingLike | null }[],
  now: Date = new Date()
): WaitlistSummary {
  const out: WaitlistSummary = {
    waiting: 0, waitingPax: 0, offered: 0,
    converted: 0, expired: 0, cancelled: 0, convertedPax: 0,
  };
  for (const { entry, booking } of rows) {
    const estado = outcomeOf(entry, booking, now);
    out[estado] += 1;
    if (estado === "waiting") out.waitingPax += paxOf(entry);
    if (estado === "converted") out.convertedPax += paxOf(entry);
  }
  return out;
}

/** Cómo se llama a quien espera, con lo que haya. */
export function contactName(entry: WaitlistEntryLike): string {
  const cliente = entry.customer;
  if (cliente && typeof cliente === "object") {
    const c = cliente as { first_name?: string; last_name?: string };
    const nombre = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
    if (nombre) return nombre;
  }
  return String(entry.contact_name || "").trim() || "Sin nombre";
}

/** Por dónde se le avisa. `null` no debería pasar: la base lo impide. */
export function contactChannel(entry: WaitlistEntryLike): string | null {
  const cliente = entry.customer;
  if (cliente && typeof cliente === "object") {
    const c = cliente as { phone?: string; whatsapp?: string; email?: string };
    const suyo = String(c.whatsapp || c.phone || c.email || "").trim();
    if (suyo) return suyo;
  }
  return String(entry.contact_phone || entry.contact_email || "").trim() || null;
}
