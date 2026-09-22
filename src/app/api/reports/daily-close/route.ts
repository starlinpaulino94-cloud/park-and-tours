import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { cierreDelDia } from "@/lib/cierre-dia-service";

/**
 * GET /api/reports/daily-close?date=AAAA-MM-DD
 *
 * El cierre de la jornada: qué operó, qué se vendió, qué entró y si la caja
 * cuadra. El cálculo vive en `cierre-dia-service.ts` sobre el dominio puro de
 * `cierre-dia.ts`; aquí solo quedan la sesión, el permiso y el código.
 *
 * Es una LECTURA, así que no audita: abrir el cierre del martes para mirarlo no
 * es una acción sobre el negocio, y anotar cada apertura llenaría la bitácora
 * de ruido que tapa lo que sí importa.
 *
 * Pide `operations` y no `manager`: el cierre del día lo firma quien estuvo en
 * la jornada, no solo la gerencia. Pero lleva el dinero cobrado y el cuadre de
 * caja, así que un vendedor no lo ve.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "reports:daily-close", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "operations");
    return ok(await cierreDelDia(ctx, req.nextUrl.searchParams.get("date")));
  } catch (err) {
    return fail(err);
  }
}
