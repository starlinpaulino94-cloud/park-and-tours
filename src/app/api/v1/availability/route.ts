import { NextRequest } from "next/server";
import { requireApiKey, apiError } from "@/lib/api-auth";
import { loadPublicDepartures } from "@/lib/public-booking-service";
import { tenantQuery } from "@/lib/tenant";
import { autorizadosDe, type AutorizacionSocio } from "@/lib/catalogo-socio";
import { allotmentsOf } from "@/lib/allotment-service";
import { pickAllotment, allotmentState } from "@/lib/allotments";
import { cupoVisible } from "@/lib/cupo-socio";
import { leerTodoElRecurso } from "@/lib/barrido";

/**
 * GET /api/v1/availability?product=<id> — las fechas con plaza.
 *
 * El producto se valida contra el catálogo PUBLICADO antes de mirar sus
 * salidas: sin eso, este parámetro sería la forma de preguntar por la
 * disponibilidad de algo que la operadora no quiso poner a la venta fuera.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y CUANDO QUIEN PREGUNTA ES UN SOCIO, SE LE CONTESTA LO SUYO
 *
 * Dos cosas que esta ruta no miraba y la reserva sí:
 *
 *  · **Su contrato por producto** (`partner_product`, de 6.1). Sin esto, un
 *    socio integrado planifica sobre un producto que no tiene autorizado y su
 *    propia reserva se lo rechaza después.
 *  · **Su cupo** (`allotment`). Enseñaba las plazas de la SALIDA. Un socio con
 *    diez garantizadas veía cuarenta, montaba su venta sobre ese número y el
 *    409 le llegaba al confirmar.
 *
 * Es el mismo número que va a comprobar `createOrderWithBookings`, calculado
 * por la misma función que usan el portal y la pantalla de reservar.
 */
export async function GET(req: NextRequest) {
  try {
    const caller = await requireApiKey(req, "read");
    const productId = req.nextUrl.searchParams.get("product") || "";
    if (!productId) {
      return Response.json({ error: { message: "Indica el producto", status: 400 } }, { status: 400 });
    }

    const [product] = await tenantQuery<{ _id: string; published?: boolean; status?: string }>(
      caller.companyId, "product", { _filter: { _id: productId }, _limit: 1 }
    );
    if (!product || product.published !== true || (product.status ?? "active") !== "active") {
      return Response.json({ error: { message: "Producto no disponible", status: 404 } }, { status: 404 });
    }

    if (caller.partnerId) {
      // Entero: si el producto consultado cae más allá del tope, la respuesta
      // dice «no disponible» sobre algo que el socio tiene bajo contrato.
      const autorizados = autorizadosDe(
        await leerTodoElRecurso<Record<string, unknown>>("partner_product", (limite, salto) =>
          tenantQuery(caller.companyId, "partner_product", {
          _filter: { partner: caller.partnerId, status: "active" },
          _sort: { created_at: "asc", _id: "asc" },
          _limit: limite, _offset: salto,
          })) as AutorizacionSocio[]
      );
      // El mismo 403 que daría su reserva, y aquí, que es donde todavía puede
      // hacer algo con él.
      if (!autorizados.has(productId)) {
        return Response.json(
          { error: { message: "Tu contrato no incluye este producto", status: 403 } },
          { status: 403 }
        );
      }
    }

    const departures = await loadPublicDepartures(caller.companyId, productId);
    if (!caller.partnerId) return Response.json({ data: departures });

    // Los cupos se piden UNA vez y se cruzan en memoria: son pocos por socio y
    // preguntar por salida convertiría esto en sesenta consultas.
    const cupos = await allotmentsOf(caller.companyId, caller.partnerId);
    const conCupo = departures
      .map((d) => {
        const cupo = cupoVisible(
          d.seatsLeft,
          allotmentState(pickAllotment(cupos, {
            partnerId: caller.partnerId as string,
            productId,
            departureId: d.id,
            travelDate: d.at,
          }))
        );
        // `seatsLeft` pasa a ser LO SUYO, no lo de la guagua: es el campo que
        // quien integra ya está leyendo, y dejarle el número grande al lado del
        // pequeño es pedirle que elija el equivocado.
        return { ...d, seatsLeft: cupo.disponible, allotment: cupo };
      })
      // Lo que su contrato no le deja vender no es disponibilidad. Las que no
      // se saben se quedan, por lo de siempre: no saber no es agotado.
      .filter((d) => d.allotment.motivo === null);

    return Response.json({ data: conCupo });
  } catch (err) {
    return apiError(err);
  }
}
