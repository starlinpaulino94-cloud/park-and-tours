import { NextRequest } from "next/server";
import { requireTenant, tenantFindOne, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { TenantError } from "@/lib/tenant";
import {
  manifestRow, sortByRoute, pickupStops, paxSummary, manifestAlerts, closeBlocker,
  closeTotals, personName, DEAD_BOOKING_STATUSES, CLOSE_BLOCK_MESSAGE,
  type ManifestBookingInput,
} from "@/lib/manifest";
import { refId } from "@/lib/types";

/**
 * GET /api/departures/:id/manifest — el papel sin el cual la excursión no sale.
 *
 * El despacho contaba cuántos pax llevaba cada salida; quiénes eran, dónde se
 * les recoge, a qué hora, qué necesitan y cuánto deben no estaba en ninguna
 * pantalla. Los datos existían —reservas, acompañantes, recogidas, vehículos,
 * guías— repartidos en cinco tablas que nadie juntaba, así que la operación se
 * seguía llevando en una hoja aparte.
 *
 * Se arma en una sola llamada porque el guía lo abre en el móvil, a veces con
 * mala cobertura, y porque es lo que se imprime.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "departures:manifest", ctx.userId), limit: 120, windowMs: 60_000 });
    // Un partner ve el manifiesto de toda la salida, incluidas las reservas de
    // la competencia: es una lista de clientes ajenos.
    if (ctx.role === "partner") throw new TenantError("El manifiesto es de uso interno", 403);

    const departure = await tenantFindOne<Record<string, unknown>>(ctx.companyId, "departure", id, {
      product: true, branch: true,
      departure_resource: { _limit: 60, vehicle: true, staff: true },
      pickup_route: { _limit: 40, vehicle: true, driver: true, guide: true, zone: true },
    });

    const bookings = await tenantQuery<ManifestBookingInput>(ctx.companyId, "booking", {
      _filter: { departure: id },
      _limit: 500,
      _sort: { createdAt: "asc" },
      // La zona del hotel va anidada a propósito: es lo que agrupa las paradas
      // de la hoja de ruta. Con `pickup_hotel: true` a secas llegaba el hotel
      // pero su zona seguía siendo un uuid, y la hoja salía sin zonas.
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
      .map((r) => ({
        ...(r.staff as Record<string, unknown>),
        resource_role: r.resource_role,
      }));
    const guides = staff.filter(
      (s) => s.resource_role === "guide" || s.staff_type === "guide"
    );
    const vehicleSeats = vehicles.reduce((s, v) => s + (Number(v.capacity) || 0), 0);

    const product = departure.product as Record<string, unknown> | undefined;
    const summary = paxSummary(rows);
    const alerts = manifestAlerts(rows, {
      capacity: Number(departure.capacity) || 0,
      vehicleSeats,
      vehicles: vehicles.length,
      guides: guides.length,
      meetingPoint: (departure.meeting_point as string) || (product?.meeting_point as string) || null,
    });

    const blocker = closeBlocker(departure as never, rows);

    return ok({
      departure: {
        _id: id,
        departure_at: departure.departure_at,
        status: departure.status,
        capacity: departure.capacity ?? 0,
        meeting_point: departure.meeting_point || product?.meeting_point || null,
        notes: departure.notes ?? null,
        closed_at: departure.closed_at ?? null,
        departed_at: departure.departed_at ?? null,
        actual_pax: departure.actual_pax ?? null,
        no_show_pax: departure.no_show_pax ?? null,
        incident_notes: departure.incident_notes ?? null,
        guide_notes: departure.guide_notes ?? null,
        product: product ? { _id: product._id, name: product.name, duration_hours: product.duration_hours } : null,
        branch: departure.branch && typeof departure.branch === "object"
          ? { name: (departure.branch as Record<string, unknown>).name } : null,
      },
      vehicles: vehicles.map((v) => ({
        _id: v._id, name: v.name, plate: v.plate, capacity: v.capacity ?? 0, vehicle_type: v.vehicle_type,
      })),
      staff: staff.map((s) => ({
        _id: s._id, name: personName(s), role: s.resource_role || s.staff_type,
        phone: s.phone ?? null, languages: s.languages ?? null,
      })),
      routes: ((departure.pickup_route as Record<string, unknown>[]) || []).map((r) => ({
        _id: r._id, name: r.name, start_time: r.start_time, status: r.status,
        zone: r.zone && typeof r.zone === "object" ? (r.zone as Record<string, unknown>).name : null,
        driver: personName(r.driver), guide: personName(r.guide),
        vehicle: r.vehicle && typeof r.vehicle === "object" ? (r.vehicle as Record<string, unknown>).plate : null,
      })),
      vehicle_seats: vehicleSeats,
      rows,
      stops: pickupStops(rows),
      summary,
      alerts,
      close: {
        blocker,
        message: blocker ? CLOSE_BLOCK_MESSAGE[blocker] : null,
        totals: closeTotals(rows),
      },
      excluded: bookings.length - travelling.length,
      generated_at: new Date().toISOString(),
      generated_by: ctx.name || ctx.email,
    });
  } catch (err) {
    return fail(err);
  }
}
