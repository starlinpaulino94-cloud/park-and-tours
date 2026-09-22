import { NextRequest } from "next/server";
import { requireTenantWrite, requireAtLeast, tenantQuery, tenantCreate, tenantFindOne, tenantUpdate } from "@/lib/tenant";
import { ok, fail, readJson } from "@/lib/api-response";
import { syncOrderTotals } from "@/lib/booking-service";
import { recalcCashSession } from "@/lib/cash";
import { ensureSchedule, scheduleRefFor } from "@/lib/schedule-service";
import { postPayment } from "@/lib/ledger-events";
import { resolveExchangeRate } from "@/lib/currency";
import { newPaymentReference } from "@/lib/codes";
import { writeAudit } from "@/lib/audit";
import { issueInvoice } from "@/lib/invoice-service";
import { decidirFactura, explicarDecision } from "@/lib/facturacion-automatica";
import { notify } from "@/lib/notify-service";
import { notifyPaymentReceived } from "@/lib/messaging/events";
import { assertSameOriginMutation } from "@/lib/csrf";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import type { CashSession, Currency, Order, PaymentMethod, Receivable } from "@/lib/types";
import { flushOutboxAfterResponse } from "@/lib/messaging/flush";

/**
 * POST /api/payments — registers a payment/refund, updates the order and
 * booking balances, feeds the cash session and settles B2B receivables.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const ctx = await requireTenantWrite();
    await assertRateLimit({ key: rateLimitKey(req, "payments:create", ctx.userId), limit: 30, windowMs: 60_000 });
    requireAtLeast(ctx, "seller");

    const body = await readJson<{
      order_id?: string; booking_id?: string; customer_id?: string; partner_id?: string;
      amount?: number; method?: PaymentMethod; currency?: Currency; exchange_rate?: number;
      payment_type?: "payment" | "refund" | "deposit" | "credit_note";
      cash_session_id?: string; reference?: string; notes?: string; paid_at?: string;
      allow_overpay?: boolean;
    }>(req);

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw Object.assign(new Error("El importe debe ser mayor que cero"), { status: 400 });
    }
    if (!body.order_id && !body.booking_id) {
      throw Object.assign(new Error("Indica la orden o la reserva a la que aplica el pago"), { status: 400 });
    }

    // AUD-F19: idempotency. A retried request (network retry, double-submit,
    // two tabs) previously created a second identical payment — double-charging
    // the customer and desyncing order/cash/receivable totals. When the client
    // sends an Idempotency-Key we store it as the payment `reference`; a repeat
    // with the same key returns the existing payment instead of creating a new
    // one. Because `reference` has no unique DB constraint (AUD-D01), this is a
    // best-effort check-then-act, but it closes the common double-submit path.
    const idempotencyKey = req.headers.get("Idempotency-Key")?.trim() || body.reference?.trim() || null;
    if (idempotencyKey) {
      const existing = await tenantQuery<{ _id: string }>(ctx.companyId, "payment", {
        _filter: { reference: idempotencyKey }, _limit: 1,
      });
      if (existing[0]) {
        console.log(`[payments] idempotent hit for ${idempotencyKey}`);
        return ok(existing[0], { idempotent: true });
      }
    }

    let orderId = body.order_id || null;
    if (!orderId && body.booking_id) {
      const booking = await tenantFindOne<{ order?: any }>(ctx.companyId, "booking", body.booking_id);
      orderId = typeof booking.order === "string" ? booking.order : booking.order?._id ?? null;
    }

    const order = orderId
      ? await tenantFindOne<Order>(ctx.companyId, "order", orderId, { customer: true, partner: true })
      : null;

    const currency = (body.currency || order?.currency || ctx.company?.base_currency || "usd") as Currency;
    // AUD-F30: resolve the base-currency rate server-side from `currency_rate`
    // rather than trusting the client. `base_amount` becomes meaningful.
    const baseCurrency = (ctx.company?.base_currency || currency) as Currency;
    const rate = await resolveExchangeRate(ctx.companyId, currency, baseCurrency);

    // AUD-F20: cap the amount so payments can't exceed what is owed and refunds
    // can't exceed what was actually collected. Overpay must be explicit.
    if (order) {
      const isRefund = body.payment_type === "refund" || body.payment_type === "credit_note";
      if (isRefund) {
        const collected = order.paid_total ?? 0;
        if (amount > collected + 0.01) {
          throw Object.assign(
            new Error(`El reembolso (${amount}) no puede superar lo cobrado (${collected})`),
            { status: 400 }
          );
        }
      } else {
        const balance = order.balance ?? 0;
        if (amount > balance + 0.01 && !body.allow_overpay) {
          throw Object.assign(
            new Error(`El pago (${amount}) supera el saldo pendiente (${balance}). Marca sobrepago para continuar.`),
            { status: 400 }
          );
        }
      }
    }

    // An open cash session is required for cash movements.
    let cashSessionId = body.cash_session_id || null;
    if (!cashSessionId && body.method === "cash") {
      const open = await tenantQuery<CashSession>(ctx.companyId, "cash_session", {
        _filter: { user: ctx.userId, status: "open" }, _limit: 1, _sort: { createdAt: "desc" },
      });
      cashSessionId = open[0]?._id ?? null;
      if (!cashSessionId) {
        throw Object.assign(
          new Error("No tienes una caja abierta. Abre una sesión de caja para cobrar en efectivo."),
          { status: 409 }
        );
      }
    }

    // A qué cuota apunta este cobro, calculado ANTES de registrarlo: después de
    // imputarlo el plan ya ha cambiado y la respuesta sería otra. Es una
    // etiqueta para el recibo ("abono de la cuota 2 de 3"); la verdad de lo
    // imputado la lleva el recálculo del plan.
    const scheduleRef = orderId
      ? await scheduleRefFor(ctx.companyId, orderId, amount).catch(() => null)
      : null;

    const payment = await tenantCreate(ctx.companyId, "payment", {
      order: orderId || undefined,
      schedule: scheduleRef || undefined,
      booking: body.booking_id || undefined,
      customer: body.customer_id || (order && typeof order.customer === "object" ? order.customer._id : order?.customer) || undefined,
      partner: body.partner_id || (order && typeof order.partner === "object" ? order.partner?._id : order?.partner) || undefined,
      cash_session: cashSessionId || undefined,
      user: ctx.userId,
      reference: idempotencyKey || newPaymentReference(),
      payment_type: body.payment_type || "payment",
      method: body.method || "cash",
      status: "completed",
      amount,
      currency,
      exchange_rate: rate,
      base_currency: ctx.company?.base_currency || currency,
      base_amount: Math.round((amount * rate + Number.EPSILON) * 100) / 100,
      paid_at: body.paid_at ? new Date(body.paid_at).toISOString() : new Date().toISOString(),
      notes: body.notes,
    }) as { _id: string; reference?: string };

    // ---- cash session movement ---------------------------------------------
    if (cashSessionId) {
      // A credit note is an outflow too — it must never post as a positive sale
      // (that contradicted the receivable/ledger handling below).
      const isRefund = body.payment_type === "refund" || body.payment_type === "credit_note";
      await tenantCreate(ctx.companyId, "cash_movement", {
        cash_session: cashSessionId,
        user: ctx.userId,
        payment: payment._id,
        movement_type: isRefund ? "refund" : "sale",
        amount: isRefund ? -amount : amount,
        currency,
        concept: isRefund ? "Reembolso" : `Cobro ${order?.order_number ?? ""}`.trim(),
        reference: payment.reference,
        movement_at: new Date().toISOString(),
      });
      await recalcCashSession(ctx.companyId, cashSessionId);
    }

    // ---- keep order + bookings in sync -------------------------------------
    // `syncOrderTotals` recalcula además la imputación del plan de cobro, que se
    // deriva de `paid_total`. `ensureSchedule` va después para que una venta
    // anterior a 0039 —sin plan— gane el suyo en el primer cobro en vez de
    // quedarse sin calendario para siempre.
    if (orderId) {
      await syncOrderTotals(ctx.companyId, orderId);
      try {
        await ensureSchedule(ctx.companyId, orderId);
      } catch (err) {
        console.error("[payments] no se pudo actualizar el plan de cobro:", err);
      }
    }

    // ---- settle the B2B receivable(s) --------------------------------------
    // AUD-F21: apply the payment with the correct SIGN and PRORATE it across
    // the order's receivables, never exceeding each document's balance.
    // Previously a refund incremented `paid_amount` (settling debt on a refund)
    // and the full amount was applied to *every* receivable (double/triple
    // settlement when an order had several documents).
    if (orderId) {
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      const isRefund = body.payment_type === "refund" || body.payment_type === "credit_note";
      const receivables = await tenantQuery<Receivable>(ctx.companyId, "receivable", {
        _filter: { order: orderId, status: { nin: ["written_off"] } },
        _limit: 20,
        _sort: { createdAt: "asc" },
      });
      let remaining = amount; // positive magnitude, distributed across documents
      for (const r of receivables) {
        if (remaining <= 0.009) break;
        const total = r.amount ?? 0;
        const currentPaid = r.paid_amount ?? 0;

        let applied: number;
        let newPaid: number;
        if (isRefund) {
          // Un-apply money from documents that carry a paid amount.
          applied = Math.min(remaining, currentPaid);
          if (applied <= 0.009) continue;
          newPaid = round2(currentPaid - applied);
        } else {
          // Apply money up to the document's outstanding balance.
          const outstanding = round2(total - currentPaid);
          if (outstanding <= 0.009) continue;
          applied = Math.min(remaining, outstanding);
          newPaid = round2(currentPaid + applied);
        }

        const newBalance = Math.max(0, round2(total - newPaid));
        await tenantUpdate(ctx.companyId, "receivable", r._id, {
          paid_amount: newPaid,
          balance: newBalance,
          status: newBalance <= 0.009 ? "paid" : newPaid > 0.009 ? "partially_paid" : "pending",
        });
        remaining = round2(remaining - applied);
      }
    }

    // ---- double-entry ledger (AUD-F15) -------------------------------------
    // Best-effort: a bookkeeping failure never blocks the payment.
    await postPayment(ctx.companyId, {
      paymentId: payment._id,
      orderId,
      amount,
      method: body.method || "cash",
      currency,
      exchangeRate: rate,
      isRefund: body.payment_type === "refund" || body.payment_type === "credit_note",
      userId: ctx.userId,
    });

    await writeAudit({
      companyId: ctx.companyId, userId: ctx.userId,
      action: body.payment_type === "refund" ? "refund_registered" : "payment_registered",
      entityType: "payment", entityId: payment._id,
      description: `${body.payment_type === "refund" ? "Reembolso" : "Cobro"} de ${amount} ${currency} (${body.method || "cash"})`,
    });

    // Recibo al cliente. Un reembolso o una nota de crédito no llevan recibo de
    // pago: decirle "hemos registrado tu pago" a quien acaba de recibir un
    // abono es exactamente al revés.
    if (body.payment_type !== "refund" && body.payment_type !== "credit_note") {
      const customerId = body.customer_id
        || (order && typeof order.customer === "object" ? order.customer._id : (order?.customer as string | undefined));
      try {
        await notifyPaymentReceived(ctx.company, ctx.companyId, {
          paymentId: payment._id,
          amount, currency,
          method: body.method || "cash",
          bookingId: body.booking_id || null,
          orderId: orderId || null,
          customerId: customerId || null,
          reference: order?.order_number || payment.reference,
          balance: order ? (order.balance ?? 0) - amount : null,
          userId: ctx.userId,
        });
      } catch (err) {
        // Un cobro registrado no se cae porque el recibo no se pueda encolar.
        console.error("[payments] no se pudo encolar el recibo:", err);
      }
    }

    // Sale dinero: el gerente se entera. Un cobro rutinario NO avisa —uno por
    // cada pago del día convertiría la bandeja en ruido y, a la semana, nadie
    // la abriría—; un reembolso siempre se revisa.
    if (body.payment_type === "refund" || body.payment_type === "credit_note") {
      await notify({
        companyId: ctx.companyId,
        event: "payment_refunded",
        entityType: "payment",
        entityId: payment._id,
        vars: {
          monto: amount,
          moneda: currency,
          referencia: order?.order_number || payment.reference,
        },
      });
    }

    console.log(`[payments] ${payment.reference} · ${amount} ${currency} · ${body.method}`);
    // El cobro ya está registrado. El recibo sale en cuanto el cajero reciba su
    // respuesta, sin que la caja espere al proveedor de correo.
    flushOutboxAfterResponse(ctx.company, ctx.companyId);
    /**
     * ────────────────────────────────────────────────────────────────────────
     * LA FACTURA SALE SOLA AL QUEDAR SALDADA LA VENTA
     *
     * El sistema sabía facturar desde siempre —`invoice-service.ts` emite con
     * su NCF, su ITBIS y su secuencia—, pero NADIE lo llamaba: se cobraba y no
     * salía comprobante. Toda la máquina fiscal montada y sin enchufar.
     *
     * El tipo de NCF lo decide el cliente, no el cajero: con RNC va crédito
     * fiscal (B01) porque necesita deducirse el ITBIS; sin él, consumo (B02).
     * Eso ya lo resuelve `ncfTypeFor` dentro del servicio.
     *
     * MEJOR ESFUERZO, COMO LA CONTABILIDAD DE ARRIBA. Si la secuencia de NCF
     * está agotada o el perfil fiscal falta, el dinero ENTRÓ igual: tumbar el
     * cobro por no poder emitir el comprobante convierte un problema
     * administrativo en un descuadre de caja. Se registra el fallo, se devuelve
     * en la respuesta para que la pantalla lo diga, y la factura se emite a
     * mano cuando haya secuencia.
     */
    let factura: { id: string; ncf: string | null } | null = null;
    let facturaError: string | null = null;

    if (orderId) {
      // Los totales se releen: `syncOrderTotals` acaba de actualizarlos y la
      // decisión depende de si la venta quedó saldada CON este pago.
      const actualizada = await tenantFindOne<Order>(ctx.companyId, "order", orderId).catch(() => null);
      const decision = decidirFactura(actualizada, body.payment_type || "payment");

      if (decision.facturar) {
        try {
          const emitida = await issueInvoice(ctx, { orderId });
          factura = {
            id: String(emitida.invoice._id),
            ncf: (emitida.invoice.ncf as string) ?? null,
          };
          await writeAudit({
            companyId: ctx.companyId, userId: ctx.userId,
            action: "invoice_issued",
            entityType: "invoice", entityId: factura.id,
            description: `Factura ${factura.ncf ?? factura.id} emitida al saldarse ${actualizada?.order_number ?? orderId}`,
            metadata: { ncf: factura.ncf, order: orderId, automatica: true },
          });
        } catch (err) {
          // Una orden ya facturada devuelve 409: no es un fallo, es que no
          // había nada que hacer. El resto sí hay que contarlo.
          const status = (err as { status?: number })?.status;
          facturaError = err instanceof Error ? err.message : String(err);
          if (status !== 409) {
            console.error("[payments] no se pudo emitir la factura:", err);
            await writeAudit({
              companyId: ctx.companyId, userId: ctx.userId,
              action: "invoice_issue_failed",
              entityType: "order", entityId: orderId,
              description: `El cobro se registró pero la factura no salió: ${facturaError}`,
              severity: "warning",
              metadata: { order: orderId, payment: payment._id },
            }).catch(() => {});
          }
        }
      } else {
        console.log(`[payments] sin factura: ${explicarDecision(decision)}`);
      }
    }

    return ok({ ...payment, factura, factura_error: facturaError });
  } catch (err) {
    return fail(err);
  }
}
