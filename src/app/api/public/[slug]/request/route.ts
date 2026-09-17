import { NextRequest, NextResponse } from "next/server";
import { fail, readJson } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadPublicPage, createPublicBooking } from "@/lib/public-booking-service";
import { readPublicRequest, confirmationNote, REQUEST_PROBLEM_MESSAGE } from "@/lib/public-booking";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import { flushOutboxAfterResponse } from "@/lib/messaging/flush";
import { VISITOR_COOKIE, REFERRAL_COOKIE } from "@/lib/attribution";
import type { Company } from "@/lib/types";

/**
 * POST /api/public/:slug/request — un desconocido pide una reserva.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES LA ÚNICA ESCRITURA SIN SESIÓN DE TODO EL SISTEMA
 *
 * Y por eso todo lo que se puede decidir en el servidor se decide en el
 * servidor. Del cuerpo solo se leen los campos que únicamente sabe el cliente
 * —quién es, cuántos van, qué día, a qué hotel—: `readPublicRequest` los extrae
 * uno a uno y descarta el resto, así que mandar `total`, `status` o
 * `discount_pct` no hace absolutamente nada.
 *
 * El precio, el cupo, la moneda, las comisiones y el plan de cobro salen de
 * `createOrderWithBookings`, el MISMO camino que usa el punto de venta. Escribir
 * aquí una versión «más simple» habría creado un segundo camino que se olvida de
 * la mitad —y esos errores aparecen semanas después, en una salida sobrevendida.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN CSRF, Y ES CORRECTO
 *
 * El resto de las mutaciones exige mismo origen porque protege una sesión con
 * cookies. Aquí no hay sesión que robar: cualquiera puede llamar a esta ruta a
 * propósito, igual que cualquiera puede rellenar el formulario. Lo que la
 * protege es otra cosa: el límite por IP, el campo trampa, el tope de personas
 * y que no se acepte NADA que tenga valor económico.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    // Duro a propósito: cinco solicitudes por hora y por IP. Una persona manda
    // una, quizá dos si se equivoca; lo que manda veinte es otra cosa.
    await assertRateLimit({ key: rateLimitKey(req, "public:request"), limit: 5, windowMs: 3_600_000 });

    const page = await loadPublicPage(String(slug || "").toLowerCase());
    if (page.state !== "ok" || !page.org) {
      return NextResponse.json({ ok: false, error: { message: "Página no encontrada", code: "not_found" } }, { status: 404 });
    }
    if (!page.acceptsRequests) {
      // La empresa no puede registrar operaciones ahora mismo. La página sigue
      // en pie con su teléfono delante: el cliente no tiene por qué saber de
      // suscripciones, y la venta se salva por la vía de siempre.
      return NextResponse.json({
        ok: false,
        error: {
          message: page.org.phone
            ? `Las reservas en línea están en pausa. Escríbenos al ${page.org.phone} y te atendemos.`
            : "Las reservas en línea están en pausa. Escríbenos y te atendemos.",
          code: "paused",
        },
      }, { status: 409 });
    }

    const parsed = readPublicRequest(await readJson(req));
    if (parsed.ok === false) {
      return NextResponse.json(
        { ok: false, error: { message: REQUEST_PROBLEM_MESSAGE[parsed.problem], code: parsed.problem } },
        { status: 400 }
      );
    }
    const request = parsed.request;

    // El producto, contra el catálogo PUBLICADO: sin esto, este campo sería la
    // forma de comprar algo que la operadora decidió no vender por la web.
    const product = page.products.find((p) => p.id === request.productId);
    if (!product) {
      return NextResponse.json(
        { ok: false, error: { message: REQUEST_PROBLEM_MESSAGE.product, code: "product" } },
        { status: 404 }
      );
    }

    const company = { _id: page.org.id, name: page.org.name, base_currency: page.org.currency } as Company;
    /**
     * El rastro del QR que trajo al cliente (0058).
     *
     * Son cookies, o sea datos del cliente, y por eso no se cree ninguna de las
     * dos: el slug se vuelve a resolver contra la base y el visitante solo sirve
     * para buscar hechos ya escritos. Lo peor que puede hacer una cookie
     * inventada es no atribuir nada.
     */
    const result = await createPublicBooking(page, request, company, {
      visitorId: req.cookies.get(VISITOR_COOKIE)?.value ?? null,
      referralSlug: req.cookies.get(REFERRAL_COOKIE)?.value ?? null,
    });

    await writeAudit({
      companyId: page.org.id,
      action: "public_booking_requested",
      entityType: "booking",
      description: `Reserva pedida desde la web: ${product.name} · ${request.adults + request.children + request.infants} pax · ${request.name}`,
      metadata: {
        reference: result.reference,
        product: product.name,
        contact: request.email || request.phone,
        pax: request.adults + request.children + request.infants,
      },
    });

    // Y que alguien del equipo lo vea hoy: una reserva web que nadie mira hasta
    // mañana es un cliente esperando confirmación que no llega.
    await notify({
      companyId: page.org.id,
      event: "booking_created",
      entityType: "booking",
      entityId: result.reference,
      dedupeSeed: result.reference,
      vars: {
        referencia: result.reference,
        producto: product.name,
        fecha: result.travelDate ? result.travelDate.slice(0, 10) : null,
        pax: request.adults + request.children + request.infants,
        cliente: `${request.name} (web)`,
      },
    });

    flushOutboxAfterResponse(company, page.org.id);
    return NextResponse.json({
      ok: true,
      data: {
        reference: result.reference,
        product: product.name,
        date: result.travelDate,
        pax: request.adults + request.children + request.infants,
        total: result.total,
        currency: result.currency,
        // Nunca dice «confirmada» mientras no haya pago: decirlo y llamar
        // después para avisar de que no había cupo es peor que no tener página.
        payNote: confirmationNote(false, page.org.terms),
      },
    });
  } catch (err) {
    return fail(err);
  }
}
