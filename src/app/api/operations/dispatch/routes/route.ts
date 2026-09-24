import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, TenantError, esInterno } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { buildDayRoutes } from "@/lib/dispatch-service";

/**
 * POST /api/operations/dispatch/routes — arma las rutas de recogida.
 *
 * Agrupa las recogidas de la salida por zona, las ordena por hora y las parte
 * cuando no caben en el vehículo. Es repetible a propósito: a media mañana
 * entran reservas nuevas y hay que rehacerlo sin duplicar rutas ni borrar el
 * conductor que alguien asignó a mano.
 *
 * Queda auditado porque mueve a gente: cambia por qué ruta y a qué hora pasa el
 * transporte a buscar a un cliente.
 *
 * Y por eso mismo exige RANGO, que es lo que le faltaba: rehacer las rutas del
 * día cambia a qué hora pasan a buscar a cada cliente y con qué chofer. Con
 * solo la sesión, cualquiera con cuenta en la empresa —un vendedor, un
 * proveedor— podía reorganizarle la mañana a la operación.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    if (!esInterno(ctx)) throw new TenantError("No tienes acceso a este recurso", 403);
    requireAtLeast(ctx, "operations");
    await assertRateLimit({
      key: rateLimitKey(req, "dispatch:routes", ctx.userId),
      limit: 30, windowMs: 60_000,
    });

    const body = await readJson<{ departure_id?: string; departure_ids?: string[] }>(req);
    const ids = body.departure_ids?.length
      ? body.departure_ids
      : body.departure_id
        ? [body.departure_id]
        : [];

    if (ids.length === 0) {
      throw Object.assign(new Error("Falta la salida cuyas rutas hay que armar"), { status: 400 });
    }
    if (ids.length > 50) {
      throw Object.assign(new Error("Demasiadas salidas de una vez; arma el día en tandas"), { status: 400 });
    }

    const results = [];
    for (const id of ids) results.push(await buildDayRoutes(ctx, id));

    const totals = results.reduce(
      (acc, r) => ({
        routes: acc.routes + r.routes.length,
        created: acc.created + r.created,
        updated: acc.updated + r.updated,
        stops: acc.stops + r.stopsAssigned,
      }),
      { routes: 0, created: 0, updated: 0, stops: 0 }
    );

    await writeAudit({
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: "dispatch.routes.build",
      entityType: "pickup_route",
      entityId: ids.join(","),
      description:
        `Rutas armadas para ${ids.length} salida(s): ${totals.created} nuevas, ` +
        `${totals.updated} actualizadas, ${totals.stops} paradas`,
      metadata: { departure_ids: ids, warnings: results.flatMap((r) => r.warnings).slice(0, 20) },
    });

    return ok({ results, totals, warnings: results.flatMap((r) => r.warnings) });
  } catch (err) {
    return fail(err);
  }
}
