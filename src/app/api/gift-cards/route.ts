import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantCreate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { newGiftCardCode } from "@/lib/codes";
import { applyIssue, validateAmount } from "@/lib/gift-cards";
import { recordMovement } from "@/lib/gift-card-service";
import { postGiftCardIssued } from "@/lib/ledger-events";
import type { Currency } from "@/lib/types";

interface GiftCardRow { _id: string; code?: string }

/**
 * POST /api/gift-cards — emite una gift card.
 *
 * `balance` e `initial_amount` salieron del CRUD genérico, así que una tarjeta no
 * se puede crear "a mano" con el saldo que a uno le parezca: nace aquí, con el
 * saldo igual al importe emitido y su movimiento de emisión. Antes la pantalla
 * era de solo lectura y ni siquiera se podía emitir una desde la aplicación.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "gift-cards:issue", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{
      amount?: number; currency?: Currency; code?: string; expires_at?: string;
      recipient_name?: string; recipient_email?: string; message?: string;
      delivery_channel?: string; customer?: string; order?: string; product?: string; notes?: string;
      /** Con qué pagó el cliente la tarjeta: decide la contrapartida del asiento. */
      paid_with?: string;
    }>(req);

    const parsed = validateAmount(body.amount);
    if ("error" in parsed) throw Object.assign(new Error(parsed.error), { status: 400 });

    const plan = applyIssue(parsed.amount);
    const currency = body.currency || ctx.company?.base_currency || "usd";
    const issuedAt = new Date().toISOString();

    // La tarjeta nace sin saldo y es el movimiento de emisión el que la funde:
    // así `recordMovement` es el ÚNICO sitio del código que escribe un saldo.
    const card = await tenantCreate<GiftCardRow>(ctx.companyId, "gift_card", {
      code: body.code?.trim() || newGiftCardCode(),
      status: "active",
      initial_amount: parsed.amount,
      balance: 0,
      currency,
      issued_at: issuedAt,
      expires_at: body.expires_at || undefined,
      recipient_name: body.recipient_name,
      recipient_email: body.recipient_email,
      message: body.message,
      delivery_channel: body.delivery_channel,
      customer: body.customer,
      order: body.order,
      product: body.product,
    });

    await recordMovement({ companyId: ctx.companyId, userId: ctx.userId }, {
      cardId: card._id,
      label: card.code || card._id,
      plan,
      currency,
      notes: body.notes,
      orderId: body.order,
      auditAction: "gift_card_issued",
      auditDescription: `Gift card ${card.code} emitida por ${parsed.amount} ${currency.toUpperCase()}`,
    });

    /**
     * Y LA DEUDA QUEDA EN LOS LIBROS (0103).
     *
     * Emitir no es un ingreso: el dinero entró pero el servicio no se ha dado.
     * `Dr caja o banco / Cr 2202 Pasivo por gift cards`. El ingreso se reconoce
     * al consumir la tarjeta, que es lo que hace el asiento del cobro.
     *
     * La cuenta 2202 estaba en el plan base desde el primer día y nada la tocaba.
     * Sin este apunte, ahora que el consumo la debita, el pasivo se iría a
     * negativo.
     *
     * Mejor esfuerzo, como el resto de la contabilidad: el saldo ya está emitido
     * y tumbar la emisión por no poder contabilizar convertiría un problema de
     * libros en una tarjeta que el cliente pagó y no existe.
     */
    await postGiftCardIssued(ctx.companyId, {
      giftCardId: card._id,
      amount: parsed.amount,
      // Con qué pagó el cliente la tarjeta. Sin dato, el asiento va a banco.
      method: body.paid_with || null,
      currency,
      userId: ctx.userId,
    });

    console.log(`[gift-cards] emitida ${card.code} por ${parsed.amount} ${currency}`);
    return ok({ _id: card._id, code: card.code, balance: plan.balance_after, status: plan.status, currency });
  } catch (err) {
    return fail(err);
  }
}
