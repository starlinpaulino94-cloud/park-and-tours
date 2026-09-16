import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertModule } from "@/lib/plan-service";
import { dgiiReport, dgiiFile, type DgiiKind } from "@/lib/dgii-service";
import { writeAudit } from "@/lib/audit";

/**
 * GET /api/reports/dgii?kind=606|607&month=AAAA-MM[&format=txt]
 *
 * El informe del mes para la pantalla, o el archivo listo para subir a la DGII.
 *
 * Es una LECTURA —`requireTenant`, no `requireTenantWrite`—: una empresa con la
 * suscripción vencida sigue teniendo que declarar sus impuestos, y no poder
 * sacar su 606 por no haber pagado el software sería convertir un problema de
 * cobro en un incumplimiento fiscal.
 */
const KINDS: DgiiKind[] = ["606", "607"];

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "reports:dgii", ctx.userId), limit: 30, windowMs: 60_000 });
    // Los números fiscales de la empresa no son para cualquiera.
    requireAtLeast(ctx, "manager");
    assertModule(ctx, "accounting");

    const sp = req.nextUrl.searchParams;
    const kind = String(sp.get("kind") || "607") as DgiiKind;
    if (!KINDS.includes(kind)) throw new TenantError("Formato desconocido: usa 606 o 607", 400);

    const month = String(sp.get("month") || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new TenantError("Indica el mes como AAAA-MM", 400);

    const report = await dgiiReport(ctx, kind, month);

    if (sp.get("format") !== "txt") return ok(report);

    // El RNC de quien declara: sin él, el archivo no identifica a nadie.
    const rnc = String((ctx.company as { tax_id?: string } | null)?.tax_id || "");
    if (!rnc) {
      throw new TenantError(
        "Tu empresa no tiene RNC registrado. Ponlo en Configuración antes de generar la declaración.",
        409
      );
    }

    const file = dgiiFile(report, rnc);

    // Queda en la bitácora: es un documento que se envía a la autoridad fiscal,
    // y meses después alguien va a preguntar quién generó el de septiembre.
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "dgii_report_generated",
      entityType: "company", entityId: ctx.companyId,
      description: `Declaración ${kind} de ${month}: ${report.totals.rows} línea(s), ${report.excluded} fuera`,
      severity: "info",
      metadata: { kind, month, rows: report.totals.rows, excluded: report.excluded },
    });

    return new NextResponse(file.content, {
      headers: {
        // Texto plano y ASCII: es lo que la herramienta de la DGII espera.
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.name}"`,
        "Cache-Control": "no-store, private",
      },
    });
  } catch (err) {
    return fail(err);
  }
}
