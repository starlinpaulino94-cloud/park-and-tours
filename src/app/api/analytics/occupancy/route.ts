import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { occupancyReport } from "@/lib/analytics-service";

/**
 * GET /api/analytics/occupancy?horizon=60 — ¿va a salir llena?
 *
 * Devuelve la previsión de cada salida futura y las alertas que de verdad
 * llevan a una acción hoy. También el tamaño de la muestra de la que se aprendió
 * la curva: sin ese número, una previsión de una operadora recién estrenada
 * tendría el mismo aspecto que una con tres años de historia.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");
    await assertRateLimit({ key: rateLimitKey(req, "analytics:occupancy", ctx.userId), limit: 20, windowMs: 60_000 });

    const horizonDays = Number(new URL(req.url).searchParams.get("horizon") ?? 60);
    return ok(await occupancyReport({ companyId: ctx.companyId, horizonDays }));
  } catch (err) {
    return fail(err);
  }
}
