import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { loadPublicPage } from "@/lib/public-booking-service";
import { pickLocale } from "@/lib/i18n";
import { BookingEngine } from "./_components/booking-engine";

/**
 * LA PÁGINA PÚBLICA DE UNA OPERADORA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUIÉN ES
 *
 * Para alguien que encontró la excursión a las once de la noche, en el móvil,
 * con la conexión del hotel. No es una pantalla del ERP: no hay menú, no hay
 * sesión y no hay nada que aprender. Se ve lo que hay, se elige un día y se
 * dejan cuatro datos.
 *
 * Se renderiza en el SERVIDOR con los datos ya dentro: la alternativa —pintar
 * un esqueleto y pedir el catálogo desde el navegador— le enseña a ese cliente
 * una pantalla vacía durante el primer segundo, que es justo cuando decide si
 * se queda.
 *
 * Y lleva los colores y el logo de la operadora, no los nuestros: el cliente
 * está comprando a SU marca, no a la nuestra.
 */

/**
 * La página se sirve por petición y no desde caché.
 *
 * Con `revalidate` la primera visita fijaba el HTML para todos: el idioma sale
 * de `Accept-Language` y de `?lang=`, así que una copia cacheada le habría
 * servido a un inglés la versión que pidió un español diez segundos antes. El
 * catálogo cambia poco; el idioma cambia con cada visitante.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPublicPage(String(slug || "").toLowerCase());
  if (page.state !== "ok" || !page.org) return { title: "Página no encontrada" };
  return {
    title: `Reservar con ${page.org.name}`,
    description: page.org.intro || `Excursiones y actividades de ${page.org.name}. Reserva en línea.`,
    openGraph: {
      title: `Reservar con ${page.org.name}`,
      description: page.org.intro || undefined,
      images: page.products.find((p) => p.image)?.image ? [page.products.find((p) => p.image)!.image!] : undefined,
    },
  };
}

export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const page = await loadPublicPage(String(slug || "").toLowerCase());
  // Una empresa sin su página activada y un slug inventado se contestan igual:
  // la diferencia solo le sirve a quien prueba nombres para averiguar qué
  // empresas usan el sistema.
  if (page.state !== "ok" || !page.org) notFound();

  /**
   * El idioma se decide AQUÍ, en el servidor.
   *
   * Lo elegido a mano manda sobre el navegador: si alguien pulsó «English»,
   * seguir hablándole en español porque su `Accept-Language` dice otra cosa
   * sería ignorar lo único que dijo de forma explícita.
   *
   * Y se decide antes de pintar porque esta página se renderiza en el servidor:
   * detectarlo en el navegador enseñaría la página en español durante el primer
   * pintado, que es justo el segundo en el que el cliente decide si se queda.
   */
  const chosen = Array.isArray(query.lang) ? query.lang[0] : query.lang;
  const locale = pickLocale({
    chosen,
    acceptLanguage: (await headers()).get("accept-language"),
  });

  return <BookingEngine slug={slug} page={page} locale={locale} />;
}
