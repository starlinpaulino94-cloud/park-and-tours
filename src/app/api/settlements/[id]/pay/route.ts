import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantFindOne, tenantQuery, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { writeAudit } from "@/lib/audit";
import { postSettlementPayment } from "@/lib/ledger-events";
import type { Settlement } from "@/lib/types";

/**
 * POST /api/settlements/:id/pay — records the pay-out of a settlement (AUD-F12).
 *
 * The old flow was a raw `PUT /api/erp/settlement/:id {status:"paid"}` which
 * flipped the status but left the matching payable OPEN, posted nothing to the
 * ledger and never closed the commissions — so the debt showed as unpaid after
 * "paying" it, and could be paid a second time. This endpoint does the whole
 * settlement atomically-as-possible: settlement → payable → commissions → ledger.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");

    const body = await readJson<{ method?: string; notes?: string }>(req);
    const settlement = await tenantFindOne<Settlement>(ctx.companyId, "settlement", id);

    if (settlement.status === "paid") {
      throw Object.assign(new Error("La liquidación ya fue pagada"), { status: 409 });
    }
    if (settlement.status === "void") {
      throw Object.assign(new Error("La liquidación está anulada"), { status: 409 });
    }

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const total = round2(settlement.commission_total ?? 0);
    const method = body.method || "transfer";

    // 1) Mark the settlement paid.
    await tenantUpdate(ctx.companyId, "settlement", id, {
      status: "paid",
      paid_total: total,
      pending_total: 0,
      paid_at: new Date().toISOString(),
      notes: body.notes || settlement.notes,
    });

    // 2) Settle the associated payable(s).
    const payables = await tenantQuery<{ _id: string; amount?: number }>(ctx.companyId, "payable", {
      _filter: { settlement: id, status: { nin: ["paid", "written_off"] } }, _limit: 10,
    });
    for (const p of payables) {
      await tenantUpdate(ctx.companyId, "payable", p._id, {
        paid_amount: round2(p.amount ?? total),
        balance: 0,
        status: "paid",
        paid_at: new Date().toISOString(),
      });
    }

    // 3) Close the commissions linked to this settlement (settled → paid).
    // Best-effort: depends on the `settlement` link field existing.
    const commissions = await tenantQuery<{ _id: string }>(ctx.companyId, "commission", {
      _filter: { settlement: id, status: "settled" }, _limit: 1000,
    });
    for (const c of commissions) {
      await tenantUpdate(ctx.companyId, "commission", c._id, { status: "paid" });
    }

    // 4) Double-entry ledger (AUD-F15): Dr commission expense, Cr cash/bank.
    await postSettlementPayment(ctx.companyId, {
      settlementId: id,
      amount: total,
      method,
      currency: settlement.currency,
      userId: ctx.userId,
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "settlement_paid", entityType: "settlement", entityId: id,
      description: `Liquidación ${settlement.code} pagada por ${total} ${settlement.currency ?? ""} (${method})`,
      severity: "info",
      metadata: { total, method, payables: payables.length, commissions: commissions.length },
    });

    console.log(`[settlements] ${settlement.code} pagada · ${total} ${settlement.currency} · ${method}`);
    return ok({ paid: true, total, payables: payables.length, commissions: commissions.length });
  } catch (err) {
    return fail(err);
  }
}
