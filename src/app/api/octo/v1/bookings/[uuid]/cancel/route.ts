import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail, octoBody } from "@/lib/octo-http";
import { cancelBooking, OctoError } from "@/lib/octo-service";
import { isUuid } from "@/lib/octo";
import { writeAudit } from "@/lib/audit";
import { flushOutboxAfterResponse } from "@/lib/messaging/flush";

/**
 * POST /api/octo/v1/bookings/:uuid/cancel — cancelar.
 *
 * POST y no DELETE porque el estándar lo define así, y porque una cancelación
 * lleva cuerpo: el motivo, que es lo que la operadora lee al día siguiente.
 *
 * Por dentro hace exactamente lo mismo que cancelar de mostrador: suelta la
 * plaza, anula la comisión, devuelve el cupo del socio, cancela el devengo del
 * proveedor, libera las existencias apartadas, invalida el voucher y avisa. No
 * hay una versión corta «para APIs».
 *
 * Nota sobre `force`: el estándar lo admite para saltarse el corte de la
 * política, y aquí NO se obedece. El corte es el acuerdo comercial de la
 * operadora, y dejar que el revendedor lo ignore desde su servidor sería
 * dejarle decidir el reembolso. La cancelación se registra igual; lo que manda
 * la política es cuánto se devuelve.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ uuid: string }> }) {
  let active: string[] = [];
  try {
    const { ctx, capabilities } = await octoRequest(req, "write");
    active = capabilities;

    const { uuid } = await params;
    if (!isUuid(uuid)) throw new OctoError("INVALID_BOOKING_UUID", "El uuid no es válido.", { uuid });

    const body = await octoBody(req).catch(() => ({}) as Record<string, unknown>);
    const booking = await cancelBooking(ctx, uuid, {
      reason: typeof body.reason === "string" ? body.reason : null,
    });

    await writeAudit({
      companyId: ctx.companyId,
      action: "octo_booking_cancelled",
      entityType: "booking",
      entityId: booking.id,
      description: `Reserva cancelada por un revendedor (OCTO): ${booking.supplierReference ?? booking.uuid}`,
      severity: "warning",
      metadata: {
        key: ctx.keyId, partner: ctx.partnerId, uuid: booking.uuid,
        reason: booking.cancellation?.reason ?? null, refund: booking.cancellation?.refund ?? null,
      },
    });

    flushOutboxAfterResponse(ctx.company, ctx.companyId);
    return octoJson(booking, capabilities);
  } catch (err) {
    return octoFail(err, active);
  }
}
