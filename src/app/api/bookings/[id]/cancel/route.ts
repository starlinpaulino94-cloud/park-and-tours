import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantCreate, tenantFindOne, tenantQuery, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { recalculateDeparture } from "@/lib/availability";
import { cancelBookingCosts } from "@/lib/supplier-settlement-service";
import { settleBookingStock } from "@/lib/stock-commitment-service";
import { syncOrderTotals } from "@/lib/booking-service";
import { postPayment } from "@/lib/ledger-events";
import { writeAudit } from "@/lib/audit";
import { notifyBookingCancelled } from "@/lib/messaging/events";
import { notify } from "@/lib/notify-service";
import { parseJson } from "@/lib/format";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import type { Booking, CancellationPolicy, CancellationTier, Product } from "@/lib/types";
import { refId } from "@/lib/types";
import { flushOutboxAfterResponse } from "@/lib/messaging/flush";

/**
 * POST /api/bookings/:id/cancel
 * Applies the product's cancellation policy to compute the refund, cancels the
 * booking, releases the seat and voids the related commissions.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "bookings:cancel", ctx.userId), limit: 30, windowMs: 60_000 });
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

    // ---- recogidas ---------------------------------------------------------
    // La recogida de una reserva cancelada seguía en «pendiente» y en su ruta:
    // el conductor pasaba igual por el hotel a buscar a alguien que canceló, y
    // el cupo del vehículo seguía contándolo. Nadie lo notaba hasta el lobby.
    const pickupsToCancel = await tenantQuery<{ _id: string }>(ctx.companyId, "pickup", {
      // Los estados reales de `pickup` (0011): pendiente, confirmada, recogida,
      // no-show y cancelada. Una ya recogida no se toca: eso ya ocurrió.
      _filter: { booking: id, status: { nin: ["cancelled", "picked_up"] } }, _limit: 20,
    });
    for (const pickup of pickupsToCancel) {
      await tenantUpdate(ctx.companyId, "pickup", pickup._id, { status: "cancelled", route: null });
    }

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

    // ---- cancelar el devengo del proveedor (0040) --------------------------
    // Una reserva cancelada no le debe nada al transportista ni al restaurante.
    // Un servicio YA liquidado no se toca: ese dinero salió, y lo que procede
    // entonces es un ajuste en la liquidación, no borrar el devengo.
    const cancelledCosts = await cancelBookingCosts(
      ctx.companyId, id, `Reserva ${booking.booking_number ?? id} cancelada`
    );

    // ---- soltar las existencias apartadas (0052) --------------------------
    // Los almuerzos que esta reserva tenía apartados vuelven a estar
    // disponibles. No sale movimiento: nunca salieron del almacén.
    //
    // Si ya se habían CONSUMIDO —la reserva se canceló después del embarque—
    // no se liberan: esas unidades salieron de verdad, y volver a sumarlas sin
    // rastro descuadraría el almacén. `settleBookingStock` lo distingue y lo
    // devuelve como problema para que quede en el log.
    try {
      const almacen = await settleBookingStock(ctx.companyId, id, "release", ctx.userId);
      for (const problema of almacen.problems) console.warn(`[cancel] almacén: ${problema}`);
    } catch (err) {
      console.error("[cancel] no se pudieron liberar las existencias apartadas:", err);
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
      metadata: { refund, refundPct, policyName, reason: body.reason, supplier_costs_cancelled: cancelledCosts },
    });

    // El cliente tiene que saberlo antes de presentarse en el lobby.
    try {
      await notifyBookingCancelled(
        ctx.company, ctx.companyId, booking,
        body.reason || "Cancelada por la agencia", ctx.userId
      );
    } catch (err) {
      console.error("[cancel] no se pudo encolar el aviso de cancelación:", err);
    }

    // El aviso interno: una cancelación libera cupo y casi siempre mueve
    // dinero, así que el gerente se entera sin tener que entrar a mirar.
    await notify({
      companyId: ctx.companyId,
      event: "booking_cancelled",
      entityType: "booking",
      entityId: booking._id,
      vars: {
        referencia: booking.booking_number,
        motivo: body.reason || null,
      },
    });

    console.log(`[cancel] reserva ${booking.booking_number} cancelada · reembolso ${refund}`);
    // La cancelación ya está registrada y la plaza liberada. El aviso al cliente
    // sale ahora: tiene que saberlo antes de presentarse en el lobby, y el
    // barrido diario podría llegar después de la hora de recogida.
    flushOutboxAfterResponse(ctx.company, ctx.companyId);
    return ok({
      cancelled: true, refund, refund_pct: refundPct, policy: policyName,
      commissions_voided: commissions.length, pickups_cancelled: pickupsToCancel.length,
    });
  } catch (err) {
    return fail(err);
  }
}
