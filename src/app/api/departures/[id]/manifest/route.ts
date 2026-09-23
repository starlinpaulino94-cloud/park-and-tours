import { NextRequest } from "next/server";
import { requireTenant, TenantError, esDeSocio } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadManifest, personName } from "@/lib/manifest-service";

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
 * mala cobertura, y porque es lo que se imprime. El armado vive en
 * `manifest-service` para que esta ruta y el PDF digan exactamente lo mismo.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "departures:manifest", ctx.userId), limit: 120, windowMs: 60_000 });
    // Un partner vería el manifiesto de toda la salida, incluidas las reservas
    // de la competencia: es una lista de clientes ajenos.
    if (esDeSocio(ctx)) throw new TenantError("El manifiesto es de uso interno", 403);

    const m = await loadManifest(ctx.companyId, id);
    const dep = m.departure;
    const product = m.product;

    return ok({
      departure: {
        _id: id,
        departure_at: dep.departure_at,
        status: dep.status,
        capacity: dep.capacity ?? 0,
        meeting_point: dep.meeting_point || product?.meeting_point || null,
        notes: dep.notes ?? null,
        closed_at: dep.closed_at ?? null,
        departed_at: dep.departed_at ?? null,
        actual_pax: dep.actual_pax ?? null,
        no_show_pax: dep.no_show_pax ?? null,
        incident_notes: dep.incident_notes ?? null,
        guide_notes: dep.guide_notes ?? null,
        product: product ? { _id: product._id, name: product.name, duration_hours: product.duration_hours } : null,
        branch: dep.branch && typeof dep.branch === "object"
          ? { name: (dep.branch as Record<string, unknown>).name } : null,
      },
      vehicles: m.vehicles.map((v) => ({
        _id: v._id, name: v.name, plate: v.plate, capacity: v.capacity ?? 0, vehicle_type: v.vehicle_type,
      })),
      staff: m.staff.map((s) => ({
        _id: s._id, name: personName(s), role: s.resource_role || s.staff_type,
        phone: s.phone ?? null, languages: s.languages ?? null,
      })),
      routes: m.routes.map((r) => ({
        _id: r._id, name: r.name, start_time: r.start_time, status: r.status,
        zone: r.zone && typeof r.zone === "object" ? (r.zone as Record<string, unknown>).name : null,
        driver: personName(r.driver), guide: personName(r.guide),
        vehicle: r.vehicle && typeof r.vehicle === "object" ? (r.vehicle as Record<string, unknown>).plate : null,
      })),
      vehicle_seats: m.vehicleSeats,
      rows: m.rows,
      stops: m.stops,
      summary: m.summary,
      alerts: m.alerts,
      close: m.close,
      excluded: m.excluded,
      generated_at: new Date().toISOString(),
      generated_by: ctx.name || ctx.email,
    });
  } catch (err) {
    return fail(err);
  }
}
