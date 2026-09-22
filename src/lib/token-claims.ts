/**
 * LEER LA EMPRESA QUE TRAE EL TOKEN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PARA QUÉ, SI EL SERVIDOR YA LO VALIDA
 *
 * No es una comprobación de seguridad: la firma la valida Supabase, y aquí no
 * se verifica nada. Es una comprobación de COHERENCIA, para el cambio de
 * empresa.
 *
 * Al cambiar de empresa hay dos cosas que tienen que acabar diciendo lo mismo:
 * la cookie (que la ruta ya fijó) y el `org_id` del token (que solo cambia
 * cuando el enganche de la 0068 reemite las claims en un refresco). Si el
 * refresco falla —o si el enganche no está puesto en el proyecto, o la 0068 no
 * se aplicó—, la cookie dice una empresa y el token dice otra: el panel lanza
 * «dashboard organization is outside your tenant» y todo lo que filtra por RLS
 * sale vacío.
 *
 * Ese es EXACTAMENTE el fallo que la 0068 vino a cerrar, así que la peor forma
 * de fallar es volver a él en silencio. Leyendo el `org_id` del token nuevo se
 * puede decir «no se pudo cambiar de empresa» en vez de dejar al usuario dentro
 * de una pantalla rota sin explicación.
 */

/** Decodifica base64url sin depender de Buffer (esto corre en el navegador). */
function decodeBase64Url(segmento: string): string | null {
  try {
    const base64 = segmento.replace(/-/g, "+").replace(/_/g, "/");
    const relleno = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    if (typeof atob === "function") {
      // `atob` devuelve bytes latin1: hay que reconstruir el UTF-8 o un nombre
      // con acentos saldría partido.
      const bytes = Uint8Array.from(atob(relleno), (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(relleno, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Las claims de un JWT, SIN verificar la firma.
 *
 * Devuelve `null` ante cualquier cosa rara —un token de dos segmentos, base64
 * roto, un JSON que no es objeto— en vez de lanzar: quien llama está decidiendo
 * si enseñar un aviso, y una excepción aquí tumbaría el cambio de empresa por
 * un token con una coma de más.
 */
export function claimsDeToken(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  const json = decodeBase64Url(partes[1]);
  if (!json) return null;
  try {
    const datos = JSON.parse(json);
    return datos && typeof datos === "object" && !Array.isArray(datos)
      ? (datos as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** La empresa que el token dice, o `null` si no la dice. */
export function empresaDelToken(token: string | null | undefined): string | null {
  const orgId = claimsDeToken(token)?.org_id;
  return typeof orgId === "string" && orgId ? orgId : null;
}

export type VeredictoCambio = "ok" | "sin_token" | "empresa_distinta";

/**
 * ¿El token nuevo aterrizó de verdad en la empresa elegida?
 *
 * `sin_token` cuando no se pudo leer el `org_id` —token raro, o un enganche que
 * dejó de emitirlo—; `empresa_distinta` cuando el token sigue en otra empresa,
 * que es la señal de que el enganche no está puesto o el refresco no sirvió.
 *
 * Los dos casos se tratan igual arriba (se deshace el cambio), pero se
 * distinguen porque el mensaje al usuario no es el mismo y, sobre todo, porque
 * en la consola hacen falta dos pistas distintas.
 */
export function verificarCambioDeEmpresa(
  token: string | null | undefined,
  empresaElegida: string,
): VeredictoCambio {
  const enElToken = empresaDelToken(token);
  if (!enElToken) return "sin_token";
  return enElToken === empresaElegida ? "ok" : "empresa_distinta";
}
