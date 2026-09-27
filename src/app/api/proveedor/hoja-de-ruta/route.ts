import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, TenantError, esDeProveedor } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { loadRunSheet } from "@/lib/dispatch-service";
import { marcarParada } from "@/lib/hoja-de-ruta-service";
import { esMarcaDelChofer } from "@/lib/hoja-de-ruta";

/**
 * LA HOJA DE RUTA DEL CHOFER.
 *
 *   GET  /api/proveedor/hoja-de-ruta?ruta=:id — las paradas en orden.
 *   POST /api/proveedor/hoja-de-ruta          — recogido o no-show, con hora.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO EL PROVEEDOR, Y SU ÁMBITO NO SE DECIDE AQUÍ
 *
 * El personal interno tiene la suya bajo `/api/operations/`, con rango. Esta es
 * la del actor externo, y lo que la acota —que la ruta sea suya, que estemos
 * alrededor del servicio, y que cada apertura quede anotada— vive en
 * `loadRunSheet` y en `marcarParada`, no en este fichero: son dos llamantes y
 * una comprobación por llamante es una comprobación que alguien se deja.
 *
 * Es la pantalla con más datos de terceros del sistema —nombre, hotel,
 * habitación y teléfono—, y eso es deliberado: el chofer no puede recoger a
 * quien no sabe identificar. Lo que se acota es cuándo y cuánto.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    if (!esDeProveedor(ctx)) throw new TenantError("No tienes acceso a este recurso", 403);
    await assertRateLimit({
      key: rateLimitKey(req, "proveedor:hoja", ctx.userId), limit: 60, windowMs: 60_000,
    });

    const ruta = (req.nextUrl.searchParams.get("ruta") || "").trim();
    if (!ruta) throw new TenantError("Indica la ruta", 400);

    return ok(await loadRunSheet(ctx, ruta));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    if (!esDeProveedor(ctx)) throw new TenantError("No tienes acceso a este recurso", 403);
    await assertRateLimit({
      key: rateLimitKey(req, "proveedor:marcar", ctx.userId), limit: 120, windowMs: 60_000,
    });

    const body = await readJson<{ parada?: unknown; marca?: unknown }>(req);
    const parada = String(body?.parada ?? "").trim();
    const marca = body?.marca;
    /**
     * Solo «recogido» y «no-show». Ni cancelar ni reabrir: cancelar una parada
     * es una decisión comercial con reembolso detrás, y no es del chofer.
     */
    if (!esMarcaDelChofer(marca)) throw new TenantError("Marca desconocida", 400);

    return ok(await marcarParada(ctx, parada, marca));
  } catch (err) {
    return fail(err);
  }
}
