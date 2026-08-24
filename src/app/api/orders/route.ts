import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantQuery, tenantCount } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { createOrderWithBookings, type CreateOrderInput } from "@/lib/booking-service";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/** POST /api/orders — creates a multi-product order with all its bookings. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "orders:create", ctx.userId), limit: 20, windowMs: 60_000 });
    requireAtLeast(ctx, "partner");

    const body = await readJson<CreateOrderInput>(req);
    if (!body.customer_id) throw Object.assign(new Error("Debes seleccionar un cliente"), { status: 400 });
    if (!body.items?.length) throw Object.assign(new Error("Añade al menos un producto a la orden"), { status: 400 });

    // Capacity override is a privileged action.
    if (body.capacity_override) requireAtLeast(ctx, "manager");
    // Portal users always sell on behalf of their own partner.
    if (ctx.role === "partner" && ctx.partnerId) body.partner_id = ctx.partnerId;

    const result = await createOrderWithBookings(ctx, body);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

/** GET /api/orders — list with the bookings expanded. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "orders:list", ctx.userId), limit: 120, windowMs: 60_000 });
    const sp = req.nextUrl.searchParams;
    const filter: Record<string, unknown> = {};
    if (sp.get("status")) filter.status = sp.get("status");
    if (ctx.role === "partner" && ctx.partnerId) filter.partner = ctx.partnerId;

    const [rows, total] = await Promise.all([
      tenantQuery(ctx.companyId, "order", {
        _filter: filter,
        _sort: { createdAt: "desc" },
        _limit: Math.min(Number(sp.get("limit") || 50), 500),
        _offset: Number(sp.get("offset") || 0),
        customer: true, seller: true, partner: true,
        booking: { _limit: 20, product: true, departure: true },
      }),
      tenantCount(ctx.companyId, "order", filter),
    ]);
    return ok(rows, { total });
  } catch (err) {
    return fail(err);
  }
}
