import { NextRequest } from "next/server";
import { requireTenant, requireAtLeast, tenantQuery, tenantCreate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { totalumSdk } from "@/lib/totalum";
import { newSettlementCode, newDocumentNumber } from "@/lib/codes";
import { writeAudit } from "@/lib/audit";
import type { BeneficiaryType, Commission, Currency, Settlement } from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * POST /api/settlements/generate
 * Groups every pending commission of a beneficiary in a period into a single
 * settlement document and registers the matching payable.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireTenant();
    requireAtLeast(ctx, "manager");

    const body = await readJson<{
      beneficiary_type?: BeneficiaryType; partner_id?: string; seller_id?: string;
      period_from?: string; period_to?: string; notes?: string;
    }>(req);

    const beneficiaryType = body.beneficiary_type || "partner";
    if (!body.partner_id && !body.seller_id) {
      throw Object.assign(new Error("Selecciona el partner o vendedor a liquidar"), { status: 400 });
    }

    const from = body.period_from ? new Date(body.period_from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = body.period_to ? new Date(body.period_to) : new Date();

    const filter: Record<string, unknown> = {
      beneficiary_type: beneficiaryType,
      status: { in: ["pending", "approved"] },
      generated_at: { gte: from.toISOString(), lte: to.toISOString() },
    };
    if (body.partner_id) filter.partner = body.partner_id;
    if (body.seller_id) filter.seller = body.seller_id;

    const candidates = await tenantQuery<Commission>(ctx.companyId, "commission", {
      _filter: filter, _limit: 1000, booking: true,
    });

    if (candidates.length === 0) {
      throw Object.assign(new Error("No hay comisiones pendientes en el período seleccionado"), { status: 404 });
    }

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const currency = (candidates[0].currency || ctx.company?.base_currency || "usd") as Currency;

    // AUD-F11: create the settlement shell first so each commission links back
    // to it, then CLAIM commissions one by one and compute the totals from the
    // ones actually claimed. Previously the total was summed from all matched
    // commissions up-front and they were marked in a separate loop with no link,
    // so a mid-loop failure or a concurrent generation could double-include a
    // commission or leave a settlement whose total didn't match its lines.
    const settlement = await tenantCreate<Settlement>(ctx.companyId, "settlement", {
      code: newSettlementCode(),
      beneficiary_type: beneficiaryType,
      partner: body.partner_id || undefined,
      seller: body.seller_id || undefined,
      period_from: from.toISOString(),
      period_to: to.toISOString(),
      sales_total: 0, cancellations_total: 0, base_total: 0,
      commission_total: 0, paid_total: 0, pending_total: 0,
      currency,
      status: "pending",
      issued_at: new Date().toISOString(),
      notes: body.notes,
    });

    let base = 0, commissionTotal = 0, cancellations = 0, claimed = 0;
    for (const c of candidates) {
      // Re-read to avoid double-claiming under concurrency / partial retries.
      const fresh = (await tenantQuery<Commission>(ctx.companyId, "commission", {
        _filter: { _id: c._id }, _limit: 1, booking: true,
      }))[0];
      if (!fresh || !["pending", "approved"].includes(fresh.status || "")) continue;

      // Link the commission to this settlement. The `settlement` field may not
      // exist yet in an un-migrated database, so fall back to a status-only
      // write rather than aborting the whole batch.
      let res = await totalumSdk.crud.editRecordById("commission", c._id, {
        status: "settled", settlement: settlement._id,
      });
      if (res.errors) {
        res = await totalumSdk.crud.editRecordById("commission", c._id, { status: "settled" });
      }
      if (res.errors) {
        console.error("[settlements] no se pudo liquidar la comisión, se omite:", c._id, res.errors);
        continue;
      }

      claimed++;
      base += fresh.base_amount ?? 0;
      commissionTotal += fresh.amount ?? 0;
      const booking: any = fresh.booking;
      if (booking && typeof booking === "object" && ["cancelled", "refunded"].includes(booking.status)) {
        cancellations += booking.total_amount ?? 0;
      }
    }

    if (claimed === 0) {
      // Everything was claimed concurrently: void the empty shell.
      await totalumSdk.crud.editRecordById("settlement", settlement._id, { status: "void", notes: "Sin comisiones que liquidar" });
      throw Object.assign(new Error("Las comisiones ya fueron liquidadas"), { status: 409 });
    }

    // Update the settlement with the totals from the commissions actually claimed.
    await totalumSdk.crud.editRecordById("settlement", settlement._id, {
      sales_total: round2(base + cancellations),
      cancellations_total: round2(cancellations),
      base_total: round2(base),
      commission_total: round2(commissionTotal),
      pending_total: round2(commissionTotal),
    });

    await tenantCreate(ctx.companyId, "payable", {
      partner: body.partner_id || undefined,
      seller: body.seller_id || undefined,
      settlement: settlement._id,
      concept: `Liquidación ${settlement.code}`,
      category: "commission",
      amount: round2(commissionTotal),
      paid_amount: 0,
      balance: round2(commissionTotal),
      currency,
      issue_date: new Date().toISOString(),
      due_date: new Date(Date.now() + 15 * 86_400_000).toISOString(),
      status: "pending",
      reference: newDocumentNumber("CXP"),
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "settlement_generated", entityType: "settlement", entityId: settlement._id,
      description: `Liquidación ${settlement.code} por ${round2(commissionTotal)} ${currency} (${claimed} comisiones)`,
      metadata: { commissions: claimed, from: from.toISOString(), to: to.toISOString() },
    });

    console.log(`[settlements] ${settlement.code}: ${claimed} comisiones · ${commissionTotal} ${currency}`);
    return ok({ settlement: { ...settlement, commission_total: round2(commissionTotal) }, commissions: claimed });
  } catch (err) {
    return fail(err);
  }
}
