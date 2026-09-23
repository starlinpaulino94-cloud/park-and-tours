import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantCreate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { lineTotal, DECIDED_STATUSES } from "@/lib/quotes";
import { loadQuoteBundle, recalculateQuote, nextSortOrder } from "@/lib/quote-service";

const LINE_TYPES = new Set([
  "service", "transport", "accommodation", "meal", "guide", "ticket", "fee", "insurance", "other",
]);

/**
 * POST /api/quotes/:id/lines — añade una línea y recalcula el documento.
 *
 * La línea y el total de la cabecera se escriben en el mismo movimiento: eran
 * dos peticiones separadas desde la pantalla, y si la segunda no llegaba (una
 * pestaña cerrada, la red caída) la cotización quedaba prometiendo un precio que
 * su desglose ya no sostenía.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "quotes:line", ctx.userId), limit: 240, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<Record<string, unknown>>(req);
    const { quote, lines } = await loadQuoteBundle(ctx.companyId, id, ctx);

    // Una propuesta ya decidida es un documento cerrado: si hay que cambiarla,
    // se abre una revisión, que es lo que el cliente vuelve a recibir.
    if (DECIDED_STATUSES.has(quote.status || "") || quote.status === "superseded") {
      throw Object.assign(
        new Error("Esta cotización ya está cerrada. Abre una revisión para cambiar su desglose."),
        { status: 409 }
      );
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";
    const quantity = Number(body.quantity);
    if (!description && !body.product) {
      throw Object.assign(new Error("La línea necesita un concepto o un producto del catálogo"), { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw Object.assign(new Error("La cantidad tiene que ser mayor que cero"), { status: 400 });
    }

    const optionId = typeof body.option === "string" && body.option ? body.option : null;
    const unit_price = Math.max(Number(body.unit_price) || 0, 0);
    const unit_cost = body.unit_cost === undefined || body.unit_cost === null || body.unit_cost === ""
      ? undefined
      : Math.max(Number(body.unit_cost) || 0, 0);
    const discount_percent = Math.min(Math.max(Number(body.discount_percent) || 0, 0), 100);
    const lineType = LINE_TYPES.has(String(body.line_type)) ? String(body.line_type) : undefined;
    const int = (v: unknown) => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };

    const line = await tenantCreate<{ _id: string }>(ctx.companyId, "quote_line", {
      quote: id,
      option: optionId || undefined,
      description: description || undefined,
      quantity, unit_price, unit_cost, discount_percent,
      line_total: lineTotal({ quantity, unit_price, discount_percent }),
      line_type: lineType,
      is_optional: body.is_optional === true,
      sort_order: nextSortOrder(lines, optionId),
      service_date: typeof body.service_date === "string" && body.service_date ? body.service_date : undefined,
      adults: int(body.adults), children: int(body.children), infants: int(body.infants),
      product: typeof body.product === "string" && body.product ? body.product : undefined,
      product_modality: typeof body.product_modality === "string" && body.product_modality ? body.product_modality : undefined,
      departure: typeof body.departure === "string" && body.departure ? body.departure : undefined,
      supplier: typeof body.supplier === "string" && body.supplier ? body.supplier : undefined,
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : undefined,
    });

    const totals = await recalculateQuote(ctx.companyId, id);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "quote_line_added",
      entityType: "quote", entityId: id,
      description: `Línea añadida a ${quote.code}: ${description || "producto del catálogo"} (${quantity} × ${unit_price})`,
      metadata: { line: line._id, total: totals.total },
    });

    return ok({ line, totals });
  } catch (err) {
    return fail(err);
  }
}
