import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantFindOne, tenantQuery, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { assertModule } from "@/lib/plan-service";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify-service";
import { usuarioDeVendedor } from "@/lib/seller-identity";
import { postSettlementPayment } from "@/lib/ledger-events";
import { payBlocker, stateAfterPayment, PAY_BLOCK_MESSAGE } from "@/lib/supplier-settlement";
import { refId, type Settlement } from "@/lib/types";
import { assertSameOriginMutation } from "@/lib/csrf";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * POST /api/settlements/:id/pay — registra el pago de una liquidación (AUD-F12).
 *
 * El flujo antiguo era un `PUT /api/erp/settlement/:id {status:"paid"}` que
 * cambiaba el estado y dejaba la cuenta por pagar ABIERTA, no asentaba nada y no
 * cerraba las comisiones: la deuda seguía apareciendo como pendiente después de
 * "pagarla", y se podía pagar dos veces. Esta ruta hace todo el recorrido:
 * liquidación → cuenta por pagar → comisiones o servicios → contabilidad.
 *
 * Tres cosas que cambiaron con las liquidaciones de proveedor (0040):
 *
 *  · **Se paga el NETO.** A un proveedor se le transfiere lo facturado menos las
 *    retenciones de la DGII; pagarle el bruto deja a la empresa debiéndole ese
 *    dinero al fisco.
 *  · **Sin comprobante no se paga.** El gasto se sostiene con la factura del
 *    proveedor. Y una liquidación en disputa se resuelve antes, no después.
 *  · **El abono parcial existe.** `partially_paid` estaba en el check desde 0006
 *    y era inalcanzable: solo se escribía 'paid'. Un proveedor al que se le
 *    abona la mitad de la semana no tenía cómo representarse.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginMutation(req);
    const { id } = await params;
    const ctx = await requireTenantWrite();
    assertModule(ctx, "settlements");
    requireAtLeast(ctx, "manager");

    const body = await readJson<{
      method?: string; notes?: string; amount?: number; skip_invoice_check?: boolean;
    }>(req);
    const settlement = await tenantFindOne<Settlement>(ctx.companyId, "settlement", id);

    // Saltarse la exigencia del comprobante es decisión de administración y
    // queda auditada: hay casos reales —un proveedor informal— y no puede ser
    // el camino por defecto.
    if (body.skip_invoice_check) requireAtLeast(ctx, "admin");

    const blocker = payBlocker(settlement, { requireInvoice: !body.skip_invoice_check });
    if (blocker) {
      throw Object.assign(new Error(PAY_BLOCK_MESSAGE[blocker]), { status: 409 });
    }

    const isSupplier = settlement.beneficiary_type === "supplier";
    // A un proveedor se le paga el neto tras retenciones; a un socio o vendedor,
    // su comisión.
    const total = round2(isSupplier ? settlement.net_total ?? 0 : settlement.commission_total ?? 0);
    const alreadyPaid = round2(settlement.paid_total ?? 0);
    const outstanding = round2(total - alreadyPaid);
    const payment = body.amount != null
      ? round2(Math.min(Math.max(Number(body.amount) || 0, 0), outstanding))
      : outstanding;
    if (payment <= 0.009) {
      throw Object.assign(new Error("El importe a pagar tiene que ser mayor que cero"), { status: 400 });
    }

    const method = body.method || "transfer";
    const state = stateAfterPayment(total, alreadyPaid, payment);
    const nowIso = new Date().toISOString();

    // 1) La liquidación.
    await tenantUpdate(ctx.companyId, "settlement", id, {
      status: state.status,
      paid_total: state.paid,
      pending_total: state.outstanding,
      paid_at: state.status === "paid" ? nowIso : null,
      last_payment_at: nowIso,
      notes: body.notes || settlement.notes,
    });

    // 2) Las cuentas por pagar asociadas, a prorrata del abono.
    const payables = await tenantQuery<{ _id: string; amount?: number; paid_amount?: number }>(
      ctx.companyId, "payable", {
        _filter: { settlement: id, status: { nin: ["paid", "written_off"] } }, _limit: 10,
      }
    );
    let remaining = payment;
    for (const payable of payables) {
      if (remaining <= 0.009) break;
      const amount = round2(payable.amount ?? total);
      const paid = round2(payable.paid_amount ?? 0);
      const due = round2(amount - paid);
      if (due <= 0.009) continue;
      const applied = round2(Math.min(remaining, due));
      const newPaid = round2(paid + applied);
      const balance = round2(amount - newPaid);
      await tenantUpdate(ctx.companyId, "payable", payable._id, {
        paid_amount: newPaid,
        balance,
        status: balance <= 0.009 ? "paid" : "partially_paid",
        paid_at: balance <= 0.009 ? nowIso : null,
      });
      remaining = round2(remaining - applied);
    }

    // 3) Lo que la liquidación cierra. Solo al quedar pagada del todo: un abono
    // parcial no cierra un servicio ni una comisión, porque todavía se debe.
    let closedCommissions = 0;
    let closedServices = 0;
    if (state.status === "paid") {
      const commissions = await tenantQuery<{ _id: string }>(ctx.companyId, "commission", {
        _filter: { settlement: id, status: "settled" }, _limit: 1000,
      });
      for (const commission of commissions) {
        await tenantUpdate(ctx.companyId, "commission", commission._id, { status: "paid" });
        closedCommissions++;
      }

      const services = await tenantQuery<{ _id: string }>(ctx.companyId, "booking_cost", {
        _filter: { settlement: id, status: "settled" }, _limit: 1000,
      });
      for (const service of services) {
        await tenantUpdate(ctx.companyId, "booking_cost", service._id, { status: "paid" });
        closedServices++;
      }
    }

    // 4) Contabilidad por partida doble (AUD-F15).
    await postSettlementPayment(ctx.companyId, {
      settlementId: id,
      amount: payment,
      method,
      currency: settlement.currency,
      userId: ctx.userId,
    });

    /**
     * Y se le dice al beneficiario que ya cobró.
     *
     * A la PERSONA, no a la audiencia de rol: «te pagaron la liquidación»
     * repartido por rol se lo manda a todos los vendedores de la empresa.
     * Sin cuenta vinculada no se avisa a nadie —un aviso personal sin persona
     * no puede convertirse en un aviso para todo el mundo—, y nunca bloquea:
     * el dinero ya se movió y ya está en la contabilidad.
     */
    /**
     * Y al tour center, cuando el beneficiario es él.
     *
     * Este bloque solo miraba `beneficiary_type === "seller"`: a un socio
     * liquidado no se le decía nunca que le habían pagado. Va a su empresa —no
     * hace falta buscar qué persona— porque el dinero es de la empresa.
     */
    if (settlement.beneficiary_type === "partner") {
      const socio = refId(settlement.partner as never);
      if (socio) {
        await notify({
          companyId: ctx.companyId,
          partnerId: socio,
          event: "partner_settlement_paid",
          entityType: "settlement",
          entityId: id,
          // El pago puede ser parcial y llegar en varios abonos: cada uno es un
          // hecho distinto y merece su aviso.
          dedupeSeed: `${socio}:${payment}:${new Date().toISOString().slice(0, 10)}`,
          vars: {
            referencia: settlement.code ?? "",
            monto: payment,
            moneda: settlement.currency ?? "usd",
          },
        });
      }
    }

    if (settlement.beneficiary_type === "seller") {
      const userId = await usuarioDeVendedor(ctx.companyId, refId(settlement.seller as never));
      if (userId) {
        await notify({
          companyId: ctx.companyId,
          userId,
          event: "settlement_paid",
          entityType: "settlement",
          entityId: id,
          vars: {
            referencia: settlement.code ?? "",
            monto: payment,
            moneda: settlement.currency ?? "usd",
          },
        });
      }
    }

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: "settlement_paid", entityType: "settlement", entityId: id,
      description: `Liquidación ${settlement.code}: abono de ${payment} ${settlement.currency ?? ""} (${method})` +
        (state.outstanding > 0.009 ? ` · quedan ${state.outstanding}` : " · saldada") +
        (body.skip_invoice_check ? " · pagada sin comprobante del proveedor" : ""),
      severity: body.skip_invoice_check ? "warning" : "info",
      metadata: {
        payment, total, paid: state.paid, outstanding: state.outstanding, method,
        payables: payables.length, commissions: closedCommissions, services: closedServices,
        without_invoice: body.skip_invoice_check === true,
      },
    });

    console.log(
      `[settlements] ${settlement.code} · abono ${payment} ${settlement.currency} · ${state.status}`
    );
    return ok({
      paid: state.status === "paid",
      status: state.status,
      payment, total, paid_total: state.paid, outstanding: state.outstanding,
      payables: payables.length, commissions: closedCommissions, services: closedServices,
    });
  } catch (err) {
    return fail(err);
  }
}
