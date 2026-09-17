import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertModule } from "@/lib/plan-service";
import { generatePayrollRun } from "@/lib/hr-service";

/**
 * POST /api/payroll/:id/generate — calcular la corrida.
 *
 * Recoge los marcajes del periodo que nadie ha pagado, agrupa por persona,
 * aplica el reparto semanal de horas extra y escribe una línea por cada una.
 * Se puede repetir mientras la corrida esté en borrador: lo que ya reclamó no
 * lo vuelve a coger, así que un segundo intento añade lo nuevo en vez de pagar
 * dos veces lo mismo.
 *
 * Es rango de administración: la nómina es el dato más sensible que guarda una
 * empresa pequeña.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "payroll:generate", ctx.userId), limit: 10, windowMs: 60_000 });
    requireAtLeast(ctx, "admin");
    assertModule(ctx, "accounting");

    const result = await generatePayrollRun(ctx.companyId, ctx.userId, id);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "payroll_generated", entityType: "payroll_run", entityId: id,
      description:
        `Nómina calculada: ${result.totals.staffCount} personas, neto ${result.totals.net}` +
        (result.skipped.length ? ` · ${result.skipped.length} sin tarifa` : ""),
      severity: result.skipped.length > 0 ? "warning" : "info",
    });

    return ok(result);
  } catch (err) {
    return fail(err);
  }
}
