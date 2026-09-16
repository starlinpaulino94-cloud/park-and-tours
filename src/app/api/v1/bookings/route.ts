import { NextRequest } from "next/server";
import { requireApiKey, apiError } from "@/lib/api-auth";
import { tenantQuery } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabase/service";
import { subscriptionState } from "@/lib/plan";
import { readPublicRequest, REQUEST_PROBLEM_MESSAGE } from "@/lib/public-booking";
import { createPublicBooking, loadPublicPage } from "@/lib/public-booking-service";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";

/**
 * POST /api/v1/bookings — un sistema externo crea una reserva.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCIA: LO PRIMERO, NO LO ÚLTIMO
 *
 * Un sistema externo REINTENTA. Se le cae la conexión a medio camino, su cola
 * lo reencola, su servidor se reinicia. Sin una clave, cada reintento crea otra
 * reserva y el socio descubre tres reservas idénticas cuando el cliente llega al
 * bus — con tres plazas ocupadas y una sola persona.
 *
 * Por eso `Idempotency-Key` es obligatoria: se comprueba ANTES de escribir
 * nada, y una repetición devuelve la MISMA reserva con 200 en vez de crear otra.
 * Hacerla opcional habría significado que el socio que más reintenta —el que
 * peor conexión tiene— es el que más duplica.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE EL SOCIO NO DECIDE
 *
 * El precio, el cupo, la moneda y la empresa. Igual que en el motor público: se
 * aceptan los datos que solo él conoce —quién viaja, cuántos, qué día— y todo lo
 * que tiene valor económico lo calcula el servidor. Una llave de API es una
 * contraseña que vende en nombre de la operadora; si además dejara poner el
 * precio, sería una contraseña que regala su margen.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await requireApiKey(req, "write");

    const idempotencyKey = (req.headers.get("idempotency-key") || "").trim().slice(0, 100);
    if (!idempotencyKey) {
      return Response.json({
        error: {
          message: "Falta la cabecera «Idempotency-Key»: manda un identificador único por reserva y repítelo si reintentas.",
          status: 400,
        },
      }, { status: 400 });
    }

    // ¿Ya se creó con esta clave? Se contesta la misma reserva.
    const { data: previous } = await supabaseService()
      .from("sales_order")
      .select("id, order_number")
      .eq("organization_id", caller.companyId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (previous) {
      const [booking] = await tenantQuery<Record<string, unknown>>(caller.companyId, "booking", {
        _filter: { order: previous.id }, _limit: 1,
      });
      return Response.json({
        data: {
          reference: String(booking?.booking_number || previous.order_number),
          order: previous.order_number,
          repeated: true,
        },
      });
    }

    // El plan: una suscripción vencida no registra operaciones nuevas, tampoco
    // por API. El mensaje lo dice para que el socio no crea que es su llave.
    const state = subscriptionState(caller.company);
    if (!state.canWrite) {
      return Response.json({
        error: { message: "La cuenta de esta operadora no admite reservas nuevas ahora mismo.", status: 402 },
      }, { status: 402 });
    }

    const parsed = readPublicRequest(await req.json().catch(() => ({})));
    if (parsed.ok === false) {
      return Response.json(
        { error: { message: REQUEST_PROBLEM_MESSAGE[parsed.problem], code: parsed.problem, status: 400 } },
        { status: 400 }
      );
    }

    // El catálogo publicado, otra vez la única fuente: un socio no vende lo que
    // la operadora no puso a la venta fuera.
    const page = await loadPublicPageForKey(caller.companyId);
    const product = page.products.find((p) => p.id === parsed.request.productId);
    if (!product) {
      return Response.json(
        { error: { message: REQUEST_PROBLEM_MESSAGE.product, status: 404 } },
        { status: 404 }
      );
    }

    const result = await createPublicBooking(page, parsed.request, caller.company);

    // La clave queda pegada a la venta: es lo que hace que el reintento
    // devuelva esto mismo en vez de crear otra.
    await supabaseService()
      .from("sales_order")
      .update({ idempotency_key: idempotencyKey })
      .eq("organization_id", caller.companyId)
      .eq("order_number", result.orderNumber);

    await writeAudit({
      companyId: caller.companyId,
      action: "api_booking_created",
      entityType: "booking",
      description: `Reserva creada por API: ${product.name} · ${parsed.request.name}`,
      metadata: { key: caller.keyId, reference: result.reference, partner: caller.partnerId },
    });

    await notify({
      companyId: caller.companyId,
      event: "booking_created",
      entityType: "booking",
      dedupeSeed: result.reference,
      vars: {
        referencia: result.reference,
        producto: product.name,
        fecha: result.travelDate ? result.travelDate.slice(0, 10) : null,
        pax: parsed.request.adults + parsed.request.children + parsed.request.infants,
        cliente: `${parsed.request.name} (API)`,
      },
    });

    return Response.json({
      data: {
        reference: result.reference,
        order: result.orderNumber,
        product: product.name,
        date: result.travelDate,
        total: result.total,
        currency: result.currency,
        status: "pending_payment",
      },
    }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}

/** El catálogo de la empresa de la llave, sin pasar por el slug público. */
async function loadPublicPageForKey(companyId: string) {
  const { data: org } = await supabaseService()
    .from("organizations").select("slug").eq("id", companyId).maybeSingle();
  const page = await loadPublicPage(String(org?.slug || ""));
  if (page.state === "ok") return page;
  // Una operadora puede vender por API sin tener página pública abierta: son
  // dos decisiones distintas. Se arma el catálogo igual.
  return loadPublicPage(String(org?.slug || ""), { ignoreSwitch: true });
}
