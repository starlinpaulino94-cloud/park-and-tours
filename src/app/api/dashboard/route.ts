import { NextRequest } from "next/server";
import { requireTenant, tenantQuery, TenantError } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { supabaseServer } from "@/lib/supabase/server";
import {
  resolveDashboardPeriod,
  resolveDashboardPermissions,
  round2,
  trendPct,
  type DashboardRankCriterion,
} from "@/lib/dashboard-metrics";

const UPCOMING_HORIZON_DAYS = 14;
const CHANNELS = new Set(["direct", "web", "phone", "whatsapp", "walk_in", "b2b_portal", "agency", "tour_center", "ota", "pos"]);

async function validateIdFilter(companyId: string, table: string, id: string, label: string) {
  const found = await tenantQuery(companyId, table, { _filter: { _id: id }, _limit: 1 });
  if (found.length === 0) throw new TenantError(`${label} no pertenece a esta empresa`, 403);
}

async function currentSellerId(companyId: string, userId: string): Promise<string | null> {
  const rows = await tenantQuery<{ _id?: string }>(companyId, "seller", { _filter: { user: userId, status: "active" }, _limit: 1 });
  return rows[0]?._id || null;
}

async function buildScope(req: NextRequest, companyId: string, forcedSellerId?: string, forcedPartnerId?: string) {
  const sp = req.nextUrl.searchParams;
  const scope: { product?: string; branch?: string; seller?: string; partner?: string; channel?: string } = {};
  const product = sp.get("product");
  const branch = sp.get("branch");
  const seller = sp.get("seller");
  const partner = sp.get("partner");
  const channel = sp.get("channel");

  if (product) { await validateIdFilter(companyId, "product", product, "La excursión"); scope.product = product; }
  if (branch) { await validateIdFilter(companyId, "branch", branch, "La sucursal"); scope.branch = branch; }
  if (forcedSellerId) scope.seller = forcedSellerId;
  else if (seller) { await validateIdFilter(companyId, "seller", seller, "El vendedor"); scope.seller = seller; }
  if (forcedPartnerId) scope.partner = forcedPartnerId;
  else if (partner) { await validateIdFilter(companyId, "partner", partner, "El tour center/agencia"); scope.partner = partner; }
  if (channel) {
    if (!CHANNELS.has(channel)) throw new TenantError("Canal no válido", 400);
    scope.channel = channel;
  }
  return scope;
}

function asRows(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    assertRateLimit({ key: rateLimitKey(req, "dashboard", ctx.userId), limit: 90, windowMs: 60_000 });

    const sellerId = ctx.role === "seller" ? await currentSellerId(ctx.companyId, ctx.userId) : null;
    const permissions = resolveDashboardPermissions(ctx.role, { userId: ctx.userId, sellerId, partnerId: ctx.partnerId });
    const sp = req.nextUrl.searchParams;
    const period = resolveDashboardPeriod(sp.get("period"), sp.get("from"), sp.get("to"), ctx.company);
    const rankBy = (["sales", "margin", "bookings", "pax"].includes(sp.get("rankBy") || "") ? sp.get("rankBy") : "sales") as DashboardRankCriterion;
    const baseCurrency = (ctx.company?.base_currency || "usd").toLowerCase();
    const scope = await buildScope(req, ctx.companyId, permissions.forcedSellerId, permissions.forcedPartnerId);

    const sb = await supabaseServer();
    const { data: summary, error: summaryError } = await sb.rpc("dashboard_summary", {
      p_org_id: ctx.companyId,
      p_from: period.from,
      p_to: period.to,
      p_previous_from: period.previousFrom,
      p_previous_to: period.previousTo,
      p_base_currency: baseCurrency,
      p_timezone: period.timezone,
      p_product_id: scope.product || null,
      p_branch_id: scope.branch || null,
      p_seller_id: scope.seller || null,
      p_partner_id: scope.partner || null,
      p_channel: scope.channel || null,
      p_rank_by: rankBy,
      p_cash_user_id: ctx.role === "cashier" ? ctx.userId : null,
    });
    if (summaryError) throw new Error(summaryError.message);

    const upcoming = asRows(summary?.upcoming_departures);

    const netSales = Number(summary?.net_sales ?? 0);
    const previousNetSales = Number(summary?.previous_net_sales ?? 0);
    const collected = Number(summary?.collected ?? 0);
    const previousCollected = Number(summary?.previous_collected ?? 0);
    const commissionCost = Number(summary?.commission_total ?? 0);
    const contributionMargin = round2(netSales - Number(summary?.cost ?? 0) - commissionCost);
    const incompleteFinancialData = Boolean(summary?.incomplete_financial_data);
    const alerts = [];
    if (incompleteFinancialData) alerts.push({ type: "warning", title: "Datos financieros incompletos", href: "/dashboard/finanzas/divisas" });
    if (permissions.canViewMargin && contributionMargin < 0) alerts.push({ type: "danger", title: "Margen negativo en el período", href: "/dashboard/rentabilidad" });
    if (permissions.canViewReceivables && Number(summary?.receivable_overdue_count ?? 0) > 0) alerts.push({ type: "warning", title: "Hay cuentas por cobrar vencidas", href: "/dashboard/deudas" });
    if (upcoming.some((departure: any) => departure.capacity > 0 && departure.occupancy < 35)) alerts.push({ type: "warning", title: "Salidas próximas con ocupación crítica", href: "/dashboard/salidas" });

    return ok({
      period,
      currency: baseCurrency,
      permissions,
      lastUpdatedAt: new Date().toISOString(),
      rankBy,
      horizonDays: UPCOMING_HORIZON_DAYS,
      incompleteFinancialData,
      truncated: false,
      alerts,
      kpis: {
        net_sales: permissions.canViewRevenue ? round2(netSales) : null,
        net_sales_trend: permissions.canViewRevenue ? trendPct(netSales, previousNetSales) : null,
        collected: permissions.canViewCollections ? round2(collected) : null,
        collected_trend: permissions.canViewCollections ? trendPct(collected, previousCollected) : null,
        contribution_margin: permissions.canViewMargin ? contributionMargin : null,
        margin_pct: permissions.canViewMargin && netSales > 0 ? round2((contributionMargin / netSales) * 100) : null,
        margin_trend: null,
        bookings: Number(summary?.bookings ?? 0),
        pax: Number(summary?.pax ?? 0),
        avg_ticket: permissions.canViewRevenue && Number(summary?.bookings ?? 0) > 0 ? round2(netSales / Number(summary?.bookings)) : null,
        cancellations: Number(summary?.cancellations ?? 0),
        refunds: Number(summary?.refunds ?? 0),
        partial_refunds: Number(summary?.partial_refunds ?? 0),
        no_shows: Number(summary?.no_shows ?? 0),
        cancellation_rate: Number(summary?.denominator ?? 0) > 0 ? round2((Number(summary?.cancellations ?? 0) / Number(summary?.denominator)) * 100) : 0,
        commissions_pending: permissions.canViewCommissions ? round2(commissionCost) : null,
        commissions_count: permissions.canViewCommissions ? Number(summary?.commission_count ?? 0) : null,
        commissions_excluded_count: permissions.canViewCommissions ? Number(summary?.commission_excluded_count ?? 0) : null,
        receivables_balance: permissions.canViewReceivables ? round2(Number(summary?.receivable_total ?? 0)) : null,
        receivables_count: permissions.canViewReceivables ? Number(summary?.receivable_count ?? 0) : null,
        receivables_excluded_count: permissions.canViewReceivables ? Number(summary?.receivable_excluded_count ?? 0) : null,
        payables_balance: permissions.canViewPayables ? round2(Number(summary?.payable_total ?? 0)) : null,
        payables_count: permissions.canViewPayables ? Number(summary?.payable_count ?? 0) : null,
        payables_excluded_count: permissions.canViewPayables ? Number(summary?.payable_excluded_count ?? 0) : null,
        cash_on_hand: permissions.canViewCash ? round2(Number(summary?.cash_total ?? 0)) : null,
        open_cash_sessions: permissions.canViewCash ? Number(summary?.cash_count ?? 0) : null,
      },
      cash_by_currency: permissions.canViewCash ? asRows(summary?.cash_by_currency) : [],
      series: permissions.canViewRevenue ? asRows(summary?.series) : [],
      by_channel: permissions.canViewRevenue ? asRows(summary?.by_channel) : [],
      top_products: permissions.canViewGlobalRankings || permissions.forcedSellerId ? asRows(summary?.top_products) : [],
      top_sellers: permissions.canViewGlobalRankings ? asRows(summary?.top_sellers) : [],
      top_partners: permissions.canViewGlobalRankings ? asRows(summary?.top_partners) : [],
      upcoming_departures: upcoming,
    });
  } catch (err) {
    return fail(err);
  }
}
