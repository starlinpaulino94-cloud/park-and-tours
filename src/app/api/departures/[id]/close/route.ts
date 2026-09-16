import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantQuery, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  manifestRow, closeBlocker, closeTotals, CLOSE_BLOCK_MESSAGE, FORCEABLE_CLOSE_BLOCKS,
  DEAD_BOOKING_STATUSES, type ManifestBookingInput,
} from "@/lib/manifest";

/**
 * POST /api/departures/:id/close — cierra la salida con lo que pasó de verdad.
 *
 * Cerrar es afirmar cuánta gente viajó, y ese número no es el vendido: un
 * no-show se cobró y no ocupó asiento. De `actual_pax` salen la ocupación real,
 * la rentabilidad por salida y lo que se le paga al guía, así que no puede
 * teclearse en un formulario ni derivarse de `booked_pax`: se cuenta desde los
 * check-in que el guía fue marcando.
 *
 * `departure.status` no es escribible por el CRUD desde AUD-B02/B16 —editarlo
 * permitía reabrir una salida llena y sobrevender—, así que 'completed' solo
 * puede llegar por aquí.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "departures:close", ctx.userId), limit: 60, windowMs: 60_000 });
    requireAtLeast(ctx, "operations");

    const body = await readJson<{
      incident_notes?: string; guide_notes?: string; departed_at?: string; returned_at?: string;
      force?: boolean; reason?: string;
    }>(req);

    const departure = await tenantFindOne<Record<string, unknown>>(ctx.companyId, "departure", id);
    const bookings = await tenantQuery<ManifestBookingInput>(ctx.companyId, "booking", {
      _filter: { departure: id }, _limit: 500,
      customer: true, pickup_hotel: { zone: true }, participant: { _limit: 200 },
    });
    const rows = bookings
      .filter((b) => !DEAD_BOOKING_STATUSES.has(String(b.status || "")))
      .map(manifestRow);

    const blocker = closeBlocker(departure as never, rows);
    if (blocker) {
      if (!body.force || !FORCEABLE_CLOSE_BLOCKS.has(blocker)) {
        throw Object.assign(new Error(CLOSE_BLOCK_MESSAGE[blocker]), { status: 409 });
      }
      // Cerrar con la lista a medio marcar, o antes de que la salida parta, es
      // una excepción del coordinador: se firma con motivo y queda auditada.
      requireAtLeast(ctx, "manager");
      if (!body.reason?.trim()) {
        throw Object.assign(new Error("Cerrar la salida saltándose una comprobación necesita un motivo"), { status: 400 });
      }
    }

    const totals = closeTotals(rows);
    const uncollected = Object.entries(totals.uncollected)
      .map(([currency, amount]) => `${amount} ${currency.toUpperCase()}`)
      .join(" + ");
    const now = new Date().toISOString();

    await tenantUpdate(ctx.companyId, "departure", id, {
      status: "completed",
      closed_at: now,
      closed_by: ctx.userId,
      departed_at: body.departed_at || departure.departed_at || departure.departure_at,
      returned_at: body.returned_at || undefined,
      actual_pax: totals.actual_pax,
      no_show_pax: totals.no_show_pax,
      incident_notes: body.incident_notes?.trim() || undefined,
      guide_notes: body.guide_notes?.trim() || undefined,
    });

    // Una reserva que embarcó y volvió está completada: dejarla en 'checked_in'
    // la mantiene para siempre en las colas de operación del día.
    let completed = 0;
    for (const row of rows) {
      if (row.checkin_status !== "done") continue;
      await tenantUpdate(ctx.companyId, "booking", row.booking_id, { status: "completed" });
      completed++;
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "departure_closed",
      entityType: "departure", entityId: id,
      description:
        `Salida cerrada con ${totals.actual_pax} pax embarcados` +
        (totals.no_show_pax > 0 ? `, ${totals.no_show_pax} no-show` : "") +
        (uncollected ? `, ${uncollected} sin cobrar` : "") +
        (body.incident_notes?.trim() ? ` — incidencia: ${body.incident_notes.trim()}` : "") +
        (blocker ? ` (forzado: ${body.reason})` : ""),
      severity: blocker || uncollected || body.incident_notes?.trim() ? "warning" : "info",
      metadata: { ...totals, bookings_completed: completed, forced_block: blocker || undefined },
    });

    return ok({ status: "completed", ...totals, bookings_completed: completed, forced: Boolean(blocker) });
  } catch (err) {
    return fail(err);
  }
}
