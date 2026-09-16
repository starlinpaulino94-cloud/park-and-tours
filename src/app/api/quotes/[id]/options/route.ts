import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantCreate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { DECIDED_STATUSES } from "@/lib/quotes";
import { loadQuoteBundle, recalculateQuote } from "@/lib/quote-service";

/**
 * POST /api/quotes/:id/options — añade una alternativa a la propuesta.
 *
 * Una propuesta de grupo se presenta con dos o tres opciones entre las que el
 * cliente escoge (hotel 4* contra 5*, con guía o sin guía). Antes había que
 * crear cotizaciones sueltas, y en cuanto existían ya nadie sabía que eran la
 * misma negociación: el embudo contaba tres negocios donde había uno.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    assertRateLimit({ key: rateLimitKey(req, "quotes:option", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<Record<string, unknown>>(req);
    const { quote, options } = await loadQuoteBundle(ctx.companyId, id);
    if (DECIDED_STATUSES.has(quote.status || "") || quote.status === "superseded") {
      throw Object.assign(
        new Error("Esta cotización ya está cerrada. Abre una revisión para cambiar sus alternativas."),
        { status: 409 }
      );
    }
    if (options.length >= 10) {
      throw Object.assign(new Error("Diez alternativas ya no son una propuesta: son un catálogo"), { status: 400 });
    }

    const name = typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : `Opción ${String.fromCharCode(65 + options.length)}`;

    const option = await tenantCreate<{ _id: string }>(ctx.companyId, "quote_option", {
      quote: id,
      name,
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : undefined,
      sort_order: options.reduce((max, o) => Math.max(max, Number(o.sort_order) || 0), 0) + 10,
      is_recommended: body.is_recommended === true,
      is_selected: false,
      subtotal: 0, discount: 0, tax: 0, total: 0, cost_total: 0, margin_amount: 0,
    });

    const totals = await recalculateQuote(ctx.companyId, id);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "quote_option_added",
      entityType: "quote", entityId: id,
      description: `Alternativa "${name}" añadida a ${quote.code}`,
      metadata: { option: option._id },
    });

    return ok({ option, totals });
  } catch (err) {
    return fail(err);
  }
}
