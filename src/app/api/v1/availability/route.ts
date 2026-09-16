import { NextRequest } from "next/server";
import { requireApiKey, apiError } from "@/lib/api-auth";
import { loadPublicDepartures } from "@/lib/public-booking-service";
import { tenantQuery } from "@/lib/tenant";

/**
 * GET /api/v1/availability?product=<id> — las fechas con plaza.
 *
 * El producto se valida contra el catálogo PUBLICADO antes de mirar sus
 * salidas: sin eso, este parámetro sería la forma de preguntar por la
 * disponibilidad de algo que la operadora no quiso poner a la venta fuera.
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

    const departures = await loadPublicDepartures(caller.companyId, productId);
    return Response.json({ data: departures });
  } catch (err) {
    return apiError(err);
  }
}
