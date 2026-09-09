import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { applyRefund, isGiftCardClosed, validateAmount, type RedeemableGiftCard } from "@/lib/gift-cards";
import { recordMovement } from "@/lib/gift-card-service";

interface GiftCardRow extends RedeemableGiftCard {
  _id: string;
  code?: string;
  currency?: string;
  initial_amount?: number;
}

/**
 * POST /api/gift-cards/:id/refund — devuelve saldo a la tarjeta.
 *
 * Es la contrapartida de consumir: si se reembolsa una compra que se pagó con la
 * tarjeta, el saldo tiene que volver. Devolver más de lo emitido se rechaza,
 * porque convertiría la tarjeta en una fuente de dinero; y una tarjeta anulada
 * no se recarga —para eso se emite una nueva—, así que solo se reabre la que
 * quedó redimida por consumo.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "gift-cards:refund", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const body = await readJson<{ amount?: number; order?: string; reason?: string }>(req);
    const parsed = validateAmount(body.amount);
    if ("error" in parsed) throw Object.assign(new Error(parsed.error), { status: 400 });
    if (!body.reason?.trim()) {
      throw Object.assign(new Error("Devolver saldo a una gift card necesita un motivo"), { status: 400 });
    }

    const card = await tenantFindOne<GiftCardRow>(ctx.companyId, "gift_card", id);
    if (isGiftCardClosed(card) && card.status !== "redeemed") {
      throw Object.assign(
        new Error("Una gift card anulada o expirada no se recarga: emite una nueva"),
        { status: 409 }
      );
    }

    const plan = applyRefund(card, parsed.amount);
    if ("error" in plan) throw Object.assign(new Error(plan.error), { status: 409 });

    await recordMovement({ companyId: ctx.companyId, userId: ctx.userId }, {
      cardId: id,
      label: card.code || id,
      plan,
      currency: card.currency,
      notes: body.reason,
      orderId: body.order,
      auditAction: "gift_card_refunded",
      auditDescription:
        `Gift card ${card.code || id}: devueltos ${parsed.amount} ${(card.currency || "").toUpperCase()} ` +
        `(saldo ${plan.balance_after}) — ${body.reason}`,
      severity: "warning",
    });

    return ok({ amount: parsed.amount, balance: plan.balance_after, status: plan.status });
  } catch (err) {
    return fail(err);
  }
}
