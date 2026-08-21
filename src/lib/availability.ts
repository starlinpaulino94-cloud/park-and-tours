import "server-only";
import { tenantQuery, tenantUpdate } from "@/lib/tenant";
import type { Departure, DepartureStatus } from "@/lib/types";

/**
 * Availability engine — the single guard against overselling.
 *
 * Confirmed + pending passengers are recomputed from the bookings themselves so
 * the counters can never silently drift out of sync with reality.
 */

const ACTIVE_STATUSES = [
  "pending", "pending_payment", "confirmed", "partially_paid",
  "paid", "checked_in", "completed",
];
const CONFIRMED_STATUSES = ["confirmed", "partially_paid", "paid", "checked_in", "completed"];
const PENDING_STATUSES = ["pending", "pending_payment"];

export interface AvailabilityState {
  departureId: string;
  capacity: number;
  bookedPax: number;
  pendingPax: number;
  availablePax: number;
  status: DepartureStatus;
  departureAt: string | null;
  cutoffHours: number;
}

export class OversellError extends Error {
  constructor(readonly available: number, readonly requested: number) {
    super(
      `Cupo insuficiente: quedan ${available} plazas y se solicitaron ${requested}. ` +
        `Un usuario autorizado puede forzar la reserva dejando registro de auditoría.`
    );
    this.name = "OversellError";
  }
}

function deriveStatus(capacity: number, booked: number, current?: DepartureStatus): DepartureStatus {
  if (current === "cancelled" || current === "closed" || current === "completed") return current;
  if (capacity <= 0) return "available";
  const ratio = booked / capacity;
  if (booked >= capacity) return "full";
  if (ratio >= 0.85) return "almost_full";
  return "available";
}

/** Recomputes a departure's occupancy from its bookings and persists the counters. */
export async function recalculateDeparture(
  companyId: string,
  departureId: string
): Promise<AvailabilityState> {
  const [departures, bookings] = await Promise.all([
    tenantQuery<Departure>(companyId, "departure", { _filter: { _id: departureId }, _limit: 1 }),
    tenantQuery<{ status?: string; pax_total?: number }>(companyId, "booking", {
      _filter: { departure: departureId, status: { in: ACTIVE_STATUSES } },
      _limit: 1000,
    }),
  ]);

  const departure = departures[0] ?? null;
  if (!departure) throw new Error("Salida no encontrada");

  let bookedPax = 0;
  let pendingPax = 0;
  for (const b of bookings) {
    const pax = b.pax_total ?? 0;
    if (CONFIRMED_STATUSES.includes(b.status || "")) bookedPax += pax;
    else if (PENDING_STATUSES.includes(b.status || "")) pendingPax += pax;
  }

  const capacity = departure.capacity ?? 0;
  const availablePax = Math.max(0, capacity - bookedPax - pendingPax);
  const status = deriveStatus(capacity, bookedPax + pendingPax, departure.status);

  await tenantUpdate(companyId, "departure", departureId, {
    booked_pax: bookedPax,
    pending_pax: pendingPax,
    available_pax: availablePax,
    status,
  });

  console.log(
    `[Availability] salida ${departureId}: cap=${capacity} conf=${bookedPax} pend=${pendingPax} libre=${availablePax} (${status})`
  );

  return {
    departureId, capacity, bookedPax, pendingPax, availablePax, status,
    departureAt: departure.departure_at ?? null,
    cutoffHours: departure.cutoff_hours ?? 0,
  };
}

/**
 * Verifies there is room for `pax` on the departure.
 * Throws `OversellError` unless `override` is true (which must be audited by the caller).
 */
export async function assertCapacity(
  companyId: string,
  departureId: string,
  pax: number,
  override = false
): Promise<AvailabilityState> {
  const state = await recalculateDeparture(companyId, departureId);

  if (state.status === "cancelled") throw new Error("La salida está cancelada");
  if (state.status === "closed" && !override) throw new Error("La salida está cerrada para nuevas reservas");
  if (state.status === "completed" && !override) throw new Error("La salida ya se realizó");

  // AUD-B07: reject sales on departures that have already left or are inside
  // their booking cutoff window. Previously `cutoff_hours` was stored but never
  // evaluated, so the sales-close time was purely decorative.
  if (!override && state.departureAt) {
    const departAt = new Date(state.departureAt).getTime();
    if (Number.isFinite(departAt)) {
      const cutoffMs = (state.cutoffHours ?? 0) * 3_600_000;
      if (departAt - cutoffMs <= Date.now()) {
        throw new Error(
          state.cutoffHours > 0
            ? `La salida está cerrada para reservas (cierre ${state.cutoffHours} h antes)`
            : "La salida ya no admite reservas"
        );
      }
    }
  }

  if (state.capacity > 0 && pax > state.availablePax && !override) {
    console.warn(`[Availability] intento de sobreventa en ${departureId}: ${pax} > ${state.availablePax}`);
    throw new OversellError(state.availablePax, pax);
  }
  return state;
}
