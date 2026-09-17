import { NextRequest, NextResponse } from "next/server";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { resolveLinkBySlug, recordTouch } from "@/lib/attribution-service";
import { VISITOR_COOKIE, REFERRAL_COOKIE, cookieMaxAgeSeconds } from "@/lib/attribution";

/**
 * GET /e/:slug — el QR pegado en el mostrador de un hotel.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PASA AQUÍ, EN ORDEN
 *
 * Alguien escanea. No tiene sesión, no ha dicho de qué empresa es cliente y no
 * va a esperar: esta ruta resuelve el enlace, deja constancia de la visita,
 * marca el navegador y lo manda a la página de la operadora. Todo antes de que
 * suelte el móvil.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA COOKIE GUARDA EL SLUG, NO EL VENDEDOR
 *
 * La cookie la controla el cliente. Si guardara el id del vendedor, cualquiera
 * podría editarla y atribuirse las ventas de la operadora entera. Guarda el
 * slug, que se vuelve a resolver contra la base cada vez que se usa: un enlace
 * borrado, desactivado o de un vendedor que ya no está deja de valer en el
 * momento, y de un slug inventado no sale ningún vendedor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES UNA SUPERFICIE QUE CUALQUIERA PUEDE LLAMAR
 *
 * Como el motor público, se limita por IP. Sin eso, un bucle llenaría
 * `seller_attribution` de visitas inventadas y el embudo del vendedor con el QR
 * más visible dejaría de significar nada. El límite es generoso —un QR de hotel
 * lo escanea mucha gente desde el mismo wifi— pero existe.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const home = new URL("/", req.url);

  try {
    await assertRateLimit({ key: rateLimitKey(req, "attr:visit"), limit: 120, windowMs: 3_600_000 });
  } catch {
    // Un escaneo que topa el límite sigue llevando al cliente a comprar: lo que
    // se pierde es el registro de la visita, no la venta.
    return NextResponse.redirect(home, 302);
  }

  const link = await resolveLinkBySlug(slug);
  // Un slug que no existe y uno desactivado se contestan igual, y no con un 404
  // que enseñe qué slugs valen: se manda a la portada como cualquier enlace roto.
  if (!link) return NextResponse.redirect(home, 302);

  const destination = new URL(`/reservar/${link.orgSlug}`, req.url);
  if (link.productId) destination.searchParams.set("p", link.productId);

  const response = NextResponse.redirect(destination, 302);

  /**
   * El visitante: lo único que hay antes de que exista el cliente.
   *
   * Se reutiliza el que ya trajera el navegador. Renovarlo en cada escaneo
   * partiría en dos el embudo del mismo señor: una visita por aquí, un registro
   * por allá, y ninguna conversión.
   */
  const existing = req.cookies.get(VISITOR_COOKIE)?.value;
  const visitorId = existing && existing.length <= 64 ? existing : crypto.randomUUID();

  const maxAge = cookieMaxAgeSeconds(link.windowDays);
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
  response.cookies.set(VISITOR_COOKIE, visitorId, cookie);
  response.cookies.set(REFERRAL_COOKIE, link.slug, cookie);

  await recordTouch({
    companyId: link.companyId,
    sellerId: link.sellerId,
    linkId: link.linkId,
    stage: "visit",
    visitorId,
    channel: link.channel,
    campaign: link.campaign,
    landing: destination.pathname + destination.search,
  });

  return response;
}
