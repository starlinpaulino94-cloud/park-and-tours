import { NextRequest } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";
import { writeAudit } from "@/lib/audit";
import type { Company, Plan, SubscriptionInvoice } from "@/lib/types";
import { refId } from "@/lib/types";

const EDITABLE = [
  "name", "code", "description", "monthly_price", "yearly_price", "currency",
  "max_users", "max_bookings_month", "max_storage_mb", "max_products", "trial_days",
  "modules_enabled", "is_premium", "status", "sort_order",
];

const NUMERIC = [
  "monthly_price", "yearly_price", "max_users", "max_bookings_month",
  "max_storage_mb", "max_products", "trial_days", "sort_order",
];

/** Keeps the payload to known plan fields and coerces the numbers the UI sends as strings. */
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

/** GET /api/superadmin/plans — catálogo de planes con su adopción y facturación. */
export async function GET() {
  try {
    const ctx = await requireSuperadmin();

    const [plansRes, companiesRes, invoicesRes] = await Promise.all([
      totalumSdk.crud.query("plan", { _limit: 100, _sort: { sort_order: "asc" } }),
      totalumSdk.crud.query("company", { _limit: 1000, _select: ["plan", "subscription_status", "status", "name"] } as any),
      totalumSdk.crud.query("subscription_invoice", { _limit: 500, _sort: { issued_at: "desc" }, company: true, plan: true }),
    ]);

    for (const [name, res] of Object.entries({ plansRes, companiesRes, invoicesRes })) {
      if ((res as any).errors) {
        console.error(`[superadmin/plans] error en ${name}:`, (res as any).errors);
        throw new Error((res as any).errors.errorMessage || "Error cargando los planes");
      }
    }

    const plans = (plansRes.data || []) as Plan[];
    const companies = (companiesRes.data || []) as Company[];
    const invoices = (invoicesRes.data || []) as SubscriptionInvoice[];
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

    const rows = plans.map((plan) => {
      const subscribers = companies.filter((c) => refId(c.plan) === plan._id);
      const active = subscribers.filter((c) => c.subscription_status === "active");
      const planInvoices = invoices.filter((i) => refId(i.plan) === plan._id);
      return {
        ...plan,
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

    const unassigned = companies.filter((c) => !refId(c.plan)).length;

    console.log(`[superadmin/plans] ${rows.length} planes consultados por ${ctx.email}`);
    return ok({ plans: rows, invoices: invoices.slice(0, 60), unassigned_companies: unassigned });
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/superadmin/plans — crea un plan, o lo actualiza si llega `plan_id`. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const body = await readJson<Record<string, any>>(req);
    const patch = sanitize(body);

    if (body.plan_id) {
      if (Object.keys(patch).length === 0) {
        throw Object.assign(new Error("No se enviaron datos válidos"), { status: 400 });
      }
      const res = await totalumSdk.crud.editRecordById("plan", body.plan_id, patch);
      if (res.errors) {
        console.error("[superadmin/plans] error actualizando el plan:", res.errors);
        throw new Error(res.errors.errorMessage || "Error actualizando el plan");
      }
      await writeAudit({
        userId: ctx.userId, action: "plan_updated", entityType: "plan", entityId: body.plan_id,
        severity: "warning", description: `Superadmin ${ctx.email} actualizó el plan`, metadata: patch,
      });
      console.log(`[superadmin/plans] plan ${body.plan_id} actualizado`);
      return ok({ _id: body.plan_id, ...patch });
    }

    if (!patch.name) throw Object.assign(new Error("El nombre del plan es obligatorio"), { status: 400 });
    const res = await totalumSdk.crud.createRecord("plan", {
      status: "active",
      currency: "usd",
      trial_days: 14,
      ...patch,
    });
    if (res.errors) {
      console.error("[superadmin/plans] error creando el plan:", res.errors);
      throw new Error(res.errors.errorMessage || "Error creando el plan");
    }
    const created = res.data as any;
    const planId = created?.insertedId || created?._id;

    await writeAudit({
      userId: ctx.userId, action: "plan_created", entityType: "plan", entityId: planId,
      severity: "warning", description: `Superadmin ${ctx.email} creó el plan ${patch.name}`,
    });
    console.log(`[superadmin/plans] plan creado ${planId}`);
    return ok({ _id: planId, ...patch });
  } catch (err) {
    return fail(err);
  }
}

/** DELETE /api/superadmin/plans?id=… — solo si ningún tenant lo tiene contratado. */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireSuperadmin();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) throw Object.assign(new Error("Falta el identificador del plan"), { status: 400 });

    const inUse = await totalumSdk.crud.query("company", { _filter: { plan: id }, _limit: 1 });
    if (inUse.errors) {
      console.error("[superadmin/plans] error comprobando el uso del plan:", inUse.errors);
      throw new Error(inUse.errors.errorMessage || "Error comprobando el plan");
    }
    if ((inUse.data || []).length > 0) {
      throw Object.assign(
        new Error("No puedes eliminar un plan con empresas contratadas. Desactívalo o migra esas empresas primero."),
        { status: 409 }
      );
    }

    const res = await totalumSdk.crud.deleteRecordById("plan", id);
    if (res.errors) {
      console.error("[superadmin/plans] error eliminando el plan:", res.errors);
      throw new Error(res.errors.errorMessage || "Error eliminando el plan");
    }
    await writeAudit({
      userId: ctx.userId, action: "plan_deleted", entityType: "plan", entityId: id,
      severity: "critical", description: `Superadmin ${ctx.email} eliminó un plan`,
    });
    console.log(`[superadmin/plans] plan ${id} eliminado`);
    return ok({ deleted: true, _id: id });
  } catch (err) {
    return fail(err);
  }
}
