import { NextRequest } from "next/server";
import { requireTenant, tenantQuery, tenantCount, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

const NOTIFICATION_TYPES = new Set(["info", "booking", "payment", "operation", "alert", "settlement"]);
const LIST_LIMIT = 100;
const MARK_ALL_LIMIT = 500;

/**
 * Las notificaciones son personales: la RLS aísla por empresa, pero dentro de la
 * empresa cada persona solo debe ver las suyas (`user_id = yo`) más los avisos
 * a toda la organización (`user_id` nulo). Sin este alcance, cualquier usuario
 * veía las notificaciones dirigidas a sus compañeros.
 */
function scopeFilter(userId: string): Record<string, unknown> {
  return { _or: [{ user_id: userId }, { user_id: null }] };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "notifications:list", ctx.userId), limit: 120, windowMs: 60_000 });

    const sp = req.nextUrl.searchParams;
    const base = scopeFilter(ctx.userId);
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
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "notifications:markall", ctx.userId), limit: 30, windowMs: 60_000 });

    const body = await readJson<{ action?: string }>(req);
    if (body.action && body.action !== "mark_all_read") {
      return ok({ updated: 0 });
    }

    const unread = await tenantQuery<{ _id?: string; id?: string }>(ctx.companyId, "notification", {
      _filter: { ...scopeFilter(ctx.userId), read_status: false },
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
