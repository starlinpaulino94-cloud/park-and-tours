import { requireSuperadmin } from "@/lib/tenant";
import { ok, fail } from "@/lib/api-response";
import { supabaseService } from "@/lib/supabase/service";
import { isTerminalBookingStatus } from "@/lib/types";
import { recorteDe, TOPE_INFORME } from "@/lib/barrido";

function mapCompany(row: any) {
  return { ...row, _id: row.id, plan: row.plan_id, base_currency: row.currency, storage_used_mb: row.metadata?.storage_used_mb || 0 };
}

export async function GET() {
  try {
    const ctx = await requireSuperadmin();
    const sb = supabaseService();
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const [{ data: companies, error: cErr }, { data: plans, error: pErr }, { data: bookings, error: bErr }, { data: invoices, error: iErr }, { data: alerts, error: aErr }, { data: memberships, error: mErr }] = await Promise.all([
      sb.from("organizations").select("*").eq("kind", "tenant").limit(TOPE_INFORME),
      sb.from("plan").select("*").order("sort_order", { ascending: true }).limit(100),
      sb.from("booking").select("organization_id,total_amount,pax_total,status,booking_date").gte("booking_date", monthStart).order("booking_date", { ascending: false }).limit(TOPE_INFORME),
      sb.from("subscription_invoice").select("*").order("issued_at", { ascending: false }).limit(300),
      sb.from("audit_log").select("*").in("severity", ["warning", "critical"]).order("occurred_at", { ascending: false }).limit(40),
      sb.from("organization_memberships").select("organization_id,role,status").limit(TOPE_INFORME),
    ]);
    for (const error of [cErr, pErr, bErr, iErr, aErr, mErr]) if (error) throw error;

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const byCompany = new Map<string, { bookings: number; revenue: number; pax: number }>();
    let gmv = 0, pax = 0;
    for (const b of bookings || []) {
      if (isTerminalBookingStatus(b.status) || b.status === "draft") continue;
      const agg = byCompany.get(b.organization_id) || { bookings: 0, revenue: 0, pax: 0 };
      agg.bookings += 1;
      agg.revenue += b.total_amount ?? 0;
      agg.pax += b.pax_total ?? 0;
      byCompany.set(b.organization_id, agg);
      gmv += b.total_amount ?? 0;
      pax += b.pax_total ?? 0;
    }
    const usersByCompany = new Map<string, number>();
    for (const m of memberships || []) usersByCompany.set(m.organization_id, (usersByCompany.get(m.organization_id) || 0) + 1);

    const mappedCompanies = (companies || []).map(mapCompany);
    const planUsage = (plans || []).map((p) => ({ _id: p.id, name: p.name, code: p.code, monthly_price: p.monthly_price ?? 0, companies: mappedCompanies.filter((c) => c.plan_id === p.id).length }));
    const mrr = mappedCompanies.reduce((sum, c) => {
      if (c.subscription_status !== "active") return sum;
      const plan = (plans || []).find((p) => p.id === c.plan_id);
      return sum + (plan?.monthly_price ?? 0);
    }, 0);
    const paidInvoices = (invoices || []).filter((i) => i.status === "paid");
    const pendingInvoices = (invoices || []).filter((i) => i.status === "pending");
    const top = mappedCompanies.map((c) => ({
      _id: c._id, name: c.name, company_type: c.company_type,
      subscription_status: c.subscription_status, status: c.status,
      plan: (plans || []).find((p) => p.id === c.plan_id)?.name,
      storage_used_mb: c.storage_used_mb,
      users: usersByCompany.get(c._id) || 0,
      ...(byCompany.get(c._id) || { bookings: 0, revenue: 0, pax: 0 }),
    })).sort((a, b) => b.revenue - a.revenue);

    /**
     * EL NÚMERO CON EL QUE SE DIRIGE EL NEGOCIO, Y SI ESTÁ CORTADO.
     *
     * `gmv_month` y `bookings_month` salían de una lectura con tope: pasada esa
     * cifra, la facturación de la plataforma se presentaba MÁS BAJA de lo que es
     * y nada lo decía. Es el peor sitio para un dato silenciosamente corto,
     * porque es justo el que nadie contrasta contra otra cosa.
     *
     * Aquí no se lanza —dejar la consola de la plataforma sin cargar por tener
     * mucho negocio sería absurdo— pero el recorte viaja en la respuesta.
     */
    // El censo de inquilinos entra en la cuenta: `companies_total` sale de esta
    // lista, así que pasado el tope la plataforma se declara más pequeña de lo
    // que es.
    const recorte = recorteDe(Math.max(
      (bookings || []).length,
      (companies || []).length,
      (memberships || []).length,
    ));

    return ok({
      recorte,
      stats: {
        companies_total: mappedCompanies.length,
        companies_active: mappedCompanies.filter((c) => c.status === "active").length,
        companies_trial: mappedCompanies.filter((c) => c.subscription_status === "trial").length,
        companies_past_due: mappedCompanies.filter((c) => c.subscription_status === "past_due").length,
        companies_suspended: mappedCompanies.filter((c) => c.status === "suspended").length,
        users_total: (memberships || []).length,
        bookings_month: (bookings || []).length,
        pax_month: pax,
        gmv_month: round2(gmv),
        mrr: round2(mrr),
        arr: round2(mrr * 12),
        invoiced_paid: round2(paidInvoices.reduce((s, i) => s + (i.amount ?? 0), 0)),
        invoiced_pending: round2(pendingInvoices.reduce((s, i) => s + (i.amount ?? 0), 0)),
        storage_mb: round2(mappedCompanies.reduce((s, c) => s + (c.storage_used_mb ?? 0), 0)),
      },
      companies: top,
      plans: planUsage,
      invoices: (invoices || []).slice(0, 20),
      alerts: alerts || [],
    });
  } catch (err) {
    return fail(err);
  }
}
