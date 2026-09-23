import { NextRequest } from "next/server";
import { requireTenant, tenantFindOne, tenantQuery, TenantError, esDeSocio } from "@/lib/tenant";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { buildVoucherPdf } from "@/lib/pdf/documents";
import { pdfResponse } from "@/lib/pdf/doc";
import { personName } from "@/lib/manifest";
import { refId } from "@/lib/types";
import type { Booking } from "@/lib/types";

/**
 * La política de cancelación, en palabras.
 *
 * Se guarda como una fila con tramos (`tiers`), y lo que el cliente necesita en
 * el papel es la frase, no el JSON: "sin cargo hasta 15 días antes, 50% después".
 */
function policyText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const policy = value as { name?: string; description?: string; tiers?: unknown };
  const tiers = Array.isArray(policy.tiers) ? policy.tiers : [];
  const spelled = tiers
    .map((t) => {
      const tier = t as { hours_before?: number; refund_pct?: number; label?: string };
      if (tier.label) return tier.label;
      if (tier.hours_before === undefined || tier.refund_pct === undefined) return "";
      return `Hasta ${tier.hours_before} h antes: reembolso del ${tier.refund_pct}%`;
    })
    .filter(Boolean)
    .join(". ");
  return [policy.description || policy.name, spelled].filter(Boolean).join(". ") || null;
}

/**
 * GET /api/bookings/:id/voucher — el voucher en PDF.
 *
 * Hasta ahora el voucher era un código de texto dentro de un correo: el cliente
 * llegaba a la puerta con una captura de pantalla y alguien tecleaba el código a
 * mano delante de la cola. El PDF lleva el QR que valida el check-in, la hora y
 * el lugar de recogida, y el saldo que queda por cobrar.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "bookings:voucher", ctx.userId), limit: 120, windowMs: 60_000 });

    const booking = await tenantFindOne<Booking & Record<string, unknown>>(ctx.companyId, "booking", id, {
      customer: true, product: { cancellation_policy: true }, modality: true,
      pickup_hotel: true, partner: true, seller: true,
    });

    // Un partner solo emite el voucher de lo que él vendió.
    if (esDeSocio(ctx) && refId(booking.partner) !== ctx.partnerId) {
      throw new TenantError("Esa reserva no es de tu cartera", 403);
    }

    const expanded = (value: unknown): Record<string, unknown> | null =>
      value && typeof value === "object" ? (value as unknown as Record<string, unknown>) : null;
    const product = expanded(booking.product);
    const hotel = expanded(booking.pickup_hotel);
    const modality = expanded(booking.modality);

    // El código del voucher vive en su propia tabla; `booking.voucher_code` es la
    // copia que se escribe al vender. Se prefiere el vivo: si el voucher se
    // reemitió, es ese el que el escáner reconoce.
    const vouchers = await tenantQuery<{ code?: string; status?: string }>(ctx.companyId, "voucher", {
      _filter: { booking: id, status: "valid" }, _limit: 1,
    });

    // Los extras contratados salen en el papel: el guía tiene que saber quién
    // lleva almuerzo pagado, y el cliente, qué compró.
    const extras = await tenantQuery<{ name?: string; quantity?: number; total_amount?: number }>(
      ctx.companyId, "booking_extra", { _filter: { booking: id }, _limit: 30 }
    );

    const bytes = await buildVoucherPdf(ctx.company, {
      booking_number: booking.booking_number,
      voucher_code: vouchers[0]?.code || booking.voucher_code,
      status: booking.status,
      customer_name: personName(booking.customer),
      // El idioma del huésped: el voucher lo enseña ÉL en la puerta.
      language: (booking.customer as { language?: string } | null)?.language ?? null,
      product_name: (product?.name as string) ?? null,
      modality_name: (modality?.name as string) ?? null,
      travel_date: booking.travel_date,
      adults: booking.adults, children: booking.children, infants: booking.infants,
      pax_total: booking.pax_total,
      pickup_hotel: (hotel?.name as string) ?? null,
      pickup_time: booking.pickup_time,
      pickup_location: booking.pickup_location,
      room_number: booking.room_number,
      meeting_point: (product?.meeting_point as string) ?? null,
      total_amount: booking.total_amount,
      paid_amount: booking.paid_amount,
      balance_amount: booking.balance_amount,
      currency: booking.currency,
      inclusions: (product?.inclusions as string) ?? null,
      exclusions: (product?.exclusions as string) ?? null,
      recommendations: (product?.recommendations as string) ?? null,
      restrictions: (product?.restrictions as string) ?? null,
      instructions: (product?.instructions as string) ?? null,
      conditions: (product?.terms as string) ?? null,
      cancellation_policy: policyText(product?.cancellation_policy),
      notes: booking.notes,
      extras: extras.map((e) => ({
        description: e.name || "Extra", quantity: Number(e.quantity) || 0, amount: Number(e.total_amount) || 0,
      })),
      sold_by: personName(booking.partner) || personName(booking.seller) || null,
    });

    return pdfResponse(bytes, `voucher-${booking.booking_number || id}.pdf`);
  } catch (err) {
    return fail(err);
  }
}
