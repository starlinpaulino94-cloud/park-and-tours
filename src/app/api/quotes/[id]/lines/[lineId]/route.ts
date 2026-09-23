import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantUpdate, tenantDelete, tenantFindOne } from "@/lib/tenant";
import type { TenantContext } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { lineTotal, DECIDED_STATUSES } from "@/lib/quotes";
import { loadQuoteBundle, recalculateQuote, type QuoteLineRow } from "@/lib/quote-service";
import { refId } from "@/lib/types";

const LINE_TYPES = new Set([
  "service", "transport", "accommodation", "meal", "guide", "ticket", "fee", "insurance", "other",
]);

/** Comprueba que la línea es de esta cotización y que el documento sigue abierto. */
async function assertEditable(
  ctx: TenantContext & { companyId: string },
  quoteId: string,
  lineId: string
) {
  const companyId = ctx.companyId;
  // El ámbito del vendedor viaja hasta aquí: editar el desglose de la
  // cotización de un compañero es cambiarle el precio a su cliente.
  const { quote } = await loadQuoteBundle(companyId, quoteId, ctx);
  if (DECIDED_STATUSES.has(quote.status || "") || quote.status === "superseded") {
    throw Object.assign(
      new Error("Esta cotización ya está cerrada. Abre una revisión para cambiar su desglose."),
      { status: 409 }
    );
  }
  const line = await tenantFindOne<QuoteLineRow>(companyId, "quote_line", lineId);
  // Sin esta comprobación, el id de la cotización en la URL sería decorativo y
  // se podría editar la línea de otra propuesta del mismo inquilino.
  if (refId(line.quote as never) !== quoteId) {
    throw Object.assign(new Error("Esa línea no pertenece a esta cotización"), { status: 404 });
  }
  return { quote, line };
}

/** PUT /api/quotes/:id/lines/:lineId — corrige una línea y recalcula el total. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    assertSameOriginMutation(req);
    const { id, lineId } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "quotes:line:edit", ctx.userId), limit: 240, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const { quote, line } = await assertEditable(ctx, id, lineId);
    const body = await readJson<Record<string, unknown>>(req);

    const patch: Record<string, unknown> = {};
    if (typeof body.description === "string") patch.description = body.description.trim() || undefined;
    if (body.quantity !== undefined) {
      const q = Number(body.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        throw Object.assign(new Error("La cantidad tiene que ser mayor que cero"), { status: 400 });
      }
      patch.quantity = q;
    }
    if (body.unit_price !== undefined) patch.unit_price = Math.max(Number(body.unit_price) || 0, 0);
    if (body.unit_cost !== undefined) {
      patch.unit_cost = body.unit_cost === null || body.unit_cost === ""
        ? null : Math.max(Number(body.unit_cost) || 0, 0);
    }
    if (body.discount_percent !== undefined) {
      patch.discount_percent = Math.min(Math.max(Number(body.discount_percent) || 0, 0), 100);
    }
    if (body.is_optional !== undefined) patch.is_optional = body.is_optional === true;
    if (body.line_type !== undefined) {
      patch.line_type = LINE_TYPES.has(String(body.line_type)) ? String(body.line_type) : null;
    }
    if (body.sort_order !== undefined) patch.sort_order = Math.floor(Number(body.sort_order)) || 0;
    if (body.service_date !== undefined) patch.service_date = body.service_date || null;
    if (body.notes !== undefined) patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    if (body.option !== undefined) patch.option = body.option || null;
    for (const ref of ["product", "product_modality", "departure", "supplier"]) {
      if (body[ref] !== undefined) patch[ref] = body[ref] || null;
    }
    for (const pax of ["adults", "children", "infants"]) {
      if (body[pax] === undefined) continue;
      const n = Math.floor(Number(body[pax]));
      patch[pax] = Number.isFinite(n) && n >= 0 ? n : null;
    }

    // `line_total` no se acepta del cliente: es la multiplicación de los campos
    // que sí acepta, y aceptarlo dejaría una línea cuyo importe no es su cuenta.
    const merged = {
      quantity: (patch.quantity ?? line.quantity) as number,
      unit_price: (patch.unit_price ?? line.unit_price) as number,
      discount_percent: (patch.discount_percent ?? line.discount_percent) as number,
    };
    patch.line_total = lineTotal(merged);

    await tenantUpdate(ctx.companyId, "quote_line", lineId, patch);
    const totals = await recalculateQuote(ctx.companyId, id);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "quote_line_updated",
      entityType: "quote", entityId: id,
      description: `Línea corregida en ${quote.code}`,
      metadata: { line: lineId, total: totals.total },
    });

    return ok({ totals });
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/quotes/:id/lines/:lineId — quita una línea y recalcula el total. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    assertSameOriginMutation(req);
    const { id, lineId } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "quotes:line:delete", ctx.userId), limit: 240, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const { quote } = await assertEditable(ctx, id, lineId);
    await tenantDelete(ctx.companyId, "quote_line", lineId);
    const totals = await recalculateQuote(ctx.companyId, id);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "quote_line_removed",
      entityType: "quote", entityId: id,
      description: `Línea eliminada de ${quote.code}`,
      metadata: { line: lineId, total: totals.total },
    });

    return ok({ totals });
  } catch (err) {
    return fail(err);
  }
}
