import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { convertBlocker, BLOCK_MESSAGE, lineGross, linePax, billableLines } from "@/lib/quotes";
import { loadQuoteBundle, recalculateQuote, type QuoteLineRow } from "@/lib/quote-service";
import { createOrderWithBookings, type BookingItemInput } from "@/lib/booking-service";
import { billablePax } from "@/lib/pricing";
import { refId } from "@/lib/types";
import type { Channel, Currency } from "@/lib/types";
import { flushOutboxAfterResponse } from "@/lib/messaging/flush";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * POST /api/quotes/:id/convert — convierte la propuesta aceptada en la reserva.
 *
 * Era el agujero del módulo: una cotización se aceptaba y ahí se acababa. La
 * venta había que volver a teclearla en el punto de venta, producto por
 * producto, y cualquier diferencia de dedo entre las dos pantallas era una
 * diferencia entre lo que el cliente firmó y lo que se le cobró.
 *
 * El precio que viaja a la reserva es el NEGOCIADO, no el del catálogo. Esa es
 * la razón de ser de una cotización de grupo: se pactó una vez, y volver a
 * calcularlo al vender le cobraría al cliente algo distinto de lo que aceptó.
 * `booking-service` lo recibe como `unit_price_override` —que la ruta pública de
 * órdenes borra del payload— y lo deja escrito en el snapshot inmutable de la
 * reserva con su origen ('quote') y el id de esta cotización.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    assertRateLimit({ key: rateLimitKey(req, "quotes:convert", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<{
      channel?: string; capacity_override?: boolean; override_reason?: string; branch?: string;
    }>(req);

    const { quote, options, lines } = await loadQuoteBundle(ctx.companyId, id);

    const blocker = convertBlocker(
      quote,
      lines.map((l) => ({
        product: refId(l.product as never),
        option_id: l.option_id || refId(l.option as never) || null,
        is_optional: l.is_optional,
      })),
      options
    );
    if (blocker) throw Object.assign(new Error(BLOCK_MESSAGE[blocker]), { status: 409 });

    const selected = options.find((o) => o.is_selected) || null;
    const currency = (quote.currency || ctx.company?.base_currency || "usd") as Currency;
    const taxPct = Number(quote.tax_percent);

    // Lo que se vende es la alternativa escogida más lo común. Los extras
    // opcionales no se reservan: el cliente no los aceptó.
    const inScope = billableLines(lines).filter((l) => {
      const optionId = l.option_id || refId(l.option as never) || null;
      return !optionId || optionId === selected?._id;
    });

    const items: BookingItemInput[] = [];
    const notCarried: QuoteLineRow[] = [];

    for (const line of inScope) {
      const productId = refId(line.product as never);
      if (!productId) { notCarried.push(line); continue; }

      const pax = linePax(line);
      // `booking-service` factura sobre los pax que pagan (los bebés viajan
      // gratis). Para que el total de la reserva sea EXACTAMENTE el de la línea
      // aceptada, el precio unitario que se le pasa es el bruto de la línea
      // repartido entre esos pax: si se mandara el unitario tal cual y la línea
      // llevara bebés, la reserva saldría más barata que lo cotizado.
      const billable = billablePax(pax.adults, pax.children);
      const gross = lineGross(line);

      items.push({
        product_id: productId,
        departure_id: refId(line.departure as never) || null,
        modality_id: refId(line.product_modality as never) || null,
        adults: pax.adults, children: pax.children, infants: pax.infants,
        discount_pct: Number(line.discount_percent) || 0,
        tax_pct: Number.isFinite(taxPct) ? taxPct : 0,
        unit_price_override: round2(gross / billable),
        cost_override: line.unit_cost === null || line.unit_cost === undefined
          ? null
          : round2(Number(line.unit_cost) * Number(line.quantity ?? 0)),
        quote_id: id,
        notes: line.notes || line.description || undefined,
      });
    }

    if (items.length === 0) {
      throw Object.assign(new Error(BLOCK_MESSAGE.no_sellable_line), { status: 409 });
    }
    if (body.capacity_override) requireAtLeast(ctx, "manager");

    // Las líneas sin producto del catálogo (una tasa, la coordinación del grupo)
    // no tienen dónde convertirse en reserva. En vez de perderlas en silencio se
    // dejan escritas en la orden y se devuelven para que la pantalla lo diga.
    const strandedTotal = round2(notCarried.reduce((s, l) => s + lineGross(l), 0));
    const strandedNote = notCarried.length > 0
      ? `Conceptos de la cotización ${quote.code} sin producto de catálogo (${strandedTotal} ${currency.toUpperCase()}): ` +
        notCarried.map((l) => `${l.description || "sin concepto"} (${lineGross(l)})`).join("; ")
      : "";

    const result = await createOrderWithBookings(ctx, {
      customer_id: refId(quote.customer as never)!,
      seller_id: refId(quote.seller as never) || null,
      partner_id: refId(quote.partner as never) || null,
      branch_id: body.branch || null,
      channel: (body.channel || "direct") as Channel,
      currency,
      notes: [`Generada desde la cotización ${quote.code}`, strandedNote, quote.notes as string | undefined]
        .filter(Boolean).join(" · ") || undefined,
      items,
      capacity_override: body.capacity_override === true,
      override_reason: body.override_reason || null,
      // Lo pactado en la propuesta viaja a la venta: el anticipo, sus fechas y
      // el plazo. Antes se quedaba en la cotización y la orden nacía con la
      // política genérica del producto, así que el cliente recibía condiciones
      // que nadie había acordado con él.
      terms: {
        deposit_type: (quote.deposit_type as string) || null,
        deposit_percent: (quote.deposit_percent as number) ?? null,
        deposit_amount: (quote.deposit_amount as number) ?? null,
        deposit_due_date: (quote.deposit_due_date as string) || null,
        balance_due_date: (quote.balance_due_date as string) || null,
        payment_terms: (quote.payment_terms as string) || null,
      },
    });

    await tenantUpdate(ctx.companyId, "quote", id, {
      status: "converted",
      order: result.order._id,
      decided_at: (quote.decided_at as string) || new Date().toISOString(),
    });
    const totals = await recalculateQuote(ctx.companyId, id);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "quote_converted",
      entityType: "quote", entityId: id,
      description: `Cotización ${quote.code} convertida en la orden ${result.order.order_number}` +
        (selected ? ` (alternativa "${selected.name}")` : "") +
        (notCarried.length > 0 ? ` — ${notCarried.length} concepto(s) por ${strandedTotal} quedaron fuera de la reserva` : ""),
      severity: notCarried.length > 0 ? "warning" : "info",
      metadata: {
        order: result.order._id, bookings: result.bookings.length,
        quote_total: totals.total, order_total: result.order.total,
        option: selected?._id, not_carried: notCarried.length, not_carried_total: strandedTotal,
      },
    });

    // La venta ya está hecha. La confirmación y el voucher salen en cuanto esta
    // respuesta llegue, no a la mañana siguiente con el barrido.
    flushOutboxAfterResponse(ctx.company, ctx.companyId);
    return ok({
      order: result.order,
      bookings: result.bookings.length,
      quote_total: totals.total,
      order_total: result.order.total,
      not_carried: notCarried.map((l) => ({ description: l.description, amount: lineGross(l) })),
    });
  } catch (err) {
    return fail(err);
  }
}

/** GET /api/quotes/:id/convert — qué impide convertirla, sin convertirla. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "quotes:convert:check", ctx.userId), limit: 240, windowMs: 60_000 });
    const { quote, options, lines } = await loadQuoteBundle(ctx.companyId, id);
    const blocker = convertBlocker(
      quote,
      lines.map((l) => ({
        product: refId(l.product as never),
        option_id: l.option_id || refId(l.option as never) || null,
        is_optional: l.is_optional,
      })),
      options
    );
    return ok({ blocker, message: blocker ? BLOCK_MESSAGE[blocker] : null });
  } catch (err) {
    return fail(err);
  }
}
