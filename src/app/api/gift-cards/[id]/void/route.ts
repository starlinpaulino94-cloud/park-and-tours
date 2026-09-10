import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { giftCardBalance, isGiftCardClosed, type RedeemableGiftCard } from "@/lib/gift-cards";
import { recordMovement } from "@/lib/gift-card-service";

interface GiftCardRow extends RedeemableGiftCard {
  _id: string;
  code?: string;
  currency?: string;
}

/**
 * POST /api/gift-cards/:id/void — anula la tarjeta y extingue su saldo.
 *
 * Anular destruye dinero del cliente, así que pide rango de gerencia y un motivo
 * que queda en la auditoría, y el saldo que se pierde se registra como
 * movimiento para que el importe extinguido sea rastreable. Una tarjeta ya
 * cerrada no se vuelve a anular.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "gift-cards:void", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const body = await readJson<{ reason?: string }>(req);
    if (!body.reason?.trim()) {
      throw Object.assign(new Error("Anular una gift card necesita un motivo"), { status: 400 });
    }

    const card = await tenantFindOne<GiftCardRow>(ctx.companyId, "gift_card", id);
    if (isGiftCardClosed(card)) {
      throw Object.assign(new Error("Esta gift card ya está cerrada"), { status: 409 });
    }

    const lost = giftCardBalance(card);
    await recordMovement({ companyId: ctx.companyId, userId: ctx.userId }, {
      cardId: id,
      label: card.code || id,
      plan: { amount: lost, balance_after: 0, status: "void", movement_type: "adjustment" },
      currency: card.currency,
      notes: body.reason,
      auditAction: "gift_card_voided",
      auditDescription:
        `Gift card ${card.code || id} anulada con saldo ${lost} ${(card.currency || "").toUpperCase()}: ${body.reason}`,
      severity: "warning",
    });

    return ok({ status: "void", extinguished_balance: lost });
  } catch (err) {
    return fail(err);
  }
}
