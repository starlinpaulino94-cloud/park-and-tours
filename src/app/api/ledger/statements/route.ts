import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { statements } from "@/lib/financials-service";
import { isPeriod, trialBalanceCsv } from "@/lib/financials";

/**
 * GET /api/ledger/statements?from=AAAA-MM&to=AAAA-MM[&format=csv]
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE HABÍA Y LO QUE FALTABA
 *
 * El sistema solo tenía balance de comprobación, que es una herramienta de
 * contable para ver si los libros cuadran. El dueño de la operadora no pregunta
 * «¿cuadra el mayor?»: pregunta cuánto ganó el mes y qué tiene. Eso son el
 * estado de resultados y el balance general, y no existían.
 *
 * Es una LECTURA —`requireTenant`—: una empresa con la suscripción vencida
 * sigue teniendo que cerrar su contabilidad, y no poder sacar su estado de
 * resultados por no haber pagado el software convertiría un problema de cobro
 * en un incumplimiento.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "ledger:statements", ctx.userId), limit: 30, windowMs: 60_000 });
    // Los estados financieros de la empresa no son para cualquiera.
    requireAtLeast(ctx, "manager");

    const sp = req.nextUrl.searchParams;
    const to = String(sp.get("to") || new Date().toISOString().slice(0, 7));
    const from = String(sp.get("from") || to);
    if (!isPeriod(from) || !isPeriod(to)) {
      throw new TenantError("Indica el rango como AAAA-MM.", 400);
    }
    if (from > to) throw new TenantError("El periodo inicial es posterior al final.", 400);

    const result = await statements(ctx.companyId, from, to);

    if (sp.get("format") !== "csv") return ok(result);

    // Se registra: es la foto contable de la empresa, y meses después alguien
    // va a preguntar quién se llevó la de septiembre.
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "statements_exported", entityType: "company", entityId: ctx.companyId,
      description: `Balance de comprobación exportado (${from} — ${to})`,
      severity: "info",
    });

    const csv = trialBalanceCsv(result.trialBalance);
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="balance-${from}-${to}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return fail(err);
  }
}
