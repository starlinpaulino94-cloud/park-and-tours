import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantQuery, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertModule } from "@/lib/plan-service";
import { loadSupplierStatement } from "@/lib/supplier-settlement-service";
import { retentionsFor, settlementTotals, reconcile } from "@/lib/supplier-settlement";
import { writeAudit } from "@/lib/audit";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import type { Settlement } from "@/lib/types";

/**
 * POST /api/settlements/:id/confirm — la factura del proveedor entra al sistema.
 *
 * Aquí se anota lo que el proveedor FACTURA, línea por línea si hace falta, y se
 * compara con lo que dice el manifiesto. La diferencia es la conversación de
 * cada viernes: "me cobras 40 pax y yo llevé 37".
 *
 * Lo que decide el flujo: si algo discrepa fuera de tolerancia, la liquidación
 * queda en `disputed` y no se puede pagar hasta resolverlo. Pagar una factura
 * que no cuadra con lo operado es regalar dinero con un comprobante de por
 * medio.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    assertModule(ctx, "settlements");
    assertRateLimit({ key: rateLimitKey(req, "settlements:confirm", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "manager");

    const body = await readJson<{
      invoice_number?: string;
      invoice_ncf?: string;
      invoice_date?: string;
      /** Importe facturado por línea; lo que no venga se da por bueno al devengo. */
      lines?: { id: string; confirmed_amount?: number; notes?: string }[];
      /** Importe total facturado, cuando el proveedor no desglosa. */
      confirmed_total?: number;
      adjustments_total?: number;
      tolerance?: number;
      accept_variance?: boolean;
      notes?: string;
    }>(req);

    const settlement = await tenantFindOne<Settlement>(ctx.companyId, "settlement", id);
    if (settlement.beneficiary_type !== "supplier") {
      throw Object.assign(
        new Error("Solo las liquidaciones de proveedor llevan factura"),
        { status: 409 }
      );
    }
    if (settlement.status === "paid" || settlement.status === "void") {
      throw Object.assign(
        new Error("La liquidación ya está cerrada"),
        { status: 409 }
      );
    }
    if (!body.invoice_number) {
      throw Object.assign(
        new Error("Indica el número de la factura del proveedor: sin comprobante el gasto no se sostiene"),
        { status: 400 }
      );
    }

    const rows = await tenantQuery<{ _id: string; amount?: number; status?: string }>(
      ctx.companyId, "booking_cost", { _filter: { settlement: id }, _limit: 1000 }
    );
    if (rows.length === 0) {
      throw Object.assign(new Error("Esta liquidación no tiene servicios"), { status: 409 });
    }

    const byId = new Map((body.lines ?? []).map((line) => [line.id, line]));
    const tolerance = Math.abs(Number(body.tolerance ?? 0)) || 0;

    // Cuando el proveedor no desglosa, su total se reparte a prorrata del
    // devengo: repartirlo por igual entre líneas de importes muy distintos
    // inventaría una discrepancia en cada una.
    const accrued = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const blanket = body.confirmed_total != null && (body.lines ?? []).length === 0
      ? Number(body.confirmed_total)
      : null;

    let confirmedTotal = 0;
    let disputed = 0;
    for (const row of rows) {
      if (["cancelled", "waived"].includes(row.status || "")) continue;
      const amount = Number(row.amount ?? 0);
      const submitted = byId.get(row._id);
      const confirmed = submitted?.confirmed_amount != null
        ? Number(submitted.confirmed_amount)
        : blanket != null
          ? Math.round(((accrued > 0 ? (amount / accrued) * blanket : 0) + Number.EPSILON) * 100) / 100
          : amount;

      const check = reconcile({ amount, confirmed_amount: confirmed }, tolerance);
      const status = check.verdict === "match" ? "confirmed" : "disputed";
      if (status === "disputed") disputed++;

      await tenantUpdate(ctx.companyId, "booking_cost", row._id, {
        confirmed_amount: confirmed,
        status,
        notes: submitted?.notes ?? undefined,
      });
      confirmedTotal += confirmed;
    }

    // El neto se recalcula sobre lo FACTURADO: en cuanto el proveedor factura,
    // el documento es el suyo y las retenciones salen de él.
    const statement = await loadSupplierStatement(ctx.companyId, id);
    const retentions = retentionsFor(statement.supplier, confirmedTotal);
    const totals = settlementTotals({
      services: statement.totals.services,
      confirmed: confirmedTotal,
      adjustments: body.adjustments_total ?? settlement.adjustments_total ?? 0,
      retentions,
    });

    // Una discrepancia bloquea el pago, salvo que gestión la acepte por escrito.
    const nextStatus = disputed > 0 && body.accept_variance !== true ? "disputed" : "approved";

    await tenantUpdate(ctx.companyId, "settlement", id, {
      supplier_invoice_number: body.invoice_number,
      supplier_invoice_ncf: body.invoice_ncf || undefined,
      supplier_invoice_date: body.invoice_date || new Date().toISOString().slice(0, 10),
      confirmed_total: totals.confirmed,
      adjustments_total: totals.adjustments,
      base_total: retentions.base,
      retention_isr: retentions.isr,
      retention_itbis: retentions.itbis,
      retention_total: retentions.total,
      net_total: totals.net,
      pending_total: Math.max(0, Math.round((totals.net - (settlement.paid_total ?? 0) + Number.EPSILON) * 100) / 100),
      status: nextStatus,
      confirmed_at: new Date().toISOString(),
      confirmed_by: ctx.userId,
      dispute_reason: disputed > 0 ? `${disputed} servicio(s) no cuadran con lo operado` : null,
      notes: body.notes || settlement.notes,
    });

    // La cuenta por pagar sigue al neto: dejarla en el bruto la pagaría de más.
    const payables = await tenantQuery<{ _id: string; paid_amount?: number }>(
      ctx.companyId, "payable", { _filter: { settlement: id, status: { nin: ["paid", "written_off"] } }, _limit: 10 }
    );
    for (const payable of payables) {
      const paid = payable.paid_amount ?? 0;
      await tenantUpdate(ctx.companyId, "payable", payable._id, {
        amount: totals.net,
        balance: Math.max(0, Math.round((totals.net - paid + Number.EPSILON) * 100) / 100),
      });
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: disputed > 0 && body.accept_variance !== true
        ? "supplier_settlement_disputed"
        : "supplier_settlement_confirmed",
      entityType: "settlement", entityId: id,
      description: `Factura ${body.invoice_number} del proveedor: facturado ${totals.confirmed}, ` +
        `devengado ${totals.services}, retenciones ${totals.retentions}, neto ${totals.net}` +
        (disputed > 0 ? ` · ${disputed} servicio(s) no cuadran` : ""),
      severity: disputed > 0 ? "warning" : "info",
      metadata: {
        invoice: body.invoice_number, ncf: body.invoice_ncf || null,
        services: totals.services, confirmed: totals.confirmed,
        retentions: totals.retentions, net: totals.net,
        disputed, accepted: body.accept_variance === true,
      },
    });

    console.log(`[proveedores] ${settlement.code} conciliada · neto ${totals.net} · ${disputed} discrepancias`);
    return ok({ status: nextStatus, totals, retentions, disputed });
  } catch (err) {
    return fail(err);
  }
}
