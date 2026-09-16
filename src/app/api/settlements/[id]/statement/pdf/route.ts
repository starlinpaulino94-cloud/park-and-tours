import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, TenantError } from "@/lib/tenant";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadSupplierStatement } from "@/lib/supplier-settlement-service";
import { buildSupplierStatementPdf } from "@/lib/pdf/documents";
import { pdfResponse } from "@/lib/pdf/doc";

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * GET /api/settlements/:id/statement/pdf — el estado de cuenta del proveedor.
 *
 * Sale de la misma carga que la pantalla, para que el papel con el que el
 * proveedor discute y lo que el sistema va a pagar no puedan discrepar.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "settlements:statement:pdf", ctx.userId), limit: 60, windowMs: 60_000 });
    if (ctx.role === "partner") throw new TenantError("El estado de cuenta es de uso interno", 403);
    requireAtLeast(ctx, "manager");

    const statement = await loadSupplierStatement(ctx.companyId, id);
    const settlement = statement.settlement as Record<string, unknown>;

    const bytes = await buildSupplierStatementPdf(
      ctx.company,
      {
        code: textOf(settlement.code),
        supplier_name: statement.supplier?.name
          ?? textOf(settlement.beneficiary_name)
          ?? "Proveedor",
        supplier_tax_id: statement.supplier?.tax_id ?? null,
        period_from: textOf(settlement.period_from),
        period_to: textOf(settlement.period_to),
        status: textOf(settlement.status),
        invoice_number: textOf(settlement.supplier_invoice_number),
        invoice_ncf: textOf(settlement.supplier_invoice_ncf),
        invoice_date: textOf(settlement.supplier_invoice_date),
        currency: String(settlement.currency || "usd"),
        services: statement.totals.services,
        confirmed: statement.totals.confirmed,
        adjustments: statement.totals.adjustments,
        retention_isr: statement.retentions.isr,
        retention_itbis: statement.retentions.itbis,
        retention_total: statement.retentions.total,
        net: statement.totals.net,
        taxable_base: statement.retentions.base,
        dispute_reason: textOf(settlement.dispute_reason),
        notes: textOf(settlement.notes),
      },
      statement.lines.map((line) => ({
        concept: line.concept,
        booking_number: line.booking_number,
        departure_at: line.departure_at,
        product_name: line.product_name,
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        amount: line.amount,
        confirmed_amount: line.confirmed_amount,
        variance: line.variance,
      }))
    );

    return pdfResponse(bytes, `estado-de-cuenta-${textOf(settlement.code) || id}.pdf`);
  } catch (err) {
    return fail(err);
  }
}
