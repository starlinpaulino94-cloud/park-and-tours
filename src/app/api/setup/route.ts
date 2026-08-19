import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { totalumSdk } from "@/lib/totalum";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { seedDemoData } from "@/lib/demo-seed";
import type { Company, CompanyType, Currency, Plan } from "@/lib/types";

/**
 * Tenant onboarding — creates the company for the signed-in user and seeds the
 * minimum configuration the ERP needs to be usable from minute one.
 */

const DEFAULT_MODULES = [
  "bookings", "crm", "commissions", "settlements", "payments", "cash_pos",
  "transport", "pickups", "operations", "b2b_portal", "accounting", "reports", "audit",
];

/** Modules highlighted per company type (all remain available; this drives the UI order). */
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

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return fail(Object.assign(new Error("No autenticado"), { status: 401 }));
    }
    const userId = session.user.id;

    const existing = await totalumSdk.crud.query("user", { _filter: { _id: userId }, _limit: 1 });
    const userRecord = existing.data?.[0];
    if (userRecord?.company_id) {
      return fail(Object.assign(new Error("El usuario ya pertenece a una empresa"), { status: 409 }));
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

    // Attach the free trial plan when one exists.
    const planRes = await totalumSdk.crud.query("plan", {
      _filter: { status: "active" }, _sort: { sort_order: "asc" }, _limit: 1,
    });
    const plan = (planRes.data?.[0] || null) as Plan | null;

    const trialEnds = new Date();
    trialEnds.setDate(trialEnds.getDate() + (plan?.trial_days ?? 14));

    const companyRes = await totalumSdk.crud.createRecord("company", {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      legal_name: name,
      tax_id: body.tax_id,
      company_type: companyType,
      group_name: body.group_name,
      email: session.user.email,
      phone: body.phone,
      city: body.city,
      country: body.country || "República Dominicana",
      timezone: "America/Santo_Domingo",
      base_currency: currency,
      brand_color: "#0E7C86",
      plan: plan?._id,
      subscription_status: "trial",
      trial_ends_at: trialEnds.toISOString(),
      next_billing_at: trialEnds.toISOString(),
      modules_enabled: DEFAULT_MODULES,
      storage_used_mb: 0,
      status: "active",
    });
    if (companyRes.errors) {
      console.error("[setup] company creation failed:", companyRes.errors);
      throw new Error(companyRes.errors.errorMessage || "No se pudo crear la empresa");
    }
    const company = companyRes.data as Company;
    const companyId = company._id;

    // Link the user as owner of the new tenant.
    const linked = await totalumSdk.crud.editRecordById("user", userId, {
      company_id: companyId,
      role: "owner",
      status: "active",
    });
    if (linked.errors) {
      console.error("[setup] failed linking user to company:", linked.errors);
      throw new Error(linked.errors.errorMessage || "No se pudo asociar el usuario a la empresa");
    }

    await seedDefaults(companyId, name, currency, companyType);

    // A brand-new tenant would otherwise show empty screens everywhere, so the
    // demo dataset is loaded unless the user explicitly opts out.
    let demo: Record<string, number> | null = null;
    if (body.seed_demo !== false) {
      const seeded = await seedDemoData({
        userId, email: session.user.email, name: session.user.name || name,
        role: "owner", companyId, partnerId: null,
        company: { ...company, base_currency: currency } as Company,
      });
      demo = seeded.created;
    }

    await writeAudit({
      companyId, userId,
      action: "company_created",
      entityType: "company", entityId: companyId,
      description: `Empresa "${name}" creada (${companyType})`,
    });

    console.log(`[setup] empresa creada: ${name} (${companyId}) para ${session.user.email}`);
    return ok({ company, focus: TYPE_FOCUS[companyType], demo });
  } catch (err) {
    return fail(err);
  }
}

async function seedDefaults(companyId: string, name: string, currency: Currency, type: CompanyType) {
  const create = (table: string, data: Record<string, unknown>) =>
    totalumSdk.crud.createRecord(table, { ...data, company: companyId });

  const branchType = type === "park" ? "park" : type === "tour_center" ? "tour_center" : "office";
  const branch = await create("branch", {
    name: `${name} — Sede principal`, code: "MAIN", branch_type: branchType, status: "active",
  });
  const branchId = (branch.data as { _id: string })?._id;

  await create("cash_register", {
    branch: branchId, name: "Caja principal", code: "CJA-01", terminal: "POS-01",
    currency, status: "active",
  });

  const categories = [
    { name: "Excursiones", color: "#0E7C86", icon: "umbrella-beach", sort_order: 1 },
    { name: "Entradas y parques", color: "#F4A259", icon: "ticket", sort_order: 2 },
    { name: "Aventura", color: "#E76F51", icon: "mountain", sort_order: 3 },
    { name: "Transporte", color: "#6366F1", icon: "bus", sort_order: 4 },
  ];
  for (const c of categories) await create("product_category", { ...c, status: "active" });

  const expenseCategories = [
    "Combustible", "Mantenimiento", "Nómina", "Publicidad", "Transporte",
    "Alimentación", "Alquiler", "Suministros", "Servicios", "Otros",
  ];
  for (const c of expenseCategories) await create("expense_category", { name: c, status: "active" });

  await create("cancellation_policy", {
    name: "Política estándar",
    description: "Reembolso completo con más de 48 horas de antelación.",
    tiers: JSON.stringify([
      { hours_before: 48, refund_pct: 100, label: "Más de 48 horas" },
      { hours_before: 24, refund_pct: 50, label: "Entre 24 y 48 horas" },
      { hours_before: 0, refund_pct: 0, label: "Menos de 24 horas" },
    ]),
    no_show_refund_pct: 0,
    status: "active",
  });

  await create("commission_rule", {
    name: "Comisión general de empresa",
    priority: 8, beneficiary_type: "seller", calc_type: "percentage",
    value: 5, currency, status: "active",
    description: "Regla por defecto aplicada cuando no existe una más específica.",
  });
  await create("commission_rule", {
    name: "Comisión estándar de partners",
    priority: 4, beneficiary_type: "partner", calc_type: "percentage",
    value: 15, currency, status: "active",
    description: "Comisión base para tour centers y agencias.",
  });
  await create("commission_rule", {
    name: "Comisión de supervisor",
    priority: 6, beneficiary_type: "supervisor", calc_type: "percentage",
    value: 2, currency, status: "active",
  });

  await create("currency_rate", {
    currency_from: "usd", currency_to: "dop", rate: 60.5,
    rate_date: new Date().toISOString(), source: "Configuración inicial",
  });

  console.log(`[setup] configuración inicial creada para ${companyId}`);
}
