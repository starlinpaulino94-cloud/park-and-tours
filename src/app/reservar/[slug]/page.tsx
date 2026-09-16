import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { loadPublicPage } from "@/lib/public-booking-service";
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

export const revalidate = 60;

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

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await loadPublicPage(String(slug || "").toLowerCase());
  // Una empresa sin su página activada y un slug inventado se contestan igual:
  // la diferencia solo le sirve a quien prueba nombres para averiguar qué
  // empresas usan el sistema.
  if (page.state !== "ok" || !page.org) notFound();

  return <BookingEngine slug={slug} page={page} />;
}
