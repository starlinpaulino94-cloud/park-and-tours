import { NextRequest } from "next/server";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { CompanyType, Currency, ModuleKey } from "@/lib/types";

const DEFAULT_MODULES: ModuleKey[] = [
  "bookings", "crm", "commissions", "settlements", "payments", "cash_pos",
  "transport", "pickups", "operations", "b2b_portal", "accounting", "reports", "audit",
];

const TYPE_FOCUS: Record<CompanyType, string[]> = {
  park: ["bookings", "cash_pos", "operations", "b2b_portal"],
  excursion_company: ["bookings", "operations", "pickups", "transport"],
  tour_operator: ["bookings", "commissions", "settlements", "b2b_portal"],
  tour_center: ["bookings", "commissions", "cash_pos"],
  agency: ["bookings", "crm", "commissions"],
  transport: ["transport", "pickups", "operations"],
  mixed_operator: ["bookings", "operations", "commissions", "cash_pos"],
  other: ["bookings", "payments"],
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function mapCompany(row: any) {
  return {
    ...row,
    _id: row.id,
    plan: row.plan_id,
    base_currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function POST(req: NextRequest) {
  try {
    const authClient = await supabaseServer();
    const { data: userRes } = await authClient.auth.getUser();
    const user = userRes.user;
    if (!user) return fail(Object.assign(new Error("No autenticado"), { status: 401 }));

    const sb = supabaseService();
    const { data: existingMembership } = await sb
      .from("organization_memberships")
      .select("organization_id, organizations(*)")
      .eq("user_id", user.id)
      .eq("is_primary", true)
      .maybeSingle();
    if (existingMembership?.organization_id) {
      const already = mapCompany((existingMembership as any).organizations || { id: existingMembership.organization_id });
      return ok({ company: already, focus: TYPE_FOCUS[(already.company_type as CompanyType) || "other"], demo: null, alreadySetUp: true });
    }

    const body = await readJson<{
      name?: string; company_type?: CompanyType; base_currency?: Currency;
      country?: string; city?: string; phone?: string; tax_id?: string; group_name?: string;
      seed_demo?: boolean;
    }>(req);

    const name = (body.name || "").trim();
    if (!name) return fail(Object.assign(new Error("El nombre de la empresa es obligatorio"), { status: 400 }));
    const companyType = (body.company_type || "excursion_company") as CompanyType;
    const currency = (body.base_currency || "usd") as Currency;

    const { data: plan } = await sb
      .from("plan")
      .select("*")
      .eq("status", "active")
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    const slug = slugify(name);
    const { data: company, error: companyError } = await sb.from("organizations").insert({
      kind: "tenant",
      name,
      slug,
      legal_name: name,
      tax_id: body.tax_id,
      company_type: companyType,
      email: user.email,
      phone: body.phone,
      country: body.country || "República Dominicana",
      timezone: "America/Santo_Domingo",
      currency,
      plan_id: plan?.id || null,
      subscription_status: "trial",
      modules_enabled: DEFAULT_MODULES,
      status: "active",
      metadata: { city: body.city, group_name: body.group_name, seed_demo_requested: body.seed_demo === true },
    }).select("*").single();
    if (companyError) throw companyError;

    await sb.from("organizations").update({ tenant_org_id: company.id }).eq("id", company.id);

    const { error: membershipError } = await sb.from("organization_memberships").insert({
      user_id: user.id,
      organization_id: company.id,
      role: "owner",
      status: "active",
      is_primary: true,
    });
    if (membershipError) throw membershipError;

    await writeAudit({
      companyId: company.id,
      userId: user.id,
      action: "company_onboarded",
      entityType: "company",
      entityId: company.id,
      description: `Empresa ${name} creada desde onboarding`,
      metadata: { companyType, currency, seedDemoSkipped: body.seed_demo === true },
    });

    return ok({ company: mapCompany(company), focus: TYPE_FOCUS[companyType], demo: null, demoSkipped: body.seed_demo === true });
  } catch (err) {
    return fail(err);
  }
}
