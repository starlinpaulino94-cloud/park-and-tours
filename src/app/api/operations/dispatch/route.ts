import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError, esInterno } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { loadDispatch } from "@/lib/dispatch-service";

/**
 * GET /api/operations/dispatch?date=YYYY-MM-DD
 *
 * Todo lo que la mesa de operaciones necesita para un día: salidas, pax,
 * vehículos, guías, hoteles y los choques REALES de recursos.
 *
 * El cálculo vive en `dispatch-service.ts` sobre el dominio puro de
 * `dispatch.ts`. Aquí solo quedan la sesión, el permiso y el código de
 * respuesta: cuando estaba todo junto no había forma de probar que una guagua
 * en el tour de las 8 y en el de las 2 no es un conflicto, y durante meses se
 * marcó en rojo todas las mañanas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EXIGÍA SESIÓN Y NADA MÁS, Y DEVUELVE EL DÍA ENTERO CON SUS CLIENTES
 *
 * `loadDispatch` expande las reservas con su cliente y su hotel. Mientras los
 * únicos con sesión eran empleados eso era un permiso que faltaba; desde 0084
 * hay proveedores con cuenta y desde 0073 tour centers, así que era la
 * operación completa del día —con nombres y hoteles— a una petición de
 * distancia.
 *
 * El despacho es de la casa: no se acota, se CIERRA. Un proveedor ve lo suyo
 * por su portal, y un socio no tiene nada que hacer aquí.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    if (!esInterno(ctx)) throw new TenantError("No tienes acceso a este recurso", 403);
    requireAtLeast(ctx, "operations");
    return ok(await loadDispatch(ctx, req.nextUrl.searchParams.get("date")));
  } catch (err) {
    return fail(err);
  }
}
