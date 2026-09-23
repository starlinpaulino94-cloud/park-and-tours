import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, tenantFindOne, tenantQuery, tenantUpdate, esDeSocio } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { ensureSchedule, setSchedule, refreshAllocation } from "@/lib/schedule-service";
import { buildSchedule, dayOf, collectionStatus, type PlannedInstallment } from "@/lib/collections";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import type { Order, PaymentScheduleRow } from "@/lib/types";

/** GET /api/orders/:id/schedule — el calendario de cobro de la venta. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "orders:schedule:get", ctx.userId), limit: 120, windowMs: 60_000 });

    const order = await tenantFindOne<Order>(ctx.companyId, "order", id, { customer: true, partner: true });
    // Un socio solo ve lo suyo: el calendario dice cuánto debe alguien.
    if (esDeSocio(ctx)) {
      const partnerId = typeof order.partner === "object" ? order.partner?._id : order.partner;
      if (!ctx.partnerId || partnerId !== ctx.partnerId) {
        throw Object.assign(new Error("No tienes acceso a esta venta"), { status: 403 });
      }
    }

    // Una venta sin plan gana el suyo al consultarlo: las órdenes anteriores a
    // 0039 no tienen calendario y sin esto no lo tendrían nunca.
    await ensureSchedule(ctx.companyId, id);

    const rows = await tenantQuery<PaymentScheduleRow>(ctx.companyId, "payment_schedule", {
      _filter: { order: id }, _limit: 60, _sort: { sequence: "asc" }, booking: true,
    });

    return ok({
      order: {
        _id: order._id, order_number: order.order_number, currency: order.currency,
        total: order.total, paid_total: order.paid_total, balance: order.balance,
        deposit_type: order.deposit_type, deposit_percent: order.deposit_percent,
        deposit_amount: order.deposit_amount, deposit_due_date: order.deposit_due_date,
        balance_due_date: order.balance_due_date, payment_terms: order.payment_terms,
        collection_status: order.collection_status,
      },
      installments: rows,
      status: collectionStatus(rows),
    });
  } catch (err) {
    return fail(err);
  }
}

/**
 * POST /api/orders/:id/schedule — fija o rehace el calendario de cobro.
 *
 * Dos formas de usarlo:
 *   · `installments: [...]` — el plan pactado a mano. Tiene que sumar el total.
 *   · `deposit_type` / `installments_count` / fechas — se pide al sistema que lo
 *     construya con esas condiciones.
 *
 * En los dos casos la imputación de lo ya cobrado se recalcula desde
 * `paid_total`, así que rehacer el plan no pierde ni duplica un pago.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "orders:schedule:set", ctx.userId), limit: 30, windowMs: 60_000 });
    // Cambiar cuándo y cuánto se cobra es una decisión comercial, no una
    // corrección de datos: un vendedor no se aplaza su propio saldo.
    requireAtLeast(ctx, "manager");

    const body = await readJson<{
      installments?: { kind?: string; due_date?: string; amount?: number }[];
      deposit_type?: string;
      deposit_percent?: number;
      deposit_amount?: number;
      deposit_due_date?: string;
      balance_due_date?: string;
      payment_terms?: string;
      installments_count?: number;
      reason?: string;
    }>(req);

    const order = await tenantFindOne<Order>(ctx.companyId, "order", id);
    if (order.status === "cancelled" || order.status === "refunded") {
      throw Object.assign(
        new Error("Una venta cancelada no tiene nada que cobrar"),
        { status: 409 }
      );
    }
    const total = order.total ?? 0;
    if (total <= 0) {
      throw Object.assign(new Error("La venta todavía no tiene importe"), { status: 409 });
    }

    // Las condiciones quedan escritas en la venta aunque el plan se dé a mano:
    // son lo que se le dice al cliente y lo que se imprime en la cotización.
    const terms: Record<string, unknown> = {};
    if (body.deposit_type !== undefined) {
      if (!["none", "percent", "amount"].includes(body.deposit_type)) {
        throw Object.assign(new Error("Tipo de anticipo no válido"), { status: 400 });
      }
      terms.deposit_type = body.deposit_type;
    }
    if (body.deposit_percent !== undefined) terms.deposit_percent = Number(body.deposit_percent);
    if (body.deposit_amount !== undefined) terms.deposit_amount = Number(body.deposit_amount);
    if (body.deposit_due_date !== undefined) terms.deposit_due_date = dayOf(body.deposit_due_date);
    if (body.balance_due_date !== undefined) terms.balance_due_date = dayOf(body.balance_due_date);
    if (body.payment_terms !== undefined) terms.payment_terms = body.payment_terms;
    if (Object.keys(terms).length > 0) await tenantUpdate(ctx.companyId, "order", id, terms);

    let planned: PlannedInstallment[];
    if (Array.isArray(body.installments) && body.installments.length > 0) {
      planned = body.installments.map((installment, index) => {
        const due = dayOf(installment.due_date);
        if (!due) {
          throw Object.assign(
            new Error(`La cuota ${index + 1} necesita una fecha de vencimiento`),
            { status: 400 }
          );
        }
        const amount = Number(installment.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw Object.assign(new Error(`La cuota ${index + 1} necesita un importe`), { status: 400 });
        }
        const kind = installment.kind === "deposit" || installment.kind === "balance"
          ? installment.kind
          : "installment";
        return { sequence: index + 1, kind, due_date: due, amount };
      });
    } else {
      const refreshed = await tenantFindOne<Order>(ctx.companyId, "order", id);
      planned = buildSchedule({
        total,
        policy: {
          deposit_type: refreshed.deposit_type,
          deposit_percent: refreshed.deposit_percent,
          deposit_amount: refreshed.deposit_amount,
        },
        depositDueDate: dayOf(refreshed.deposit_due_date),
        balanceDueDate: dayOf(refreshed.balance_due_date),
        installments: body.installments_count ?? 1,
      });
      if (planned.length === 0) {
        throw Object.assign(new Error("Esas condiciones no producen ninguna cuota"), { status: 400 });
      }
    }

    await setSchedule(ctx.companyId, id, planned);
    await refreshAllocation(ctx.companyId, id);

    const rows = await tenantQuery<PaymentScheduleRow>(ctx.companyId, "payment_schedule", {
      _filter: { order: id }, _limit: 60, _sort: { sequence: "asc" },
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "payment_schedule_set", entityType: "order", entityId: id,
      description: `Plan de cobro de ${order.order_number}: ${planned.length} cuota(s)` +
        (body.reason ? ` · ${body.reason}` : ""),
      metadata: { installments: planned, reason: body.reason || null },
    });

    console.log(`[cobros] plan de ${order.order_number} · ${planned.length} cuotas`);
    return ok({ installments: rows.filter((r) => r.status !== "cancelled") });
  } catch (err) {
    return fail(err);
  }
}
