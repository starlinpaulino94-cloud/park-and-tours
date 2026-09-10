import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantCreate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { newGiftCardCode } from "@/lib/codes";
import { applyIssue, validateAmount } from "@/lib/gift-cards";
import { recordMovement } from "@/lib/gift-card-service";
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
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "gift-cards:issue", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{
      amount?: number; currency?: Currency; code?: string; expires_at?: string;
      recipient_name?: string; recipient_email?: string; message?: string;
      delivery_channel?: string; customer?: string; order?: string; product?: string; notes?: string;
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

    console.log(`[gift-cards] emitida ${card.code} por ${parsed.amount} ${currency}`);
    return ok({ _id: card._id, code: card.code, balance: plan.balance_after, status: plan.status, currency });
  } catch (err) {
    return fail(err);
  }
}
