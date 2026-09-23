import { NextRequest } from "next/server";
import { requireTenantWrite, tenantQuery, esDeSocio } from "@/lib/tenant";
import { ventaSelladaPorVendedor } from "@/lib/seller-scope";
import { excesoDeDescuento, mensajeExceso } from "@/lib/techo-descuento";
import { ok, fail, readJson } from "@/lib/api-response";
import { resolvePrice, billablePax } from "@/lib/pricing";
import type { Channel } from "@/lib/types";

interface QuoteItem {
  product_id: string;
  modality_id?: string | null;
  adults?: number;
  children?: number;
  infants?: number;
  discount_pct?: number;
  tax_pct?: number;
  travel_date?: string | null;
}

/**
 * POST /api/pricing/quote
 * Prices a cart with the same engine the sale uses, so the POS never computes
 * a price in the browser and what the seller sees is what gets charged.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenantWrite();
    const body = await readJson<{
      items?: QuoteItem[]; partner_id?: string | null; seller_id?: string | null; channel?: Channel | null;
    }>(req);

    const items = (body.items || []).filter((i) => i.product_id);
    if (items.length === 0) throw Object.assign(new Error("Añade al menos un producto"), { status: 400 });

    /**
     * El techo de descuento, TAMBIÉN al cotizar.
     *
     * Lo definitivo lo decide la creación de la orden, que es donde se cobra.
     * Aquí se comprueba igual porque esta ruta es la que el punto de venta
     * llama mientras el cajero teclea: dejar que el carrito enseñe un total con
     * un 40 % y rechazarlo al confirmar es discutir con el cliente delante por
     * un precio que el sistema ya le había enseñado.
     */
    if (ventaSelladaPorVendedor(ctx) && ctx.sellerId) {
      const [fichaPropia] = await tenantQuery<{ max_discount_pct?: number | null }>(
        ctx.companyId, "seller", { _filter: { _id: ctx.sellerId }, _limit: 1 }
      );
      const exceso = excesoDeDescuento(
        items.map((i) => ({ product_id: i.product_id, discount_pct: i.discount_pct })),
        fichaPropia?.max_discount_pct
      );
      if (exceso) throw Object.assign(new Error(mensajeExceso(exceso)), { status: 403 });
    }

    // Portal users are always priced with their own partner's B2B rules.
    const partnerId = esDeSocio(ctx) && ctx.partnerId ? ctx.partnerId : body.partner_id || null;

    const lines = await Promise.all(
      items.map(async (item) => {
        const adults = Number(item.adults ?? 0);
        const children = Number(item.children ?? 0);
        const infants = Number(item.infants ?? 0);
        // Same rule as the sale: infants do not pay.
        const quantity = billablePax(adults, children);
        try {
          const result = await resolvePrice({
            companyId: ctx.companyId,
            productId: item.product_id,
            modalityId: item.modality_id || null,
            partnerId,
            sellerId: body.seller_id || null,
            channel: body.channel || (partnerId ? "b2b_portal" : "direct"),
            quantity,
            travelDate: item.travel_date || null,
            discountPct: Number(item.discount_pct ?? 0),
            taxPct: Number(item.tax_pct ?? 0),
          });
          return {
            product_id: item.product_id,
            modality_id: item.modality_id || null,
            quantity,
            pax_total: adults + children + infants,
            unit_price: result.unitPrice,
            gross_amount: result.grossAmount,
            discount_amount: result.discountAmount,
            tax_amount: result.taxAmount,
            total_amount: result.totalAmount,
            currency: result.currency,
            applied_rule: result.snapshot.applied_rule_name || null,
            error: null as string | null,
          };
        } catch (err) {
          // One unpriceable line must not break the whole quote: report it inline.
          const message = err instanceof Error ? err.message : "No se pudo calcular el precio";
          console.error(`[quote] error valorando el producto ${item.product_id}:`, err);
          return {
            product_id: item.product_id, modality_id: item.modality_id || null, quantity,
            pax_total: adults + children + infants,
            unit_price: 0, gross_amount: 0, discount_amount: 0, tax_amount: 0, total_amount: 0,
            currency: ctx.company?.base_currency || "usd", applied_rule: null, error: message,
          };
        }
      })
    );

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const totals = lines.reduce(
      (acc, l) => ({
        gross: acc.gross + l.gross_amount,
        discount: acc.discount + l.discount_amount,
        tax: acc.tax + l.tax_amount,
        total: acc.total + l.total_amount,
        pax: acc.pax + l.pax_total,
      }),
      { gross: 0, discount: 0, tax: 0, total: 0, pax: 0 }
    );

    return ok({
      lines,
      currency: lines[0]?.currency || ctx.company?.base_currency || "usd",
      totals: {
        gross: round2(totals.gross), discount: round2(totals.discount),
        tax: round2(totals.tax), total: round2(totals.total), pax: totals.pax,
      },
    });
  } catch (err) {
    return fail(err);
  }
}
