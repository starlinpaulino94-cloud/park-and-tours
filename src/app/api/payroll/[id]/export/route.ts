import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne } from "@/lib/tenant";
import { fail } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { payrollCsv } from "@/lib/hr";
import { linesOf } from "@/lib/hr-service";

/**
 * GET /api/payroll/:id/export — el archivo que se le manda al contador.
 *
 * Sale de las líneas GUARDADAS, no de un recálculo: lo que se exporta tiene que
 * ser exactamente lo que se aprobó. Recalcular al exportar haría que el archivo
 * cambiara si alguien tocó un marcaje después, y esa diferencia no la vería
 * nadie hasta el trimestre siguiente.
 *
 * La descarga se registra en auditoría. Es la lista de sueldos de toda la
 * empresa: quién se la llevó y cuándo es parte de saber quién la tiene.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "payroll:export", ctx.userId), limit: 20, windowMs: 60_000 });
    requireAtLeast(ctx, "admin");

    const run = await tenantFindOne<Record<string, unknown>>(ctx.companyId, "payroll_run", id);
    const lines = await linesOf(ctx.companyId, id);
    const csv = payrollCsv(lines);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "payroll_exported", entityType: "payroll_run", entityId: id,
      description: `Nómina exportada (${lines.length} personas)`, severity: "info",
    });

    const nombre = `nomina-${String(run.period_start || "").slice(0, 10)}-${String(run.period_end || "").slice(0, 10)}.csv`;
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        // El BOM va delante para que Excel en español abra el archivo con los
        // acentos bien en vez de con caracteres rotos.
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${nombre}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return fail(err);
  }
}
