import { NextRequest } from "next/server";
import { requireTenant, requireTenantWrite, requireAtLeast, tenantQuery, tenantCount } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { sellerFilterFor } from "@/lib/seller-scope";
import { notify } from "@/lib/notify-service";
import { usuarioDeVendedor } from "@/lib/seller-identity";
import { refId } from "@/lib/types";
import { assertWithinLimit } from "@/lib/plan-service";
import { createOrderWithBookings, type CreateOrderInput } from "@/lib/booking-service";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { flushOutboxAfterResponse } from "@/lib/messaging/flush";

/** POST /api/orders — creates a multi-product order with all its bookings. */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "orders:create", ctx.userId), limit: 20, windowMs: 60_000 });
    requireAtLeast(ctx, "partner");

    const body = await readJson<CreateOrderInput>(req);
    if (!body.customer_id) throw Object.assign(new Error("Debes seleccionar un cliente"), { status: 400 });
    if (!body.items?.length) throw Object.assign(new Error("Añade al menos un producto a la orden"), { status: 400 });

    // Un precio pactado solo nace de una cotización aceptada, y lo fija el
    // servidor en /api/quotes/:id/convert. Aceptarlo aquí desde el navegador
    // convertiría el punto de venta en un formulario de "pon tú el precio".
    for (const item of body.items) {
      delete item.unit_price_override;
      delete item.cost_override;
      delete item.quote_id;
      // 0061 — las marcas de componente de paquete las pone la expansión del
      // servidor. Poder declararse uno a mano sería poder regalarse cualquier
      // excursión: un componente se cobra a cero.
      delete item.bundle_component;
      delete item.bundle_item_id;
      delete item.bundle_group;
    }

    // Capacity override is a privileged action.
    if (body.capacity_override) requireAtLeast(ctx, "manager");
    // Vender por encima del límite de crédito de un socio también: un vendedor
    // no decide cuánto descubierto aguanta la empresa. Y el portal del socio
    // nunca puede saltárselo, se pida como se pida.
    if (body.allow_over_credit) {
      if (ctx.role === "partner") delete body.allow_over_credit;
      else requireAtLeast(ctx, "manager");
    }
    // Las condiciones de cobro salen de la cotización, no del navegador: aquí
    // permitirían regalarse un anticipo de cero y un saldo a un año.
    delete body.terms;
    // Portal users always sell on behalf of their own partner.
    if (ctx.role === "partner" && ctx.partnerId) body.partner_id = ctx.partnerId;

    // El techo de reservas del mes se mide con TODAS las que trae la orden, no
    // de una en una: una orden de cinco reservas con cuatro de hueco tiene que
    // fallar antes de escribir las cuatro primeras y dejar la venta a medias.
    await assertWithinLimit(ctx, "max_bookings_month", Math.max(1, (body.items || []).length));

    const result = await createOrderWithBookings(ctx, body);

    /**
     * «Esta venta es tuya», al vendedor al que se le atribuyó.
     *
     * Importa sobre todo cuando NO estuvo delante: la venta web que le atribuye
     * su enlace, la que registra el mostrador a su nombre. Sin aviso, se entera
     * al mirar la pantalla —si mira—, y una venta que el vendedor no sabe que
     * tiene es una comisión que no va a reclamar.
     *
     * A la PERSONA, y nunca a quien acaba de venderla: ya lo sabe.
     */
    const suyo = refId((result.order as { seller?: unknown }).seller);
    if (suyo) {
      const userId = await usuarioDeVendedor(ctx.companyId, suyo);
      if (userId && userId !== ctx.userId) {
        await notify({
          companyId: ctx.companyId,
          userId,
          event: "sale_attributed",
          entityType: "order",
          entityId: result.order._id,
          vars: {
            referencia: result.order.order_number ?? "",
            monto: result.order.total ?? 0,
            moneda: result.order.currency ?? "usd",
          },
        });
      }
    }

    // La venta ya está hecha. La confirmación y el voucher salen en cuanto esta
    // respuesta llegue al punto de venta, sin que el cajero espere a Resend con
    // el cliente delante.
    flushOutboxAfterResponse(ctx.company, ctx.companyId);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

/** GET /api/orders — list with the bookings expanded. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    await assertRateLimit({ key: rateLimitKey(req, "orders:list", ctx.userId), limit: 120, windowMs: 60_000 });
    const sp = req.nextUrl.searchParams;
    const filter: Record<string, unknown> = {};
    if (sp.get("status")) filter.status = sp.get("status");
    if (ctx.role === "partner" && ctx.partnerId) filter.partner = ctx.partnerId;
    // Esta ruta arma su propio filtro y NO pasa por `buildListFilter`, así que
    // el ámbito del vendedor hay que aplicarlo aquí a mano. Sin esto, acotar
    // `/api/erp/order` no habría servido de nada: la pantalla de ventas lee por
    // aquí, y por aquí se veían las de toda la empresa.
    const sellerScope = sellerFilterFor("order", ctx.role, ctx.sellerId);
    if (sellerScope) Object.assign(filter, sellerScope);

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
