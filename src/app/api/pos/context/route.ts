import { NextRequest } from "next/server";
import { requireTenant, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import type { Branch, CashSession, Departure, Hotel, Partner, Product, Seller } from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * GET /api/pos/context?date=YYYY-MM-DD
 * Single bootstrap call for the point of sale: catalogue with modalities and
 * live availability for the selected day, plus every selector the cashier needs.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const dateParam = req.nextUrl.searchParams.get("date");
    const day = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
    const from = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
    // Look 60 days ahead so the seller can also close future sales from the same screen.
    const to = new Date(from.getTime() + 60 * 86_400_000);

    const [products, hotels, sellers, partners, branches, openCash] = await Promise.all([
      tenantQuery<Product>(ctx.companyId, "product", {
        _filter: { status: "active" },
        _sort: { sort_order: "asc" },
        _limit: 200,
        category: true,
        product_modality: { _limit: 20, _sort: { sort_order: "asc" } },
      }),
      tenantQuery<Hotel>(ctx.companyId, "hotel", { _filter: { status: "active" }, _sort: { name: "asc" }, _limit: 300, zone: true }),
      tenantQuery<Seller>(ctx.companyId, "seller", { _filter: { status: "active" }, _sort: { first_name: "asc" }, _limit: 200 }),
      tenantQuery<Partner>(ctx.companyId, "partner", { _filter: { status: "active" }, _sort: { name: "asc" }, _limit: 200 }),
      tenantQuery<Branch>(ctx.companyId, "branch", { _filter: { status: "active" }, _sort: { name: "asc" }, _limit: 50 }),
      tenantQuery<CashSession>(ctx.companyId, "cash_session", {
        _filter: { user: ctx.userId, status: "open" }, _limit: 1, _sort: { createdAt: "desc" }, cash_register: true,
      }),
    ]);

    const productIds = products.map((p) => p._id);
    const departures = productIds.length
      ? await tenantQuery<Departure>(ctx.companyId, "departure", {
          _filter: {
            product: { in: productIds },
            departure_at: { gte: from.toISOString(), lte: to.toISOString() },
            status: { nin: ["cancelled", "closed", "completed"] },
          },
          _sort: { departure_at: "asc" },
          _limit: 1000,
        })
      : [];

    const byProduct = new Map<string, Departure[]>();
    for (const d of departures) {
      const id = refId(d.product);
      if (!id) continue;
      byProduct.set(id, [...(byProduct.get(id) || []), d]);
    }

    const catalog = products.map((p) => ({
      _id: p._id,
      name: p.name,
      code: p.code,
      product_type: p.product_type,
      short_description: p.short_description,
      cover_image_url: p.cover_image_url,
      location: p.location,
      duration_hours: p.duration_hours,
      base_price: p.base_price ?? 0,
      currency: p.currency || ctx.company?.base_currency || "usd",
      category: typeof p.category === "object" ? p.category?.name : undefined,
      meeting_point: p.meeting_point,
      modalities: ((p.product_modality || []) as any[])
        .filter((m) => m.status !== "inactive")
        .map((m) => ({
          _id: m._id, name: m.name, modality_type: m.modality_type,
          price: m.price ?? 0, min_pax: m.min_pax, max_pax: m.max_pax,
        })),
      departures: (byProduct.get(p._id) || []).map((d) => ({
        _id: d._id,
        departure_at: d.departure_at,
        capacity: d.capacity ?? 0,
        available_pax: d.available_pax ?? 0,
        status: d.status,
      })),
    }));

    console.log(`[pos] contexto: ${catalog.length} productos · ${departures.length} salidas · caja ${openCash[0]?.code ?? "cerrada"}`);
    return ok({
      currency: ctx.company?.base_currency || "usd",
      role: ctx.role,
      catalog,
      hotels: hotels.map((h) => ({ _id: h._id, name: h.name, zone: typeof h.zone === "object" ? h.zone?.name : undefined })),
      sellers: sellers.map((s) => ({ _id: s._id, name: [s.first_name, s.last_name].filter(Boolean).join(" ") || s.code || "Vendedor" })),
      partners: partners.map((p) => ({ _id: p._id, name: p.commercial_name || p.name || "Partner" })),
      branches: branches.map((b) => ({ _id: b._id, name: b.name })),
      cash_session: openCash[0]
        ? { _id: openCash[0]._id, code: openCash[0].code, register: typeof openCash[0].cash_register === "object" ? openCash[0].cash_register?.name : undefined }
        : null,
    });
  } catch (err) {
    return fail(err);
  }
}
