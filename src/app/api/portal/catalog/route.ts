import { NextRequest } from "next/server";
import { requireTenant, tenantQuery, requireAtLeast, TenantError, esDeSocio } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { resolvePrice } from "@/lib/pricing";
import type { Departure, Partner, Product, ProductModality } from "@/lib/types";
import { refId } from "@/lib/types";
import { autorizadosDe, type AutorizacionSocio } from "@/lib/catalogo-socio";
import { plazasLibres, type SalidaConCupo } from "@/lib/plazas";
import { allotmentsOf } from "@/lib/allotment-service";
import { pickAllotment, allotmentState } from "@/lib/allotments";
import { cupoVisible } from "@/lib/cupo-socio";

/**
 * GET /api/portal/catalog?date=YYYY-MM-DD
 * Catálogo autorizado del partner con disponibilidad real y precio B2B.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const sp = req.nextUrl.searchParams;
    // AUD-006: a staff user needs manager+ to inspect another partner's catalog.
    let partnerId: string | null;
    if (esDeSocio(ctx)) {
      partnerId = ctx.partnerId;
    } else {
      const requested = sp.get("partner_id");
      if (requested && requested !== ctx.partnerId) requireAtLeast(ctx, "manager");
      partnerId = requested || ctx.partnerId;
    }
    if (!partnerId) throw new TenantError("Tu usuario no está asociado a ningún partner", 403);

    const partner = (await tenantQuery<Partner>(ctx.companyId, "partner", {
      _filter: { _id: partnerId }, _limit: 1,
    }))[0];
    if (!partner) throw new TenantError("Partner no encontrado", 404);
    if (partner.status !== "active") throw new TenantError("El partner está inactivo", 403);

    /**
     * EL CONTRATO, DESDE SU TABLA (0077).
     *
     * Antes se pedía `authorized_products` expandido en la consulta de arriba y
     * se filtraba así:
     *
     *     ...(authorizedIds.length ? { _id: { in: authorizedIds } } : {})
     *
     * `authorized_products` no existía en ninguna tabla ni en el mapa de
     * relaciones, así que la expansión devolvía vacío SIEMPRE y ese filtro no
     * se aplicó nunca — ni una vez. La pantalla prometía «catálogo autorizado»
     * y enseñaba el catálogo entero.
     */
    const autorizaciones = await tenantQuery<Record<string, unknown>>(ctx.companyId, "partner_product", {
      _filter: { partner: partnerId, status: "active" }, _limit: 1000,
    });
    const autorizados = autorizadosDe(autorizaciones as AutorizacionSocio[]);
    const authorizedIds = [...autorizados];

    /**
     * Sin nada autorizado, el catálogo está vacío y no se consulta.
     *
     * Y explícito, no confiando en que `in: []` signifique «ninguno»: no lo
     * significa en todos los traductores de consulta —en alguno es una
     * condición que no se aplica— y ahí el fallo sería devolverle el catálogo
     * entero justo al socio que no tiene nada autorizado.
     */
    const products = authorizedIds.length === 0 ? [] : await tenantQuery<Product>(ctx.companyId, "product", {
      _filter: {
        status: "active",
        // Mismo motivo que en el punto de venta: la reserva de un paquete
        // necesita el día de inicio, que este catálogo no pide. Enseñarlo aquí
        // sería ofrecerle a un socio algo que no puede reservar.
        is_bundle: false,
        // Y SIEMPRE. Desde 0077 la tabla se siembra con el catálogo entero por
        // socio, así que «vacía» significa lo que dice; el filtro condicional
        // de antes es exactamente la línea que convirtió la autorización en un
        // adorno.
        _id: { in: authorizedIds },
      },
      _limit: 200, _sort: { name: "asc" },
      category: true,
      product_modality: { _limit: 20, _filter: { status: "active" } },
    });

    const dateParam = sp.get("date");
    const dayStart = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
    const rangeEnd = new Date(dayStart);
    rangeEnd.setDate(rangeEnd.getDate() + (dateParam ? 1 : 30));

    const productIds = products.map((p) => p._id);
    const departures = productIds.length
      ? await tenantQuery<Departure>(ctx.companyId, "departure", {
          _filter: {
            product: { in: productIds },
            departure_at: { gte: dayStart.toISOString(), lte: rangeEnd.toISOString() },
            status: { nin: ["cancelled", "closed", "completed"] },
          },
          _limit: 500, _sort: { departure_at: "asc" },
        })
      : [];

    const departuresByProduct = new Map<string, Departure[]>();
    for (const d of departures) {
      const id = refId(d.product) || "none";
      departuresByProduct.set(id, [...(departuresByProduct.get(id) || []), d]);
    }

    /**
     * EL CUPO CONTRATADO, DELANTE Y NO AL FINAL.
     *
     * Esta pantalla enseñaba las plazas libres de la SALIDA. Un socio con diez
     * garantizadas veía las cuarenta de la guagua, vendía quince, y el 409 de
     * `assertAllotment` le llegaba en la cara del turista que tenía delante. El
     * motor de cupos no estaba roto —comprueba bien, y en el único camino que
     * crea reservas—: estaba escondido, y un límite que solo aparece al final
     * es indistinguible de un fallo del sistema.
     *
     * Los cupos se piden UNA vez y se cruzan en memoria: son pocos por socio y
     * preguntar por salida convertiría el catálogo en cien consultas.
     */
    const cupos = await allotmentsOf(ctx.companyId, partnerId);

    // B2B price per product using the pricing engine (never a frontend formula).
    const rows = await Promise.all(
      products.map(async (product) => {
        const modalities = (product.product_modality || []) as ProductModality[];
        const modality = modalities.find((m) => m.modality_type === "adult") || modalities[0];
        let price = null;
        try {
          const resolved = await resolvePrice({
            companyId: ctx.companyId,
            productId: product._id,
            modalityId: modality?._id,
            partnerId,
            channel: "b2b_portal",
            quantity: 1,
            travelDate: dayStart.toISOString(),
          });
          price = {
            unit_price: resolved.unitPrice,
            total: resolved.totalAmount,
            currency: resolved.currency,
            rule: resolved.snapshot.applied_rule_name,
          };
        } catch (err) {
          console.error(`[portal/catalog] no se pudo calcular el precio de ${product.name}:`, err);
        }

        const productDepartures = departuresByProduct.get(product._id) || [];
        return {
          _id: product._id,
          name: product.name,
          short_description: product.short_description,
          description: product.description,
          duration_hours: product.duration_hours,
          location: product.location,
          meeting_point: product.meeting_point,
          images: product.images,
          cover_image_url: product.cover_image_url,
          category: typeof product.category === "object" ? product.category?.name : undefined,
          modalities: modalities.map((m) => ({ _id: m._id, name: m.name, modality_type: m.modality_type })),
          price,
          departures: productDepartures.slice(0, 20).map((d) => {
            const cupo = cupoVisible(
              // Mismo motivo que en el POS: un hueco no es un agotado.
              plazasLibres(d as SalidaConCupo),
              allotmentState(pickAllotment(cupos, {
                partnerId: partnerId as string,
                productId: product._id,
                departureId: d._id,
                travelDate: d.departure_at,
              }))
            );
            return {
              _id: d._id,
              departure_at: d.departure_at,
              // Lo que este socio puede reservar, no lo que cabe en la guagua.
              available_pax: cupo.disponible,
              capacity: d.capacity ?? 0,
              status: d.status,
              cupo,
            };
          }),
          next_departure: productDepartures[0]?.departure_at,
        };
      })
    );

    console.log(`[portal/catalog] ${rows.length} productos autorizados para ${partner.commercial_name || partner.name}`);
    return ok({ products: rows, partner_id: partnerId, restricted: true });
  } catch (err) {
    return fail(err);
  }
}
