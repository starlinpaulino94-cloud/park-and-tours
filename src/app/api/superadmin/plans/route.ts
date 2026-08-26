import { NextRequest } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { supabaseService } from "@/lib/supabase/service";
import { assertSameOriginMutation } from "@/lib/csrf";

const EDITABLE = [
  "name", "code", "description", "monthly_price", "yearly_price", "currency",
  "max_users", "max_bookings_month", "max_storage_mb", "max_products", "trial_days",
  "modules_enabled", "is_premium", "status", "sort_order",
];
const NUMERIC = ["monthly_price", "yearly_price", "max_users", "max_bookings_month", "max_storage_mb", "max_products", "trial_days", "sort_order"];

function sanitize(body: Record<string, any>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (!(key in body)) continue;
    let value = body[key];
    if (value === "" || value === undefined) value = null;
    if (value !== null && NUMERIC.includes(key)) {
      const n = Number(value);
      value = Number.isFinite(n) ? n : null;
    }
    patch[key] = value;
  }
  return patch;
}

function mapRow(row: any) {
  return { ...row, _id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function GET() {
  try {
    const ctx = await requireSuperadmin();
    const sb = supabaseService();
    const [{ data: plans, error: plansError }, { data: companies, error: companiesError }, { data: invoices, error: invoicesError }] = await Promise.all([
      sb.from("plan").select("*").order("sort_order", { ascending: true }).limit(100),
      sb.from("organizations").select("id, plan_id, subscription_status, status, name").eq("kind", "tenant").limit(1000),
      sb.from("subscription_invoice").select("*").order("issued_at", { ascending: false }).limit(500),
    ]);
    if (plansError) throw plansError;
    if (companiesError) throw companiesError;
    if (invoicesError) throw invoicesError;
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const rows = (plans || []).map((plan) => {
      const subscribers = (companies || []).filter((c) => c.plan_id === plan.id);
      const active = subscribers.filter((c) => c.subscription_status === "active");
      const planInvoices = (invoices || []).filter((i) => i.plan_id === plan.id);
      return {
        ...mapRow(plan),
        usage: {
          companies: subscribers.length,
          active: active.length,
          trial: subscribers.filter((c) => c.subscription_status === "trial").length,
          past_due: subscribers.filter((c) => c.subscription_status === "past_due").length,
          mrr: round2(active.length * (plan.monthly_price ?? 0)),
          invoiced: round2(planInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + (i.amount ?? 0), 0)),
        },
      };
    });
    return ok({ plans: rows, invoices: (invoices || []).slice(0, 60).map(mapRow), unassigned_companies: (companies || []).filter((c) => !c.plan_id).length });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireSuperadmin();
    const body = await readJson<Record<string, any>>(req);
    const patch = sanitize(body);
    const sb = supabaseService();
    if (body.plan_id) {
      if (Object.keys(patch).length === 0) throw Object.assign(new Error("No se enviaron datos válidos"), { status: 400 });
      const { data, error } = await sb.from("plan").update(patch).eq("id", body.plan_id).select("*").single();
      if (error) throw error;
      await writeAudit({ userId: ctx.userId, action: "plan_updated", entityType: "plan", entityId: body.plan_id, severity: "warning", description: `Superadmin ${ctx.email} actualizó el plan`, metadata: patch });
      return ok(mapRow(data));
    }
    if (!patch.name) throw Object.assign(new Error("El nombre del plan es obligatorio"), { status: 400 });
    const { data, error } = await sb.from("plan").insert({ status: "active", currency: "usd", trial_days: 14, ...patch }).select("*").single();
    if (error) throw error;
    await writeAudit({ userId: ctx.userId, action: "plan_created", entityType: "plan", entityId: data.id, severity: "warning", description: `Superadmin ${ctx.email} creó el plan ${patch.name}` });
    return ok(mapRow(data));
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireSuperadmin();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) throw Object.assign(new Error("Falta el identificador del plan"), { status: 400 });
    const sb = supabaseService();
    const { data: inUse, error: inUseError } = await sb.from("organizations").select("id").eq("plan_id", id).limit(1);
    if (inUseError) throw inUseError;
    if ((inUse || []).length > 0) throw Object.assign(new Error("No puedes eliminar un plan con empresas contratadas."), { status: 409 });
    const { error } = await sb.from("plan").delete().eq("id", id);
    if (error) throw error;
    await writeAudit({ userId: ctx.userId, action: "plan_deleted", entityType: "plan", entityId: id, severity: "critical", description: `Superadmin ${ctx.email} eliminó un plan` });
    return ok({ deleted: true, _id: id });
  } catch (err) {
    return fail(err);
  }
}
