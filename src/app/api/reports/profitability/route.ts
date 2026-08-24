import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantQuery } from "@/lib/tenant";
import { ok, fail, resolvePeriod } from "@/lib/api-response";
import type { Booking, Commission } from "@/lib/types";
import { refId } from "@/lib/types";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

type Bucket = {
  key: string; label: string;
  bookings: number; pax: number;
  gross: number; discounts: number; taxes: number; net: number;
  commissions: number; costs: number; margin: number; margin_pct: number;
};

const MAX_ROWS = 750;

const emptyBucket = (key: string, label: string): Bucket => ({
  key, label, bookings: 0, pax: 0, gross: 0, discounts: 0, taxes: 0,
  net: 0, commissions: 0, costs: 0, margin: 0, margin_pct: 0,
});

/**
 * GET /api/reports/profitability?period=month&group_by=product|seller|partner|channel|departure
 * Ingreso bruto − descuentos − comisiones − costes = margen de contribución.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "reports:profitability", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const sp = req.nextUrl.searchParams;
    const { from, to, label } = resolvePeriod(sp.get("period"), sp.get("from"), sp.get("to"));
    const groupBy = sp.get("group_by") || "product";

    const bookings = await tenantQuery<Booking>(ctx.companyId, "booking", {
      _filter: {
        booking_date: { gte: from, lte: to },
        status: { nin: ["draft", "cancelled", "refunded"] },
      },
      _limit: MAX_ROWS,
      _sort: { booking_date: "desc" },
      product: true, seller: true, partner: true, departure: true,
    });

    const bookingIds = bookings.map((b) => b._id);
    const commissions = bookingIds.length
      ? await tenantQuery<Commission>(ctx.companyId, "commission", {
          _filter: { booking: { in: bookingIds }, status: { ne: "cancelled" } },
          _limit: MAX_ROWS,
        })
      : [];

    const commissionByBooking = new Map<string, number>();
    for (const c of commissions) {
      const id = refId(c.booking);
      if (!id) continue;
      commissionByBooking.set(id, (commissionByBooking.get(id) || 0) + (c.amount ?? 0));
    }

    const keyOf = (b: Booking): { key: string; label: string } => {
      const pick = (ref: any, fallback: string, field = "name") =>
        ref && typeof ref === "object"
          ? { key: ref._id as string, label: (ref[field] as string) || fallback }
          : { key: "none", label: fallback };
      switch (groupBy) {
        case "seller": return pick(b.seller, "Venta directa");
        case "partner": return pick(b.partner, "Venta propia");
        case "channel": return { key: b.channel || "direct", label: b.channel || "direct" };
        case "departure": {
          const d: any = b.departure;
          return d && typeof d === "object"
            ? { key: d._id, label: new Date(d.departure_at).toISOString().slice(0, 16).replace("T", " ") }
            : { key: "none", label: "Sin salida" };
        }
        default: return pick(b.product, "Sin producto");
      }
    };

    const buckets = new Map<string, Bucket>();
    const totals = emptyBucket("total", label);

    for (const b of bookings) {
      const { key, label: bucketLabel } = keyOf(b);
      const bucket = buckets.get(key) || emptyBucket(key, bucketLabel);
      const commission = commissionByBooking.get(b._id) || 0;
      const gross = b.gross_amount ?? b.total_amount ?? 0;
      const discounts = b.discount_amount ?? 0;
      const taxes = b.tax_amount ?? 0;
      const net = b.total_amount ?? 0;
      const costs = b.cost_amount ?? 0;
      const margin = net - commission - costs;

      for (const target of [bucket, totals]) {
        target.bookings += 1;
        target.pax += b.pax_total ?? 0;
        target.gross += gross;
        target.discounts += discounts;
        target.taxes += taxes;
        target.net += net;
        target.commissions += commission;
        target.costs += costs;
        target.margin += margin;
      }
      buckets.set(key, bucket);
    }

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const finalize = (b: Bucket): Bucket => ({
      ...b,
      gross: round2(b.gross), discounts: round2(b.discounts), taxes: round2(b.taxes),
      net: round2(b.net), commissions: round2(b.commissions), costs: round2(b.costs),
      margin: round2(b.margin),
      margin_pct: b.net > 0 ? round2((b.margin / b.net) * 100) : 0,
    });

    const rows = [...buckets.values()].map(finalize).sort((a, b) => b.margin - a.margin);

    console.log(`[profitability] ${label} · ${bookings.length} reservas · margen ${round2(totals.margin)}`);
    return ok({
      period: { from, to, label },
      group_by: groupBy,
      rows,
      totals: finalize(totals),
      truncated: bookings.length >= MAX_ROWS,
    });
  } catch (err) {
    return fail(err);
  }
}
