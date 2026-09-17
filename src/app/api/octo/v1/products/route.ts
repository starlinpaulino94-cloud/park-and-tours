import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail } from "@/lib/octo-http";
import { octoProducts } from "@/lib/octo-service";

/**
 * GET /api/octo/v1/products — el catálogo que un revendedor puede vender.
 *
 * Los PUBLICADOS y nada más: el costo, el proveedor y las notas internas son
 * del negocio de la operadora, no de quien revende.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx, capabilities } = await octoRequest(req, "read");
    return octoJson(await octoProducts(ctx), capabilities);
  } catch (err) {
    return octoFail(err);
  }
}
