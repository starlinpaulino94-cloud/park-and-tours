import "server-only";
import { tenantCreate, tenantUpdate } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import type { GiftCardMovementPlan } from "@/lib/gift-cards";

/**
 * Persistencia de un movimiento de gift card.
 *
 * Las tres acciones que mueven saldo —consumir, devolver y anular— hacen lo
 * mismo: dejan el nuevo saldo en la tarjeta, escriben la fila de
 * `gift_card_movement` que lo explica, y lo auditan. Se escribe el movimiento
 * DESPUÉS de actualizar la tarjeta, para que un fallo a mitad no deje un
 * movimiento que nadie aplicó.
 *
 * Es el ÚNICO punto del código que escribe un saldo de gift card: incluso la
 * emisión crea la tarjeta en cero y la funde con su movimiento, para que no haya
 * una segunda vía por la que un saldo pueda aparecer sin explicación.
 */

export interface MovementContext {
  companyId: string;
  userId?: string;
}

export interface MovementInput {
  cardId: string;
  label: string;
  plan: GiftCardMovementPlan;
  currency?: string | null;
  notes?: string;
  orderId?: string;
  auditAction: string;
  auditDescription: string;
  severity?: "info" | "warning";
}

export async function recordMovement(ctx: MovementContext, input: MovementInput): Promise<void> {
  const { plan } = input;

  await tenantUpdate(ctx.companyId, "gift_card", input.cardId, {
    balance: plan.balance_after,
    status: plan.status,
  });

  await tenantCreate(ctx.companyId, "gift_card_movement", {
    gift_card: input.cardId,
    movement_type: plan.movement_type,
    amount: plan.amount,
    balance_after: plan.balance_after,
    moved_at: new Date().toISOString(),
    notes: input.notes,
    user: ctx.userId,
    ...(input.orderId ? { order: input.orderId } : {}),
  });

  await writeAudit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: input.auditAction,
    entityType: "gift_card",
    entityId: input.cardId,
    description: input.auditDescription,
    severity: input.severity || "info",
    metadata: {
      movement_type: plan.movement_type,
      amount: plan.amount,
      balance_after: plan.balance_after,
      currency: input.currency || undefined,
    },
  });
}
