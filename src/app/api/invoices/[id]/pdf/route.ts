import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne, tenantQuery } from "@/lib/tenant";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { buildInvoicePdf } from "@/lib/pdf/documents";
import { pdfResponse } from "@/lib/pdf/doc";
import { refId } from "@/lib/types";

/**
 * GET /api/invoices/:id/pdf — el comprobante fiscal impreso.
 *
 * Es el documento que el cliente guarda para su contabilidad y el que se enseña
 * en una inspección, así que lleva lo que lo hace válido: el NCF con su
 * vencimiento, el RNC de las dos partes y el desglose del ITBIS.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "invoices:pdf", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "cashier");

    const invoice = await tenantFindOne<Record<string, unknown>>(ctx.companyId, "invoice", id, {
      order: true, tax_profile: true, credit_note_of: true,
    });
    const lines = await tenantQuery<Record<string, unknown>>(ctx.companyId, "invoice_line", {
      _filter: { invoice: id }, _limit: 200, _sort: { sort_order: "asc" },
    });

    const order = invoice.order && typeof invoice.order === "object"
      ? (invoice.order as Record<string, unknown>) : null;
    const profile = invoice.tax_profile && typeof invoice.tax_profile === "object"
      ? (invoice.tax_profile as Record<string, unknown>) : null;
    const modified = invoice.credit_note_of && typeof invoice.credit_note_of === "object"
      ? (invoice.credit_note_of as Record<string, unknown>) : null;

    const bytes = await buildInvoicePdf(
      { ...ctx.company, tax_id: ctx.company?.tax_id ?? null },
      {
        ncf: invoice.ncf as string,
        ncf_type: invoice.ncf_type as string,
        number: invoice.number as string,
        invoice_type: invoice.invoice_type as string,
        status: invoice.status as string,
        issued_at: invoice.issued_at as string,
        due_date: invoice.due_date as string,
        ncf_expires_at: invoice.ncf_expires_at as string,
        customer_name: invoice.customer_name as string,
        customer_tax_id: invoice.customer_tax_id as string,
        customer_address: invoice.customer_address as string,
        order_number: (order?.order_number as string) ?? null,
        currency: invoice.currency as string,
        subtotal: invoice.subtotal as number,
        discount: invoice.discount as number,
        tax: invoice.tax as number,
        tax_rate: invoice.tax_rate as number,
        total: invoice.total as number,
        paid_amount: invoice.paid_amount as number,
        balance: invoice.balance as number,
        notes: invoice.notes as string,
        voided_at: invoice.voided_at as string,
        void_reason: invoice.void_reason as string,
        credit_note_of: (modified?.ncf as string) ?? (refId(invoice.credit_note_of as never) ? "—" : null),
        tax_name: (profile?.tax_name as string) ?? null,
      },
      lines.map((l) => ({
        description: l.description as string,
        quantity: l.quantity as number,
        unit_price: l.unit_price as number,
        discount: l.discount as number,
        tax_rate: l.tax_rate as number,
        tax_amount: l.tax_amount as number,
        total: l.total as number,
        is_exempt: l.is_exempt as boolean,
      }))
    );

    return pdfResponse(bytes, `${invoice.ncf || invoice.number || id}.pdf`);
  } catch (err) {
    return fail(err);
  }
}
