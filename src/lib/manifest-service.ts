import "server-only";
import { tenantFindOne, tenantQuery } from "@/lib/tenant";
import {
  manifestRow, sortByRoute, pickupStops, paxSummary, manifestAlerts, closeBlocker,
  closeTotals, personName, DEAD_BOOKING_STATUSES, CLOSE_BLOCK_MESSAGE,
  type ManifestBookingInput, type ManifestRow, type PickupStop, type PaxSummary, type ManifestAlert,
} from "@/lib/manifest";

/**
 * El armado del manifiesto, en un solo sitio.
 *
 * Lo piden dos rutas —la pantalla y el PDF que el guía se lleva impreso— y las
 * dos tienen que decir exactamente lo mismo. Con la consulta duplicada bastaba
 * con que una olvidara excluir las reservas canceladas para que el papel y la
 * pantalla dieran cuentas distintas de la misma salida.
 */

export interface ManifestPayload {
  departure: Record<string, unknown> & { _id: string };
  product: Record<string, unknown> | null;
  vehicles: Record<string, unknown>[];
  staff: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  vehicleSeats: number;
  rows: ManifestRow[];
  stops: PickupStop[];
  summary: PaxSummary;
  alerts: ManifestAlert[];
  close: { blocker: string | null; message: string | null; totals: ReturnType<typeof closeTotals> };
  excluded: number;
}

export async function loadManifest(companyId: string, departureId: string): Promise<ManifestPayload> {
  const departure = await tenantFindOne<Record<string, unknown>>(companyId, "departure", departureId, {
    product: true, branch: true,
    departure_resource: { _limit: 60, vehicle: true, staff: true },
    pickup_route: { _limit: 40, vehicle: true, driver: true, guide: true, zone: true },
  });

  const bookings = await tenantQuery<ManifestBookingInput>(companyId, "booking", {
    _filter: { departure: departureId },
    _limit: 500,
    _sort: { createdAt: "asc" },
    // La zona del hotel va anidada: es lo que agrupa las paradas de la ruta.
    customer: true, pickup_hotel: { zone: true }, partner: true, seller: true,
    participant: { _limit: 200 },
  });

  // Una reserva cancelada o reembolsada no viaja: dejarla en la lista hace que
  // el guía cuente cabezas que no existen y que el cupo parezca lleno.
  const travelling = bookings.filter((b) => !DEAD_BOOKING_STATUSES.has(String(b.status || "")));
  const rows = sortByRoute(travelling.map(manifestRow));

  const resources = (departure.departure_resource as Record<string, unknown>[]) || [];
  const vehicles = resources
    .map((r) => r.vehicle)
    .filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object"));
  const staff: Record<string, unknown>[] = resources
    .filter((r) => r.staff && typeof r.staff === "object")
    .map((r) => ({ ...(r.staff as Record<string, unknown>), resource_role: r.resource_role }));
  const guides = staff.filter((s) => s.resource_role === "guide" || s.staff_type === "guide");
  const vehicleSeats = vehicles.reduce((s, v) => s + (Number(v.capacity) || 0), 0);

  const product = (departure.product as Record<string, unknown>) || null;
  const blocker = closeBlocker(departure as never, rows);

  return {
    departure: { ...departure, _id: departureId },
    product,
    vehicles,
    staff,
    routes: (departure.pickup_route as Record<string, unknown>[]) || [],
    vehicleSeats,
    rows,
    stops: pickupStops(rows),
    summary: paxSummary(rows),
    alerts: manifestAlerts(rows, {
      capacity: Number(departure.capacity) || 0,
      vehicleSeats,
      vehicles: vehicles.length,
      guides: guides.length,
      meetingPoint: (departure.meeting_point as string) || (product?.meeting_point as string) || null,
    }),
    close: {
      blocker,
      message: blocker ? CLOSE_BLOCK_MESSAGE[blocker] : null,
      totals: closeTotals(rows),
    },
    excluded: bookings.length - travelling.length,
  };
}

/** Nombre presentable de una persona relacionada, reexportado por comodidad. */
export { personName };
