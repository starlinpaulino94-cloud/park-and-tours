import { NextRequest } from "next/server";
import { octoRequest, octoJson, octoFail } from "@/lib/octo-http";
import { octoProduct } from "@/lib/octo-service";

/** GET /api/octo/v1/products/:id — la ficha de un producto con sus opciones y unidades. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let active: string[] = [];
  try {
    const { ctx, capabilities } = await octoRequest(req, "read");
    active = capabilities;
    const { id } = await params;
    return octoJson(await octoProduct(ctx, id), capabilities);
  } catch (err) {
    return octoFail(err, active);
  }
}
