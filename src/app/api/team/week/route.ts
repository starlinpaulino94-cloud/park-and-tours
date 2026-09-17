import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { teamWeek } from "@/lib/hr-service";

/**
 * GET /api/team/week?date=YYYY-MM-DD — la semana del equipo de un vistazo.
 *
 * Quién cubre cuántas horas, a quién no se le puede asignar nada y a quién se
 * le vence algo. Lo mira el encargado antes de publicar, que es el momento en
 * el que todavía se puede cambiar.
 *
 * Es rango de gestión: las horas y las acreditaciones de los compañeros no son
 * dato de operación diaria.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "team:week", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const date = req.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    return ok(await teamWeek(ctx.companyId, date));
  } catch (err) {
    return fail(err);
  }
}
