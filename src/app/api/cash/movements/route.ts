import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantCreate, tenantFindOne } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { recalcCashSession } from "@/lib/cash";
import type { CashSession } from "@/lib/types";

/** POST /api/cash/movements — manual cash in/out (withdrawals, deposits, petty expenses). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{
      cash_session_id?: string; movement_type?: string; amount?: number;
      concept?: string; reference?: string;
    }>(req);

    if (!body.cash_session_id) throw Object.assign(new Error("Indica la sesión de caja"), { status: 400 });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      throw Object.assign(new Error("El importe debe ser distinto de cero"), { status: 400 });
    }
    // AUD-U06/F27: only known manual movement types are accepted, so an
    // arbitrary string can't be mis-classified by the cash recalculation.
    const ALLOWED_MOVEMENTS = ["deposit", "withdrawal", "expense", "adjustment"];
    const movementType = body.movement_type || "adjustment";
    if (!ALLOWED_MOVEMENTS.includes(movementType)) {
      throw Object.assign(new Error("Tipo de movimiento no válido"), { status: 400 });
    }

    const session = await tenantFindOne<CashSession>(ctx.companyId, "cash_session", body.cash_session_id);
    if (session.status !== "open") {
      throw Object.assign(new Error("La sesión de caja está cerrada"), { status: 409 });
    }

    const movement = await tenantCreate(ctx.companyId, "cash_movement", {
      cash_session: body.cash_session_id,
      user: ctx.userId,
      movement_type: movementType,
      amount: Math.abs(amount),
      currency: session.currency,
      concept: body.concept || "Movimiento manual",
      reference: body.reference,
      movement_at: new Date().toISOString(),
    });

    await recalcCashSession(ctx.companyId, body.cash_session_id);
    console.log(`[cash] movimiento ${body.movement_type} de ${amount} en ${session.code}`);
    return ok(movement);
  } catch (err) {
    return fail(err);
  }
}
