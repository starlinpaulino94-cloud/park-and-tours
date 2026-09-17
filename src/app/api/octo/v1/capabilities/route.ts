import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail } from "@/lib/octo-http";
import { capabilityCatalog } from "@/lib/octo";

/**
 * GET /api/octo/v1/capabilities — qué extensiones del estándar soportamos.
 *
 * La lista corta es una decisión. Anunciar una capacidad que no se cumple es la
 * forma más rápida de romper una conexión en producción: el revendedor deja de
 * mandar los campos que compensaban su ausencia y todo falla más tarde, en el
 * peor sitio.
 */
export async function GET(req: NextRequest) {
  try {
    const { capabilities } = await octoRequest(req, "read");
    return octoJson(capabilityCatalog(), capabilities);
  } catch (err) {
    return octoFail(err);
  }
}
