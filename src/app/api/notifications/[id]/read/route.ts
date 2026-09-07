import { NextRequest } from "next/server";
import { requireTenant, tenantFindOne, tenantUpdate, TenantError } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * POST /api/notifications/:id/read  →  marca una notificación como leída (o no
 * leída con `{ read: false }`). La autorización se resuelve en el servidor: la
 * notificación debe ser del usuario (`user_id = yo`) o un aviso a toda la
 * empresa (`user_id` nulo); nunca la de otro compañero.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "notifications:read", ctx.userId), limit: 120, windowMs: 60_000 });

    const { id } = await params;
    const notification = await tenantFindOne<{ user_id?: string | null }>(ctx.companyId, "notification", id);
    if (!notification) throw new TenantError("La notificación no existe", 404);
    if (notification.user_id && notification.user_id !== ctx.userId) {
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
