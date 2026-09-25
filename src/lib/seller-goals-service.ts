import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { tenantCreate, tenantQuery, tenantUpdate, type TenantContext } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import {
  rangeOf, progressOf, isAchieved, overallPct, achievementSnapshot,
  bonusTotals, normalizePayoutKind,
  type Actuals, type GoalRow, type ProgressLine, type DateRange, type BonusTotals,
} from "@/lib/seller-goals";
import type { Currency } from "@/lib/types";
import { limitesConsulta } from "@/lib/report";
import { companyTimeZone } from "@/lib/time";

/**
 * Las metas contra la base.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO REAL SE MIDE DE DONDE YA ESTÁ
 *
 * No hay contadores que mantener: los clientes captados salen del embudo
 * (0058), y las reservas, ventas, pasajeros e ingresos salen de las reservas.
 * Un contador denormalizado sería un segundo sitio donde se decide si alguien
 * cobra su premio, y el día que se desincronice nadie lo notaría — porque nadie
 * mira un contador, solo la barra que pinta.
 */

/** Tope de filas por consulta: un tablero que tarda un minuto no se mira. */
export const MAX_GOAL_ROWS = 5000;

/**
 * Las reservas que cuentan.
 *
 * Una reserva en borrador o cancelada no es una venta, y contarla haría que un
 * vendedor llegara a su meta creando reservas que nunca se cobran. `pending`
 * tampoco entra: todavía no hay nada.
 */
export const COUNTED_BOOKING = [
  "confirmed", "partially_paid", "paid", "checked_in", "completed",
] as const;

/** Las que además cuentan como VENTA cerrada: hay dinero de verdad. */
export const CLOSED_BOOKING = ["paid", "checked_in", "completed"] as const;

export interface GoalScope {
  sellerId?: string | null;
  sellerTypeId?: string | null;
  branchId?: string | null;
  productId?: string | null;
  categoryId?: string | null;
}

/**
 * Qué vendedores entran en el alcance de una meta.
 *
 * Una meta por tipo —«los hoteles»— o por sucursal cubre a varias personas, y
 * el progreso es el del grupo. Devolver `null` significa «toda la red», que es
 * lo que pasa cuando la meta no acota a nadie.
 */
async function sellersInScope(companyId: string, scope: GoalScope): Promise<string[] | null> {
  if (scope.sellerId) return [scope.sellerId];
  if (!scope.sellerTypeId && !scope.branchId) return null;

  let query = supabaseService()
    .from("seller")
    .select("id")
    .eq("organization_id", companyId)
    .limit(MAX_GOAL_ROWS);
  if (scope.sellerTypeId) query = query.eq("seller_type_id", scope.sellerTypeId);
  if (scope.branchId) query = query.eq("branch_id", scope.branchId);

  const { data, error } = await query;
  // Sin esto, un fallo de lectura devuelve «este alcance no cubre a nadie» y
  // TODAS las metas de grupo salen al 0 % en el tablero, sin una línea en
  // ningún sitio que lo explique.
  if (error) {
    console.error(`[metas] no se pudo resolver el alcance de la meta en ${companyId}: ${error.message}`);
  }
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Lo conseguido de verdad en un rango.
 *
 * Los captados salen del embudo y el resto de las reservas. Son dos fuentes
 * porque son dos cosas distintas: captar a alguien que no compra sigue siendo
 * trabajo, y es justamente lo que una meta de captación quiere premiar.
 */
/**
 * EL DÍA DE LA META ES EL DE LA EMPRESA, NO EL DEL SERVIDOR.
 *
 * El rango salía como `${range.from}T00:00:00.000Z` … `T23:59:59.999Z`, o sea
 * cortado en UTC. Una venta de las 21:00 del 30 de septiembre en Santo Domingo
 * son las 01:00 UTC del 1 de octubre: quedaba FUERA de la meta de septiembre, y
 * dentro entraban las ventas de las últimas cuatro horas del 31 de agosto. El
 * vendedor pierde de su premio lo que vendió la última noche —que es cuando se
 * vende— y se le apunta lo que hizo la víspera del primer día.
 *
 * Aquí no es una imprecisión de informe: de este número depende si alguien
 * cobra un bono. Se corta con el mismo ayudante semiabierto que usan todos los
 * listados. Sin zona declarada se cae al corte de antes.
 */
function limitesDelRango(range: DateRange, timeZone?: string | null): { from: string; to: string } {
  if (!timeZone) {
    return { from: `${range.from}T00:00:00.000Z`, to: `${range.to}T23:59:59.999Z` };
  }
  const { gte, lt } = limitesConsulta({ desde: range.from, hasta: range.to }, timeZone);
  return { from: gte, to: lt };
}

export async function actualsFor(
  companyId: string,
  scope: GoalScope,
  range: DateRange,
  timeZone?: string | null
): Promise<Actuals> {
  const sellers = await sellersInScope(companyId, scope);
  // Un alcance que no cubre a nadie —un tipo de vendedor sin gente— tiene sus
  // cifras en cero, no las de toda la empresa.
  if (sellers !== null && sellers.length === 0) {
    return { signups: 0, bookings: 0, sales: 0, pax: 0, revenue: 0 };
  }

  const { from, to } = limitesDelRango(range, timeZone);
  const sb = supabaseService();

  // ── captados: el embudo (0058) ────────────────────────────────────────────
  let signupQuery = sb
    .from("seller_attribution")
    .select("customer_id, visitor_id")
    .eq("organization_id", companyId)
    .eq("stage", "signup")
    .gte("created_at", from)
    // Menor ESTRICTO: `limitesConsulta` devuelve el instante del día siguiente,
    // que no pertenece al rango. Con `lte` entraría el primer momento del día
    // de después, y una venta de medianoche contaría en dos metas.
    .lt("created_at", to)
    .limit(MAX_GOAL_ROWS);
  if (sellers) signupQuery = signupQuery.in("seller_id", sellers);
  const { data: signupRows, error: errorDeCaptados } = await signupQuery;
  if (errorDeCaptados) {
    console.error(`[metas] no se pudieron leer los captados: ${errorDeCaptados.message}`);
  }

  // Personas, no eventos: el mismo cliente captado dos veces es uno.
  const captados = new Set<string>();
  for (const row of signupRows ?? []) {
    const who = (row.customer_id as string) || (row.visitor_id as string);
    if (who) captados.add(who);
  }

  // ── reservas, ventas, pasajeros e ingresos ───────────────────────────────
  //
  // Se filtra por FECHA DE VENTA (`created_at`) y no por fecha de viaje: la
  // meta de septiembre premia lo que se vendió en septiembre, aunque el grupo
  // viaje en enero.
  let bookingQuery = sb
    .from("booking")
    .select("id, status, adults, children, infants, total_amount, currency, seller_id, product_id")
    .eq("organization_id", companyId)
    .in("status", COUNTED_BOOKING as unknown as string[])
    .gte("created_at", from)
    .lt("created_at", to)
    .limit(MAX_GOAL_ROWS);
  if (sellers) bookingQuery = bookingQuery.in("seller_id", sellers);
  if (scope.productId) bookingQuery = bookingQuery.eq("product_id", scope.productId);
  const { data: bookingRows, error: errorDeReservas } = await bookingQuery;
  // Cero por una lectura rota es una meta que parece sin empezar. No bloquea
  // —el bono lo otorga una persona— pero tiene que poder mirarse.
  if (errorDeReservas) {
    console.error(`[metas] no se pudieron leer las reservas de la meta: ${errorDeReservas.message}`);
  }

  let rows = bookingRows ?? [];

  // La categoría no está en la reserva: se resuelve por producto, y solo si la
  // meta la pide — una consulta de más en cada tablero no compensa.
  if (scope.categoryId) {
    const productIds = [...new Set(rows.map((r) => r.product_id as string).filter(Boolean))];
    if (productIds.length === 0) rows = [];
    else {
      const { data: products } = await sb
        .from("product")
        .select("id")
        .eq("organization_id", companyId)
        .eq("category_id", scope.categoryId)
        .in("id", productIds);
      const wanted = new Set((products ?? []).map((p) => p.id as string));
      rows = rows.filter((r) => wanted.has(r.product_id as string));
    }
  }

  let pax = 0;
  let revenue = 0;
  let sales = 0;
  for (const row of rows) {
    // Los bebés viajan gratis pero ocupan asiento y van en el manifiesto: para
    // una meta de pasajeros son personas que el vendedor trajo.
    pax += Number(row.adults ?? 0) + Number(row.children ?? 0) + Number(row.infants ?? 0);
    revenue += Number(row.total_amount ?? 0);
    if ((CLOSED_BOOKING as readonly string[]).includes(String(row.status))) sales += 1;
  }

  return {
    signups: captados.size,
    bookings: rows.length,
    sales,
    pax,
    revenue: Math.round(revenue * 100) / 100,
  };
}

export interface GoalProgress {
  goal: GoalRow & { _id: string; seller?: unknown; seller_type?: unknown; product?: unknown };
  range: DateRange;
  lines: ProgressLine[];
  achieved: boolean;
  overall: number | null;
}

/** El progreso de todas las metas vivas de una empresa. */
export async function goalsWithProgress(
  companyId: string,
  options: { sellerId?: string | null; now?: Date; timeZone?: string | null } = {}
): Promise<GoalProgress[]> {
  const filter: Record<string, unknown> = { status: "active" };
  const goals = await tenantQuery<GoalProgress["goal"]>(companyId, "seller_goal", {
    _filter: filter,
    _sort: { created_at: "desc" },
    _limit: 200,
    seller: true,
    seller_type: true,
    product: true,
  } as never);

  const out: GoalProgress[] = [];
  for (const goal of goals) {
    const scope: GoalScope = {
      sellerId: refOf(goal.seller),
      sellerTypeId: refOf(goal.seller_type),
      productId: refOf(goal.product),
    };
    // Filtrar por vendedor es filtrar por metas que le APLIQUEN: una meta de
    // «todos los hoteles» también es suya.
    if (options.sellerId && scope.sellerId && scope.sellerId !== options.sellerId) continue;

    const range = rangeOf(goal, options.now);
    const actuals = await actualsFor(companyId, scope, range, options.timeZone);
    const lines = progressOf(goal, actuals);
    out.push({ goal, range, lines, achieved: isAchieved(lines), overall: overallPct(lines) });
  }

  // Lo más cerca de cumplirse, arriba: es donde un empujón cambia algo.
  return out.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
}

function refOf(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object") {
    const id = (value as Record<string, unknown>)._id ?? (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/* ------------------------------------------------------------------ bonos */

export interface AwardInput {
  goalId: string;
  sellerId: string;
  amount: number;
  payoutKind?: string | null;
  description?: string | null;
  currency?: Currency;
}

/**
 * Otorga el bono de una meta cumplida.
 *
 * NO se otorga solo: lo hace una persona. Un bono automático sobre una meta que
 * alguien editó a la baja el día 30 se pagaría sin que nadie lo mirara, y esa
 * es exactamente la clase de premio que acaba en una discusión.
 *
 * Lo que sí es automático es la CONDICIÓN CONGELADA: se guarda lo que la meta
 * pedía y lo que se alcanzó aquel día, porque dentro de seis meses la meta
 * puede estar editada o borrada.
 */
export async function awardGoalBonus(
  ctx: TenantContext & { companyId: string },
  input: AwardInput
): Promise<{ bonusId: string }> {
  const [goal] = await tenantQuery<GoalProgress["goal"]>(ctx.companyId, "seller_goal", {
    _filter: { _id: input.goalId }, _limit: 1, seller: true, seller_type: true, product: true,
  } as never);
  if (!goal) throw Object.assign(new Error("La meta no existe"), { status: 404 });

  /**
   * EL ALCANCE ES EL DE LA META, NO EL QUE VENGA EN LA PETICIÓN.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * LO QUE PASABA
   *
   * Aquí se armaba `{ sellerId: input.sellerId, productId: ... }`, tirando el
   * `seller_type` de la meta y sustituyendo su vendedor por el del cuerpo de la
   * petición. Dos cosas, las dos caras:
   *
   *  · una meta de UN vendedor se podía cobrar a nombre de OTRO. El
   *    `goal.seller` no se comparaba con `input.sellerId` en ningún sitio: si
   *    el segundo daba los números por su cuenta, se le pagaba un premio que no
   *    era suyo;
   *  · y una meta de GRUPO —«los hoteles», una sucursal— se juzgaba contra las
   *    cifras de una sola persona, así que el tablero y el botón de otorgar
   *    decidían cosas distintas sobre la misma meta. Es exactamente lo que el
   *    comentario de `attachBonusesToSettlement` dice que no puede pasar: dos
   *    sitios calculando el mismo total acaban discrepando.
   *
   * El alcance se arma igual que en el tablero, y el vendedor que cobra tiene
   * que estar DENTRO de él.
   */
  const scope: GoalScope = {
    sellerId: refOf(goal.seller),
    sellerTypeId: refOf(goal.seller_type),
    productId: refOf(goal.product),
  };
  const alcanzados = await sellersInScope(ctx.companyId, scope);
  if (alcanzados !== null && !alcanzados.includes(input.sellerId)) {
    throw Object.assign(
      new Error("Ese vendedor no entra en el alcance de esta meta."),
      { status: 409 }
    );
  }

  const range = rangeOf(goal);
  const actuals = await actualsFor(
    ctx.companyId, scope, range,
    companyTimeZone(ctx.company as { timezone?: string | null } | null)
  );
  const lines = progressOf(goal, actuals);

  if (!isAchieved(lines)) {
    throw Object.assign(
      new Error("Esta meta todavía no está cumplida en todas sus dimensiones."),
      { status: 409 }
    );
  }

  // Un mismo vendedor no cobra dos veces la misma meta. Sin esto, dos clics
  // seguidos —o un reintento— otorgarían el premio dos veces.
  const existing = await tenantQuery<{ _id: string }>(ctx.companyId, "seller_bonus", {
    _filter: { goal: input.goalId, seller: input.sellerId, status: { ne: "cancelled" } },
    _limit: 1,
  });
  if (existing.length > 0) {
    throw Object.assign(new Error("Este vendedor ya tiene el bono de esta meta."), { status: 409 });
  }

  const bonus = await tenantCreate<{ _id: string }>(ctx.companyId, "seller_bonus", {
    seller: input.sellerId,
    goal: input.goalId,
    description: input.description?.trim() || goal.reward?.trim() || `Meta cumplida: ${goal.name || "sin nombre"}`,
    condition: JSON.stringify(achievementSnapshot(goal, lines, range)),
    amount: Math.max(0, Math.round(Number(input.amount || 0) * 100) / 100),
    currency: input.currency || (goal.currency as Currency) || "usd",
    payout_kind: normalizePayoutKind(input.payoutKind),
    status: "pending",
    approved_by: ctx.userId || undefined,
  });

  await writeAudit({
    companyId: ctx.companyId,
    userId: ctx.userId,
    action: "seller_bonus_awarded",
    entityType: "seller_bonus",
    entityId: bonus._id,
    description:
      `Bono otorgado por la meta «${goal.name || "sin nombre"}» (${range.from} → ${range.to}): ` +
      `${input.amount} ${normalizePayoutKind(input.payoutKind) === "in_kind" ? "en especie" : "en efectivo"}.`,
    metadata: { goal: input.goalId, seller: input.sellerId, amount: input.amount },
  });

  return { bonusId: bonus._id };
}

/** Los bonos vivos de un vendedor, ya separados en efectivo y especie. */
export async function bonusesOf(
  companyId: string,
  sellerId: string
): Promise<{ totals: BonusTotals; rows: Record<string, unknown>[] }> {
  const rows = await tenantQuery<Record<string, unknown>>(companyId, "seller_bonus", {
    _filter: { seller: sellerId },
    _sort: { awarded_at: "desc" },
    _limit: 200,
  });
  return { totals: bonusTotals(rows as never), rows };
}

/**
 * Engancha a una liquidación los bonos aprobados de un vendedor.
 *
 * Solo los engancha y devuelve sus totales separados: NO escribe los importes
 * de la liquidación. Quien los escribe es quien la genera, y tiene que ser uno
 * solo — dos sitios calculando el mismo total acaban discrepando, y la
 * diferencia aparece en el banco y no en ninguna pantalla.
 */
export async function attachBonusesToSettlement(
  ctx: TenantContext & { companyId: string },
  settlementId: string,
  sellerId: string
): Promise<BonusTotals> {
  const pending = await tenantQuery<{ _id: string }>(ctx.companyId, "seller_bonus", {
    _filter: { seller: sellerId, status: "approved" },
    _limit: 200,
  });

  for (const bonus of pending) {
    await tenantUpdate(ctx.companyId, "seller_bonus", bonus._id, {
      settlement: settlementId,
      status: "settled",
    });
  }

  /**
   * Y SE SUMAN LOS DE ESTA LIQUIDACIÓN, NO TODOS LOS DEL VENDEDOR.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * LO QUE PASABA, Y SALÍA POR EL BANCO
   *
   * Esto llamaba a `bonusesOf(sellerId)`, que lee los doscientos bonos más
   * recientes de esa persona —de cualquier liquidación y de cualquier fecha— y
   * `bonusTotals` cuenta todo lo que esté `approved` **o `settled`**. O sea que
   * los bonos ya pagados en liquidaciones ANTERIORES volvían a sumarse aquí.
   *
   * Y de aquí sale `pending_total`, que es lo que se transfiere: la segunda
   * liquidación de un vendedor le pagaba otra vez los bonos de la primera, la
   * tercera los de las dos, y así. Nadie lo ve, porque cada liquidación por
   * separado cuadra consigo misma.
   *
   * El comentario que había decía que se leían después «porque antes del update
   * no contarían», y no era verdad por partida doble: `approved` ya contaba, y
   * lo que sobraba no era lo de antes del update sino lo de otras
   * liquidaciones. Se leen por `settlement`, que es la pregunta de verdad: qué
   * paga ESTA.
   */
  const deEsta = await tenantQuery<Record<string, unknown>>(ctx.companyId, "seller_bonus", {
    _filter: { seller: sellerId, settlement: settlementId },
    _limit: 200,
  });
  return bonusTotals(deEsta as never);
}
