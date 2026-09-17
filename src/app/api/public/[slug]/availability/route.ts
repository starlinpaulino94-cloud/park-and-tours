import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadPublicPage, loadPublicDepartures } from "@/lib/public-booking-service";

/**
 * GET /api/public/:slug/availability?product=<id> — las fechas que se pueden pedir.
 *
 * Solo salidas futuras, abiertas y CON PLAZA. Enseñar una salida llena para que
 * el formulario la rechace después es la peor manera de perder una venta: el
 * cliente ya escribió sus datos.
 *
 * El producto se valida contra el catálogo PUBLICADO antes de consultar nada:
 * si no, este parámetro sería una forma de preguntar por las salidas de un
 * producto que la operadora decidió no publicar.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    await assertRateLimit({ key: rateLimitKey(req, "public:availability"), limit: 120, windowMs: 60_000 });

    const productId = req.nextUrl.searchParams.get("product") || "";
    const page = await loadPublicPage(String(slug || "").toLowerCase());
    if (page.state !== "ok" || !page.org) {
      return NextResponse.json({ ok: false, error: { message: "Página no encontrada", code: "not_found" } }, { status: 404 });
    }
    if (!page.products.some((product) => product.id === productId)) {
      return NextResponse.json({ ok: false, error: { message: "Excursión no disponible", code: "not_found" } }, { status: 404 });
    }

    const departures = await loadPublicDepartures(page.org.id, productId);
    return NextResponse.json(
      { ok: true, data: departures },
      // Menos caché que el catálogo: el cupo cambia con cada venta, y una
      // fecha que se ve libre cinco minutos después de llenarse es una llamada
      // de disculpa.
      { headers: { "Cache-Control": "public, max-age=15, s-maxage=15" } }
    );
  } catch (err) {
    return fail(err);
  }
}
