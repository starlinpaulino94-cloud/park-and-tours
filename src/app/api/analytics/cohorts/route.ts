import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { cohortReport } from "@/lib/analytics-service";

/**
 * GET /api/analytics/cohorts?months=12 — ¿vuelven los clientes?
 *
 * Es una LECTURA: `requireTenant`. Una suscripción vencida no puede impedirle a
 * nadie mirar su propio historial — es justo cuando más falta hace saber si el
 * negocio retiene.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");
    await assertRateLimit({ key: rateLimitKey(req, "analytics:cohorts", ctx.userId), limit: 20, windowMs: 60_000 });

    const months = Number(new URL(req.url).searchParams.get("months") ?? 12);
    return ok(await cohortReport({ companyId: ctx.companyId, months }));
  } catch (err) {
    return fail(err);
  }
}
