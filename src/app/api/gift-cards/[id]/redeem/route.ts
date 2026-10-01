import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, tenantFindOne } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  giftCardBalance, giftCardBlocker, planDePagoConTarjeta,
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
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "gift-cards:redeem", ctx.userId), limit: 120, windowMs: 60_000 });
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{ amount?: number; order?: string; notes?: string; currency?: string }>(req);
    const card = await tenantFindOne<GiftCardRow>(ctx.companyId, "gift_card", id);

    /**
     * Las tres comprobaciones —importe, estado y moneda— viven en el dominio
     * desde el 30-sep, porque `/api/payments` hace lo mismo al cobrar una orden
     * con método `gift_card`. Tenerlas aquí y allí era tener dos definiciones de
     * «esta tarjeta puede pagar esto», y la que se queda atrás cobra de menos o
     * acepta una tarjeta cerrada.
     */
    const decision = planDePagoConTarjeta(card, body.amount, body.currency);
    if ("error" in decision) throw Object.assign(new Error(decision.error), { status: decision.status });
    const plan = decision.plan;

    await recordMovement({ companyId: ctx.companyId, userId: ctx.userId }, {
      cardId: id,
      label: card.code || id,
      plan,
      currency: card.currency,
      notes: body.notes,
      orderId: body.order,
      auditAction: "gift_card_redeemed",
      auditDescription:
        `Gift card ${card.code || id}: consumidos ${plan.amount} ${(card.currency || "").toUpperCase()}, ` +
        `saldo restante ${plan.balance_after}`,
    });

    return ok({ amount: plan.amount, balance: plan.balance_after, status: plan.status, currency: card.currency });
  } catch (err) {
    return fail(err);
  }
}

/** GET /api/gift-cards/:id/redeem — si la tarjeta serviría, sin consumirla. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "gift-cards:check", ctx.userId), limit: 240, windowMs: 60_000 });

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
