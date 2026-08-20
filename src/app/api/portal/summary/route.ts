import { NextRequest } from "next/server";
import { requireTenant, tenantQuery, requireAtLeast, TenantError } from "@/lib/tenant";
import { ok, fail, resolvePeriod } from "@/lib/api-response";
import type { Booking, Commission, Partner, Receivable, Settlement } from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * GET /api/portal/summary — panel del portal B2B.
 * Solo expone la información del propio partner: nunca datos financieros
 * internos del parque que no le correspondan.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const sp = req.nextUrl.searchParams;

    // AUD-006: a partner only ever sees their own view. A staff user may inspect
    // another partner's portal, but only from manager up — previously any seller
    // could pass an arbitrary `partner_id` and read that partner's financials.
    let partnerId: string | null;
    if (ctx.role === "partner") {
      partnerId = ctx.partnerId;
    } else {
      const requested = sp.get("partner_id");
      if (requested && requested !== ctx.partnerId) requireAtLeast(ctx, "manager");
      partnerId = requested || ctx.partnerId;
    }
    if (!partnerId) throw new TenantError("Tu usuario no está asociado a ningún partner", 403);

    const { from, to, label } = resolvePeriod(sp.get("period") || "month", sp.get("from"), sp.get("to"));

    const [partnerRows, bookings, commissions, settlements, receivables] = await Promise.all([
      tenantQuery<Partner>(ctx.companyId, "partner", { _filter: { _id: partnerId }, _limit: 1 }),
      tenantQuery<Booking>(ctx.companyId, "booking", {
        _filter: { partner: partnerId, booking_date: { gte: from, lte: to } },
        _limit: 500, _sort: { booking_date: "desc" },
        product: true, customer: true, departure: true,
      }),
      tenantQuery<Commission>(ctx.companyId, "commission", {
        _filter: { partner: partnerId, beneficiary_type: "partner", status: { ne: "cancelled" } },
        _limit: 500, _sort: { generated_at: "desc" },
      }),
      tenantQuery<Settlement>(ctx.companyId, "settlement", {
        _filter: { partner: partnerId }, _limit: 30, _sort: { issued_at: "desc" },
      }),
      tenantQuery<Receivable>(ctx.companyId, "receivable", {
        _filter: { partner: partnerId, status: { nin: ["paid", "written_off"] } },
        _limit: 200, _sort: { due_date: "asc" },
      }),
    ]);

    const partner = partnerRows[0];
    if (!partner) throw new TenantError("Partner no encontrado", 404);

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const live = bookings.filter((b) => !["cancelled", "refunded", "draft"].includes(b.status || ""));

    const sales = live.reduce((s, b) => s + (b.total_amount ?? 0), 0);
    const pax = live.reduce((s, b) => s + (b.pax_total ?? 0), 0);
    const commissionEarned = commissions.reduce((s, c) => s + (c.amount ?? 0), 0);
    const commissionPending = commissions
      .filter((c) => ["pending", "approved"].includes(c.status || ""))
      .reduce((s, c) => s + (c.amount ?? 0), 0);
    const balance = receivables.reduce((s, r) => s + (r.balance ?? 0), 0);

    const byProduct = new Map<string, { label: string; bookings: number; pax: number; sales: number }>();
    for (const b of live) {
      const p: any = b.product;
      const key = refId(b.product) || "none";
      const agg = byProduct.get(key) || { label: (p && typeof p === "object" ? p.name : "Producto") || "Producto", bookings: 0, pax: 0, sales: 0 };
      agg.bookings += 1;
      agg.pax += b.pax_total ?? 0;
      agg.sales += b.total_amount ?? 0;
      byProduct.set(key, agg);
    }

    console.log(`[portal] ${partner.commercial_name || partner.name}: ${live.length} reservas · ${round2(sales)}`);
    return ok({
      period: { from, to, label },
      partner: {
        _id: partner._id,
        name: partner.name,
        commercial_name: partner.commercial_name,
        partner_type: partner.partner_type,
        currency: partner.currency || ctx.company?.base_currency || "usd",
        credit_limit: partner.credit_limit ?? 0,
        credit_days: partner.credit_days ?? 0,
        default_commission_pct: partner.default_commission_pct ?? 0,
        status: partner.status,
      },
      kpis: {
        bookings: live.length,
        cancellations: bookings.length - live.length,
        pax,
        sales: round2(sales),
        commission_earned: round2(commissionEarned),
        commission_pending: round2(commissionPending),
        balance: round2(balance),
        credit_available: round2(Math.max((partner.credit_limit ?? 0) - balance, 0)),
        average_ticket: live.length ? round2(sales / live.length) : 0,
      },
      top_products: [...byProduct.values()].sort((a, b) => b.sales - a.sales).slice(0, 8)
        .map((p) => ({ ...p, sales: round2(p.sales) })),
      recent_bookings: bookings.slice(0, 25),
      settlements,
      receivables,
    });
  } catch (err) {
    return fail(err);
  }
}
