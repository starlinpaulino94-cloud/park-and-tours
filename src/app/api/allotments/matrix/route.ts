import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { partnerMatrix } from "@/lib/allotment-service";

/**
 * GET /api/allotments/matrix?partner=&from=&days=&product=
 *
 * El cupo de un socio día a día. Una lista de filas no responde a la pregunta
 * que se hace el comercial —«¿qué le queda a esta agencia la semana que
 * viene?»—: eso se ve en una rejilla.
 */
const MAX_DAYS = 60;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "allotments:matrix", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const sp = req.nextUrl.searchParams;
    const partnerId = String(sp.get("partner") || "").trim();
    if (!partnerId) throw new TenantError("Indica el socio.", 400);

    const from = String(sp.get("from") || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new TenantError("La fecha inicial debe ser AAAA-MM-DD.", 400);

    const days = Math.min(Math.max(Number(sp.get("days") || 14), 1), MAX_DAYS);
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(`${from}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const cells = await partnerMatrix(ctx.companyId, partnerId, dates, sp.get("product"));
    return ok({ partnerId, from, days, cells });
  } catch (err) {
    return fail(err);
  }
}
