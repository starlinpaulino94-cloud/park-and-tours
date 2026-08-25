import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { resolveDisplayName } from "@/lib/supabase/auth-context";

/**
 * Resolución de nombres de usuario para mostrarlos junto a un registro.
 *
 * Las identidades viven en `auth.users`, que PostgREST no puede unir desde las
 * tablas de `public`, así que `requested_by` llega como un uuid suelto. Esto lo
 * traduce a un nombre presentable usando el cliente de servicio, siempre en el
 * servidor y siempre sobre ids que ya pasaron por el filtro de empresa.
 *
 * Devuelve SOLO el nombre. El correo del usuario nunca sale de aquí: la regla
 * de identidad se aplica también cuando el usuario es un tercero dentro de la
 * misma pantalla, y una solicitud sin nombre registrado se muestra como tal en
 * vez de sustituirse silenciosamente por la dirección de correo.
 */

/**
 * Caché en memoria del proceso.
 *
 * Cada render de la sección de aprobaciones resolvía hasta ocho identidades con
 * una llamada al Admin API por cabeza, y las mismas personas solicitan una y
 * otra vez. El mapa uuid→nombre es verdad global (no depende del inquilino que
 * consulta), así que cachearlo por instancia es seguro: no cruza datos entre
 * empresas, solo evita repetir la misma pregunta. Un TTL corto basta para que
 * un cambio de nombre se refleje sin intervención.
 */
const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { name: string | null; at: number }>();

/** Descarta lo caducado y recorta el mapa si creció demasiado (FIFO por inserción). */
function evict(now: number) {
  for (const [id, entry] of cache) {
    if (now - entry.at > TTL_MS) cache.delete(id);
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Vacía la caché — solo para pruebas y para el arranque en caliente. */
export function clearUserDirectoryCache(): void {
  cache.clear();
}

async function fetchName(id: string): Promise<string | null> {
  try {
    const { data } = await supabaseService().auth.admin.getUserById(id);
    const metaName = (data?.user?.user_metadata?.name as string | undefined) ?? null;
    if (metaName?.trim() && !metaName.includes("@")) return metaName.trim();

    // Sin nombre en el perfil: se deriva uno legible, nunca la dirección.
    const derived = resolveDisplayName(metaName, data?.user?.email ?? null);
    return derived && derived !== "Usuario" ? derived : null;
  } catch (err) {
    console.warn(`[user-directory] no se pudo resolver el usuario ${id}:`, err);
    return null;
  }
}

export async function resolveUserNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const now = Date.now();
  evict(now);

  const missing: string[] = [];
  for (const id of unique) {
    const hit = cache.get(id);
    if (hit && now - hit.at <= TTL_MS) {
      if (hit.name) out.set(id, hit.name);
    } else {
      missing.push(id);
    }
  }

  // Un fallo puntual del Admin API se cachea como "sin nombre" igual que un
  // acierto: la pantalla muestra la etiqueta neutra y no reintenta ocho veces
  // seguidas contra un servicio que ya respondió mal.
  await Promise.all(
    missing.map(async (id) => {
      const name = await fetchName(id);
      cache.set(id, { name, at: Date.now() });
      if (name) out.set(id, name);
    })
  );

  return out;
}

/** Etiqueta a mostrar cuando no hay un nombre disponible. */
export const UNKNOWN_REQUESTER = "Solicitante sin nombre registrado";
