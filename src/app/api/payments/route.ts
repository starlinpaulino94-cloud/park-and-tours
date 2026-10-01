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
import { planDePagoConTarjeta, type RedeemableGiftCard } from "@/lib/gift-cards";
import { recordMovement } from "@/lib/gift-card-service";

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
      /** 0103. Con `method: "gift_card"`, de qué tarjeta sale el saldo. */
      gift_card_id?: string;
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

    /**
     * EL SALDO REGALO NO ES EFECTIVO Y NO PASA POR CAJA (0103).
     *
     * Consumir una gift card no mete un peso en el cajón: extingue una deuda que
     * la empresa ya cobró el día que vendió la tarjeta. Meterlo en el arqueo
     * haría que el cajero cuadrara contra un dinero que no está, y a fin de turno
     * le faltaría exactamente lo que se pagó con tarjetas.
     *
     * Por eso `cash_session` se queda a un lado: más abajo el apunte de caja solo
     * se escribe si hay sesión, así que con esto no se escribe ninguno.
     */
    const conTarjeta = body.method === "gift_card";

    // An open cash session is required for cash movements.
    let cashSessionId = conTarjeta ? null : body.cash_session_id || null;
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

    /**
     * DE QUIÉN ES ESTE DINERO (0081).
     *
     * Se calcula UNA vez y se sella en el cobro y en el apunte de caja. Antes
     * el cobro nacía con su socio —`payment.partner` existe y se rellenaba— y
     * el `cash_movement` de la línea siguiente lo perdía: desde el momento de
     * escribirlo, el efectivo de una venta de socio era indistinguible del
     * propio de la operadora.
     *
     * Mientras el socio no pueda abrir caja eso no descuadra nada, porque todo
     * el efectivo está de verdad en el cajón de la operadora. Deja de ser
     * cierto en cuanto exista la caja externa, y entonces el arqueo diría que
     * la operadora tiene un dinero que está en el mostrador de otro.
     */
    const socioDelCobro =
      body.partner_id ||
      (order && typeof order.partner === "object" ? order.partner?._id : order?.partner) ||
      null;

    /**
     * ────────────────────────────────────────────────────────────────────────
     * EL CANJE Y EL COBRO SON UNA SOLA OPERACIÓN (0103)
     *
     * Antes de esta entrega el saldo emitido no podía pagar una orden: se
     * consumía en el cajón de la tarjeta y se cobraba la orden por otro método,
     * dos gestos sin relación. Si se olvidaba el segundo, la orden quedaba
     * impagada con el saldo ya gastado.
     *
     * ¿POR QUÉ SE CANJEA PRIMERO Y NO DESPUÉS?
     *
     * No hay transacción que abarque las dos escrituras, así que alguna va
     * primero y hay que elegir cuál falla mejor:
     *
     *  · Cobrar y luego canjear: si el canje falla, la orden queda pagada y la
     *    tarjeta conserva su saldo. El cliente puede gastarlo otra vez y la
     *    empresa paga dos veces el mismo servicio, **sin que nada lo señale**.
     *  · Canjear y luego cobrar: si el cobro falla, el cliente perdió saldo y la
     *    orden sigue impagada. Eso **se puede deshacer**, y aquí se deshace:
     *    `applyRefund` existe justo para esto y el movimiento de devolución
     *    queda en el libro de la tarjeta con su motivo.
     *
     * Se elige el que se puede compensar. Y si la compensación TAMBIÉN falla se
     * grita —auditoría con severidad de aviso y el error original—, porque
     * entonces hay un saldo consumido sin cobro y eso lo tiene que arreglar una
     * persona.
     */
    let tarjeta: (RedeemableGiftCard & { _id: string; code?: string; currency?: string }) | null = null;
    let canjeado = 0;
    if (conTarjeta) {
      /**
       * DEVOLVER NO ES COBRAR AL REVÉS: AQUÍ SOLO SE COBRA.
       *
       * Esta rama consume saldo con `applyRedemption`, y un `refund` o una nota
       * de crédito con `method: "gift_card"` entraría por el mismo sitio: al
       * cliente que se le devuelve dinero se le RESTARÍA saldo, en la dirección
       * contraria a lo que se le prometió, y el apunte del libro de la tarjeta
       * diría «consumido» para una operación que le debía dinero.
       *
       * La devolución a tarjeta existe y tiene su puerta —`applyRefund` y
       * `/api/gift-cards/:id/refund`—, con su propio techo (no puede devolver
       * más de lo emitido). Se manda allí en vez de adivinar aquí a qué tarjeta
       * va y cuánto cabe.
       */
      if (body.payment_type === "refund" || body.payment_type === "credit_note") {
        throw Object.assign(
          new Error(
            "Un reembolso con método gift card consumiría saldo en vez de devolverlo. " +
            "Devuelve el saldo desde la ficha de la tarjeta y registra el reembolso con otro método."
          ),
          { status: 400 }
        );
      }
      if (!body.gift_card_id) {
        throw Object.assign(new Error("Indica la gift card de la que sale el saldo"), { status: 400 });
      }
      tarjeta = await tenantFindOne(ctx.companyId, "gift_card", body.gift_card_id);
      /**
       * Sin esto, una tarjeta inexistente —o de otra empresa, que desde aquí es
       * lo mismo— llegaba como `null` al dominio y reventaba leyéndole el estado:
       * un 500 en lugar de un «no existe», y con la traza de un fallo interno
       * para lo que es un identificador equivocado.
       */
      if (!tarjeta) {
        throw Object.assign(new Error("Esa gift card no existe"), { status: 404 });
      }

      // Las mismas tres comprobaciones que la acción del cajón, en el dominio.
      const decision = planDePagoConTarjeta(tarjeta, amount, currency);
      if ("error" in decision) {
        throw Object.assign(new Error(decision.error), { status: decision.status });
      }

      await recordMovement({ companyId: ctx.companyId, userId: ctx.userId }, {
        cardId: body.gift_card_id,
        label: tarjeta.code || body.gift_card_id,
        plan: decision.plan,
        currency: tarjeta.currency,
        notes: body.notes,
        orderId: orderId || undefined,
        auditAction: "gift_card_redeemed",
        auditDescription:
          `Gift card ${tarjeta.code || body.gift_card_id}: consumidos ${amount} ` +
          `${currency.toUpperCase()} para cobrar ${order?.order_number ?? orderId ?? "una venta"}, ` +
          `saldo restante ${decision.plan.balance_after}`,
      });
      canjeado = amount;
    }

    /** Devuelve el saldo si el cobro no se pudo registrar. */
    const deshacerCanje = async (motivo: string) => {
      if (!conTarjeta || canjeado <= 0 || !body.gift_card_id) return;
      await recordMovement({ companyId: ctx.companyId, userId: ctx.userId }, {
        cardId: body.gift_card_id,
        label: tarjeta?.code || body.gift_card_id,
        plan: {
          amount: -canjeado,
          /**
           * El saldo y el estado que la tarjeta tenía ANTES del canje, leídos de
           * la fila que se cargó arriba. Deshacer es volver a donde estaba, no
           * calcular otra cosa: poner `partially_used` a mano —que es lo que
           * había aquí al escribirlo— marcaría como usada una tarjeta que se
           * queda intacta.
           */
          balance_after: Math.round((Number(tarjeta?.balance ?? 0) + Number.EPSILON) * 100) / 100,
          status: tarjeta?.status || "active",
          movement_type: "refund",
        },
        currency: tarjeta?.currency,
        notes: `Devuelto: el cobro no se pudo registrar (${motivo})`,
        auditAction: "gift_card_refunded",
        auditDescription:
          `Gift card ${tarjeta?.code || body.gift_card_id}: devueltos ${canjeado} ` +
          `${currency.toUpperCase()} porque el cobro falló — ${motivo}`,
        severity: "warning",
      });
    };

    let payment: { _id: string; reference?: string };
    try {
      payment = await tenantCreate(ctx.companyId, "payment", {
      order: orderId || undefined,
      schedule: scheduleRef || undefined,
      booking: body.booking_id || undefined,
      customer: body.customer_id || (order && typeof order.customer === "object" ? order.customer._id : order?.customer) || undefined,
      partner: socioDelCobro || undefined,
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
      ...(conTarjeta ? { gift_card: body.gift_card_id } : {}),
      }) as { _id: string; reference?: string };
    } catch (err) {
      /**
       * El cobro no se escribió y el saldo ya se consumió: se devuelve.
       *
       * Si la devolución falla también, se deja escrito con severidad de aviso y
       * se lanza el error ORIGINAL —no el de la compensación—, porque el
       * diagnóstico de por qué no se pudo cobrar es el que sirve.
       */
      await deshacerCanje(err instanceof Error ? err.message : String(err)).catch(async (fallo) => {
        console.error("[payments] el canje NO se pudo deshacer:", fallo);
        await writeAudit({
          companyId: ctx.companyId, userId: ctx.userId,
          action: "gift_card_redeem_orphaned",
          entityType: "gift_card", entityId: body.gift_card_id!,
          description:
            `Se consumió saldo de una gift card y el cobro no se registró, y la devolución ` +
            `automática también falló. Hay que devolverlo a mano.`,
          severity: "warning",
          metadata: { amount: canjeado, order: orderId, error: String(err) },
        }).catch(() => {});
      });
      throw err;
    }

    // ---- cash session movement ---------------------------------------------
    if (cashSessionId) {
      // A credit note is an outflow too — it must never post as a positive sale
      // (that contradicted the receivable/ledger handling below).
      const isRefund = body.payment_type === "refund" || body.payment_type === "credit_note";
      await tenantCreate(ctx.companyId, "cash_movement", {
        cash_session: cashSessionId,
        user: ctx.userId,
        payment: payment._id,
        // El mismo socio que el cobro: es la fila que el arqueo SUMA, así que
        // es donde tiene que poder distinguirse de quién es el dinero.
        partner: socioDelCobro || undefined,
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
