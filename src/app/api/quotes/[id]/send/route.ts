import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { sendBlocker, BLOCK_MESSAGE, versionedCode } from "@/lib/quotes";
import { loadQuoteBundle, recalculateQuote } from "@/lib/quote-service";
import { depositDue } from "@/lib/quotes";
import { notifyQuoteSent } from "@/lib/messaging/events";
import { flushOutboxAfterResponse } from "@/lib/messaging/flush";

/**
 * POST /api/quotes/:id/send — registra que la propuesta salió hacia el cliente.
 *
 * `status` y `sent_at` salieron del CRUD genérico: como campos de formulario,
 * cualquiera podía marcar "Enviada" una cotización vacía, sin destinatario y sin
 * plazo, y el embudo la contaba como negocio en juego. Aquí se comprueba que el
 * documento está en condiciones de defenderse solo delante del cliente.
 *
 * El envío por correo todavía no existe en la plataforma: esta acción deja
 * constancia de la salida y del plazo, que es lo que el seguimiento necesita.
 * Cuando haya mensajería, el disparo se engancha aquí y no en la pantalla.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "quotes:send", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<{ follow_up_at?: string; notes?: string }>(req);
    const { quote, lines } = await loadQuoteBundle(ctx.companyId, id);

    const blocker = sendBlocker(quote, lines);
    if (blocker) throw Object.assign(new Error(BLOCK_MESSAGE[blocker]), { status: 409 });

    // El total sale de las líneas en el momento de enviar: es el número que el
    // cliente va a leer, así que no puede venir de un cálculo viejo.
    const totals = await recalculateQuote(ctx.companyId, id);

    const sentCount = (Number(quote.sent_count) || 0) + 1;
    await tenantUpdate(ctx.companyId, "quote", id, {
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_count: sentCount,
      ...(body.follow_up_at ? { follow_up_at: body.follow_up_at } : {}),
    });

    // Y sale de verdad hacia el cliente. Hasta ahora "enviar" solo cambiaba un
    // estado: el vendedor tenía que copiar los números a un correo a mano.
    try {
      await notifyQuoteSent(ctx.company, ctx.companyId, quote, {
        total: totals.total,
        deposit: depositDue(quote, totals.total).deposit,
        sellerName: ctx.name || null,
        sentCount,
        userId: ctx.userId,
      });
    } catch (err) {
      console.error("[cotizaciones] no se pudo encolar el envío:", err);
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: sentCount > 1 ? "quote_resent" : "quote_sent",
      entityType: "quote", entityId: id,
      description: `Cotización ${versionedCode(quote.code, quote.version)} enviada por ${totals.total} ${String(quote.currency || "").toUpperCase()}${sentCount > 1 ? ` (envío nº ${sentCount})` : ""}`,
      metadata: { total: totals.total, sent_count: sentCount, valid_until: quote.valid_until },
    });

    // La propuesta ya está marcada como enviada. El correo con el PDF sale en
    // cuanto esta respuesta llegue al vendedor, no cuando pase el barrido.
    flushOutboxAfterResponse(ctx.company, ctx.companyId);
    return ok({ status: "sent", sent_count: sentCount, totals });
  } catch (err) {
    return fail(err);
  }
}

/** GET /api/quotes/:id/send — qué falta para poder enviarla, sin enviarla. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "quotes:send:check", ctx.userId), limit: 240, windowMs: 60_000 });
    const { quote, lines } = await loadQuoteBundle(ctx.companyId, id);
    const blocker = sendBlocker(quote, lines);
    return ok({ blocker, message: blocker ? BLOCK_MESSAGE[blocker] : null });
  } catch (err) {
    return fail(err);
  }
}
