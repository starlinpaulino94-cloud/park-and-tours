import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, tenantQuery, tenantCount, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { inboxFilter } from "@/lib/notify";

const NOTIFICATION_TYPES = new Set(["info", "booking", "payment", "operation", "alert", "settlement"]);
const LIST_LIMIT = 100;
const MARK_ALL_LIMIT = 500;

/**
 * Las notificaciones son personales: la RLS aísla por empresa, pero dentro de la
 * empresa cada persona solo debe ver las suyas (`user_id = yo`) más los avisos
 * a toda la organización que le tocan por su rol. Sin este alcance, cualquier
 * usuario veía las notificaciones dirigidas a sus compañeros.
 *
 * El rol entró en 0044: hasta entonces un aviso de empresa lo veía TODO el
 * mundo, y desde que el sistema empezó a escribirlos de verdad eso significaría
 * el descuadre de caja de anoche apareciéndole al vendedor igual que al dueño.
 * `inboxFilter` vive en `notify.ts` para que la bandeja y el contador de la
 * campana no puedan discrepar.
 */

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "notifications:list", ctx.userId), limit: 120, windowMs: 60_000 });

    const sp = req.nextUrl.searchParams;
    const base = inboxFilter(ctx.userId, ctx.role);
    const filter: Record<string, unknown> = { ...base };
    if (sp.get("scope") === "unread") filter.read_status = false;
    const type = sp.get("type");
    if (type && NOTIFICATION_TYPES.has(type)) filter.notification_type = type;

    const [items, unreadCount] = await Promise.all([
      tenantQuery(ctx.companyId, "notification", { _filter: filter, _sort: { created_at: "desc" }, _limit: LIST_LIMIT }),
      tenantCount(ctx.companyId, "notification", { ...base, read_status: false }),
    ]);

    return ok({ items, unreadCount });
  } catch (err) {
    return fail(err);
  }
}

/** Marca como leídas todas las notificaciones no leídas del usuario. */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "notifications:markall", ctx.userId), limit: 30, windowMs: 60_000 });

    const body = await readJson<{ action?: string }>(req);
    if (body.action && body.action !== "mark_all_read") {
      return ok({ updated: 0 });
    }

    const unread = await tenantQuery<{ _id?: string; id?: string }>(ctx.companyId, "notification", {
      _filter: { ...inboxFilter(ctx.userId, ctx.role), read_status: false },
      _sort: { created_at: "desc" },
      _limit: MARK_ALL_LIMIT,
    });
    const readAt = new Date().toISOString();
    const ids = unread.map((n) => String(n._id || n.id)).filter(Boolean);
    await Promise.all(ids.map((id) => tenantUpdate(ctx.companyId, "notification", id, { read_status: true, read_at: readAt })));

    return ok({ updated: ids.length });
  } catch (err) {
    return fail(err);
  }
}
