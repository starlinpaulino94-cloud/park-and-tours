import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  decideBlocker, BLOCK_MESSAGE, FORCEABLE_DECIDE_BLOCKS, versionedCode,
} from "@/lib/quotes";
import { loadQuoteBundle, recalculateQuote } from "@/lib/quote-service";

const DECISIONS = new Set(["accepted", "rejected", "negotiating"]);

/**
 * POST /api/quotes/:id/decide — registra la respuesta del cliente.
 *
 * Aceptar una propuesta es el momento en que la empresa se compromete con un
 * precio, así que no puede ser un `select` del formulario. Se exige que el
 * cliente la haya recibido, y un rechazo sin motivo no dice nada: el motivo es
 * lo único que convierte una cotización perdida en información de ventas.
 *
 * Una propuesta vencida se puede aceptar igualmente —pasa a diario: el cliente
 * responde tarde y la empresa mantiene el precio—, pero es decisión de un
 * responsable y queda auditada como advertencia.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "quotes:decide", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<{
      decision?: string; reason?: string; accepted_by?: string; force?: boolean; follow_up_at?: string;
    }>(req);

    const decision = String(body.decision || "");
    if (!DECISIONS.has(decision)) {
      throw Object.assign(new Error("La respuesta solo puede ser aceptada, rechazada o en negociación"), { status: 400 });
    }

    const { quote, options } = await loadQuoteBundle(ctx.companyId, id);
    const blocker = decideBlocker(quote);
    if (blocker) {
      if (!body.force || !FORCEABLE_DECIDE_BLOCKS.has(blocker)) {
        throw Object.assign(new Error(BLOCK_MESSAGE[blocker]), { status: 409 });
      }
      // Mantener el precio de una propuesta vencida es una excepción comercial,
      // no un atajo del vendedor.
      requireAtLeast(ctx, "manager");
      if (!body.reason?.trim()) {
        throw Object.assign(new Error("Aceptar una cotización vencida necesita un motivo"), { status: 400 });
      }
    }

    if (decision === "rejected" && !body.reason?.trim()) {
      throw Object.assign(
        new Error("Un rechazo sin motivo no se puede aprender: indica por qué se perdió"),
        { status: 400 }
      );
    }
    // Con alternativas sobre la mesa, "aceptada" tiene que decir cuál.
    if (decision === "accepted" && options.length > 0 && !options.some((o) => o.is_selected)) {
      throw Object.assign(
        new Error("La propuesta ofrece alternativas: marca cuál escogió el cliente antes de aceptarla"),
        { status: 409 }
      );
    }

    const totals = await recalculateQuote(ctx.companyId, id);
    const decided = decision !== "negotiating";

    await tenantUpdate(ctx.companyId, "quote", id, {
      status: decision,
      ...(decided ? { decided_at: new Date().toISOString() } : {}),
      ...(decision === "accepted" ? { accepted_by: body.accepted_by?.trim() || undefined } : {}),
      ...(decision === "rejected" ? { rejection_reason: body.reason?.trim() } : {}),
      ...(body.follow_up_at ? { follow_up_at: body.follow_up_at } : {}),
    });

    const label = versionedCode(quote.code, quote.version);
    const wording = decision === "accepted" ? "aceptada" : decision === "rejected" ? "rechazada" : "en negociación";
    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: `quote_${decision}`,
      entityType: "quote", entityId: id,
      description: `Cotización ${label} ${wording} por ${totals.total} ${String(quote.currency || "").toUpperCase()}` +
        (body.reason?.trim() ? ` — ${body.reason.trim()}` : "") +
        (blocker ? " (vencida, forzada)" : ""),
      severity: blocker ? "warning" : "info",
      metadata: { decision, total: totals.total, forced_block: blocker || undefined },
    });

    return ok({ status: decision, totals, forced: Boolean(blocker) });
  } catch (err) {
    return fail(err);
  }
}
