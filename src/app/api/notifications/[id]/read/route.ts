import { NextRequest } from "next/server";
import { requireTenantWrite, tenantFindOne, tenantUpdate, TenantError, esDeSocio } from "@/lib/tenant";
import { puedeMarcar } from "@/lib/notify";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * POST /api/notifications/:id/read  →  marca una notificación como leída (o no
 * leída con `{ read: false }`). La autorización se resuelve en el servidor, y
 * con la MISMA función que arma la bandeja: marcar lo que no se ve —o lo que no
 * es de uno— es el fallo que aparece en cuanto hay dos buzones.
 *
 * Aquí la regla era «`user_id` nulo ⇒ es de empresa ⇒ vale». Los avisos de un
 * tour center también tienen `user_id` nulo, así que esa regla dejaba que
 * cualquiera —incluido otro tour center— se los marcara como leídos y se los
 * borrara de la campana antes de que él los viera.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "notifications:read", ctx.userId), limit: 120, windowMs: 60_000 });

    const { id } = await params;
    const notification = await tenantFindOne<{ user_id?: string | null; partner_id?: string | null }>(
      ctx.companyId, "notification", id
    );
    if (!notification) throw new TenantError("La notificación no existe", 404);
    const actor = {
      userId: ctx.userId, role: ctx.role,
      esDeSocio: esDeSocio(ctx), partnerId: ctx.partnerId,
    };
    if (!puedeMarcar(notification, actor)) {
      throw new TenantError("Esta notificación no es tuya", 403);
    }

    const body = await readJson<{ read?: boolean }>(req);
    const read = body.read !== false;
    const updated = await tenantUpdate(ctx.companyId, "notification", id, {
      read_status: read,
      read_at: read ? new Date().toISOString() : null,
    });

    return ok(updated);
  } catch (err) {
    return fail(err);
  }
}
