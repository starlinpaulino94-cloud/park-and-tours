import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne, tenantQuery, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
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

    if (["cancelled", "refunded", "partially_refunded"].includes(booking.status || "")) {
      throw Object.assign(new Error("No se puede hacer check-in de una reserva cancelada o reembolsada"), { status: 409 });
    }

    // AUD-B04: block re-use of an already completed check-in. The UI disables
    // the button, but the API previously accepted a repeat check-in, letting a
    // ticket be presented twice. no_show is still allowed to correct a mistake.
    if (booking.checkin_status === "done" && !body.no_show) {
      throw Object.assign(new Error("Esta reserva ya tiene el check-in completado"), { status: 409 });
    }

    const balance = booking.balance_amount ?? 0;
    if (balance > 0.009 && !body.force) {
      throw Object.assign(
        new Error(`La reserva tiene un saldo pendiente de ${balance}. Cobra el saldo o fuerza el check-in.`),
        { status: 402 }
      );
    }

    // AUD-B04: validate the ticket itself, not just the booking. A cancelled or
    // expired voucher must never pass check-in (the docstring promised this but
    // the code only looked at booking state). Checked only for real check-in,
    // not for no-show correction.
    if (!body.no_show) {
      const bookingVouchers = await tenantQuery<{ _id: string; status?: string }>(ctx.companyId, "voucher", {
        _filter: { booking: id }, _limit: 5,
      });
      if (bookingVouchers.length > 0 && bookingVouchers.every((v) => ["cancelled", "expired"].includes(v.status || ""))) {
        throw Object.assign(new Error("El voucher de esta reserva está cancelado o expirado"), { status: 409 });
      }

      // Do not allow checking in a booking whose travel date is still in the
      // future (guards against presenting a ticket for the wrong day). Late
      // check-in stays allowed; a future date can still be forced.
      if (booking.travel_date && !body.force) {
        const travel = new Date(booking.travel_date);
        if (!Number.isNaN(travel.getTime())) {
          const oneDayMs = 86_400_000;
          if (travel.getTime() - Date.now() > oneDayMs) {
            throw Object.assign(
              new Error("La reserva es para una fecha futura; no se puede hacer check-in todavía (usa forzar si procede)."),
              { status: 409 }
            );
          }
        }
      }
    }

    if (body.no_show) {
      await tenantUpdate(ctx.companyId, "booking", id, {
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

    await tenantUpdate(ctx.companyId, "booking", id, {
      status: complete ? "checked_in" : booking.status,
      checkin_status: complete ? "done" : checkedPax > 0 ? "partial" : "pending",
      checked_in_pax: checkedPax,
      checked_in_at: new Date().toISOString(),
      checked_in_by: ctx.userId,
      internal_notes: body.notes || booking.internal_notes,
    });

    // Mark the individual participants when provided.
    // AUD-007: only participants that actually belong to THIS booking may be
    // touched. Previously any participant id from the request body was written,
    // allowing a cross-booking (and cross-tenant) write.
    const ownParticipantIds = new Set(
      (Array.isArray(booking.participant) ? booking.participant : [])
        .map((p) => (typeof p === "string" ? p : (p as { _id?: string })?._id))
        .filter((x): x is string => Boolean(x))
    );
    for (const pid of body.participant_ids || []) {
      if (!ownParticipantIds.has(pid)) {
        console.warn(`[checkin] ignorado participante ${pid} ajeno a la reserva ${id}`);
        continue;
      }
      await tenantUpdate(ctx.companyId, "participant", pid, { checkin_status: "done" });
    }

    // Burn the voucher so it cannot be reused.
    if (complete) {
      const vouchers = await tenantQuery<{ _id: string }>(ctx.companyId, "voucher", {
        _filter: { booking: id, status: "valid" }, _limit: 5,
      });
      for (const v of vouchers) {
        await tenantUpdate(ctx.companyId, "voucher", v._id, {
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
