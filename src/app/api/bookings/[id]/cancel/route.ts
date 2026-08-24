import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantCreate, tenantFindOne, tenantQuery, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { recalculateDeparture } from "@/lib/availability";
import { syncOrderTotals } from "@/lib/booking-service";
import { postPayment } from "@/lib/ledger-events";
import { writeAudit } from "@/lib/audit";
import { parseJson } from "@/lib/format";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import type { Booking, CancellationPolicy, CancellationTier, Product } from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * POST /api/bookings/:id/cancel
 * Applies the product's cancellation policy to compute the refund, cancels the
 * booking, releases the seat and voids the related commissions.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "bookings:cancel", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<{ reason?: string; refund_override?: number }>(req);
    const booking = await tenantFindOne<Booking>(ctx.companyId, "booking", id, { product: true, departure: true });

    // AUD-B03: block all terminal states, not just "cancelled". A first refund
    // leaves the booking in "refunded"/"partially_refunded", which previously
    // passed this guard and allowed a second cancellation to issue a DUPLICATE
    // refund payment. A double-click on the cancel dialog hit the same bug.
    const TERMINAL = ["cancelled", "refunded", "partially_refunded"];
    if (booking.status && TERMINAL.includes(booking.status)) {
      throw Object.assign(
        new Error("La reserva ya fue cancelada o reembolsada"),
        { status: 409 }
      );
    }

    // ---- refund according to the applicable policy ------------------------
    const product = typeof booking.product === "object" ? (booking.product as Product) : null;
    const policyId = refId(product?.cancellation_policy);
    let refundPct = 0;
    let policyName = "Sin política definida";

    if (policyId) {
      const policy = (await tenantQuery<CancellationPolicy>(ctx.companyId, "cancellation_policy", {
        _filter: { _id: policyId }, _limit: 1,
      }))[0];
      if (policy) {
        policyName = policy.name || policyName;
        const tiers = parseJson<CancellationTier[]>(policy.tiers, []);
        const travel = booking.travel_date ? new Date(booking.travel_date) : null;
        const hoursBefore = travel ? (travel.getTime() - Date.now()) / 3_600_000 : Number.POSITIVE_INFINITY;
        const sorted = [...tiers].sort((a, b) => b.hours_before - a.hours_before);
        for (const tier of sorted) {
          if (hoursBefore >= tier.hours_before) { refundPct = tier.refund_pct; break; }
        }
      }
    }

    const total = booking.total_amount ?? 0;
    const paid = booking.paid_amount ?? 0;
    const policyRefund = Math.round(((total * refundPct) / 100 + Number.EPSILON) * 100) / 100;
    const refund = body.refund_override != null
      ? Math.max(0, Math.min(body.refund_override, paid))
      : Math.min(policyRefund, paid);

    if (body.refund_override != null) requireAtLeast(ctx, "manager");

    await tenantUpdate(ctx.companyId, "booking", id, {
      status: refund > 0 ? (refund >= paid ? "refunded" : "partially_refunded") : "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: body.reason || "Cancelada por el usuario",
      refund_amount: refund,
      balance_amount: 0,
    });

    // ---- void commissions --------------------------------------------------
    const commissions = await tenantQuery<{ _id: string; status?: string }>(ctx.companyId, "commission", {
      _filter: { booking: id, status: { in: ["pending", "approved"] } }, _limit: 50,
    });
    for (const c of commissions) {
      await tenantUpdate(ctx.companyId, "commission", c._id, {
        status: "cancelled",
        notes: "Anulada por cancelación de la reserva",
      });
    }

    // ---- invalidate vouchers ----------------------------------------------
    const vouchers = await tenantQuery<{ _id: string }>(ctx.companyId, "voucher", {
      _filter: { booking: id, status: "valid" }, _limit: 10,
    });
    for (const v of vouchers) {
      await tenantUpdate(ctx.companyId, "voucher", v._id, { status: "cancelled" });
    }

    // ---- release the seat --------------------------------------------------
    const departureId = refId(booking.departure);
    if (departureId) await recalculateDeparture(ctx.companyId, departureId);

    const orderId = refId(booking.order);

    // ---- refund payment record --------------------------------------------
    // AUD (over-refund): the refund payment must be created BEFORE syncOrderTotals
    // so the order's paid_total reflects it. Otherwise the order kept a stale
    // paid_total and a second refund could pass the payments API's cap.
    if (refund > 0) {
      const refundPayment = await tenantCreate<{ _id?: string }>(ctx.companyId, "payment", {
        order: orderId,
        booking: id,
        customer: refId(booking.customer),
        user: ctx.userId,
        reference: `REF-${booking.booking_number}`,
        payment_type: "refund",
        method: "cash",
        status: "completed",
        amount: refund,
        currency: booking.currency || "usd",
        paid_at: new Date().toISOString(),
        notes: `Reembolso por cancelación (${policyName}, ${refundPct}%)`,
      });
      // Double-entry ledger (AUD-F15), best-effort.
      const refundPaymentId = refundPayment._id;
      if (refundPaymentId) {
        await postPayment(ctx.companyId, {
          paymentId: refundPaymentId,
          orderId,
          amount: refund,
          method: "cash",
          currency: booking.currency || "usd",
          isRefund: true,
          userId: ctx.userId,
        });
      }
    }

    // Now recompute the order totals — after the refund exists, so paid_total
    // and balance account for it.
    if (orderId) await syncOrderTotals(ctx.companyId, orderId);

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "booking_cancelled", entityType: "booking", entityId: id,
      description: `Reserva ${booking.booking_number} cancelada. Reembolso ${refund} (${refundPct}% — ${policyName})`,
      severity: "warning",
      metadata: { refund, refundPct, policyName, reason: body.reason },
    });

    console.log(`[cancel] reserva ${booking.booking_number} cancelada · reembolso ${refund}`);
    return ok({ cancelled: true, refund, refund_pct: refundPct, policy: policyName, commissions_voided: commissions.length });
  } catch (err) {
    return fail(err);
  }
}
