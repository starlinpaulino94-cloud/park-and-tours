import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantCreate, tenantFindOne, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { recalcCashSession } from "@/lib/cash";
import { writeAudit } from "@/lib/audit";
import type { CashSession } from "@/lib/types";
import { assertSameOriginMutation } from "@/lib/csrf";

/** POST /api/cash/sessions/:id/close — arqueo: counts cash and closes the session. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenant();
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{ counted_cash?: number; notes?: string }>(req);
    const session = await tenantFindOne<CashSession>(ctx.companyId, "cash_session", id);
    if (session.status !== "open") {
      throw Object.assign(new Error("La sesión de caja ya está cerrada"), { status: 409 });
    }

    await recalcCashSession(ctx.companyId, id);
    const refreshed = await tenantFindOne<CashSession>(ctx.companyId, "cash_session", id);

    const counted = Number(body.counted_cash ?? 0);
    const expected = refreshed.expected_cash ?? 0;
    const difference = Math.round((counted - expected + Number.EPSILON) * 100) / 100;

    await tenantUpdate(ctx.companyId, "cash_session", id, {
      closed_at: new Date().toISOString(),
      counted_cash: counted,
      difference,
      status: "closed",
      notes: body.notes || refreshed.notes,
    });

    await tenantCreate(ctx.companyId, "cash_movement", {
      cash_session: id, user: ctx.userId,
      movement_type: "closing", amount: counted,
      currency: refreshed.currency, concept: "Cierre de caja / arqueo",
      movement_at: new Date().toISOString(),
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "cash_session_closed", entityType: "cash_session", entityId: id,
      description: `Caja cerrada. Esperado ${expected}, contado ${counted}, diferencia ${difference}`,
      severity: Math.abs(difference) > 0.009 ? "warning" : "info",
      metadata: { expected, counted, difference },
    });

    console.log(`[cash] sesión ${refreshed.code} cerrada · diferencia ${difference}`);
    return ok({ expected_cash: expected, counted_cash: counted, difference });
  } catch (err) {
    return fail(err);
  }
}
