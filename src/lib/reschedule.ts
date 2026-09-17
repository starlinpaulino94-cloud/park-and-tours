/**
 * REPROGRAMAR UNA RESERVA: las reglas, en puro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ES «CANCELAR Y VOLVER A VENDER»
 *
 * Esa era la única salida que había, y no es lo mismo:
 *
 *  · El voucher que el cliente ya tiene deja de valer, y llega a la puerta con
 *    un papel anulado.
 *  · Las comisiones se anulan y se generan otra vez, con el precio de HOY en vez
 *    del que se vendió. El vendedor cobra distinto por la misma venta.
 *  · Al cliente le llega un aviso de CANCELACIÓN por algo que no canceló.
 *  · Y se pierde el historial: en el sistema quedan dos reservas sin relación,
 *    así que nadie puede ver que un cliente mueve su excursión cada semana.
 *
 * Reprogramar mantiene la identidad de la reserva —su número y su voucher, que
 * es lo que el cliente tiene en la mano— y le cambia la fecha.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE PUEDE FORZAR, Y LO QUE SÍ
 *
 * Hay bloqueos que son físicos y no los levanta ningún rol: no se mueve una
 * reserva a un producto distinto (eso es otra venta), ni a una fecha que ya
 * pasó, ni a una salida sin cupo —eso sería sobreventa, y el cliente se queda
 * en el lobby—. Y hay bloqueos que son de POLÍTICA: el plazo de cambios y el
 * número de veces. Esos los levanta un gerente a sabiendas, y queda registrado.
 *
 * Es la misma distinción que en las cotizaciones: forzar un límite de negocio es
 * una decisión, forzar una imposibilidad es un error.
 */

export type RescheduleBlock =
  | "cancelled"
  | "checked_in"
  | "already_travelled"
  | "different_product"
  | "same_departure"
  | "past_target"
  | "target_closed"
  | "no_capacity"
  | "cutoff"
  | "too_many";

export const RESCHEDULE_BLOCK_MESSAGE: Record<RescheduleBlock, string> = {
  cancelled: "Esta reserva está cancelada o reembolsada: ya no hay plaza que mover.",
  checked_in: "Esta reserva ya hizo check-in. Mover una excursión que el cliente ya tomó no es reprogramar.",
  already_travelled: "La fecha de esta reserva ya pasó. Véndele una nueva o registra un no-show.",
  different_product: "La salida elegida es de otro producto. Eso es una venta nueva, no un cambio de fecha.",
  same_departure: "La reserva ya está en esa salida.",
  past_target: "No se puede mover a una fecha que ya pasó.",
  target_closed: "Esa salida está cerrada o cancelada: elige otra.",
  no_capacity: "Esa salida no tiene cupo para los pasajeros de esta reserva.",
  cutoff: "Ya pasó el plazo de cambios de este producto.",
  too_many: "Esta reserva ya se movió el máximo de veces.",
};

/**
 * Los que un gerente puede levantar.
 *
 * El plazo y el número de veces son política comercial: hay clientes con los que
 * se hace una excepción, y negarla desde el software obliga a arreglarlo por
 * fuera —cancelando y revendiendo—, que es justo lo que esto viene a evitar.
 */
export const FORCEABLE_RESCHEDULE_BLOCKS: RescheduleBlock[] = ["cutoff", "too_many"];

/**
 * Cuántas veces se puede mover una reserva sin que alguien lo mire.
 *
 * Tres. No es un número sagrado: es el punto donde la reprogramación deja de ser
 * un favor operativo y empieza a ser un cliente que no va a ir. A la cuarta, un
 * gerente decide si se mueve otra vez o se convierte en reembolso.
 */
export const MAX_RESCHEDULES = 3;

/** Plazo por defecto cuando el producto no declara uno. */
export const DEFAULT_CUTOFF_HOURS = 24;

export interface BookingForReschedule {
  status?: string | null;
  checkin_status?: string | null;
  travel_date?: string | null;
  pax_total?: number | null;
  reschedule_count?: number | null;
  /** Producto de la reserva, ya resuelto a identificador. */
  productId?: string | null;
  departureId?: string | null;
}

export interface TargetForReschedule {
  id?: string | null;
  productId?: string | null;
  departure_at?: string | null;
  status?: string | null;
  /**
   * Plazas libres, o `null` cuando la salida no declara cupo.
   *
   * `null` es «sin techo declarado», no «cero»: una salida sin capacidad puesta
   * no puede bloquear un cambio, igual que un plan sin límite no bloquea nada.
   */
  availableSeats?: number | null;
}

const DEAD_STATUSES = ["cancelled", "refunded", "partially_refunded", "no_show"];
const TRAVELLED = ["checked_in", "completed"];
const CLOSED_DEPARTURES = ["cancelled", "closed", "departed", "completed"];

const hoursBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3_600_000;

/**
 * El primer motivo por el que esta reserva no se puede mover a esa salida, o
 * `null` si se puede. Devuelve UNO: el más fundamental, porque enseñar cinco
 * problemas a la vez no ayuda a resolver ninguno.
 */
export function rescheduleBlocker(
  booking: BookingForReschedule,
  target: TargetForReschedule,
  now: Date = new Date(),
  cutoffHours: number = DEFAULT_CUTOFF_HOURS
): RescheduleBlock | null {
  const status = String(booking.status || "").toLowerCase();
  if (DEAD_STATUSES.includes(status)) return "cancelled";
  if (TRAVELLED.includes(status) || TRAVELLED.includes(String(booking.checkin_status || ""))) {
    return "checked_in";
  }

  // Lo imposible antes que lo de política: decirle «pasó el plazo» a quien
  // eligió un producto equivocado lo manda a pedir permiso para nada.
  if (!target.productId || !booking.productId || target.productId !== booking.productId) {
    return "different_product";
  }
  if (target.id && booking.departureId && target.id === booking.departureId) return "same_departure";

  const targetAt = target.departure_at ? new Date(target.departure_at) : null;
  if (!targetAt || Number.isNaN(targetAt.getTime()) || targetAt.getTime() <= now.getTime()) {
    return "past_target";
  }
  if (CLOSED_DEPARTURES.includes(String(target.status || "").toLowerCase())) return "target_closed";

  const pax = Number(booking.pax_total ?? 1) || 1;
  if (target.availableSeats !== null && target.availableSeats !== undefined && target.availableSeats < pax) {
    return "no_capacity";
  }

  // La fecha de la reserva ya pasó: no hay nada que mover, hay que vender otra.
  const travelAt = booking.travel_date ? new Date(booking.travel_date) : null;
  if (travelAt && !Number.isNaN(travelAt.getTime()) && travelAt.getTime() <= now.getTime()) {
    return "already_travelled";
  }

  // Y por último la política, que es la que un gerente puede levantar.
  if (travelAt && hoursBetween(now, travelAt) < cutoffHours) return "cutoff";
  if ((booking.reschedule_count ?? 0) >= MAX_RESCHEDULES) return "too_many";

  return null;
}

/** ¿Este bloqueo lo puede levantar un gerente? */
export function isForceable(block: RescheduleBlock): boolean {
  return FORCEABLE_RESCHEDULE_BLOCKS.includes(block);
}

/**
 * Lo que se escribe en la reserva al moverla.
 *
 * El número de reserva y el código del voucher NO están aquí a propósito: el
 * cliente tiene ese papel en la mano y el documento se genera con la fecha
 * nueva cuando se imprime, así que cambiarle el código solo conseguiría que el
 * voucher que ya tiene deje de servir.
 */
export interface ReschedulePatch {
  /** El patch va tal cual a `tenantUpdate`, que espera un registro abierto. */
  [field: string]: string | number | null;
  departure: string;
  travel_date: string;
  previous_departure: string | null;
  rescheduled_at: string;
  reschedule_reason: string;
  reschedule_count: number;
}

export function reschedulePatch(
  booking: BookingForReschedule,
  target: TargetForReschedule,
  reason: string,
  now: Date = new Date()
): ReschedulePatch {
  return {
    departure: String(target.id),
    travel_date: String(target.departure_at),
    previous_departure: booking.departureId || null,
    rescheduled_at: now.toISOString(),
    reschedule_reason: reason.trim(),
    reschedule_count: (booking.reschedule_count ?? 0) + 1,
  };
}
