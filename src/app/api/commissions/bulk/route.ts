import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertModule } from "@/lib/plan-service";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import { usuarioDeVendedor } from "@/lib/seller-identity";
import { refId } from "@/lib/types";
import type { Commission, CommissionStatus } from "@/lib/types";
import { assertSameOriginMutation } from "@/lib/csrf";

const ALLOWED: CommissionStatus[] = ["approved", "held", "disputed", "cancelled", "paid", "pending"];

/**
 * POST /api/commissions/bulk — aprueba, retiene o cancela varias comisiones a la vez.
 * Nunca recalcula el importe: el snapshot financiero es inmutable.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    assertModule(ctx, "commissions");
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
    const porVendedor = new Map<string, number>();
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

      await tenantUpdate(ctx.companyId, "commission", id, patch);
      updated++;
      amount += commission.amount ?? 0;
      // Lo aprobado por vendedor, para avisarle DESPUÉS y una sola vez: un
      // aviso por comisión convertiría una aprobación de cien líneas en cien
      // notificaciones, y nadie lee la número doce.
      if (status === "approved") {
        const suyo = refId(commission.seller as never);
        if (suyo) porVendedor.set(suyo, (porVendedor.get(suyo) ?? 0) + (commission.amount ?? 0));
      }
    }

    /**
     * El aviso va a la PERSONA, no a la audiencia de rol.
     *
     * Mandado a la audiencia `seller` se lo manda a todos los vendedores de la
     * empresa: cada uno recibiría las aprobaciones de sus compañeros, ninguno
     * encontraría las suyas, y de paso todos sabrían cuánto cobran los demás.
     *
     * Y nunca bloquea: la comisión ya está aprobada y escrita. Que el correo
     * falle no puede deshacer una decisión de dinero.
     */
    for (const [sellerId, total] of porVendedor) {
      const userId = await usuarioDeVendedor(ctx.companyId, sellerId);
      if (!userId) continue;   // sin cuenta vinculada no hay a quién avisar
      await notify({
        companyId: ctx.companyId,
        userId,
        event: "commission_approved",
        entityType: "seller",
        entityId: sellerId,
        vars: { monto: total, moneda: ctx.company?.base_currency ?? "usd" },
      });
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
