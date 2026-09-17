import "server-only";
import { tenantCreate, tenantQuery, tenantUpdate, type TenantContext } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import {
  adjustmentBlocker, adjustmentTotal, cancellationEffect, netCommission, round2,
  type AdjustmentReason,
} from "@/lib/commission-adjustments";
import type { Commission, Currency } from "@/lib/types";

/**
 * Los ajustes de comisión contra la base.
 *
 * Todo lo que decide vive en `commission-adjustments.ts`, que es puro. Aquí
 * solo se lee, se escribe y se deja rastro.
 */

interface AdjustmentRow {
  _id: string;
  amount?: number | null;
  reason?: string | null;
  reason_code?: string | null;
  created_at?: string | null;
}

/** Los ajustes de una comisión, del más antiguo al más nuevo. */
export async function adjustmentsOf(companyId: string, commissionId: string): Promise<AdjustmentRow[]> {
  return tenantQuery<AdjustmentRow>(companyId, "commission_adjustment", {
    _filter: { commission: commissionId },
    _sort: { created_at: "asc" },
    _limit: 200,
  });
}

/**
 * Recalcula el neto de una comisión desde sus ajustes.
 *
 * Se hace aquí y no con un disparador que agregue en la base a propósito: un
 * disparador sería un SEGUNDO sitio donde se decide dinero, y el día que las
 * dos fórmulas se separen —porque alguien tocó una— la diferencia aparecería en
 * una liquidación sin que nada la explique. Es la misma decisión que
 * `syncOrderTotals`.
 */
export async function syncCommissionNet(companyId: string, commissionId: string): Promise<number> {
  const [commission] = await tenantQuery<Commission>(companyId, "commission", {
    _filter: { _id: commissionId }, _limit: 1,
  });
  if (!commission) return 0;

  const adjustments = await adjustmentsOf(companyId, commissionId);
  const total = adjustmentTotal(adjustments);
  const net = netCommission(Number(commission.amount ?? 0), adjustments);

  await tenantUpdate(companyId, "commission", commissionId, {
    adjustment_total: total,
    net_amount: net,
  });
  return net;
}

export interface AdjustInput {
  commissionId: string;
  /** CON SIGNO: negativo descuenta, positivo añade. */
  amount: number;
  reason: string;
  reasonCode?: AdjustmentReason;
  bookingId?: string | null;
}

export interface AdjustResult {
  adjustmentId: string;
  net: number;
}

/** Añade un ajuste firmado y deja el neto al día. */
export async function adjustCommission(
  ctx: TenantContext & { companyId: string },
  input: AdjustInput
): Promise<AdjustResult> {
  const [commission] = await tenantQuery<Commission>(ctx.companyId, "commission", {
    _filter: { _id: input.commissionId }, _limit: 1,
  });
  if (!commission) throw Object.assign(new Error("La comisión no existe"), { status: 404 });

  const blocker = adjustmentBlocker({
    amount: input.amount, reason: input.reason, status: commission.status,
  });
  if (blocker) throw Object.assign(new Error(blocker), { status: 400 });

  const created = await tenantCreate<{ _id: string }>(ctx.companyId, "commission_adjustment", {
    commission: input.commissionId,
    amount: round2(input.amount),
    currency: (commission.currency || "usd") as Currency,
    reason: input.reason.trim().slice(0, 300),
    reason_code: input.reasonCode || "correction",
    booking: input.bookingId || undefined,
    created_by: ctx.userId || undefined,
  });

  const net = await syncCommissionNet(ctx.companyId, input.commissionId);

  await writeAudit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "commission_adjusted",
    entityType: "commission",
    entityId: input.commissionId,
    description:
      `Ajuste de ${round2(input.amount)} sobre la comisión de ${commission.beneficiary_name || "un beneficiario"}. ` +
      `Motivo: ${input.reason.trim()}. Queda un neto de ${net}.`,
    severity: "warning",
    metadata: { amount: round2(input.amount), reason_code: input.reasonCode || "correction", net },
  });

  return { adjustmentId: created._id, net };
}

/**
 * Lo que hay que hacer con las comisiones de una reserva que se cancela.
 *
 * Antes de 0059 esto anulaba las pendientes y NO TOCABA las pagadas: el dinero
 * había salido, la venta se caía, y no quedaba ni rastro de que hubiera que
 * recuperarlo. Ahora las pagadas se ajustan en negativo, que deja las dos
 * cifras a la vista.
 *
 * Devuelve cuántas anuló y cuántas ajustó, para que quien cancela lo vea.
 */
export async function settleCommissionsOnCancel(
  ctx: TenantContext & { companyId: string },
  bookingId: string,
  reference: string
): Promise<{ voided: number; adjusted: number; clawback: number }> {
  const commissions = await tenantQuery<Commission>(ctx.companyId, "commission", {
    _filter: { booking: bookingId }, _limit: 50,
  });

  let voided = 0;
  let adjusted = 0;
  let clawback = 0;

  for (const commission of commissions) {
    const adjustments = await adjustmentsOf(ctx.companyId, commission._id);
    const effect = cancellationEffect(
      { status: commission.status, amount: commission.amount },
      adjustments,
      reference
    );

    if (effect.action === "void") {
      await tenantUpdate(ctx.companyId, "commission", commission._id, {
        status: "cancelled",
        notes: effect.reason,
        net_amount: 0,
      });
      voided += 1;
      continue;
    }

    if (effect.action === "adjust") {
      /**
       * NO se le cambia el estado.
       *
       * Sigue estando pagada, porque se pagó. Poner `cancelled` sobre una
       * comisión cuyo dinero salió es justo la mentira que este ajuste viene a
       * evitar: el histórico diría que nunca se pagó.
       */
      await tenantCreate(ctx.companyId, "commission_adjustment", {
        commission: commission._id,
        amount: effect.amount,
        currency: (commission.currency || "usd") as Currency,
        reason: effect.reason,
        reason_code: effect.reasonCode,
        booking: bookingId,
        created_by: ctx.userId || undefined,
      });
      await syncCommissionNet(ctx.companyId, commission._id);
      adjusted += 1;
      clawback = round2(clawback + Math.abs(effect.amount));
    }
  }

  if (adjusted > 0) {
    // Que alguien lo vea: es dinero que ya salió y que hay que recuperar de la
    // siguiente liquidación. Sin este aviso, el ajuste existe y nadie actúa.
    await writeAudit({
      companyId: ctx.companyId,
      userId: ctx.userId,
      action: "commission_clawback",
      entityType: "booking",
      entityId: bookingId,
      description:
        `La reserva ${reference} se canceló con ${adjusted} comisión(es) ya pagada(s): ` +
        `${clawback} a recuperar en la próxima liquidación.`,
      severity: "warning",
      metadata: { adjusted, clawback },
    });
  }

  return { voided, adjusted, clawback };
}
