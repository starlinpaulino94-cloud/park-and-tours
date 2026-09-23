import { NextRequest } from "next/server";
import { requireTenant, tenantQuery } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import type { Branch, CashSession, Departure, Hotel, Partner, Product, Seller } from "@/lib/types";
import { refId } from "@/lib/types";
import { plazasLibres, type SalidaConCupo } from "@/lib/plazas";

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

    const [products, bundles, hotels, sellers, partners, branches, openCash] = await Promise.all([
      tenantQuery<Product>(ctx.companyId, "product", {
        // ─────────────────────────────────────────────────────────────────
        // LOS PAQUETES NO SE OFRECEN AQUÍ TODAVÍA
        //
        // Un paquete necesita un dato que esta pantalla no pide: el DÍA en que
        // empieza. Sin él, `createOrderWithBookings` rechaza la venta con
        // «Falta el día en que empieza el paquete».
        //
        // Sin este filtro el paquete salía como una tarjeta normal, el cajero
        // lo añadía y el fallo aparecía al confirmar, con el cliente delante.
        // Ofrecer algo que no se puede cobrar es peor que no ofrecerlo: lo
        // segundo se nota al configurar, lo primero en el mostrador.
        _filter: { status: "active", is_bundle: false },
        _sort: { sort_order: "asc" },
        _limit: 200,
        category: true,
        product_modality: { _limit: 20, _sort: { sort_order: "asc" } },
        // Los extras viajan con el catálogo: ofrecerlos exige una consulta más
        // por producto si no, y el POS se abre con el cliente delante.
        product_extra: { _limit: 30, _sort: { sort_order: "asc" } },
      }),
      // ─────────────────────────────────────────────────────────────────
      // LOS PAQUETES VAN APARTE, Y NO MEZCLADOS EN EL CATÁLOGO
      //
      // No se venden igual: un paquete no tiene salida propia —salen sus
      // actividades— así que las tarjetas del catálogo, que enseñan «próxima
      // salida» y «plazas», no dicen nada útil sobre él. Y para añadirlo hace
      // falta antes el DÍA en que empieza, que ninguna tarjeta pide.
      //
      // Separarlos deja que cada uno tenga la interfaz que le corresponde, en
      // vez de una tarjeta que miente sobre la mitad de sus datos.
      tenantQuery<Product & { bundle_buffer_minutes?: number }>(ctx.companyId, "product", {
        _filter: { status: "active", is_bundle: true },
        _sort: { sort_order: "asc" },
        _limit: 50,
        category: true,
        product_bundle_item: { _limit: 20, _sort: { day_offset: "asc" }, product: true },
      } as never),
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
      extras: ((p as any).product_extra || [])
        .filter((e: any) => e.status !== "inactive")
        .map((e: any) => ({
          _id: e._id, name: e.name, description: e.description,
          price_type: e.price_type, price: e.price ?? 0, currency: e.currency,
          is_required: e.is_required === true, max_quantity: e.max_quantity ?? null,
        })),
      departures: (byProduct.get(p._id) || []).map((d) => ({
        _id: d._id,
        departure_at: d.departure_at,
        capacity: d.capacity ?? 0,
        // `?? 0` convertía «la caché no está calculada» en «agotado», y con eso
        // el catálogo entero salía en rojo con salidas vacías. Ver plazas.ts.
        available_pax: plazasLibres(d as SalidaConCupo),
        status: d.status,
      })),
    }));

    console.log(`[pos] contexto: ${catalog.length} productos · ${departures.length} salidas · caja ${openCash[0]?.code ?? "cerrada"}`);
    const bundleCatalog = (bundles as unknown as Record<string, unknown>[]).map((b) => ({
      _id: String(b._id),
      name: String(b.name ?? "Paquete"),
      code: b.code ?? null,
      base_price: b.base_price ?? 0,
      currency: b.currency || ctx.company?.base_currency || "usd",
      category: typeof b.category === "object" && b.category
        ? (b.category as { name?: string }).name : undefined,
      cover_image_url: b.cover_image_url ?? null,
      // Solo para que la tarjeta pueda decir QUÉ lleva antes de pedir la fecha.
      // El itinerario real lo arma `/api/bundles` con las salidas de cada día.
      activities: ((b.product_bundle_item as Record<string, unknown>[]) || []).map((it) => ({
        itemId: String(it._id),
        name: typeof it.product === "object" && it.product
          ? String((it.product as { name?: string }).name ?? "Actividad")
          : "Actividad",
        dayOffset: Number(it.day_offset ?? 0),
        isOptional: it.is_optional === true,
      })),
    }));

    return ok({
      currency: ctx.company?.base_currency || "usd",
      role: ctx.role,
      catalog,
      bundles: bundleCatalog,
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
