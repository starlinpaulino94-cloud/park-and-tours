import "server-only";
import { tenantCreate, tenantFindOne, tenantQuery, tenantUpdate } from "@/lib/tenant";
import { supabaseServer } from "@/lib/supabase/server";
import { loadCostTariffs } from "@/lib/pricing";
import {
  costLines, costTotal, retentionsFor, settlementTotals, reconcile,
  type CostLine, type Retentions,
} from "@/lib/supplier-settlement";
import { newSettlementCode, newDocumentNumber } from "@/lib/codes";
import { projectRow, type ProjectionCtx } from "@/lib/field-projection";
import type { Booking, Settlement, Supplier } from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * El devengo y la liquidación de proveedores, contra la base.
 *
 * Dos decisiones de fondo:
 *
 *  · **El devengo se escribe al vender, no al liquidar.** Si se calculara el
 *    viernes recorriendo las reservas de la semana, una tarifa que cambió el
 *    miércoles se aplicaría a lo operado el lunes. Lo que se le debe al
 *    proveedor es lo que costaba EL DÍA que se operó, así que se congela
 *    entonces —igual que el precio de venta.
 *
 *  · **La liquidación reclama sus líneas.** Cada devengo se enlaza a la
 *    liquidación en el momento de incluirlo, no después: sin ese enlace, dos
 *    generaciones simultáneas o un reintento a medias incluirían el mismo
 *    servicio dos veces y se le pagaría doble al proveedor.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * RECLAMAR UN DEVENGO, CON LA CONDICIÓN DENTRO DE LA ESCRITURA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTA CON RELEERLO ANTES
 *
 * Antes se releía el devengo y, si seguía reclamable, se escribía. Eso ESTRECHA
 * la ventana y no la cierra: entre la lectura y la escritura cabe otra
 * liquidación. Probado — la segunda pisaba el enlace de la primera y contaba el
 * importe igual, así que el mismo viaje salía en dos liquidaciones y al
 * transportista se le pagaba dos veces.
 *
 * Sin transacciones, lo único que cierra la ventana es que la CONDICIÓN viaje
 * dentro de la misma sentencia: `update … where id = ? and status in (…)`. Si
 * otro llegó antes, el `where` ya no encuentra nada y vuelve vacío. Postgres
 * resuelve el desempate, que es donde se puede resolver.
 *
 * Y lo que se cuenta es lo que la BASE dice que cambió, no lo que se leyó
 * antes: el importe sale de la fila devuelta.
 */
async function claimCost(
  companyId: string,
  costId: string,
  settlementId: string
): Promise<{ amount: number } | null> {
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from("booking_cost")
    .update({ status: "settled", settlement_id: settlementId })
    .eq("organization_id", companyId)
    .eq("id", costId)
    // La condición. Sin ella esto es un `last write wins`, que aquí significa
    // pagar dos veces.
    .in("status", [...CLAIMABLE])
    .select("id,amount");

  if (error) {
    console.error(`[liquidación] no se pudo reclamar el devengo ${costId}:`, error.message);
    return null;
  }
  const fila = (data ?? [])[0] as { amount?: number } | undefined;
  return fila ? { amount: Number(fila.amount ?? 0) } : null;
}

/** Estados de un devengo que ya no espera pago. */
const DEAD_COST = new Set(["cancelled", "waived"]);
/** Estados que una liquidación puede reclamar. */
const CLAIMABLE = new Set(["accrued", "confirmed", "disputed"]);

export interface AccrualInput {
  bookingId: string;
  productId: string;
  departureId?: string | null;
  /** Pax que consumen el servicio: los que pagan. */
  pax: number;
  /** Vehículos asignados a la salida, si se conocen. */
  vehicles?: number | null;
  /** Venta bruta de la línea, para las tarifas por porcentaje. */
  revenue?: number;
  currency: string;
}

/**
 * Anota lo que esta reserva le debe a cada proveedor.
 *
 * Es idempotente por reserva: si ya hay devengos, no se duplican. Una reserva se
 * crea una vez, pero esta función también la llama la reconstrucción de las
 * ventas anteriores a 0040, que no tenían devengo alguno.
 */
export async function accrueBookingCosts(
  companyId: string,
  input: AccrualInput
): Promise<{ lines: CostLine[]; total: number; created: number }> {
  const existing = await tenantQuery<{ _id: string; status?: string }>(companyId, "booking_cost", {
    _filter: { booking: input.bookingId }, _limit: 50,
  });
  if (existing.some((row) => !DEAD_COST.has(row.status || ""))) {
    return { lines: [], total: 0, created: 0 };
  }

  const tariffs = await loadCostTariffs(companyId, input.productId);
  const lines = costLines(
    tariffs,
    {
      pax: input.pax,
      groups: 1,
      ...(input.vehicles === null || input.vehicles === undefined ? {} : { vehicles: input.vehicles }),
      revenue: input.revenue ?? 0,
    },
    input.currency
  );
  if (lines.length === 0) return { lines: [], total: 0, created: 0 };

  let created = 0;
  for (const line of lines) {
    await tenantCreate(companyId, "booking_cost", {
      booking: input.bookingId,
      departure: input.departureId || undefined,
      supplier: line.supplierId || undefined,
      product_cost: line.tariffId || undefined,
      concept: line.concept,
      cost_type: line.costType,
      quantity: line.quantity,
      unit_cost: line.unitCost,
      amount: line.amount,
      currency: line.currency,
      status: "accrued",
    });
    created++;
  }

  const total = costTotal(lines);
  await tenantUpdate(companyId, "booking", input.bookingId, { accrued_cost: total });
  return { lines, total, created };
}

/**
 * Cancela el devengo de una reserva que ya no se va a operar.
 *
 * Una reserva cancelada no le debe nada al transportista, y dejar el devengo
 * vivo se lo pagaría en la liquidación del viernes.
 */
export async function cancelBookingCosts(
  companyId: string,
  bookingId: string,
  reason = "Reserva cancelada"
): Promise<number> {
  const rows = await tenantQuery<{ _id: string; status?: string }>(companyId, "booking_cost", {
    _filter: { booking: bookingId }, _limit: 50,
  });
  let cancelled = 0;
  for (const row of rows) {
    // Un servicio ya liquidado o pagado no se toca: el dinero salió.
    if (["settled", "paid"].includes(row.status || "")) continue;
    if (DEAD_COST.has(row.status || "")) continue;
    await tenantUpdate(companyId, "booking_cost", row._id, { status: "cancelled", notes: reason });
    cancelled++;
  }
  if (cancelled > 0) await tenantUpdate(companyId, "booking", bookingId, { accrued_cost: 0 });
  return cancelled;
}

/* --------------------------------------------------------- la liquidación */

export interface GenerateInput {
  supplierId: string;
  from: Date;
  to: Date;
  notes?: string | null;
  userId?: string;
}

export interface GenerateResult {
  settlement: Settlement;
  claimed: number;
  services: number;
  currency: string;
}

/**
 * Agrupa lo devengado de un proveedor en un período y crea su liquidación.
 *
 * El período se mide por la fecha de la SALIDA, no por la de la reserva: al
 * proveedor se le paga por lo que operó esta semana, no por lo que se vendió.
 */
export async function generateSupplierSettlement(
  companyId: string,
  input: GenerateInput
): Promise<GenerateResult> {
  const supplier = await tenantFindOne<Supplier>(companyId, "supplier", input.supplierId);

  const candidates = await tenantQuery<Record<string, unknown> & { _id: string }>(
    companyId, "booking_cost", {
      _filter: { supplier: input.supplierId, status: { in: [...CLAIMABLE] } },
      _limit: 1000,
      _sort: { createdAt: "asc" },
      booking: true,
      departure: true,
    }
  );

  // El filtro por fecha de salida se hace aquí y no en la consulta porque la
  // fecha vive en la salida, no en el devengo, y un servicio sin salida
  // (una tarifa fija de la reserva) se fecha por la reserva.
  const inPeriod = candidates.filter((row) => {
    const departure = row.departure as { departure_at?: string } | null;
    const booking = row.booking as { travel_date?: string; createdAt?: string } | null;
    const when = departure?.departure_at || booking?.travel_date || booking?.createdAt;
    if (!when) return false;
    const date = new Date(when);
    return date >= input.from && date <= input.to;
  });

  if (inPeriod.length === 0) {
    throw Object.assign(
      new Error("No hay servicios pendientes de liquidar a este proveedor en el período"),
      { status: 404 }
    );
  }

  const currency = String(
    inPeriod[0].currency || supplier.currency || "usd"
  ).toLowerCase();

  // Una liquidación no puede mezclar monedas: pagarle al proveedor en un solo
  // importe lo que se le debe en pesos y en dólares es inventarse una tasa.
  const other = inPeriod.find((row) => String(row.currency || currency).toLowerCase() !== currency);
  if (other) {
    throw Object.assign(
      new Error(
        `Este proveedor tiene servicios en ${currency.toUpperCase()} y en ` +
        `${String(other.currency).toUpperCase()}. Liquida cada moneda por separado.`
      ),
      { status: 409 }
    );
  }

  // La cáscara primero, para que cada devengo se enlace al reclamarlo.
  const settlement = await tenantCreate<Settlement>(companyId, "settlement", {
    code: newSettlementCode(),
    beneficiary_type: "supplier",
    supplier: input.supplierId,
    beneficiary_name: supplier.name,
    period_from: input.from.toISOString(),
    period_to: input.to.toISOString(),
    services_total: 0, confirmed_total: 0, adjustments_total: 0,
    retention_isr: 0, retention_itbis: 0, retention_total: 0,
    net_total: 0, base_total: 0, commission_total: 0, paid_total: 0, pending_total: 0,
    currency,
    status: "pending",
    issued_at: new Date().toISOString(),
    notes: input.notes || undefined,
  });

  let services = 0;
  let claimed = 0;
  for (const row of inPeriod) {
    // La condición va DENTRO de la escritura: si otra liquidación llegó antes,
    // esto vuelve vacío y el devengo no se cuenta. Ver `claimCost`.
    const mio = await claimCost(companyId, row._id, String(settlement._id));
    if (!mio) continue;
    services += mio.amount;
    claimed++;
  }

  if (claimed === 0) {
    await tenantUpdate(companyId, "settlement", settlement._id, {
      status: "void", notes: "Sin servicios que liquidar",
    });
    throw Object.assign(new Error("Los servicios ya fueron liquidados"), { status: 409 });
  }

  const retentions = retentionsFor(supplier, services);
  const totals = settlementTotals({ services, retentions });

  await tenantUpdate(companyId, "settlement", settlement._id, {
    services_total: totals.services,
    confirmed_total: 0,
    base_total: retentions.base,
    retention_isr: retentions.isr,
    retention_itbis: retentions.itbis,
    retention_total: retentions.total,
    net_total: totals.net,
    pending_total: totals.net,
  });

  // La cuenta por pagar nace con la liquidación: `payable.supplier_id` existía
  // desde 0030 y NADA lo escribía nunca, así que lo que se le debía a un
  // proveedor no aparecía en cuentas por pagar.
  await tenantCreate(companyId, "payable", {
    supplier: input.supplierId,
    settlement: settlement._id,
    concept: `Liquidación de servicios ${settlement.code}`,
    category: "supplier_services",
    amount: totals.net,
    paid_amount: 0,
    balance: totals.net,
    currency,
    issue_date: new Date().toISOString(),
    due_date: new Date(
      Date.now() + Math.max(0, Number(supplier.payment_terms_days ?? 15)) * 86_400_000
    ).toISOString(),
    status: "pending",
    reference: newDocumentNumber("CXP"),
  });

  return { settlement, claimed, services: totals.services, currency };
}

/* ------------------------------------------------------- estado de cuenta */

export interface StatementLine {
  _id: string;
  concept: string;
  cost_type?: string | null;
  quantity?: number | null;
  unit_cost?: number | null;
  amount: number;
  confirmed_amount: number | null;
  variance: number;
  verdict: ReturnType<typeof reconcile>["verdict"];
  currency: string;
  status?: string | null;
  booking_number: string | null;
  departure_at: string | null;
  product_name: string | null;
}

export interface StatementPayload {
  settlement: Settlement & Record<string, unknown>;
  supplier: Supplier | null;
  lines: StatementLine[];
  retentions: Retentions;
  totals: ReturnType<typeof settlementTotals>;
  /** Cuántas líneas discrepan de lo facturado. */
  disputed: number;
}

/**
 * El estado de cuenta de una liquidación.
 *
 * Lo piden la pantalla, el PDF que se le manda al proveedor y la conciliación,
 * y los tres tienen que decir lo mismo: un estado de cuenta que no cuadra con
 * lo que el sistema va a pagar no sirve para discutir nada.
 */
export async function loadSupplierStatement(
  companyId: string,
  settlementId: string,
  actor?: ProjectionCtx
): Promise<StatementPayload> {
  const crudo = await tenantFindOne<Settlement & Record<string, unknown>>(
    companyId, "settlement", settlementId, { supplier: true, partner: true, seller: true }
  );

  /**
   * LA CABECERA SE RECORTA, Y LAS LÍNEAS NO HACE FALTA.
   *
   * El mapeo de abajo elige a mano lo que cada línea enseña, así que una
   * columna nueva en `booking_cost` no se cuela por ahí. La CABECERA, en
   * cambio, viaja entera: es la fila tal cual sale de la base, con quién la
   * aprobó y a quién se le asignó la disputa dentro. Pasarla por la lista
   * blanca del actor (0085) la deja en lo que ese actor puede ver — y una
   * columna que alguien añada mañana nace fuera.
   *
   * Sin actor no se recorta: quien llama desde dentro —la conciliación, el
   * PDF de la operadora— necesita la fila completa.
   */
  const settlement = actor
    ? projectRow("settlement", actor, crudo)
    : crudo;

  const rows = await tenantQuery<Record<string, unknown> & { _id: string }>(
    companyId, "booking_cost", {
      _filter: { settlement: settlementId }, _limit: 1000, _sort: { createdAt: "asc" },
      booking: { product: true }, departure: true,
    }
  );

  const lines: StatementLine[] = rows.map((row) => {
    const check = reconcile(row as { amount?: number; confirmed_amount?: number | null });
    const booking = row.booking as { booking_number?: string; product?: { name?: string } } | null;
    const departure = row.departure as { departure_at?: string } | null;
    return {
      _id: row._id,
      concept: String(row.concept || "Servicio operado"),
      cost_type: (row.cost_type as string) ?? null,
      quantity: (row.quantity as number) ?? null,
      unit_cost: (row.unit_cost as number) ?? null,
      amount: check.accrued,
      confirmed_amount: check.confirmed,
      variance: check.variance,
      verdict: check.verdict,
      currency: String(row.currency || settlement.currency || "usd").toLowerCase(),
      status: (row.status as string) ?? null,
      booking_number: booking?.booking_number ?? null,
      departure_at: departure?.departure_at ?? null,
      product_name: booking?.product?.name ?? null,
    };
  });

  const supplierId = refId(settlement.supplier);
  const supplier = supplierId
    ? await tenantFindOne<Supplier>(companyId, "supplier", supplierId).catch(() => null)
    : null;

  const services = round2(lines.reduce((sum, line) => sum + line.amount, 0));
  // Lo facturado sale de las líneas confirmadas; si ninguna lo está todavía, no
  // hay factura y manda el devengo.
  const anyConfirmed = lines.some((line) => line.confirmed_amount !== null);
  const confirmed = anyConfirmed
    ? round2(lines.reduce((sum, line) => sum + (line.confirmed_amount ?? line.amount), 0))
    : null;

  const retentions = retentionsFor(supplier, confirmed ?? services);
  const totals = settlementTotals({
    services,
    confirmed,
    adjustments: Number(settlement.adjustments_total ?? 0),
    retentions,
  });

  return {
    settlement,
    supplier,
    lines,
    retentions,
    totals,
    disputed: lines.filter((line) => line.verdict === "over" || line.verdict === "under").length,
  };
}

/** Un proveedor con servicios pendientes de liquidar, para la pantalla. */
export interface PendingSupplier {
  /** Clave de la fila: proveedor y moneda. La tabla de la pantalla la necesita. */
  _id: string;
  supplierId: string;
  name: string;
  currency: string;
  services: number;
  lines: number;
  oldest: string | null;
}

export async function pendingBySupplier(companyId: string): Promise<PendingSupplier[]> {
  const rows = await tenantQuery<Record<string, unknown>>(companyId, "booking_cost", {
    _filter: { status: { in: [...CLAIMABLE] } },
    _limit: 2000,
    _sort: { createdAt: "asc" },
    supplier: true,
    departure: true,
  });

  const groups = new Map<string, PendingSupplier>();
  for (const row of rows) {
    const supplier = row.supplier as { _id?: string; name?: string } | null;
    const supplierId = supplier?._id ?? refId(row.supplier);
    // Un devengo sin proveedor asignado no se puede pagar a nadie; se agrupa
    // aparte para que se vea y se corrija la tarifa del catálogo.
    const key = `${supplierId ?? "sin-proveedor"}:${String(row.currency || "usd").toLowerCase()}`;
    const departure = row.departure as { departure_at?: string } | null;
    const when = departure?.departure_at ?? null;

    const group = groups.get(key) || {
      _id: key,
      supplierId: supplierId ?? "",
      name: supplier?.name || "Sin proveedor asignado",
      currency: String(row.currency || "usd").toLowerCase(),
      services: 0, lines: 0, oldest: null,
    };
    group.services = round2(group.services + Number(row.amount ?? 0));
    group.lines += 1;
    if (when && (!group.oldest || when < group.oldest)) group.oldest = when;
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => b.services - a.services);
}

/** Reconstruye el devengo de una reserva que se vendió antes de 0040. */
export async function backfillBookingCosts(
  companyId: string,
  bookingId: string
): Promise<number> {
  const booking = await tenantFindOne<Booking & { product?: unknown; departure?: unknown }>(
    companyId, "booking", bookingId, { product: true, departure: true }
  );
  if (booking.status === "cancelled" || booking.status === "refunded") return 0;
  const productId = refId(booking.product);
  if (!productId) return 0;

  const result = await accrueBookingCosts(companyId, {
    bookingId,
    productId,
    departureId: refId(booking.departure),
    pax: Math.max(1, Number(booking.pax_total ?? 1)),
    revenue: Number(booking.gross_amount ?? booking.total_amount ?? 0),
    currency: String(booking.currency || "usd"),
  });
  return result.created;
}
