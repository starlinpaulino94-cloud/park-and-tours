import { NextRequest } from "next/server";
import { requireApiKey, apiError } from "@/lib/api-auth";
import { tenantQuery } from "@/lib/tenant";
import { toPublicCard, isPublishable, type PublicProductRow } from "@/lib/public-booking";

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
    const rows = await tenantQuery<PublicProductRow>(caller.companyId, "product", {
      _filter: { published: true },
      _limit: 200,
      _sort: { sort_order: "asc" },
    });

    const products = rows.filter(isPublishable).map((row) => toPublicCard(row, caller.company?.base_currency || "usd"));
    return Response.json({ data: products });
  } catch (err) {
    return apiError(err);
  }
}
