import { NextRequest } from "next/server";
import { requireTenant, tenantQuery, tenantAggregate } from "@/lib/tenant";
import { ok, fail, resolvePeriod } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";
import { refId } from "@/lib/types";

/**
 * Executive dashboard.
 *
 * Bookings for the period are pulled once (paged, projected to the few fields
 * we need) and every ranking is derived from that single dataset; reference
 * labels are then resolved with one batched query per dimension.
 */

const CANCELLED = ["cancelled", "refunded"];
const PAGE = 1000;
const MAX_PAGES = 5;

interface Bucket { key: string; label: string; sales: number; pax: number; bookings: number; margin: number }

function bump(map: Map<string, Bucket>, key: string | undefined, sales: number, pax: number, margin: number) {
  if (!key) return;
  const b = map.get(key) || { key, label: key, sales: 0, pax: 0, bookings: 0, margin: 0 };
  b.sales += sales; b.pax += pax; b.bookings += 1; b.margin += margin;
  map.set(key, b);
}

function topOf(map: Map<string, Bucket>, limit = 6): Bucket[] {
  return [...map.values()].sort((a, b) => b.sales - a.sales).slice(0, limit);
}

async function labelize(table: string, companyId: string, buckets: Bucket[], nameOf: (r: any) => string) {
  const ids = buckets.map((b) => b.key).filter(Boolean);
  if (ids.length === 0) return buckets;
  const rows = await tenantQuery<any>(companyId, table, { _filter: { _id: { in: ids } }, _limit: ids.length });
  const byId = new Map(rows.map((r) => [r._id, r]));
  for (const b of buckets) {
    const row = byId.get(b.key);
    if (row) b.label = nameOf(row);
  }
  return buckets;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const sp = req.nextUrl.searchParams;
    const period = resolvePeriod(sp.get("period"), sp.get("from"), sp.get("to"));

    const scope: Record<string, unknown> = {};
    for (const key of ["product", "branch", "seller", "partner", "channel"]) {
      const value = sp.get(key);
      if (value) scope[key] = value;
    }
    if (ctx.role === "partner" && ctx.partnerId) scope.partner = ctx.partnerId;

    const periodFilter = { ...scope, booking_date: { gte: period.from, lte: period.to } };

    // ---- period bookings (single projected dataset) ------------------------
    const rows: any[] = [];
    let truncated = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const chunk = await tenantQuery<any>(ctx.companyId, "booking", {
        _filter: periodFilter,
        _sort: { booking_date: "asc" },
        _limit: PAGE,
        _offset: page * PAGE,
        _select: {
          booking_date: true, total_amount: true, cost_amount: true, margin_amount: true,
          pax_total: true, status: true, channel: true, currency: true,
          product: true, seller: true, partner: true, branch: true, departure: true,
        },
      });
      rows.push(...chunk);
      if (chunk.length < PAGE) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
    if (truncated) console.warn(`[dashboard] periodo truncado a ${MAX_PAGES * PAGE} reservas`);

    const active = rows.filter((r) => !CANCELLED.includes(r.status));
    const cancelled = rows.filter((r) => CANCELLED.includes(r.status));

    const byProduct = new Map<string, Bucket>();
    const bySeller = new Map<string, Bucket>();
    const byPartner = new Map<string, Bucket>();
    const byChannel = new Map<string, Bucket>();
    const byDay = new Map<string, Bucket>();

    let sales = 0, pax = 0, cost = 0;
    for (const r of active) {
      const amount = r.total_amount ?? 0;
      const paxCount = r.pax_total ?? 0;
      const margin = r.margin_amount ?? amount - (r.cost_amount ?? 0);
      sales += amount; pax += paxCount; cost += r.cost_amount ?? 0;

      bump(byProduct, refId(r.product), amount, paxCount, margin);
      bump(bySeller, refId(r.seller), amount, paxCount, margin);
      bump(byPartner, refId(r.partner), amount, paxCount, margin);
      bump(byChannel, r.channel, amount, paxCount, margin);
      bump(byDay, (r.booking_date || "").slice(0, 10), amount, paxCount, margin);
    }

    const [topProducts, topSellers, topPartners] = await Promise.all([
      labelize("product", ctx.companyId, topOf(byProduct), (r) => r.name || "Producto"),
      labelize("seller", ctx.companyId, topOf(bySeller), (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Vendedor"),
      labelize("partner", ctx.companyId, topOf(byPartner), (r) => r.commercial_name || r.name || "Partner"),
    ]);

    // ---- today / month headline figures ------------------------------------
    const today = resolvePeriod("today");
    const month = resolvePeriod("month");
    const [todayAgg, monthAgg] = await Promise.all([
      tenantAggregate(ctx.companyId, "booking", {
        _filter: { ...scope, status: { nin: CANCELLED }, booking_date: { gte: today.from, lte: today.to } },
        _aggregate: { _sum: { total_amount: true, pax_total: true }, _count: true },
      }),
      tenantAggregate(ctx.companyId, "booking", {
        _filter: { ...scope, status: { nin: CANCELLED }, booking_date: { gte: month.from, lte: month.to } },
        _aggregate: { _sum: { total_amount: true, pax_total: true }, _count: true },
      }),
    ]);

    // ---- financial position -------------------------------------------------
    const [commissionsPending, receivables, payables, cashOpen, upcoming] = await Promise.all([
      tenantAggregate(ctx.companyId, "commission", {
        _filter: { status: { in: ["pending", "approved", "settled"] } },
        _aggregate: { _sum: { amount: true }, _count: true },
      }),
      tenantAggregate(ctx.companyId, "receivable", {
        _filter: { status: { nin: ["paid", "written_off"] } },
        _aggregate: { _sum: { balance: true }, _count: true },
      }),
      tenantAggregate(ctx.companyId, "payable", {
        _filter: { status: { nin: ["paid", "cancelled"] } },
        _aggregate: { _sum: { balance: true }, _count: true },
      }),
      tenantAggregate(ctx.companyId, "cash_session", {
        _filter: { status: "open" },
        _aggregate: { _sum: { expected_cash: true }, _count: true },
      }),
      tenantQuery<any>(ctx.companyId, "departure", {
        _filter: { departure_at: { gte: new Date().toISOString() }, status: { nin: ["cancelled", "completed"] } },
        _sort: { departure_at: "asc" },
        _limit: 8,
        product: true,
      }),
    ]);

    const lowOccupancy = upcoming
      .map((d: any) => ({
        _id: d._id,
        product: typeof d.product === "object" ? d.product?.name : "Salida",
        departure_at: d.departure_at,
        capacity: d.capacity ?? 0,
        booked: (d.booked_pax ?? 0) + (d.pending_pax ?? 0),
        available: d.available_pax ?? 0,
        status: d.status,
        occupancy: d.capacity ? Math.round((((d.booked_pax ?? 0) + (d.pending_pax ?? 0)) / d.capacity) * 100) : 0,
      }))
      .sort((a: any, b: any) => a.occupancy - b.occupancy);

    const totalBookings = rows.length;
    const cancellationRate = totalBookings > 0 ? (cancelled.length / totalBookings) * 100 : 0;

    return ok({
      period: { ...period, from: period.from, to: period.to },
      currency: ctx.company?.base_currency || "usd",
      kpis: {
        sales_period: round2(sales),
        margin_period: round2(sales - cost),
        cost_period: round2(cost),
        bookings_period: active.length,
        pax_period: pax,
        avg_ticket: active.length > 0 ? round2(sales / active.length) : 0,
        cancellations: cancelled.length,
        cancellation_rate: round2(cancellationRate),
        sales_today: round2(todayAgg?._sum?.total_amount ?? 0),
        bookings_today: todayAgg?._count ?? 0,
        pax_today: todayAgg?._sum?.pax_total ?? 0,
        sales_month: round2(monthAgg?._sum?.total_amount ?? 0),
        bookings_month: monthAgg?._count ?? 0,
        pax_month: monthAgg?._sum?.pax_total ?? 0,
        commissions_pending: round2(commissionsPending?._sum?.amount ?? 0),
        commissions_count: commissionsPending?._count ?? 0,
        receivables_balance: round2(receivables?._sum?.balance ?? 0),
        receivables_count: receivables?._count ?? 0,
        payables_balance: round2(payables?._sum?.balance ?? 0),
        payables_count: payables?._count ?? 0,
        cash_on_hand: round2(cashOpen?._sum?.expected_cash ?? 0),
        open_cash_sessions: cashOpen?._count ?? 0,
      },
      series: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
      top_products: topProducts,
      top_sellers: topSellers,
      top_partners: topPartners,
      by_channel: topOf(byChannel, 10),
      upcoming_departures: lowOccupancy,
      truncated,
    });
  } catch (err) {
    return fail(err);
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
