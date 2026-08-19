import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne, tenantQuery } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";
import { writeAudit } from "@/lib/audit";
import type { Booking } from "@/lib/types";

/**
 * POST /api/bookings/:id/checkin
 * Supports full check-in, partial check-in and no-show, validating the voucher
 * and the payment status.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    requireAtLeast(ctx, "operations");

    const body = await readJson<{
      pax?: number; no_show?: boolean; participant_ids?: string[]; notes?: string; force?: boolean;
    }>(req);

    const booking = await tenantFindOne<Booking>(ctx.companyId, "booking", id, { participant: { _limit: 100 } });

    if (booking.status === "cancelled" || booking.status === "refunded") {
      throw Object.assign(new Error("No se puede hacer check-in de una reserva cancelada"), { status: 409 });
    }

    const balance = booking.balance_amount ?? 0;
    if (balance > 0.009 && !body.force) {
      throw Object.assign(
        new Error(`La reserva tiene un saldo pendiente de ${balance}. Cobra el saldo o fuerza el check-in.`),
        { status: 402 }
      );
    }

    if (body.no_show) {
      await totalumSdk.crud.editRecordById("booking", id, {
        status: "no_show", checkin_status: "no_show",
        checked_in_at: new Date().toISOString(), checked_in_by: ctx.userId,
        internal_notes: body.notes || booking.internal_notes,
      });
      await writeAudit({
        companyId: ctx.companyId, userId: ctx.userId,
        action: "booking_no_show", entityType: "booking", entityId: id,
        description: `No-show registrado en ${booking.booking_number}`, severity: "warning",
      });
      return ok({ status: "no_show" });
    }

    const totalPax = booking.pax_total ?? 0;
    const checkedPax = Math.max(0, Math.min(body.pax ?? totalPax, totalPax));
    const complete = checkedPax >= totalPax && totalPax > 0;

    await totalumSdk.crud.editRecordById("booking", id, {
      status: complete ? "checked_in" : booking.status,
      checkin_status: complete ? "done" : checkedPax > 0 ? "partial" : "pending",
      checked_in_pax: checkedPax,
      checked_in_at: new Date().toISOString(),
      checked_in_by: ctx.userId,
      internal_notes: body.notes || booking.internal_notes,
    });

    // Mark the individual participants when provided.
    for (const pid of body.participant_ids || []) {
      await totalumSdk.crud.editRecordById("participant", pid, { checkin_status: "done" });
    }

    // Burn the voucher so it cannot be reused.
    if (complete) {
      const vouchers = await tenantQuery<{ _id: string }>(ctx.companyId, "voucher", {
        _filter: { booking: id, status: "valid" }, _limit: 5,
      });
      for (const v of vouchers) {
        await totalumSdk.crud.editRecordById("voucher", v._id, {
          status: "used", used_at: new Date().toISOString(),
        });
      }
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: complete ? "booking_checked_in" : "booking_partial_checkin",
      entityType: "booking", entityId: id,
      description: `Check-in ${checkedPax}/${totalPax} en ${booking.booking_number}${body.force ? " (forzado con saldo pendiente)" : ""}`,
      severity: body.force ? "warning" : "info",
    });

    console.log(`[checkin] ${booking.booking_number}: ${checkedPax}/${totalPax}`);
    return ok({ status: complete ? "checked_in" : "partial", checked_in_pax: checkedPax, total_pax: totalPax });
  } catch (err) {
    return fail(err);
  }
}
