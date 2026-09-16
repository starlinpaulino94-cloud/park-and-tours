import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantCreate, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { reviseBlocker, BLOCK_MESSAGE, versionedCode } from "@/lib/quotes";
import { loadQuoteBundle, recalculateQuote } from "@/lib/quote-service";
import { refId } from "@/lib/types";

/** Campos del documento que una revisión hereda tal cual. */
const CARRIED_FIELDS = [
  "title", "quote_type", "currency", "event_date", "pax", "tax_percent",
  "contact_name", "contact_email", "contact_phone", "company_name",
  "deposit_type", "deposit_percent", "deposit_amount", "deposit_due_date", "balance_due_date",
  "terms", "inclusions", "exclusions", "cancellation_policy", "payment_terms",
  "notes", "internal_notes",
] as const;

/** Referencias que la revisión mantiene. */
const CARRIED_REFS = ["customer", "partner", "seller", "lead"] as const;

/**
 * POST /api/quotes/:id/revise — abre la ronda siguiente de la negociación.
 *
 * Una propuesta enviada es un documento que el cliente tiene en la mano: editarla
 * encima borraba lo que se le había ofrecido y a qué precio, y con ello la única
 * forma de saber qué se movió entre una ronda y otra. La revisión copia el
 * documento entero —alternativas y líneas incluidas—, sube la versión y deja la
 * anterior marcada como reemplazada para que el embudo no cuente dos veces el
 * mismo negocio.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    assertRateLimit({ key: rateLimitKey(req, "quotes:revise", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<{ reason?: string; valid_until?: string }>(req);
    const { quote, options, lines } = await loadQuoteBundle(ctx.companyId, id);

    const blocker = reviseBlocker(quote);
    if (blocker) throw Object.assign(new Error(BLOCK_MESSAGE[blocker]), { status: 409 });

    const version = (Number(quote.version) || 1) + 1;
    const carried: Record<string, unknown> = {};
    for (const f of CARRIED_FIELDS) if (quote[f] !== undefined && quote[f] !== null) carried[f] = quote[f];
    for (const r of CARRIED_REFS) {
      const value = refId(quote[r] as never);
      if (value) carried[r] = value;
    }

    const revision = await tenantCreate<{ _id: string; code?: string }>(ctx.companyId, "quote", {
      ...carried,
      code: versionedCode(quote.code, version),
      status: "draft",
      version,
      revision_of: id,
      revision_reason: body.reason?.trim() || undefined,
      issued_at: new Date().toISOString(),
      valid_until: body.valid_until || undefined,
      user: ctx.userId,
      subtotal: 0, discount: 0, tax: 0, total: 0, cost_total: 0, margin_amount: 0,
    });

    // Las alternativas se copian primero para poder reapuntar sus líneas.
    const optionMap = new Map<string, string>();
    for (const opt of options) {
      const copy = await tenantCreate<{ _id: string }>(ctx.companyId, "quote_option", {
        quote: revision._id,
        name: opt.name,
        description: (opt as { description?: string }).description,
        sort_order: opt.sort_order ?? 0,
        is_recommended: Boolean(opt.is_recommended),
        // Lo que escogió el cliente pertenecía a la versión anterior: la ronda
        // nueva vuelve a estar abierta hasta que responda.
        is_selected: false,
        subtotal: 0, discount: 0, tax: 0, total: 0, cost_total: 0, margin_amount: 0,
      });
      optionMap.set(opt._id, copy._id);
    }

    for (const line of lines) {
      const sourceOption = line.option_id || refId(line.option as never) || null;
      await tenantCreate(ctx.companyId, "quote_line", {
        quote: revision._id,
        option: sourceOption ? optionMap.get(sourceOption) : undefined,
        description: line.description,
        quantity: line.quantity, unit_price: line.unit_price, unit_cost: line.unit_cost,
        discount_percent: line.discount_percent, line_total: line.line_total,
        line_type: (line as { line_type?: string }).line_type,
        is_optional: Boolean(line.is_optional),
        sort_order: line.sort_order ?? 0,
        service_date: line.service_date || undefined,
        adults: line.adults ?? undefined, children: line.children ?? undefined, infants: line.infants ?? undefined,
        product: refId(line.product as never),
        product_modality: refId(line.product_modality as never),
        departure: refId(line.departure as never),
        supplier: refId((line as { supplier?: unknown }).supplier as never),
        notes: (line as { notes?: string }).notes,
      });
    }

    const totals = await recalculateQuote(ctx.companyId, revision._id);

    // La versión anterior queda fuera del embudo: sigue consultable, pero ya no
    // es la propuesta viva.
    await tenantUpdate(ctx.companyId, "quote", id, {
      status: "superseded",
      superseded_at: new Date().toISOString(),
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "quote_revised",
      entityType: "quote", entityId: revision._id,
      description: `Revisión ${revision.code} abierta desde ${quote.code}` +
        (body.reason?.trim() ? ` — ${body.reason.trim()}` : ""),
      metadata: { revision_of: id, version, lines: lines.length, options: options.length, total: totals.total },
    });

    return ok({ quote: revision, totals });
  } catch (err) {
    return fail(err);
  }
}
