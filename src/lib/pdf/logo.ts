import "server-only";
import { imageKindOf, embeddableLogo } from "@/lib/branding";

/**
 * Traer el logo de la empresa para incrustarlo en un PDF.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTO NO PUEDE ROMPER UN DOCUMENTO
 *
 * Generar un voucher es una operación que ocurre delante de un cliente. Que el
 * almacenamiento esté lento, que la URL haya caducado o que alguien haya pegado
 * un enlace roto NO puede dejar sin voucher a nadie: todo fallo devuelve `null`
 * y el documento sale con el nombre en texto, como salía antes.
 *
 * Tres límites, y los tres tienen motivo:
 *
 *  · **Tiempo.** Sin plazo, un almacenamiento colgado cuelga la petición del
 *    PDF, y el usuario ve una pantalla girando en vez de su documento.
 *  · **Tamaño.** Un logo es un logo; si alguien apunta a un archivo de 20 MB,
 *    bajarlo entero para meterlo en una cabecera de 40 puntos es tirar memoria
 *    del servidor por una imagen que nadie va a ver a ese detalle.
 *  · **Formato.** El formato PDF solo sabe incrustar PNG y JPEG. Lo demás se
 *    descarta aquí en vez de reventar dentro del generador.
 */

/** Plazo para bajar el logo. Pasado esto, el documento sale sin él. */
const TIMEOUT_MS = 4_000;
/** Techo de tamaño: por encima, no es un logo. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export interface FetchedLogo {
  bytes: Uint8Array;
  kind: "png" | "jpg";
}

/** Caché por proceso: un manifiesto de tres hojas no baja el logo tres veces. */
const cache = new Map<string, FetchedLogo | null>();

export async function fetchLogo(url: unknown, origin?: string): Promise<FetchedLogo | null> {
  const safe = embeddableLogo(url);
  if (!safe) return null;

  // Una ruta relativa necesita saber contra qué dominio resolverse; sin origen
  // no se puede, y adivinarlo sería pedirle al servidor que se llame a sí mismo
  // a un sitio inventado.
  const absolute = safe.startsWith("/") ? (origin ? `${origin}${safe}` : null) : safe;
  if (!absolute) return null;

  if (cache.has(absolute)) return cache.get(absolute) ?? null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(absolute, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const declared = res.headers.get("content-type");
    const kind = imageKindOf(absolute, declared);
    if (!kind) throw new Error(`formato no incrustable: ${declared ?? "desconocido"}`);

    // El `content-length` puede faltar o mentir, así que además se corta por el
    // tamaño real: fiarse solo de la cabecera deja la puerta abierta a bajarse
    // un archivo enorme igual.
    const declaredSize = Number(res.headers.get("content-length") || 0);
    if (declaredSize > MAX_LOGO_BYTES) throw new Error("logo demasiado grande");

    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.byteLength > MAX_LOGO_BYTES) throw new Error("logo demasiado grande");
    if (buffer.byteLength === 0) throw new Error("logo vacío");

    const logo: FetchedLogo = { bytes: buffer, kind };
    cache.set(absolute, logo);
    return logo;
  } catch (err) {
    console.warn(`[pdf] no se pudo traer el logo (${absolute}):`, (err as Error).message);
    // Se cachea el fallo: si la URL está rota, no tiene sentido reintentarla en
    // cada documento del día.
    cache.set(absolute, null);
    return null;
  }
}

/** Vacía la caché. Solo la usan las pruebas y el cambio de logo. */
export function clearLogoCache(): void {
  cache.clear();
}
