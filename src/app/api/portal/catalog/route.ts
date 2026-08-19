import { NextRequest } from "next/server";
import { requireTenant, tenantQuery, TenantError } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { resolvePrice } from "@/lib/pricing";
import type { Departure, Partner, Product, ProductModality } from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * GET /api/portal/catalog?date=YYYY-MM-DD
 * Catálogo autorizado del partner con disponibilidad real y precio B2B.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const sp = req.nextUrl.searchParams;
    const partnerId = ctx.role === "partner" ? ctx.partnerId : sp.get("partner_id") || ctx.partnerId;
    if (!partnerId) throw new TenantError("Tu usuario no está asociado a ningún partner", 403);

    const partner = (await tenantQuery<Partner>(ctx.companyId, "partner", {
      _filter: { _id: partnerId }, _limit: 1, authorized_products: true,
    }))[0];
    if (!partner) throw new TenantError("Partner no encontrado", 404);
    if (partner.status !== "active") throw new TenantError("El partner está inactivo", 403);

    const authorized = (partner.authorized_products || []) as any[];
    const authorizedIds = authorized.map((p) => (typeof p === "object" ? p._id : p)).filter(Boolean);

    const products = await tenantQuery<Product>(ctx.companyId, "product", {
      _filter: {
        status: "active",
        ...(authorizedIds.length ? { _id: { in: authorizedIds } } : {}),
      },
      _limit: 200, _sort: { name: "asc" },
      category: true,
      product_modality: { _limit: 20, _filter: { status: "active" } },
    });

    const dateParam = sp.get("date");
    const dayStart = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
    const rangeEnd = new Date(dayStart);
    rangeEnd.setDate(rangeEnd.getDate() + (dateParam ? 1 : 30));

    const productIds = products.map((p) => p._id);
    const departures = productIds.length
      ? await tenantQuery<Departure>(ctx.companyId, "departure", {
          _filter: {
            product: { in: productIds },
            departure_at: { gte: dayStart.toISOString(), lte: rangeEnd.toISOString() },
            status: { nin: ["cancelled", "closed", "completed"] },
          },
          _limit: 500, _sort: { departure_at: "asc" },
        })
      : [];

    const departuresByProduct = new Map<string, Departure[]>();
    for (const d of departures) {
      const id = refId(d.product) || "none";
      departuresByProduct.set(id, [...(departuresByProduct.get(id) || []), d]);
    }

    // B2B price per product using the pricing engine (never a frontend formula).
    const rows = await Promise.all(
      products.map(async (product) => {
        const modalities = (product.product_modality || []) as ProductModality[];
        const modality = modalities.find((m) => m.modality_type === "adult") || modalities[0];
        let price = null;
        try {
          const resolved = await resolvePrice({
            companyId: ctx.companyId,
            productId: product._id,
            modalityId: modality?._id,
            partnerId,
            channel: "b2b_portal",
            quantity: 1,
            travelDate: dayStart.toISOString(),
          });
          price = {
            unit_price: resolved.unitPrice,
            total: resolved.totalAmount,
            currency: resolved.currency,
            rule: resolved.snapshot.applied_rule_name,
          };
        } catch (err) {
          console.error(`[portal/catalog] no se pudo calcular el precio de ${product.name}:`, err);
        }

        const productDepartures = departuresByProduct.get(product._id) || [];
        return {
          _id: product._id,
          name: product.name,
          short_description: product.short_description,
          description: product.description,
          duration_hours: product.duration_hours,
          location: product.location,
          meeting_point: product.meeting_point,
          images: product.images,
          cover_image_url: product.cover_image_url,
          category: typeof product.category === "object" ? product.category?.name : undefined,
          modalities: modalities.map((m) => ({ _id: m._id, name: m.name, modality_type: m.modality_type })),
          price,
          departures: productDepartures.slice(0, 20).map((d) => ({
            _id: d._id,
            departure_at: d.departure_at,
            available_pax: d.available_pax ?? 0,
            capacity: d.capacity ?? 0,
            status: d.status,
          })),
          next_departure: productDepartures[0]?.departure_at,
        };
      })
    );

    console.log(`[portal/catalog] ${rows.length} productos autorizados para ${partner.commercial_name || partner.name}`);
    return ok({ products: rows, partner_id: partnerId, restricted: authorizedIds.length > 0 });
  } catch (err) {
    return fail(err);
  }
}
