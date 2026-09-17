import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { tenantQuery, tenantUpdate, TenantError, type TenantContext } from "@/lib/tenant";
import { syncOrderTotals } from "@/lib/booking-service";
import { writeAudit } from "@/lib/audit";
import {
  evaluateBenefits, redeemMembership, redeemPromotion, reverseRedemption,
  platformConfigured, MembegoApiError,
} from "@/lib/membego-platform";
import {
  REDEEM_BLOCK_MESSAGE, REVERSAL_BLOCK_MESSAGE,
  defaultLine, discountFor, effectOf, idempotencyKeyFor, redeemBlocker,
  reversalBlocker, serviceLabel, shouldRestoreLine,
  type EvaluateResult, type EvaluatedBenefit, type LineLike,
} from "@/lib/membego-benefits";

/**
 * EL CANJE, CONTRA LA BASE Y CONTRA MEMBEGO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ORDEN ES LA DECISIÓN
 *
 * Primero se CONSUME en MembeGo y solo después se rebaja la venta.
 *
 * Al revés —rebajar y luego consumir— parece más amable con el cajero y es la
 * forma de regalar dinero: si el cliente gastó ese beneficio hace diez minutos
 * en otra sucursal, la venta ya saldría rebajada y el descuento no lo respalda
 * nadie. MembeGo decide, y solo cuando dijo que sí baja el importe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOBRE UNA VENTA QUE YA EXISTE
 *
 * El beneficio se canjea contra una venta creada, no contra un carrito. Un
 * carrito se abandona; un uso consumido contra un carrito abandonado es un uso
 * que el cliente perdió sin recibir nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA ELEGIBILIDAD NO SE GUARDA. NUNCA.
 *
 * Es la regla que la migración 0041 dejó escrita y que esta ola no toca. Lo que
 * se guarda es el RECIBO —qué se canjeó, cuánto rebajó, qué dijo MembeGo— para
 * poder cuadrar la caja, revertir y conciliar. Nada de eso decide si el cliente
 * tiene derecho: eso se pregunta, siempre, en el momento.
 */

export interface MembegoContext {
  configured: boolean;
  linked: boolean;
  membegoCompanyId: string | null;
}

/** ¿Está esta empresa en condiciones de canjear? */
export async function membegoContext(companyId: string): Promise<MembegoContext> {
  const configured = platformConfigured();
  const { data } = await supabaseService()
    .from("membego_link")
    .select("membego_company_id, status")
    .eq("organization_id", companyId)
    .maybeSingle();

  const linked = Boolean(data?.membego_company_id) && (data?.status ?? "active") === "active";
  return {
    configured,
    linked,
    membegoCompanyId: linked ? String(data?.membego_company_id) : null,
  };
}

/**
 * Quién es este cliente en MembeGo.
 *
 * Sale del espejo que los webhooks mantienen (0041). Si el cliente no está ahí,
 * es que nunca llegó por MembeGo: no hay beneficios que preguntar, y decirlo es
 * mejor que llamar a su API para que conteste que no conoce a nadie.
 */
export async function membegoClienteIdOf(companyId: string, customerId: string): Promise<string | null> {
  const { data } = await supabaseService()
    .from("membego_customer")
    .select("membego_cliente_id")
    .eq("organization_id", companyId)
    .eq("customer_id", customerId)
    .maybeSingle();
  return data?.membego_cliente_id ? String(data.membego_cliente_id) : null;
}

export interface BenefitsForCustomer {
  available: boolean;
  reason: string | null;
  membegoClienteId: string | null;
  evaluation: EvaluateResult | null;
}

/**
 * Los beneficios del cliente, preguntados AHORA.
 *
 * Nunca falla hacia arriba por culpa de MembeGo: si su API no contesta, el
 * mostrador tiene que poder seguir vendiendo. Lo que se devuelve entonces es
 * «no disponible» con el motivo, no una excepción que tumbe la pantalla de
 * venta entera por una integración.
 */
export async function benefitsForCustomer(
  companyId: string,
  customerId: string
): Promise<BenefitsForCustomer> {
  const ctx = await membegoContext(companyId);
  if (!ctx.configured) return { available: false, reason: REDEEM_BLOCK_MESSAGE.not_configured, membegoClienteId: null, evaluation: null };
  if (!ctx.linked) return { available: false, reason: REDEEM_BLOCK_MESSAGE.not_linked, membegoClienteId: null, evaluation: null };

  const clienteId = await membegoClienteIdOf(companyId, customerId);
  if (!clienteId) {
    return { available: false, reason: REDEEM_BLOCK_MESSAGE.no_customer, membegoClienteId: null, evaluation: null };
  }

  try {
    const evaluation = await evaluateBenefits(ctx.membegoCompanyId as string, clienteId);
    return { available: true, reason: null, membegoClienteId: clienteId, evaluation };
  } catch (err) {
    const message = err instanceof MembegoApiError
      ? `MembeGo no pudo contestar (${err.code}). ${err.message}`
      : "MembeGo no está disponible ahora mismo.";
    console.error("[membego] evaluación de beneficios fallida:", err);
    return { available: false, reason: message, membegoClienteId: clienteId, evaluation: null };
  }
}

/* ══════════════════════════════════════════════════════════ canjear ══ */

interface OrderRow {
  id: string;
  status: string | null;
  currency: string | null;
  customer_id: string | null;
}

interface BookingRow {
  _id: string;
  product?: unknown;
  total_amount?: number | null;
  discount_amount?: number | null;
  status?: string | null;
  membego_benefit?: string | null;
}

async function loadOrder(companyId: string, orderId: string): Promise<OrderRow | null> {
  const { data } = await supabaseService()
    .from("sales_order")
    .select("id,status,currency,customer_id")
    .eq("organization_id", companyId)
    .eq("id", orderId)
    .maybeSingle();
  return (data as OrderRow | null) ?? null;
}

/** Las líneas vivas de la venta, con su importe: sobre una de ellas se aplica. */
async function linesOf(companyId: string, orderId: string): Promise<{ rows: BookingRow[]; lines: LineLike[] }> {
  const rows = await tenantQuery<BookingRow>(companyId, "booking", {
    _filter: { order: orderId }, _limit: 100, product: true,
  });
  const DEAD = new Set(["cancelled", "refunded"]);
  const live = rows.filter((row) => !DEAD.has(row.status ?? ""));
  const lines: LineLike[] = live.map((row) => ({
    id: row._id,
    label: productNameOf(row),
    total: Number(row.total_amount ?? 0),
  }));
  return { rows: live, lines };
}

function productNameOf(row: BookingRow): string {
  const product = row.product;
  if (product && typeof product === "object") {
    const name = (product as { name?: string }).name;
    if (name) return String(name);
  }
  return "Excursión";
}

export interface RedeemInput {
  orderId: string;
  benefit: EvaluatedBenefit;
  /** Cuándo contestó MembeGo. Una evaluación vieja no sirve para canjear. */
  evaluatedAt: string;
  /** La línea elegida; sin ella se usa la más cara. */
  bookingId?: string | null;
}

export interface RedeemOutcome {
  redemptionId: string;
  benefitName: string;
  effectLabel: string;
  discount: number;
  currency: string;
  bookingId: string;
  usesLeft: number | null;
  orderTotal: number;
}

/**
 * Canjear un beneficio sobre una venta.
 *
 * Lanza `TenantError` con el motivo cuando no se puede, y deja que el error de
 * MembeGo suba tal cual cuando es él quien se niega: el cajero necesita
 * distinguir «no te quedan usos» de «no hay conexión», porque en el primer caso
 * cobra completo y en el segundo espera un minuto.
 */
export async function redeemForOrder(
  ctx: TenantContext & { companyId: string },
  input: RedeemInput
): Promise<RedeemOutcome> {
  const companyId = ctx.companyId;
  const mb = await membegoContext(companyId);

  const order = await loadOrder(companyId, input.orderId);
  if (!order) throw new TenantError("Esa venta no existe.", 404);

  const clienteId = order.customer_id ? await membegoClienteIdOf(companyId, order.customer_id) : null;
  const { rows, lines } = await linesOf(companyId, input.orderId);

  // ¿Ya tiene un beneficio aplicado? Cada uso es UN servicio: dos beneficios
  // sobre la misma venta consumirían dos usos por un solo servicio prestado.
  const { data: previous } = await supabaseService()
    .from("membego_redemption")
    .select("id")
    .eq("organization_id", companyId)
    .eq("order_id", input.orderId)
    .eq("status", "applied")
    .limit(1);

  const block = redeemBlocker({
    configured: mb.configured,
    linked: mb.linked,
    membegoClienteId: clienteId,
    benefit: input.benefit,
    evaluatedAt: input.evaluatedAt,
    lines,
    alreadyRedeemed: (previous?.length ?? 0) > 0,
    orderStatus: order.status,
  });
  if (block) throw new TenantError(REDEEM_BLOCK_MESSAGE[block], block === "already_redeemed" ? 409 : 400);

  const chosen = input.bookingId
    ? lines.find((line) => line.id === input.bookingId) ?? defaultLine(lines)
    : defaultLine(lines);
  if (!chosen) throw new TenantError(REDEEM_BLOCK_MESSAGE.no_line, 400);

  const effect = effectOf(input.benefit);
  const discount = discountFor(effect, chosen.total);
  const idempotencyKey = idempotencyKeyFor(input.orderId, input.benefit.id);
  const servicio = serviceLabel(chosen.label);

  // ── 1. Consumir en MembeGo. Si esto falla, la venta no se toca. ─────────
  let remoteId = "";
  let usesLeft: number | null = null;
  try {
    if (input.benefit.type === "MEMBERSHIP") {
      const result = await redeemMembership({
        membegoCompanyId: mb.membegoCompanyId as string,
        membershipId: input.benefit.id,
        servicio,
        notas: `Venta ${input.orderId}`,
        idempotencyKey,
      });
      remoteId = result.redemptionId;
      usesLeft = result.unlimited ? null : result.usesLeft;
      await recordRedemption(companyId, ctx.userId, {
        input, order, chosen, effect, discount, idempotencyKey, clienteId: clienteId as string,
        membegoCompanyId: mb.membegoCompanyId, remoteId,
        visitId: result.visitId, ticket: result.ticketNumero, codigo: result.codigo,
        usesLeft, unlimited: result.unlimited,
      });
    } else {
      const result = await redeemPromotion({
        membegoCompanyId: mb.membegoCompanyId as string,
        promotionId: input.benefit.id,
        servicio,
        externalId: input.orderId,
        idempotencyKey,
      });
      remoteId = result.redemptionId;
      usesLeft = result.usesLeft;
      await recordRedemption(companyId, ctx.userId, {
        input, order, chosen, effect, discount, idempotencyKey, clienteId: clienteId as string,
        membegoCompanyId: mb.membegoCompanyId, remoteId,
        visitId: null, ticket: null, codigo: null,
        usesLeft, unlimited: false,
      });
    }
  } catch (err) {
    // El intento fallido también se guarda: sin él, un «no me aplicó el
    // descuento» no tiene dónde mirarse, y el motivo real de MembeGo se pierde.
    await recordFailure(companyId, ctx.userId, {
      input, order, chosen, effect, idempotencyKey, clienteId, membegoCompanyId: mb.membegoCompanyId, err,
    });
    throw err;
  }

  // ── 2. Ahora sí: rebajar la línea y recalcular la venta. ────────────────
  const row = rows.find((r) => r._id === chosen.id);
  if (discount > 0 && row) {
    await tenantUpdate(companyId, "booking", chosen.id, {
      discount_amount: round2(Number(row.discount_amount ?? 0) + discount),
      total_amount: round2(Math.max(0, Number(row.total_amount ?? 0) - discount)),
      membego_benefit: input.benefit.nombre,
      membego_discount: discount,
    });
    // El total de la venta se recalcula desde sus líneas: tocar la línea sin
    // esto dejaría la orden cobrando el importe de antes.
    await syncOrderTotals(companyId, input.orderId);
  }

  await writeAudit({
    companyId, userId: ctx.userId,
    action: "membego_benefit_redeemed",
    entityType: "order", entityId: input.orderId,
    description: `Beneficio MembeGo canjeado: ${input.benefit.nombre} · −${discount}`,
    metadata: {
      benefit_id: input.benefit.id, benefit_type: input.benefit.type,
      redemption_id: remoteId, discount, booking: chosen.id, uses_left: usesLeft,
    },
  });

  const refreshed = await loadOrderTotal(companyId, input.orderId);
  return {
    redemptionId: remoteId,
    benefitName: input.benefit.nombre,
    effectLabel: effect.label,
    discount,
    currency: String(order.currency || "usd"),
    bookingId: chosen.id,
    usesLeft,
    orderTotal: refreshed,
  };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function loadOrderTotal(companyId: string, orderId: string): Promise<number> {
  const { data } = await supabaseService()
    .from("sales_order").select("total").eq("organization_id", companyId).eq("id", orderId).maybeSingle();
  return Number(data?.total ?? 0);
}

interface RecordInput {
  input: RedeemInput;
  order: OrderRow;
  chosen: LineLike;
  effect: ReturnType<typeof effectOf>;
  discount: number;
  idempotencyKey: string;
  clienteId: string;
  membegoCompanyId: string | null;
  remoteId: string;
  visitId: string | null;
  ticket: string | null;
  codigo: string | null;
  usesLeft: number | null;
  unlimited: boolean;
}

async function recordRedemption(companyId: string, userId: string, r: RecordInput): Promise<void> {
  const { error } = await supabaseService().from("membego_redemption").insert({
    organization_id: companyId,
    order_id: r.order.id,
    booking_id: r.chosen.id,
    customer_id: r.order.customer_id,
    membego_cliente_id: r.clienteId,
    membego_company_id: r.membegoCompanyId,
    benefit_type: r.input.benefit.type,
    benefit_id: r.input.benefit.id,
    benefit_name: r.input.benefit.nombre,
    redemption_id: r.remoteId,
    visit_id: r.visitId,
    ticket_numero: r.ticket,
    codigo: r.codigo,
    uses_left: r.usesLeft,
    unlimited: r.unlimited,
    effect_kind: r.effect.kind,
    effect_label: r.effect.label,
    amount_discounted: r.discount,
    currency: r.order.currency,
    status: "applied",
    redeemed_by: userId || null,
    idempotency_key: r.idempotencyKey,
  });
  // 23505 = la misma clave ya existía. Es un reintento: MembeGo devolvió el
  // mismo canje y aquí ya estaba anotado. No es un error.
  if (error && error.code !== "23505") throw new Error(error.message);
}

async function recordFailure(
  companyId: string,
  userId: string,
  r: {
    input: RedeemInput; order: OrderRow; chosen: LineLike; effect: ReturnType<typeof effectOf>;
    idempotencyKey: string; clienteId: string | null; membegoCompanyId: string | null; err: unknown;
  }
): Promise<void> {
  const api = r.err instanceof MembegoApiError ? r.err : null;
  await supabaseService().from("membego_redemption").insert({
    organization_id: companyId,
    order_id: r.order.id,
    booking_id: r.chosen.id,
    customer_id: r.order.customer_id,
    membego_cliente_id: r.clienteId ?? "",
    membego_company_id: r.membegoCompanyId,
    benefit_type: r.input.benefit.type,
    benefit_id: r.input.benefit.id,
    benefit_name: r.input.benefit.nombre,
    effect_kind: r.effect.kind,
    effect_label: r.effect.label,
    amount_discounted: 0,
    currency: r.order.currency,
    status: "failed",
    error_code: api?.code ?? "INTERNAL_ERROR",
    error_message: (api?.message ?? String(r.err)).slice(0, 400),
    request_id: api?.requestId ?? null,
    redeemed_by: userId || null,
    // Un intento fallido no puede bloquear el siguiente con la misma clave.
    idempotency_key: `${r.idempotencyKey}:fail:${Date.now()}`,
  }).then(({ error }) => {
    if (error) console.error("[membego] no se pudo anotar el canje fallido:", error.message);
  });
}

/* ═════════════════════════════════════════════════════════ revertir ══ */

export interface ReversalOutcome {
  reversed: boolean;
  manual: boolean;
  message: string;
  restored: number;
}

/**
 * Devolverle al cliente el beneficio de una venta que se cae.
 *
 * Se llama desde la cancelación de la reserva. Nunca lanza: una cancelación no
 * puede quedarse a medias porque MembeGo no conteste — la reserva tiene que
 * cancelarse igual y la incidencia queda anotada para resolverla.
 */
export async function reverseForOrder(
  companyId: string,
  orderId: string,
  reason: string,
  userId = ""
): Promise<ReversalOutcome[]> {
  const { data } = await supabaseService()
    .from("membego_redemption")
    .select("id,redemption_id,status,benefit_type,benefit_name,membego_company_id,booking_id,amount_discounted")
    .eq("organization_id", companyId)
    .eq("order_id", orderId)
    .eq("status", "applied")
    .limit(10);

  const rows = data ?? [];
  const outcomes: ReversalOutcome[] = [];

  for (const row of rows) {
    const block = reversalBlocker({
      status: String(row.status),
      redemption_id: row.redemption_id as string | null,
      benefit_type: row.benefit_type as string,
    });

    if (block) {
      // Una promoción no tiene reversa por API. Se dice y se deja anotado en vez
      // de fingir que se devolvió.
      await supabaseService().from("membego_redemption").update({
        reverse_reason: `${reason} · ${REVERSAL_BLOCK_MESSAGE[block]}`,
      }).eq("organization_id", companyId).eq("id", row.id);

      await writeAudit({
        companyId, userId,
        action: "membego_reversal_manual",
        entityType: "order", entityId: orderId,
        severity: "warning",
        description: `El beneficio «${row.benefit_name}» no se pudo devolver solo: ${REVERSAL_BLOCK_MESSAGE[block]}`,
        metadata: { redemption: row.id, block },
      });

      outcomes.push({ reversed: false, manual: true, message: REVERSAL_BLOCK_MESSAGE[block], restored: 0 });
      continue;
    }

    try {
      await reverseRedemption(
        String(row.membego_company_id ?? ""),
        String(row.redemption_id),
        reason
      );
      await supabaseService().from("membego_redemption").update({
        status: "reversed", reversed_at: new Date().toISOString(), reverse_reason: reason,
      }).eq("organization_id", companyId).eq("id", row.id);

      // El importe solo vuelve a la venta si la venta sigue viva. Si se está
      // cancelando entera, subir la línea antes inflaría el reembolso.
      let restored = 0;
      const order = await loadOrder(companyId, orderId);
      if (row.booking_id && shouldRestoreLine(order?.status)) {
        restored = await restoreLine(companyId, String(row.booking_id), Number(row.amount_discounted ?? 0));
        if (restored > 0) await syncOrderTotals(companyId, orderId);
      }

      outcomes.push({ reversed: true, manual: false, message: "Beneficio devuelto al cliente.", restored });
    } catch (err) {
      console.error("[membego] no se pudo revertir el canje:", err);
      await writeAudit({
        companyId, userId,
        action: "membego_reversal_failed",
        entityType: "order", entityId: orderId,
        severity: "warning",
        description: `No se pudo devolver el beneficio «${row.benefit_name}» en MembeGo`,
        metadata: { redemption: row.id, error: err instanceof Error ? err.message : String(err) },
      });
      outcomes.push({
        reversed: false, manual: true,
        message: "MembeGo no aceptó la reversa: hay que devolverlo desde su panel.",
        restored: 0,
      });
    }
  }

  return outcomes;
}

async function restoreLine(companyId: string, bookingId: string, discount: number): Promise<number> {
  if (!(discount > 0)) return 0;
  const [row] = await tenantQuery<BookingRow>(companyId, "booking", {
    _filter: { _id: bookingId }, _limit: 1,
  });
  if (!row) return 0;
  await tenantUpdate(companyId, "booking", bookingId, {
    discount_amount: round2(Math.max(0, Number(row.discount_amount ?? 0) - discount)),
    total_amount: round2(Number(row.total_amount ?? 0) + discount),
    membego_benefit: null,
    membego_discount: null,
  });
  return discount;
}

/* ═════════════════════════════════════════════════════════ consultar ══ */

export interface RedemptionRow {
  id: string;
  orderId: string | null;
  benefitName: string | null;
  benefitType: string;
  discount: number;
  currency: string | null;
  status: string;
  effectLabel: string | null;
  usesLeft: number | null;
  ticket: string | null;
  createdAt: string;
  errorMessage: string | null;
}

/** Los canjes de una venta, para la ficha y para el recibo. */
export async function redemptionsOfOrder(companyId: string, orderId: string): Promise<RedemptionRow[]> {
  const { data } = await supabaseService()
    .from("membego_redemption")
    .select("id,order_id,benefit_name,benefit_type,amount_discounted,currency,status,effect_label,uses_left,ticket_numero,created_at,error_message")
    .eq("organization_id", companyId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(20);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    orderId: row.order_id ? String(row.order_id) : null,
    benefitName: (row.benefit_name as string | null) ?? null,
    benefitType: String(row.benefit_type),
    discount: Number(row.amount_discounted ?? 0),
    currency: (row.currency as string | null) ?? null,
    status: String(row.status),
    effectLabel: (row.effect_label as string | null) ?? null,
    usesLeft: row.uses_left === null ? null : Number(row.uses_left),
    ticket: (row.ticket_numero as string | null) ?? null,
    createdAt: String(row.created_at),
    errorMessage: (row.error_message as string | null) ?? null,
  }));
}
