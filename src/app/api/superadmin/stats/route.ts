import { requireSuperadmin } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";
import type { Booking, Company, Plan, SubscriptionInvoice } from "@/lib/types";
import { refId } from "@/lib/types";

/** GET /api/superadmin/stats — métricas globales de la plataforma. */
export async function GET() {
  try {
    const ctx = await requireSuperadmin();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [companiesRes, plansRes, bookingsRes, invoicesRes, auditRes, usersRes] = await Promise.all([
      totalumSdk.crud.query("company", { _limit: 500, _sort: { createdAt: "desc" }, plan: true }),
      totalumSdk.crud.query("plan", { _limit: 50, _sort: { sort_order: "asc" } }),
      totalumSdk.crud.query("booking", {
        _limit: 1000,
        _filter: { booking_date: { gte: monthStart } },
        _select: ["company", "total_amount", "pax_total", "status", "booking_date"],
        _include: false,
      } as any),
      totalumSdk.crud.query("subscription_invoice", { _limit: 300, _sort: { issued_at: "desc" }, company: true }),
      totalumSdk.crud.query("audit_log", {
        _limit: 40, _sort: { occurred_at: "desc" },
        _filter: { severity: { in: ["warning", "critical"] } },
        company: true, user: true,
      }),
      totalumSdk.crud.query("user", { _limit: 1000, _select: ["company_id", "role", "status"], _include: false } as any),
    ]);

    for (const [name, res] of Object.entries({ companiesRes, plansRes, bookingsRes, invoicesRes, auditRes, usersRes })) {
      if ((res as any).errors) {
        console.error(`[superadmin/stats] error en ${name}:`, (res as any).errors);
        throw new Error((res as any).errors.errorMessage || "Error cargando estadísticas");
      }
    }

    const companies = (companiesRes.data || []) as Company[];
    const plans = (plansRes.data || []) as Plan[];
    const bookings = (bookingsRes.data || []) as Booking[];
    const invoices = (invoicesRes.data || []) as SubscriptionInvoice[];
    const users = (usersRes.data || []) as any[];

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

    const byCompany = new Map<string, { bookings: number; revenue: number; pax: number }>();
    let gmv = 0, pax = 0;
    for (const b of bookings) {
      if (["cancelled", "refunded", "draft"].includes(b.status || "")) continue;
      const id = refId(b.company) || "none";
      const agg = byCompany.get(id) || { bookings: 0, revenue: 0, pax: 0 };
      agg.bookings += 1;
      agg.revenue += b.total_amount ?? 0;
      agg.pax += b.pax_total ?? 0;
      byCompany.set(id, agg);
      gmv += b.total_amount ?? 0;
      pax += b.pax_total ?? 0;
    }

    const usersByCompany = new Map<string, number>();
    for (const u of users) {
      const id = typeof u.company_id === "object" ? u.company_id?._id : u.company_id;
      if (id) usersByCompany.set(id, (usersByCompany.get(id) || 0) + 1);
    }

    const planUsage = plans.map((p) => ({
      _id: p._id, name: p.name, code: p.code,
      monthly_price: p.monthly_price ?? 0,
      companies: companies.filter((c) => refId(c.plan) === p._id).length,
    }));

    const mrr = companies.reduce((sum, c) => {
      if (c.subscription_status !== "active") return sum;
      const plan = typeof c.plan === "object" && c.plan ? c.plan : plans.find((p) => p._id === refId(c.plan));
      return sum + (plan?.monthly_price ?? 0);
    }, 0);

    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const pendingInvoices = invoices.filter((i) => i.status === "pending");

    const top = companies
      .map((c) => ({
        _id: c._id, name: c.name, company_type: c.company_type,
        subscription_status: c.subscription_status, status: c.status,
        plan: typeof c.plan === "object" ? c.plan?.name : undefined,
        trial_ends_at: c.trial_ends_at, next_billing_at: c.next_billing_at,
        storage_used_mb: c.storage_used_mb ?? 0,
        users: usersByCompany.get(c._id) || 0,
        ...(byCompany.get(c._id) || { bookings: 0, revenue: 0, pax: 0 }),
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const stats = {
      companies_total: companies.length,
      companies_active: companies.filter((c) => c.status === "active").length,
      companies_trial: companies.filter((c) => c.subscription_status === "trial").length,
      companies_past_due: companies.filter((c) => c.subscription_status === "past_due").length,
      companies_suspended: companies.filter((c) => c.status === "suspended").length,
      users_total: users.length,
      bookings_month: bookings.length,
      pax_month: pax,
      gmv_month: round2(gmv),
      mrr: round2(mrr),
      arr: round2(mrr * 12),
      invoiced_paid: round2(paidInvoices.reduce((s, i) => s + (i.amount ?? 0), 0)),
      invoiced_pending: round2(pendingInvoices.reduce((s, i) => s + (i.amount ?? 0), 0)),
      storage_mb: round2(companies.reduce((s, c) => s + (c.storage_used_mb ?? 0), 0)),
    };

    console.log(`[superadmin/stats] ${stats.companies_total} empresas · MRR ${stats.mrr} · consultado por ${ctx.email}`);
    return ok({
      stats,
      companies: top,
      plans: planUsage,
      invoices: invoices.slice(0, 20),
      alerts: (auditRes.data || []) as any[],
    });
  } catch (err) {
    return fail(err);
  }
}
