import "server-only";
import { isTerminalBookingStatus } from "@/lib/types";
import { supabaseService } from "@/lib/supabase/service";
import { tenantQuery, tenantUpdate, TenantError, type TenantContext } from "@/lib/tenant";
import { syncOrderTotals } from "@/lib/booking-service";
import { writeAudit } from "@/lib/audit";
import { tryWrite } from "@/lib/supabase/io";
import {
  evaluateBenefits, redeemMembership, redeemPromotion, reverseRedemption,
  platformConfigured, MembegoApiError,
} from "@/lib/membego-platform";
import {
  REDEEM_BLOCK_MESSAGE, REVERSAL_BLOCK_MESSAGE,
  defaultLine, discountFor, effectOf, idempotencyKeyFor, redeemBlocker,
  reversalBlocker, serviceLabel, shouldRestoreLine,
  type BenefitType, type EvaluateResult, type EvaluatedBenefit, type LineLike,
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
 *
 * Y «en el momento» quiere decir DESDE AQUÍ. Durante cinco olas el canje se hizo
 * sobre el beneficio que mandaba el navegador en el cuerpo de la petición: su
 * `eligible` y su `effect` incluidos. Eso no es preguntar en el momento, es
 * creerle al cliente su copia de la respuesta — y con ella, dejarle poner el
 * descuento. `redeemForOrder` vuelve a llamar a `evaluateBenefits` y cruza por
 * identificador contra los beneficios de ESE cliente; de la petición solo
 * sobrevive cuál.
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
  const live = rows.filter((row) => !isTerminalBookingStatus(row.status));
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

/**
 * QUÉ beneficio se quiere canjear. Y nada más que eso.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ANTES ENTRABA EL BENEFICIO ENTERO, Y VENÍA DEL NAVEGADOR
 *
 * `RedeemInput.benefit` era un `EvaluatedBenefit` completo, tal como lo mandaba
 * el cuerpo de la petición: con su `eligible` y con su `effect`. O sea que el
 * cliente decidía **si tenía derecho** y **cuánto se le rebajaba**. Un `POST`
 * con `effect: { kind: "FREE" }` sobre una promoción real de un 5 % dejaba la
 * línea en cero, MembeGo consumía el 5 % que sí existe, y el recibo de aquí
 * anotaba «FREE» con toda la cara de bueno.
 *
 * Y peor: `redeemMembership` solo manda el `membershipId`, sin el cliente. Con
 * el beneficio viniendo de fuera, cualquier identificador de membresía de esa
 * empresa valía sobre CUALQUIER venta — la membresía de un cliente pagando la
 * excursión de otro.
 *
 * El tipo es la defensa, no un comentario: si aquí solo hay `id` y `type`, no
 * hay cómo leer un `effect` de la peticion ni por descuido. El beneficio de
 * verdad se vuelve a pedir a MembeGo dentro de `redeemForOrder`.
 */
export interface BeneficioPedido {
  id: string;
  type: BenefitType;
}

export interface RedeemInput {
  orderId: string;
  benefit: BeneficioPedido;
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
 * EL BENEFICIO, TAL COMO MEMBEGO LO DESCRIBE AHORA MISMO.
 *
 * Se cruza por identificador Y por tipo contra los beneficios de ESTE cliente.
 * Cruzar por identificador solo dejaría pasar una membresía pedida como
 * promoción, y es el tipo el que decide a qué endpoint se llama.
 *
 * Devuelve `null` cuando el beneficio pedido no está entre los del cliente: eso
 * cubre de una vez el que caducó, el que ya se gastó en otra sucursal y el que
 * nunca fue suyo, y `redeemBlocker` lo cuenta como «elige el beneficio».
 */
async function beneficioVigente(
  membegoCompanyId: string,
  membegoClienteId: string,
  pedido: BeneficioPedido
): Promise<{ benefit: EvaluatedBenefit | null; evaluatedAt: string }> {
  const evaluacion = await evaluateBenefits(membegoCompanyId, membegoClienteId);
  const suyo = (evaluacion.benefits ?? []).find(
    (b) => String(b.id) === String(pedido.id) && b.type === pedido.type
  ) ?? null;
  return { benefit: suyo, evaluatedAt: evaluacion.evaluatedAt };
}

/**
 * La línea sobre la que se aplica: la pedida si SIRVE, y si no la más cara.
 *
 * Esto era `lines.find(...) ?? defaultLine(lines)`, y ese `find` a secas se
 * salta el único invariante que `defaultLine` defiende: que la línea tenga
 * importe. Una línea de cero —una cortesía, un infante solo, una que otra regla
 * ya dejó en cero— entraba como elegida, `discountFor` devolvía cero sobre ella,
 * y el canje seguía adelante: MembeGo gastaba el uso del cliente y la venta no
 * bajaba ni un peso. El cliente paga lo mismo y tiene un uso menos.
 *
 * Que la pedida no valga no es motivo para rechazar el canje: hay una línea
 * buena al lado y es la que cualquiera habría elegido a mano.
 */
function lineaElegida(lines: LineLike[], pedida?: string | null): LineLike | null {
  if (pedida) {
    const suya = lines.find((line) => line.id === pedida);
    if (suya && Number(suya.total) > 0) return suya;
  }
  return defaultLine(lines);
}

/** Lo que MembeGo contesta al consumir, en la forma que el recibo necesita. */
interface ConsumoRemoto {
  remoteId: string;
  usesLeft: number | null;
  visitId: string | null;
  ticket: string | null;
  codigo: string | null;
  unlimited: boolean;
}

async function consumirMembresia(
  membegoCompanyId: string,
  beneficio: EvaluatedBenefit,
  servicio: string,
  orderId: string,
  idempotencyKey: string
): Promise<ConsumoRemoto> {
  const result = await redeemMembership({
    membegoCompanyId,
    membershipId: beneficio.id,
    servicio,
    notas: `Venta ${orderId}`,
    idempotencyKey,
  });
  return {
    remoteId: result.redemptionId,
    // Ilimitada no son cero usos restantes: son «no aplica», y guardar cero
    // haría que la ficha del cliente dijera que se le acabó.
    usesLeft: result.unlimited ? null : result.usesLeft,
    visitId: result.visitId,
    ticket: result.ticketNumero,
    codigo: result.codigo,
    unlimited: result.unlimited,
  };
}

async function consumirPromocion(
  membegoCompanyId: string,
  beneficio: EvaluatedBenefit,
  servicio: string,
  orderId: string,
  idempotencyKey: string
): Promise<ConsumoRemoto> {
  const result = await redeemPromotion({
    membegoCompanyId,
    promotionId: beneficio.id,
    servicio,
    externalId: orderId,
    idempotencyKey,
  });
  return {
    remoteId: result.redemptionId,
    usesLeft: result.usesLeft,
    // Una promoción no deja visita ni ticket: son de la membresía.
    visitId: null, ticket: null, codigo: null, unlimited: false,
  };
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

  /**
   * ¿Ya tiene un beneficio aplicado? Cada uso es UN servicio: dos beneficios
   * sobre la misma venta consumirían dos usos por un solo servicio prestado.
   *
   * Y el error de esta lectura se mira. Descartándolo, `previous` venía `null`,
   * `alreadyRedeemed` salía `false` y la regla de «uno por venta» se apagaba
   * sola justo cuando la base va mal: dos usos del cliente por un servicio, y
   * ni un aviso. La regla no puede depender de que la consulta tenga suerte.
   */
  const { data: previous, error: errorDePrevios } = await supabaseService()
    .from("membego_redemption")
    .select("id")
    .eq("organization_id", companyId)
    .eq("order_id", input.orderId)
    .eq("status", "applied")
    .limit(1);
  if (errorDePrevios) {
    throw new TenantError(
      "No se pudo comprobar si esta venta ya tiene un beneficio aplicado: no se canjea a ciegas.",
      503
    );
  }

  /**
   * EL BENEFICIO SE LE VUELVE A PREGUNTAR A MEMBEGO, AQUÍ Y AHORA.
   *
   * La cabecera de este módulo dice que la elegibilidad no se guarda nunca y que
   * se pregunta siempre en el momento. Canjear sobre el objeto que mandó el
   * navegador no era preguntar en el momento: era creerle su copia. De la
   * petición sobrevive el `id` —qué beneficio— y todo lo demás —si sirve, qué le
   * hace a la factura, de quién es— sale de esta respuesta.
   *
   * Solo se pregunta cuando hay a quién preguntar. Sin configuración, sin enlace
   * o sin cliente en MembeGo, el beneficio se queda en `null` y `redeemBlocker`
   * dice la causa PRIMERA, que es la que el cajero puede arreglar o escalar.
   */
  const situacion = {
    configured: mb.configured,
    linked: mb.linked,
    membegoClienteId: clienteId,
    lines,
    alreadyRedeemed: (previous?.length ?? 0) > 0,
    orderStatus: order.status,
  };

  /**
   * Primero lo que se sabe sin salir de aquí, y solo después se llama.
   *
   * `redeemBlocker` sin beneficio contesta exactamente las causas que no
   * dependen de MembeGo —no configurado, no vinculado, cliente desconocido, ya
   * canjeada, venta cerrada— y `no_benefit` es la marca de que llegó hasta él.
   * Es una lista con un orden pensado y no se copia aquí: se le pregunta dos
   * veces al mismo sitio.
   *
   * Sin esto, una venta ya canjeada gastaba una llamada a MembeGo para acabar
   * contestando lo que ya se sabía — y si MembeGo estaba caído, contestaba «no
   * hay conexión» en vez de «esta venta ya tiene un beneficio aplicado», que es
   * lo que el cajero necesita leer para cobrar completo y seguir.
   */
  const antesDeLlamar = redeemBlocker({ ...situacion, benefit: null, evaluatedAt: "" });
  if (antesDeLlamar && antesDeLlamar !== "no_benefit") {
    throw new TenantError(
      REDEEM_BLOCK_MESSAGE[antesDeLlamar],
      antesDeLlamar === "already_redeemed" ? 409 : 400
    );
  }

  const vigente = await beneficioVigente(mb.membegoCompanyId as string, clienteId as string, input.benefit);

  const block = redeemBlocker({
    ...situacion,
    benefit: vigente.benefit,
    evaluatedAt: vigente.evaluatedAt,
  });
  if (block) throw new TenantError(REDEEM_BLOCK_MESSAGE[block], block === "already_redeemed" ? 409 : 400);

  const beneficio = vigente.benefit as EvaluatedBenefit;
  const chosen = lineaElegida(lines, input.bookingId);
  if (!chosen) throw new TenantError(REDEEM_BLOCK_MESSAGE.no_line, 400);

  const effect = effectOf(beneficio);
  const discount = discountFor(effect, chosen.total);
  const idempotencyKey = idempotencyKeyFor(input.orderId, beneficio.id);
  const servicio = serviceLabel(chosen.label);

  // ── 1. Consumir en MembeGo. Si esto falla, la venta no se toca. ─────────
  let consumo: ConsumoRemoto;
  try {
    consumo = beneficio.type === "MEMBERSHIP"
      ? await consumirMembresia(mb.membegoCompanyId as string, beneficio, servicio, input.orderId, idempotencyKey)
      : await consumirPromocion(mb.membegoCompanyId as string, beneficio, servicio, input.orderId, idempotencyKey);
  } catch (err) {
    // El intento fallido también se guarda: sin él, un «no me aplicó el
    // descuento» no tiene dónde mirarse, y el motivo real de MembeGo se pierde.
    await recordFailure(companyId, ctx.userId, {
      beneficio, order, chosen, effect, idempotencyKey, clienteId, membegoCompanyId: mb.membegoCompanyId, err,
    });
    throw err;
  }
  const { remoteId, usesLeft } = consumo;

  /**
   * EL USO YA SE GASTÓ. SI EL RECIBO NO SE PUEDE ESCRIBIR, NO SE MIENTE SOBRE ÉL.
   *
   * Esto estaba dentro del mismo `try` que la llamada a MembeGo, así que un fallo
   * al escribir el recibo —la base caída, una columna que no cuadra— caía en el
   * mismo `catch` y se anotaba como canje **fallido**. Y un canje fallido dice
   * exactamente lo contrario de lo que había pasado: que no se consumió nada.
   * Con esa fila delante, nadie va a ir a devolverle al cliente el uso que sí
   * perdió, porque el registro asegura que no lo perdió.
   *
   * Ahora son dos pasos. Si el segundo falla, queda una fila de auditoría con el
   * identificador del canje REMOTO —que es lo único con lo que se puede cuadrar
   * o revertir a mano— y se lanza: sin recibo no se rebaja la venta, porque la
   * regla de este módulo es que cada descuento tenga detrás un recibo.
   */
  try {
    await recordRedemption(companyId, ctx.userId, {
      beneficio, order, chosen, effect, discount, idempotencyKey,
      clienteId: clienteId as string, membegoCompanyId: mb.membegoCompanyId, ...consumo,
    });
  } catch (err) {
    await writeAudit({
      companyId, userId: ctx.userId,
      action: "membego_redemption_orphan",
      entityType: "order", entityId: input.orderId,
      severity: "warning",
      description:
        `MembeGo consumió el beneficio «${beneficio.nombre}» (canje ${remoteId}) y el recibo no se pudo guardar: ` +
        "el cliente perdió el uso y la venta NO se rebajó. Hay que devolverlo desde el panel de MembeGo.",
      metadata: {
        benefit_id: beneficio.id, benefit_type: beneficio.type, redemption_id: remoteId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw new TenantError(
      "MembeGo consumió el beneficio pero no se pudo guardar el recibo, así que la venta no se ha rebajado. " +
      "Está anotado en la auditoría con el número de canje para devolverlo.",
      500
    );
  }

  // ── 2. Ahora sí: rebajar la línea y recalcular la venta. ────────────────
  const row = rows.find((r) => r._id === chosen.id);
  if (discount > 0 && row) {
    await tenantUpdate(companyId, "booking", chosen.id, {
      discount_amount: round2(Number(row.discount_amount ?? 0) + discount),
      total_amount: round2(Math.max(0, Number(row.total_amount ?? 0) - discount)),
      membego_benefit: beneficio.nombre,
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
    description: `Beneficio MembeGo canjeado: ${beneficio.nombre} · −${discount}`,
    metadata: {
      benefit_id: beneficio.id, benefit_type: beneficio.type,
      redemption_id: remoteId, discount, booking: chosen.id, uses_left: usesLeft,
    },
  });

  const refreshed = await loadOrderTotal(companyId, input.orderId);
  return {
    redemptionId: remoteId,
    benefitName: beneficio.nombre,
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
  beneficio: EvaluatedBenefit;
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
    benefit_type: r.beneficio.type,
    benefit_id: r.beneficio.id,
    benefit_name: r.beneficio.nombre,
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
    beneficio: EvaluatedBenefit; order: OrderRow; chosen: LineLike; effect: ReturnType<typeof effectOf>;
    idempotencyKey: string; clienteId: string | null; membegoCompanyId: string | null; err: unknown;
  }
): Promise<void> {
  const api = r.err instanceof MembegoApiError ? r.err : null;
  // La fila del canje FALLIDO es lo único que quedará de él: si tampoco se
  // puede escribir, al menos que conste en el registro. No se lanza porque
  // quien llama ya está gestionando un fallo.
  await tryWrite("anotar el canje fallido", supabaseService().from("membego_redemption").insert({
    organization_id: companyId,
    order_id: r.order.id,
    booking_id: r.chosen.id,
    customer_id: r.order.customer_id,
    membego_cliente_id: r.clienteId ?? "",
    membego_company_id: r.membegoCompanyId,
    benefit_type: r.beneficio.type,
    benefit_id: r.beneficio.id,
    benefit_name: r.beneficio.nombre,
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
  }));
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
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y SE DEVUELVE LO DE LA RESERVA QUE SE CAE, NO LO DE LA VENTA ENTERA
 *
 * Esto barría todos los canjes aplicados de la orden. Quien lo llama es la
 * cancelación de UNA reserva, así que en una venta de tres excursiones —una
 * familia que se baja de la del jueves y hace las otras dos— la reversa se
 * llevaba el beneficio aplicado a una línea que sigue viva: MembeGo le devolvía
 * el uso al cliente, `restoreLine` le subía otra vez el importe a esa línea, y
 * el total de la venta SUBÍA después de una cancelación. Si esa línea ya estaba
 * pagada o ya se prestó, la operadora regaló el servicio y el uso volvió a la
 * cuenta del cliente.
 *
 * Con `bookingId` se devuelve solo lo suyo. Los canjes sin reserva anotada —de
 * antes de que la columna se llenara— se devuelven igual: no se puede saber de
 * quién son, y dejar un beneficio sin devolver es peor que devolverlo de más.
 */
export async function reverseForOrder(
  companyId: string,
  orderId: string,
  reason: string,
  userId = "",
  bookingId?: string | null
): Promise<ReversalOutcome[]> {
  const { data, error } = await supabaseService()
    .from("membego_redemption")
    .select("id,redemption_id,status,benefit_type,benefit_name,membego_company_id,booking_id,amount_discounted")
    .eq("organization_id", companyId)
    .eq("order_id", orderId)
    .eq("status", "applied")
    .limit(10);

  /**
   * Una lectura que falla NO es «no había nada que devolver».
   *
   * Descartando el error, `data` venía `null`, esto devolvía una lista vacía y
   * quien llama —que recorre la lista buscando avisos— no encontraba ninguno.
   * La cancelación seguía tan contenta y el cliente se quedaba sin su uso, sin
   * una línea en la auditoría ni en la consola. Aquí sí se dice, y se dice como
   * lo que es: algo que hay que devolver a mano.
   */
  if (error) {
    await writeAudit({
      companyId, userId,
      action: "membego_reversal_failed",
      entityType: "order", entityId: orderId,
      severity: "warning",
      description: `No se pudo leer si esta venta tenía beneficios de MembeGo que devolver: ${error.message}`,
      metadata: { booking: bookingId ?? null },
    });
    return [{
      reversed: false, manual: true, restored: 0,
      message: "No se pudo comprobar si había un beneficio de MembeGo que devolver: revísalo en su panel.",
    }];
  }

  const todos = data ?? [];
  const rows = bookingId
    ? todos.filter((row) => !row.booking_id || String(row.booking_id) === String(bookingId))
    : todos;
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
      await tryWrite("anotar que la reversa hay que hacerla a mano",
        supabaseService().from("membego_redemption").update({
          reverse_reason: `${reason} · ${REVERSAL_BLOCK_MESSAGE[block]}`,
        }).eq("organization_id", companyId).eq("id", row.id));

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
      /**
       * MembeGo YA revirtió el beneficio por su API. Si esta fila se queda sin
       * marcar, la nuestra sigue diciendo «canjeado» y una segunda cancelación
       * volvería a pedir la reversa de algo ya revertido. No se lanza —tumbar
       * la cancelación aquí sería peor, el beneficio ya volvió— pero queda
       * escrito con el identificador para poder cuadrarlo a mano.
       */
      const marcado = await tryWrite(`marcar como revertido el canje ${row.id}`,
        supabaseService().from("membego_redemption").update({
          status: "reversed", reversed_at: new Date().toISOString(), reverse_reason: reason,
        }).eq("organization_id", companyId).eq("id", row.id));
      if (!marcado) {
        console.error(`[membego] el beneficio del canje ${row.id} se revirtió en MembeGo pero la fila local sigue activa: hay que cuadrarlo a mano`);
      }

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
