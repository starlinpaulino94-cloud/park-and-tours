import { NextRequest } from "next/server";
import { requireTenant, tenantFindOne, TenantError, esDeSocio } from "@/lib/tenant";
import { assertSettlementBeneficiary, beneficiaryOf, type SettlementLike } from "@/lib/settlement-access";
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
    if (esDeSocio(ctx)) throw new TenantError("El estado de cuenta es de uso interno", 403);

    /**
     * La misma pregunta que en la pantalla, y por el mismo motivo: abierta a su
     * beneficiario, el rango deja de decidir y bastaría con cambiar el
     * identificador de la dirección para bajarse la liquidación de otro.
     */
    const cabecera = await tenantFindOne<SettlementLike & Record<string, unknown>>(
      ctx.companyId, "settlement", id, { seller: true, partner: true, supplier: true }
    );
    assertSettlementBeneficiary(ctx, cabecera);

    /**
     * Y ESTE documento es el del PROVEEDOR: lleva el coste de cada servicio y
     * las retenciones fiscales dentro. Servírselo a un vendedor le entregaría
     * el margen de la empresa en un PDF, que es justo el dato que el recorte de
     * columnas existe para que no viaje.
     *
     * El suyo llega con su propio generador; hasta entonces, aquí se dice que
     * no en vez de entregar el que hay a mano.
     */
    if (beneficiaryOf(cabecera)?.kind === "seller") {
      throw new TenantError(
        "El estado de cuenta en PDF del vendedor todavía no está disponible; su detalle sí, en Mi espacio.",
        404
      );
    }

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
