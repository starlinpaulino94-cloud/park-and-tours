import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  applyRedemption, giftCardBalance, giftCardBlocker, validateAmount,
  GIFT_CARD_BLOCK_MESSAGE, type RedeemableGiftCard,
} from "@/lib/gift-cards";
import { recordMovement } from "@/lib/gift-card-service";

interface GiftCardRow extends RedeemableGiftCard {
  _id: string;
  code?: string;
  currency?: string;
  initial_amount?: number;
}

/**
 * POST /api/gift-cards/:id/redeem — consume saldo de la tarjeta.
 *
 * El saldo era un campo del formulario y esta es la única vía por la que se
 * mueve ahora. Rechaza con 409 lo que no se puede consumir —cerrada, vencida o
 * sin saldo— y con 409 también un importe mayor al disponible, en vez de
 * recortarlo: recortar dejaría la orden cobrada de menos sin que nadie lo note.
 *
 * La acción NO toca los totales de la orden. Devuelve el importe consumido para
 * que el flujo de cobro lo aplique, y el `order` que se le pase queda solo como
 * referencia del movimiento. Tampoco convierte divisas: el importe tiene que
 * venir en la moneda de la tarjeta.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "gift-cards:redeem", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{ amount?: number; order?: string; notes?: string; currency?: string }>(req);
    const parsed = validateAmount(body.amount);
    if ("error" in parsed) throw Object.assign(new Error(parsed.error), { status: 400 });

    const card = await tenantFindOne<GiftCardRow>(ctx.companyId, "gift_card", id);

    const blocker = giftCardBlocker(card);
    if (blocker) throw Object.assign(new Error(GIFT_CARD_BLOCK_MESSAGE[blocker]), { status: 409 });

    // Una tarjeta en dólares no paga una orden en pesos sin una tasa explícita,
    // y aquí no hay ninguna: mezclar divisas 1:1 descuadraría el saldo.
    if (body.currency && card.currency && body.currency !== card.currency) {
      throw Object.assign(
        new Error(`La tarjeta está en ${card.currency.toUpperCase()} y el cobro en ${body.currency.toUpperCase()}`),
        { status: 409 }
      );
    }

    const plan = applyRedemption(card, parsed.amount);
    if ("error" in plan) throw Object.assign(new Error(plan.error), { status: 409 });

    await recordMovement({ companyId: ctx.companyId, userId: ctx.userId }, {
      cardId: id,
      label: card.code || id,
      plan,
      currency: card.currency,
      notes: body.notes,
      orderId: body.order,
      auditAction: "gift_card_redeemed",
      auditDescription:
        `Gift card ${card.code || id}: consumidos ${parsed.amount} ${(card.currency || "").toUpperCase()}, ` +
        `saldo restante ${plan.balance_after}`,
    });

    return ok({ amount: parsed.amount, balance: plan.balance_after, status: plan.status, currency: card.currency });
  } catch (err) {
    return fail(err);
  }
}

/** GET /api/gift-cards/:id/redeem — si la tarjeta serviría, sin consumirla. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "gift-cards:check", ctx.userId), limit: 240, windowMs: 60_000 });

    const card = await tenantFindOne<GiftCardRow>(ctx.companyId, "gift_card", id);
    const blocker = giftCardBlocker(card);
    return ok({
      blocker,
      message: blocker ? GIFT_CARD_BLOCK_MESSAGE[blocker] : null,
      balance: giftCardBalance(card),
      currency: card.currency,
    });
  } catch (err) {
    return fail(err);
  }
}
