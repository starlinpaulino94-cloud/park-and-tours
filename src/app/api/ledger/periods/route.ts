import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertModule } from "@/lib/plan-service";
import { periods, movePeriod } from "@/lib/financials-service";
import type { PeriodAction } from "@/lib/financials";

/**
 * Los periodos contables: cerrarlos, reabrirlos y darlos por declarados.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA
 *
 * El mayor aceptaba cualquier asiento con cualquier fecha. El 607 se envía el
 * día 20 y nada impedía registrar un pago con fecha del mes anterior: a partir
 * de ahí lo declarado y los libros dicen cosas distintas, y la diferencia solo
 * aparece cuando la DGII cruza los comprobantes.
 *
 * Cerrar es del CONTADOR (rol de administración) y se puede deshacer. Darlo por
 * declarado no se deshace desde aquí: corregir un mes ya enviado es una
 * rectificativa ante la DGII, que es una conversación, no un botón.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "ledger:periods", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");
    return ok(await periods(ctx.companyId));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "ledger:periods:move", ctx.userId), limit: 20, windowMs: 60_000 });
    requireAtLeast(ctx, "admin");
    assertModule(ctx, "accounting");

    const body = await readJson<{ period?: string; action?: string }>(req);
    const action = body.action;
    if (action !== "close" && action !== "reopen" && action !== "lock") {
      throw new TenantError("Acción no reconocida: cerrar, reabrir o declarar.", 400);
    }

    const result = await movePeriod(ctx.companyId, ctx.userId, String(body.period || ""), action as PeriodAction);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: `period_${result.status}`, entityType: "accounting_period", entityId: null,
      description:
        `Periodo ${result.period} → ${result.status}` +
        (result.totals ? ` (resultado ${result.totals.netIncome})` : ""),
      // Reabrir un periodo cerrado es de las cosas que hay que poder encontrar
      // después: alguien deshizo una revisión que ya estaba aprobada.
      severity: action === "reopen" ? "warning" : "info",
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
