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

    const commissions = await tenantQuery<Commission>(ctx.companyId, "commission", {
      _filter: filter, _limit: 1000, booking: true,
    });

    if (commissions.length === 0) {
      throw Object.assign(new Error("No hay comisiones pendientes en el período seleccionado"), { status: 404 });
    }

    let base = 0, commissionTotal = 0, cancellations = 0;
    const currency = (commissions[0].currency || ctx.company?.base_currency || "usd") as Currency;
    for (const c of commissions) {
      base += c.base_amount ?? 0;
      commissionTotal += c.amount ?? 0;
      const booking: any = c.booking;
      if (booking && typeof booking === "object" && ["cancelled", "refunded"].includes(booking.status)) {
        cancellations += booking.total_amount ?? 0;
      }
    }

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

    const settlement = await tenantCreate<Settlement>(ctx.companyId, "settlement", {
      code: newSettlementCode(),
      beneficiary_type: beneficiaryType,
      partner: body.partner_id || undefined,
      seller: body.seller_id || undefined,
      period_from: from.toISOString(),
      period_to: to.toISOString(),
      sales_total: round2(base + cancellations),
      cancellations_total: round2(cancellations),
      base_total: round2(base),
      commission_total: round2(commissionTotal),
      paid_total: 0,
      pending_total: round2(commissionTotal),
      currency,
      status: "pending",
      issued_at: new Date().toISOString(),
      notes: body.notes,
    });

    for (const c of commissions) {
      const res = await totalumSdk.crud.editRecordById("commission", c._id, { status: "settled" });
      if (res.errors) {
        console.error("[settlements] failed marking commission as settled:", c._id, res.errors);
        throw new Error(res.errors.errorMessage || "Error actualizando las comisiones");
      }
    }

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
      description: `Liquidación ${settlement.code} por ${round2(commissionTotal)} ${currency} (${commissions.length} comisiones)`,
      metadata: { commissions: commissions.length, from: from.toISOString(), to: to.toISOString() },
    });

    console.log(`[settlements] ${settlement.code}: ${commissions.length} comisiones · ${commissionTotal} ${currency}`);
    return ok({ settlement, commissions: commissions.length });
  } catch (err) {
    return fail(err);
  }
}
