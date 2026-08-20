import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantQuery, tenantCreate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { newCashSessionCode } from "@/lib/codes";
import { writeAudit } from "@/lib/audit";
import type { CashSession, Currency } from "@/lib/types";

/** GET /api/cash/sessions — sessions, newest first (open ones surface at the top of the UI). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    const status = req.nextUrl.searchParams.get("status");
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const rows = await tenantQuery<CashSession>(ctx.companyId, "cash_session", {
      _filter: filter,
      _sort: { createdAt: "desc" },
      _limit: 100,
      cash_register: true, branch: true, user: true,
    });
    return ok(rows);
  } catch (err) {
    return fail(err);
  }
}

/** POST /api/cash/sessions — opens a cash session. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "cashier");

    const body = await readJson<{ cash_register_id?: string; opening_amount?: number; currency?: Currency; notes?: string }>(req);
    if (!body.cash_register_id) throw Object.assign(new Error("Selecciona la caja a abrir"), { status: 400 });

    const alreadyOpen = await tenantQuery<CashSession>(ctx.companyId, "cash_session", {
      _filter: { cash_register: body.cash_register_id, status: "open" }, _limit: 1,
    });
    if (alreadyOpen.length > 0) {
      throw Object.assign(new Error("Esta caja ya tiene una sesión abierta"), { status: 409 });
    }

    const register = (await tenantQuery<{ _id: string; branch?: any; currency?: Currency }>(
      ctx.companyId, "cash_register", { _filter: { _id: body.cash_register_id }, _limit: 1 }
    ))[0];
    if (!register) throw Object.assign(new Error("Caja no encontrada"), { status: 404 });

    const opening = Number(body.opening_amount ?? 0);
    // AUD-U06: opening float must be a valid, non-negative amount.
    if (!Number.isFinite(opening) || opening < 0) {
      throw Object.assign(new Error("El fondo de apertura no puede ser negativo"), { status: 400 });
    }
    const session = await tenantCreate<CashSession>(ctx.companyId, "cash_session", {
      cash_register: body.cash_register_id,
      branch: typeof register.branch === "object" ? register.branch?._id : register.branch,
      user: ctx.userId,
      code: newCashSessionCode(),
      opened_at: new Date().toISOString(),
      opening_amount: opening,
      expected_cash: opening,
      counted_cash: 0, difference: 0,
      card_total: 0, transfer_total: 0, sales_total: 0,
      expenses_total: 0, withdrawals_total: 0,
      currency: body.currency || register.currency || ctx.company?.base_currency || "usd",
      status: "open",
      notes: body.notes,
    });

    await tenantCreate(ctx.companyId, "cash_movement", {
      cash_session: session._id, user: ctx.userId,
      movement_type: "opening", amount: opening,
      currency: session.currency, concept: "Fondo de apertura",
      movement_at: new Date().toISOString(),
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "cash_session_opened", entityType: "cash_session", entityId: session._id,
      description: `Caja abierta con fondo ${opening}`,
    });

    console.log(`[cash] sesión ${session.code} abierta por ${ctx.email}`);
    return ok(session);
  } catch (err) {
    return fail(err);
  }
}
