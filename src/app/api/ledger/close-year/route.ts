import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertModule } from "@/lib/plan-service";
import { closeYear } from "@/lib/financials-service";

/**
 * POST /api/ledger/close-year — llevar el resultado del ejercicio a acumulados.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CUENTA QUE NADIE USABA
 *
 * `3201 Resultados acumulados` está en el plan de cuentas desde que existe el
 * mayor y NADA escribía nunca en ella. Sin el asiento de cierre, los ingresos y
 * los gastos de un año siguen ahí el año siguiente: el estado de resultados del
 * segundo ejercicio incluye el primero, y el balance general no cuadra jamás.
 *
 * Es un asiento de verdad, no una bandera: queda en el mayor, se puede ver y se
 * puede reversar como cualquier otro. Una bandera obligaría a cada informe a
 * recordar excluir el año anterior, y alguno se olvidaría.
 *
 * No se repite: un segundo cierre del mismo ejercicio duplicaría el resultado
 * en acumulados y el balance dejaría de cuadrar para siempre.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "ledger:close-year", ctx.userId), limit: 5, windowMs: 60_000 });
    requireAtLeast(ctx, "admin");
    assertModule(ctx, "accounting");

    const body = await readJson<{ year?: string }>(req);
    const result = await closeYear(ctx.companyId, ctx.userId, String(body.year || ""));

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "year_closed", entityType: "ledger_entry", entityId: null,
      description: `Ejercicio ${result.year} cerrado con ${result.entryCode}: ${result.lines} líneas por ${result.total}`,
      severity: "warning",
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
