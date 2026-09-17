import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail } from "@/lib/octo-http";
import { octoSupplier } from "@/lib/octo-service";

/**
 * GET /api/octo/v1/supplier — quién es la operadora.
 *
 * Es el primer endpoint que llama cualquier revendedor al conectar: si esto
 * contesta, la llave sirve y la dirección es la correcta. Por eso se deja de
 * solo lectura y sin efectos: es el «ping» del estándar.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx, capabilities } = await octoRequest(req, "read");
    return octoJson(octoSupplier(ctx), capabilities);
  } catch (err) {
    return octoFail(err);
  }
}
