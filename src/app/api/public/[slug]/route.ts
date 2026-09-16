import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadPublicPage } from "@/lib/public-booking-service";

/**
 * GET /api/public/:slug — la página de una operadora, para el mundo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN SESIÓN, Y POR ESO CON MÁS CUIDADO
 *
 *  · Lo que devuelve es una LISTA BLANCA construida en `public-booking.ts`: el
 *    costo, el proveedor y las notas internas del producto no existen para esta
 *    ruta, ni siquiera se consultan.
 *  · Una empresa sin su página activada responde 404, igual que un slug
 *    inventado. Distinguirlos hacia fuera le serviría a quien prueba nombres
 *    para averiguar qué empresas usan el sistema.
 *  · El límite es por IP y alto —es una página, se visita— pero existe: sin él,
 *    esta ruta es un generador de consultas gratis contra la base.
 *
 * La respuesta se puede cachear unos segundos: es la misma para todo el mundo y
 * no lleva nada de nadie.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    await assertRateLimit({ key: rateLimitKey(req, "public:page"), limit: 120, windowMs: 60_000 });

    const page = await loadPublicPage(String(slug || "").toLowerCase());
    if (page.state !== "ok") {
      return NextResponse.json({ ok: false, error: { message: "Página no encontrada", code: "not_found" } }, { status: 404 });
    }

    return NextResponse.json(
      { ok: true, data: page },
      { headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    return fail(err);
  }
}
