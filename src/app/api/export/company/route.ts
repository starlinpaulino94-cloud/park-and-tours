import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireAtLeast } from "@/lib/tenant";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { buildCompanyExport, ROWS_PER_TABLE } from "@/lib/company-export-service";
import { companyExportPlan } from "@/lib/company-export";
import { writeAudit } from "@/lib/audit";

/**
 * GET /api/export/company — «llévate tus datos»: la empresa entera en un ZIP.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES UNA LECTURA, Y NO SE BLOQUEA POR PLAN
 *
 * `requireTenant`, no `requireTenantWrite`, por la misma razón que la
 * exportación de cada listado: una empresa con la suscripción vencida conserva
 * «consultar y exportar». Es justo cuando deja de pagar cuando más necesita
 * poder sacar lo suyo, y negárselo ahí convertiría el plan en un rehén.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PIDE ROL DE ADMINISTRADOR, Y QUEDA REGISTRADO
 *
 * Un archivo con las ochenta y ocho tablas de la empresa es, visto de otro
 * modo, la copia completa del negocio: la cartera de clientes, los precios, las
 * comisiones de cada partner y la contabilidad. Un vendedor no lo descarga. Y
 * quien lo descarga deja rastro en la bitácora con severidad crítica, porque
 * este es exactamente el movimiento que alguien querría poder revisar después.
 *
 * El límite de peticiones es bajo a propósito (tres por hora): cada llamada
 * recorre ochenta y ocho tablas, así que también protege al sistema de que una
 * pantalla con un bucle lo use como ametralladora.
 */

/** El volcado recorre 88 tablas: necesita más que el tiempo de una consulta. */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "admin");
    await assertRateLimit({ key: rateLimitKey(req, "export:company", ctx.userId), limit: 3, windowMs: 3_600_000 });

    const companyName = ctx.company?.name || ctx.company?.legal_name || "empresa";
    const exportado = await buildCompanyExport(ctx, companyName);

    await writeAudit({
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: "company_data_exported",
      entityType: "company",
      entityId: ctx.companyId,
      description:
        `Exportación completa de la empresa: ${exportado.total} registro(s) en ` +
        `${exportado.rows.filter((r) => r.rows > 0).length} archivo(s)`,
      severity: "critical",
      metadata: {
        total: exportado.total,
        tables: companyExportPlan().length,
        truncated: exportado.truncated,
        rowLimit: ROWS_PER_TABLE,
        filename: exportado.filename,
      },
    });

    return new NextResponse(exportado.bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${exportado.filename}"`,
        "Content-Length": String(exportado.bytes.length),
        // Los datos de un inquilino no se guardan en ninguna caché intermedia.
        "Cache-Control": "no-store, private",
        "X-Row-Count": String(exportado.total),
      },
    });
  } catch (err) {
    return fail(err);
  }
}
