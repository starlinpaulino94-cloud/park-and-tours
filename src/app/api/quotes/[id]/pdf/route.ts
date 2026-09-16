import { NextRequest } from "next/server";
import { requireTenant, tenantQuery } from "@/lib/tenant";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadQuoteBundle, recalculateQuote } from "@/lib/quote-service";
import { buildQuotePdf } from "@/lib/pdf/documents";
import { pdfResponse } from "@/lib/pdf/doc";
import { personName } from "@/lib/manifest";
import { refId } from "@/lib/types";

/**
 * GET /api/quotes/:id/pdf — la propuesta en PDF.
 *
 * "Enviar" ya registraba la salida y encolaba el correo, pero lo que el cliente
 * recibía era texto: el desglose que sostiene el precio y las alternativas entre
 * las que tiene que escoger no cabían en un cuerpo de mensaje. Este es el
 * documento que se adjunta, se imprime y se enseña en una reunión.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "quotes:pdf", ctx.userId), limit: 60, windowMs: 60_000 });

    const { quote, options, lines } = await loadQuoteBundle(ctx.companyId, id);
    // Los totales se recalculan antes de imprimir: el papel que sale por la
    // puerta no puede llevar un número más viejo que sus propias líneas.
    const totals = await recalculateQuote(ctx.companyId, id);

    const customerId = refId(quote.customer as never);
    const [customer] = customerId
      ? await tenantQuery<Record<string, unknown>>(ctx.companyId, "customer", { _filter: { _id: customerId }, _limit: 1 })
      : [];
    const sellerId = refId(quote.seller as never);
    const [seller] = sellerId
      ? await tenantQuery<Record<string, unknown>>(ctx.companyId, "seller", { _filter: { _id: sellerId }, _limit: 1 })
      : [];

    const bytes = await buildQuotePdf(
      ctx.company,
      {
        code: quote.code,
        title: quote.title as string,
        status: quote.status,
        version: quote.version,
        issued_at: quote.issued_at as string,
        valid_until: quote.valid_until as string,
        event_date: quote.event_date as string,
        pax: quote.pax as number,
        currency: quote.currency,
        tax_percent: quote.tax_percent,
        subtotal: totals.subtotal,
        discount: totals.discount,
        tax: totals.tax,
        total: totals.total,
        deposit_type: quote.deposit_type,
        deposit_percent: quote.deposit_percent,
        deposit_amount: quote.deposit_amount,
        deposit_due_date: quote.deposit_due_date as string,
        balance_due_date: quote.balance_due_date as string,
        customer_name: personName(customer),
        company_name: quote.company_name as string,
        contact_name: quote.contact_name as string,
        contact_email: quote.contact_email as string,
        contact_phone: quote.contact_phone as string,
        seller_name: personName(seller),
        inclusions: quote.inclusions as string,
        exclusions: quote.exclusions as string,
        cancellation_policy: quote.cancellation_policy as string,
        payment_terms: quote.payment_terms as string,
        terms: quote.terms as string,
        notes: quote.notes as string,
      },
      lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount_percent: l.discount_percent,
        line_total: l.line_total,
        is_optional: l.is_optional,
        option_id: l.option_id || refId(l.option as never) || null,
        service_date: l.service_date,
      })),
      options
    );

    return pdfResponse(bytes, `cotizacion-${quote.code || id}.pdf`);
  } catch (err) {
    return fail(err);
  }
}
