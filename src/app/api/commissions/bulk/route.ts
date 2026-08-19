import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";
import { writeAudit } from "@/lib/audit";
import type { Commission, CommissionStatus } from "@/lib/types";

const ALLOWED: CommissionStatus[] = ["approved", "held", "disputed", "cancelled", "paid", "pending"];

/**
 * POST /api/commissions/bulk — aprueba, retiene o cancela varias comisiones a la vez.
 * Nunca recalcula el importe: el snapshot financiero es inmutable.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");

    const body = await readJson<{ ids?: string[]; status?: CommissionStatus; notes?: string }>(req);
    const ids = (body.ids || []).filter(Boolean);
    const status = body.status;

    if (ids.length === 0) throw Object.assign(new Error("Selecciona al menos una comisión"), { status: 400 });
    if (!status || !ALLOWED.includes(status)) {
      throw Object.assign(new Error("Estado de comisión no válido"), { status: 400 });
    }
    if (ids.length > 500) throw Object.assign(new Error("Máximo 500 comisiones por operación"), { status: 400 });

    let updated = 0;
    let amount = 0;
    for (const id of ids) {
      // tenantFindOne guarantees the commission belongs to this tenant.
      const commission = await tenantFindOne<Commission>(ctx.companyId, "commission", id);
      if (commission.status === "settled" && status !== "paid") {
        console.warn(`[commissions] omitida ${id}: ya está liquidada`);
        continue;
      }
      const patch: Record<string, unknown> = { status };
      if (status === "approved") patch.approved_at = new Date().toISOString();
      if (body.notes) patch.notes = body.notes;

      const res = await totalumSdk.crud.editRecordById("commission", id, patch);
      if (res.errors) {
        console.error("[commissions] error actualizando", id, res.errors);
        throw new Error(res.errors.errorMessage || "Error actualizando comisiones");
      }
      updated++;
      amount += commission.amount ?? 0;
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: `commissions_${status}`, entityType: "commission",
      description: `${updated} comisiones marcadas como ${status}`,
      metadata: { ids, status, amount },
    });

    console.log(`[commissions] ${updated}/${ids.length} → ${status}`);
    return ok({ updated, skipped: ids.length - updated, amount });
  } catch (err) {
    return fail(err);
  }
}
