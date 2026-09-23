import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantUpdate, tenantDelete } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { DECIDED_STATUSES } from "@/lib/quotes";
import { loadQuoteBundle, recalculateQuote } from "@/lib/quote-service";

/**
 * PUT /api/quotes/:id/options/:optionId — renombra, recomienda o marca la
 * alternativa que escogió el cliente.
 *
 * Escoger es excluyente: marcar una desmarca las demás en el mismo movimiento.
 * Dos opciones "escogidas" a la vez dejarían sin respuesta la única pregunta que
 * importa al convertir la propuesta en reserva: ¿qué compró el cliente?
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; optionId: string }> }
) {
  try {
    assertSameOriginMutation(req);
    const { id, optionId } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "quotes:option:edit", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<Record<string, unknown>>(req);
    const { quote, options } = await loadQuoteBundle(ctx.companyId, id, ctx);
    const option = options.find((o) => o._id === optionId);
    if (!option) throw Object.assign(new Error("Esa alternativa no pertenece a esta cotización"), { status: 404 });

    const selecting = body.is_selected === true;
    if (!selecting && DECIDED_STATUSES.has(quote.status || "")) {
      throw Object.assign(new Error("Esta cotización ya está cerrada"), { status: 409 });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (body.description !== undefined) {
      patch.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
    }
    if (body.sort_order !== undefined) patch.sort_order = Math.floor(Number(body.sort_order)) || 0;
    if (body.is_recommended !== undefined) patch.is_recommended = body.is_recommended === true;
    if (body.is_selected !== undefined) patch.is_selected = selecting;

    await tenantUpdate(ctx.companyId, "quote_option", optionId, patch);

    if (body.is_recommended === true) {
      for (const other of options) {
        if (other._id !== optionId && other.is_recommended) {
          await tenantUpdate(ctx.companyId, "quote_option", other._id, { is_recommended: false });
        }
      }
    }
    if (body.is_selected !== undefined) {
      for (const other of options) {
        if (other._id !== optionId && other.is_selected) {
          await tenantUpdate(ctx.companyId, "quote_option", other._id, { is_selected: false });
        }
      }
      await tenantUpdate(ctx.companyId, "quote", id, { selected_option: selecting ? optionId : null });
    }

    const totals = await recalculateQuote(ctx.companyId, id);

    if (body.is_selected !== undefined) {
      await writeAudit({
        companyId: ctx.companyId, userId: ctx.userId,
        action: "quote_option_selected",
        entityType: "quote", entityId: id,
        description: selecting
          ? `El cliente escogió "${option.name}" en ${quote.code} (${totals.total})`
          : `Se deshizo la elección de alternativa en ${quote.code}`,
        metadata: { option: optionId, total: totals.total },
      });
    }

    return ok({ totals });
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/quotes/:id/options/:optionId — retira una alternativa y sus líneas. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; optionId: string }> }
) {
  try {
    assertSameOriginMutation(req);
    const { id, optionId } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "quotes:option:delete", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const { quote, options } = await loadQuoteBundle(ctx.companyId, id, ctx);
    const option = options.find((o) => o._id === optionId);
    if (!option) throw Object.assign(new Error("Esa alternativa no pertenece a esta cotización"), { status: 404 });
    if (DECIDED_STATUSES.has(quote.status || "") || quote.status === "superseded") {
      throw Object.assign(new Error("Esta cotización ya está cerrada"), { status: 409 });
    }
    if (option.is_selected) {
      throw Object.assign(
        new Error("Es la alternativa que escogió el cliente: desmárcala antes de retirarla"),
        { status: 409 }
      );
    }

    // Las líneas de la opción caen con ella por la clave ajena (on delete cascade).
    await tenantDelete(ctx.companyId, "quote_option", optionId);
    const totals = await recalculateQuote(ctx.companyId, id);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "quote_option_removed",
      entityType: "quote", entityId: id,
      description: `Alternativa "${option.name}" retirada de ${quote.code}`,
      metadata: { option: optionId, total: totals.total },
    });

    return ok({ totals });
  } catch (err) {
    return fail(err);
  }
}
