import { NextRequest } from "next/server";
import { requireTenantWrite, TenantError, esDeProveedor } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  responderDesdeElPortal, MENSAJE_DEL_ENLACE,
  type Respuesta, type TipoDeRecurso,
} from "@/lib/respuesta-proveedor";

/**
 * POST /api/proveedor/respuesta — el proveedor acepta o rechaza un servicio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOLO EL PROVEEDOR, Y SOLO EL SUYO
 *
 * Aquí NO entra el personal interno, ni siquiera con rango. Aceptar en nombre
 * de un transportista es exactamente lo que esta función existe para evitar: si
 * la casa puede marcar «aceptado», la conformidad deja de probar nada y el
 * enlace de un clic sobra. Cuando hay que registrar una respuesta dada por
 * teléfono, se le manda el enlace y lo pulsa él.
 *
 * El proveedor sale de la FICHA, nunca del cuerpo de la petición.
 */
const RESPUESTAS = new Set<Respuesta>(["accepted", "rejected"]);
const TIPOS = new Set<TipoDeRecurso>(["departure_resource", "pickup_route"]);

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    if (!esDeProveedor(ctx) || !ctx.supplierId) {
      throw new TenantError("Solo el proveedor puede contestar sus servicios", 403);
    }
    await assertRateLimit({
      key: rateLimitKey(req, "proveedor:respuesta", ctx.userId), limit: 60, windowMs: 60_000,
    });

    const body = await readJson<{ tipo?: unknown; id?: unknown; respuesta?: unknown; nota?: unknown }>(req);
    const tipo = String(body?.tipo ?? "") as TipoDeRecurso;
    const id = String(body?.id ?? "").trim();
    const respuesta = String(body?.respuesta ?? "") as Respuesta;
    if (!TIPOS.has(tipo)) throw new TenantError("Tipo de servicio desconocido", 400);
    if (!id) throw new TenantError("Indica el servicio", 400);
    if (!RESPUESTAS.has(respuesta)) throw new TenantError("La respuesta solo puede ser aceptar o rechazar", 400);

    // El motivo del rechazo se guarda; el de la aceptación también, si lo pone.
    // No se exige: obligar a escribir algo para poder decir que no es la forma
    // de que nadie diga que no y la operadora se entere al llegar el autobús.
    const nota = typeof body?.nota === "string" ? body.nota.trim().slice(0, 500) || null : null;

    const hecho = await responderDesdeElPortal(
      ctx.companyId, ctx.supplierId, tipo, id, respuesta, nota, ctx.userId
    );
    if (!hecho.ok) {
      throw new TenantError(MENSAJE_DEL_ENLACE[hecho.motivo ?? "already_answered"], 409);
    }
    return ok({ answer: hecho.answer, confirmation_number: hecho.confirmation_number ?? null });
  } catch (err) {
    return fail(err);
  }
}
