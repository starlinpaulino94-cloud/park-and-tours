import { NextRequest } from "next/server";
import { requireTenant } from "@/lib/tenant";
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
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    return ok(await loadDispatch(ctx, req.nextUrl.searchParams.get("date")));
  } catch (err) {
    return fail(err);
  }
}
