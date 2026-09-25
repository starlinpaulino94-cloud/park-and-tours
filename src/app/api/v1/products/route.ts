import { NextRequest } from "next/server";
import { requireApiKey, apiError } from "@/lib/api-auth";
import { tenantQuery } from "@/lib/tenant";
import { toPublicCard, isPublishable, type PublicProductRow } from "@/lib/public-booking";
import { autorizadosDe, type AutorizacionSocio } from "@/lib/catalogo-socio";
import { tarifarioDeSocio } from "@/lib/tarifario";
import { leerTodoElRecurso } from "@/lib/barrido";

/**
 * GET /api/v1/products — el catálogo que un socio puede vender.
 *
 * Devuelve lo MISMO que la página pública: los productos publicados, con la
 * ficha armada por lista blanca. Que una agencia tenga llave no le da acceso al
 * costo, al proveedor ni a las notas internas —eso es del negocio de la
 * operadora, no de quien revende—, y reutilizar la misma ficha garantiza que
 * ninguna de las dos superficies se quede atrás cuando la otra cambie.
 */
export async function GET(req: NextRequest) {
  try {
    const caller = await requireApiKey(req, "read");

    /**
     * LA LLAVE DE UN SOCIO VE SU CATÁLOGO, NO EL CATÁLOGO.
     *
     * Antes devolvía todo lo publicado a cualquier llave. El contrato por
     * producto (0077) se aplicaba en el portal y al vender, y esta ruta —que es
     * justo por donde mira un socio que integra antes de reservar— se había
     * quedado fuera: le enseñaba productos que su propia reserva iba a
     * rechazar.
     */
    // El catálogo del socio, ENTERO. Con el tope de mil, un producto que sí
    // tiene firmado desaparecía de la lista que él consulta antes de reservar —
    // y siempre el mismo, porque el orden no cambia.
    const autorizados = caller.partnerId
      ? [...autorizadosDe(await leerTodoElRecurso<Record<string, unknown>>("partner_product", (limite, salto) =>
          tenantQuery(caller.companyId, "partner_product", {
          _filter: { partner: caller.partnerId, status: "active" },
          _sort: { created_at: "asc", _id: "asc" },
          _limit: limite, _offset: salto,
          })) as AutorizacionSocio[])]
      : null;

    // Sin nada autorizado, nada que devolver; y explícito, no fiándolo a que
    // `in: []` signifique «ninguno» en el traductor de turno.
    if (autorizados !== null && autorizados.length === 0) {
      return Response.json({ data: [] });
    }

    const rows = await tenantQuery<PublicProductRow>(caller.companyId, "product", {
      _filter: {
        published: true,
        ...(autorizados ? { _id: { in: autorizados } } : {}),
      },
      _limit: 200,
      _sort: { sort_order: "asc" },
    });

    const products = rows.filter(isPublishable).map((row) => toPublicCard(row, caller.company?.base_currency || "usd"));

    /**
     * Y SU PRECIO NETO, DE LA MISMA FUNCIÓN QUE EL TARIFARIO.
     *
     * El criterio del plan es que «el tarifario descargado coincide con lo que
     * la API devuelve». Eso no se consigue revisándolo: se consigue teniendo
     * una sola función que los produzca. La ficha pública sigue trayendo el
     * precio de tarifa —es lo que el socio le enseña a su cliente—; `net` es lo
     * que se le factura a él.
     */
    if (!caller.partnerId) return Response.json({ data: products });

    const fecha = (req.nextUrl.searchParams.get("date") || "").trim()
      || new Date().toISOString().slice(0, 10);
    const tarifario = await tarifarioDeSocio(caller.companyId, caller.partnerId, `${fecha}T00:00:00.000Z`);
    const netos = new Map<string, { currency: string; net_price: number }>();
    for (const linea of tarifario) {
      // La primera modalidad manda: es la que la ficha pública enseña como
      // precio «desde». El desglose por modalidad está en el tarifario.
      if (!netos.has(linea.product_id)) {
        netos.set(linea.product_id, { currency: linea.currency, net_price: linea.net_price });
      }
    }

    return Response.json({
      data: products.map((p) => {
        const neto = netos.get(String((p as { id?: string; _id?: string }).id ?? (p as { _id?: string })._id ?? ""));
        return neto ? { ...p, net_price: neto.net_price, net_currency: neto.currency } : p;
      }),
      /** Los precios netos son de este día: las reglas tienen temporada. */
      net_prices_for: fecha,
    });
  } catch (err) {
    return apiError(err);
  }
}
