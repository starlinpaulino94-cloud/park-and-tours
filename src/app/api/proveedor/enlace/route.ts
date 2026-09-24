import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, TenantError, esInterno } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { emitirEnlaceDeRespuesta, type TipoDeRecurso } from "@/lib/respuesta-proveedor";

/**
 * POST /api/proveedor/enlace — emite el enlace de un clic para un servicio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO EMITE LA CASA, NO EL PROVEEDOR
 *
 * Al revés que contestar. El enlace es una credencial: quien la tiene acepta un
 * servicio sin contraseña, así que la crea quien asigna, y con rango. Un
 * proveedor pidiéndose enlaces a sí mismo no tendría sentido —ya está dentro
 * del portal— y sí tendría una consecuencia: una forma de fabricar credenciales
 * a demanda para mandárselas a quien sea.
 *
 * La dirección se devuelve UNA vez. No se guarda: en la base solo queda su
 * huella, así que quien pierda este mensaje tiene que emitir otro —y el
 * anterior deja de valer en ese momento.
 */
const TIPOS = new Set<TipoDeRecurso>(["departure_resource", "pickup_route"]);

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    if (!esInterno(ctx)) throw new TenantError("No tienes acceso a este recurso", 403);
    requireAtLeast(ctx, "operations");
    await assertRateLimit({
      key: rateLimitKey(req, "proveedor:enlace", ctx.userId), limit: 60, windowMs: 60_000,
    });

    const body = await readJson<{ tipo?: unknown; id?: unknown }>(req);
    const tipo = String(body?.tipo ?? "") as TipoDeRecurso;
    const id = String(body?.id ?? "").trim();
    if (!TIPOS.has(tipo)) throw new TenantError("Tipo de servicio desconocido", 400);
    if (!id) throw new TenantError("Indica el servicio", 400);

    const enlace = await emitirEnlaceDeRespuesta(ctx.companyId, tipo, id);
    return ok(enlace);
  } catch (err) {
    return fail(err);
  }
}
