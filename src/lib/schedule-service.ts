import "server-only";
import { tenantCreate, tenantFindOne, tenantQuery, tenantUpdate } from "@/lib/tenant";
import {
  buildSchedule, allocate, statusFor, collectionStatus, effectivePolicy, balanceDueDate,
  dayOf, type Installment, type PlannedInstallment,
} from "@/lib/collections";
import type { Booking, Order } from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * El calendario de cobro de una venta, persistido.
 *
 * La decisión de fondo: **lo imputado se deriva, no se acumula.** Cada vez que
 * cambia el dinero de una orden se reparte `paid_total` entero sobre el plan,
 * de la cuota más antigua a la más nueva. Ir sumando pago a pago obliga a
 * acertar en todos los casos —un reembolso parcial, un cobro anulado, un plan
 * que se rehace a mitad— y basta fallar en uno para que el plan y el saldo de
 * la orden digan cosas distintas para siempre. Derivarlo es idempotente: se
 * puede recalcular mil veces y siempre da lo mismo que la orden.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Una cuota perdonada o anulada ya no espera dinero. */
const DEAD = new Set(["waived", "cancelled"]);

interface ScheduleRow extends Installment {
  _id: string;
  booking?: unknown;
  currency?: string | null;
  /** Derivado, como lo imputado: lo escribe `refreshAllocation` y nadie más. */
  balance?: number | null;
}

async function liveSchedule(companyId: string, orderId: string): Promise<ScheduleRow[]> {
  const rows = await tenantQuery<ScheduleRow>(companyId, "payment_schedule", {
    _filter: { order: orderId }, _limit: 60, _sort: { sequence: "asc" },
  });
  return rows;
}

/**
 * Fecha de vencimiento del saldo de cada reserva, derivada de su salida.
 *
 * Se guarda en la reserva y no solo en la orden porque el recordatorio se manda
 * por reserva: una orden con dos excursiones en fechas distintas tiene dos
 * vencimientos y dos avisos.
 */
export async function syncBookingDueDates(
  companyId: string,
  orderId: string,
  now: Date = new Date()
): Promise<{ bookingId: string; dueDate: string | null; total: number; productId: string | null }[]> {
  const bookings = await tenantQuery<Booking & { product?: unknown; departure?: unknown }>(
    companyId, "booking", {
      _filter: { order: orderId }, _limit: 200,
      product: true, departure: true,
    }
  );

  const out: { bookingId: string; dueDate: string | null; total: number; productId: string | null }[] = [];
  for (const booking of bookings) {
    if (booking.status === "cancelled" || booking.status === "refunded") continue;
    const product = (typeof booking.product === "object" ? booking.product : null) as
      { _id?: string; balance_due_days?: number | null } | null;
    const departure = (typeof booking.departure === "object" ? booking.departure : null) as
      { departure_at?: string | null } | null;

    const dueDate = balanceDueDate(
      departure?.departure_at ?? null,
      product?.balance_due_days ?? null,
      now
    );
    if (dueDate !== dayOf(booking.balance_due_date)) {
      await tenantUpdate(companyId, "booking", booking._id, { balance_due_date: dueDate });
    }
    out.push({
      bookingId: booking._id,
      dueDate,
      total: booking.total_amount ?? 0,
      productId: product?._id ?? refId(booking.product),
    });
  }
  return out;
}

/**
 * Crea el plan de cobro si la venta todavía no tiene ninguno.
 *
 * No pisa un plan existente: un gerente pudo pactar cuotas a medida y rehacerlo
 * en cada cobro las borraría. Para reemplazarlo está `setSchedule`.
 */
export async function ensureSchedule(
  companyId: string,
  orderId: string,
  now: Date = new Date()
): Promise<void> {
  const existing = await liveSchedule(companyId, orderId);
  if (existing.some((row) => !DEAD.has(row.status || ""))) {
    await refreshAllocation(companyId, orderId, now);
    return;
  }

  const order = await tenantFindOne<Order & Record<string, unknown>>(companyId, "order", orderId);
  const total = order.total ?? 0;
  if (total <= 0) return;

  const bookings = await syncBookingDueDates(companyId, orderId, now);
  // La política del producto que más pesa en la venta: es el que manda el
  // anticipo cuando la orden no pactó condiciones propias.
  const leading = [...bookings].sort((a, b) => b.total - a.total)[0] ?? null;
  const product = leading?.productId
    ? await tenantFindOne<Record<string, unknown>>(companyId, "product", leading.productId).catch(() => null)
    : null;

  const policy = effectivePolicy(
    order as { deposit_type?: string | null; deposit_percent?: number | null; deposit_amount?: number | null },
    product as { deposit_type?: string | null; deposit_percent?: number | null; balance_due_days?: number | null } | null
  );

  // El saldo vence antes de la PRIMERA salida: no se sube al autobús debiendo.
  const earliest = bookings
    .map((b) => b.dueDate)
    .filter((d): d is string => !!d)
    .sort()[0] ?? null;

  const planned = buildSchedule({
    total,
    policy,
    depositDueDate: dayOf(order.deposit_due_date as string) || dayOf(now),
    balanceDueDate: dayOf(order.balance_due_date as string) || earliest,
    now,
  });
  if (planned.length === 0) return;

  const bookingId = bookings.length === 1 ? bookings[0].bookingId : null;
  /**
   * Y el plan nuevo sigue numerando donde acabó el viejo.
   *
   * Aquí se llega cuando TODAS las cuotas anteriores están muertas —perdonadas
   * o anuladas—, y sin el desplazamiento el plan nuevo volvía a empezar en 1.
   * La venta acababa con dos cuotas «1» y dos «2», una viva y otra muerta, y el
   * recibo que dice «abono de la cuota 2 de 3» deja de poder señalar una sola.
   * `setSchedule` ya lo hacía; esto es lo mismo por el otro camino.
   */
  await writePlan(companyId, orderId, planned, {
    currency: String(order.currency || "usd"),
    bookingId,
    offset: await nextSequence(companyId, orderId),
  });
  await refreshAllocation(companyId, orderId, now);
}

/**
 * Reemplaza el plan por uno pactado a mano.
 *
 * Las cuotas tienen que sumar el total de la venta: un plan que suma de menos
 * deja dinero que nadie va a pedir, y uno que suma de más le reclama al cliente
 * algo que no compró.
 */
export async function setSchedule(
  companyId: string,
  orderId: string,
  installments: PlannedInstallment[],
  now: Date = new Date()
): Promise<void> {
  const order = await tenantFindOne<Order>(companyId, "order", orderId);
  const total = round2(order.total ?? 0);
  const sum = round2(installments.reduce((s, i) => s + Number(i.amount || 0), 0));
  if (Math.abs(sum - total) > 0.009) {
    throw Object.assign(
      new Error(`Las cuotas suman ${sum} y la venta es de ${total}. Tienen que cuadrar.`),
      { status: 400 }
    );
  }
  if (installments.some((i) => !dayOf(i.due_date))) {
    throw Object.assign(new Error("Cada cuota necesita una fecha de vencimiento"), { status: 400 });
  }

  // Un plan que se rehace no puede borrar un cobro: las cuotas ya cobradas se
  // anulan en vez de desaparecer, y la imputación se recalcula desde el total
  // pagado de la orden, que es la única cifra que no depende del plan.
  for (const row of await liveSchedule(companyId, orderId)) {
    await tenantUpdate(companyId, "payment_schedule", row._id, {
      status: "cancelled", paid_amount: 0, balance: 0,
    });
  }

  await writePlan(companyId, orderId, installments, {
    currency: String(order.currency || "usd"),
    bookingId: null,
    offset: await nextSequence(companyId, orderId),
  });
  await refreshAllocation(companyId, orderId, now);
}

async function nextSequence(companyId: string, orderId: string): Promise<number> {
  const rows = await liveSchedule(companyId, orderId);
  return rows.reduce((max, row) => Math.max(max, Number(row.sequence ?? 0)), 0);
}

async function writePlan(
  companyId: string,
  orderId: string,
  planned: PlannedInstallment[],
  opts: { currency: string; bookingId: string | null; offset?: number }
): Promise<void> {
  const offset = opts.offset ?? 0;
  for (const installment of planned) {
    await tenantCreate(companyId, "payment_schedule", {
      order: orderId,
      booking: opts.bookingId || undefined,
      sequence: offset + installment.sequence,
      kind: installment.kind,
      due_date: installment.due_date,
      amount: installment.amount,
      paid_amount: 0,
      balance: installment.amount,
      currency: opts.currency,
      status: "pending",
    });
  }
}

/**
 * Reparte lo cobrado de la orden sobre el plan y actualiza los estados.
 *
 * Es la operación que se llama después de cada pago, reembolso o anulación. No
 * necesita saber qué cambió: parte de `paid_total`, que la sincronización de la
 * orden ya mantiene, así que no puede desviarse de ella.
 */
export async function refreshAllocation(
  companyId: string,
  orderId: string,
  now: Date = new Date()
): Promise<void> {
  const rows = await liveSchedule(companyId, orderId);
  if (rows.length === 0) return;

  const order = await tenantFindOne<Order>(companyId, "order", orderId);
  const paid = Math.max(round2(order.paid_total ?? 0), 0);

  /**
   * Las muertas fuera, y el cobro nunca en negativo.
   *
   * Las dos líneas son defensa en profundidad y hoy no se pueden alcanzar:
   * `allocate` se salta las cuotas muertas por su cuenta, `statusFor` conserva
   * su estado y `collectionStatus` las vuelve a filtrar, así que quitarlas de
   * aquí no cambia nada de lo que se escribe. Un mutador las borra y todo sigue
   * verde; lo fija una guarda estructural en `ui-contracts.test.ts`.
   *
   * Se quedan porque lo que las hace inertes es el contrato de OTRO módulo. El
   * día que `allocate` se reescriba para repartir un abono y ese filtro se
   * mueva, esto es lo único que impide que una cuota perdonada vuelva a pedir
   * dinero y que un reembolso se impute como si fuera un cobro.
   */
  const live = rows.filter((row) => !DEAD.has(row.status || ""));
  // Se parte de cero: repartir sobre lo ya imputado sumaría dos veces el mismo
  // dinero en cuanto el plan o un cobro cambien.
  const blank: Installment[] = live.map((row) => ({ ...row, paid_amount: 0 }));
  const { allocations } = allocate(blank, paid, now);

  const applied = new Map<string, { paid: number; balance: number; status: string }>();
  for (const allocation of allocations) {
    const id = (allocation.installment as ScheduleRow)._id;
    applied.set(id, {
      paid: allocation.paid_amount,
      balance: allocation.balance,
      status: allocation.status,
    });
  }

  const nowIso = now.toISOString();
  for (const row of live) {
    const hit = applied.get(row._id);
    const amount = round2(row.amount ?? 0);
    const paidAmount = hit?.paid ?? 0;
    const balance = hit?.balance ?? amount;
    const status = hit?.status ?? statusFor({ ...row, paid_amount: 0 }, now);

    /**
     * EL SALDO TAMBIÉN SE DERIVA, ASÍ QUE TAMBIÉN SE COMPARA.
     *
     * Esto miraba lo imputado y el estado, y no el saldo. Una cuota cuyo
     * importe se corrige a mano —el gerente baja de 500 a 300 la última— queda
     * con el mismo `paid_amount` y el mismo estado, así que salía por aquí sin
     * tocarse y se quedaba con el `balance` del importe viejo. Y el saldo es lo
     * que el cliente ve en su cuota y lo que el listado de cobros suma: el
     * plan seguía pidiendo doscientos que ya nadie debe.
     *
     * La cabecera de este módulo dice que lo imputado se deriva y no se
     * acumula. El saldo es parte de lo derivado.
     */
    const unchanged =
      round2(row.paid_amount ?? 0) === paidAmount &&
      round2(row.balance ?? 0) === balance &&
      (row.status || "") === status;
    if (unchanged) continue;

    await tenantUpdate(companyId, "payment_schedule", row._id, {
      paid_amount: paidAmount,
      balance,
      status,
      paid_at: status === "paid" ? nowIso : null,
    });
    row.paid_amount = paidAmount;
    row.status = status;
  }

  const state = collectionStatus(live, now);
  if (order.collection_status !== state) {
    await tenantUpdate(companyId, "order", orderId, { collection_status: state });
  }
}

/**
 * La cuota a la que apunta un cobro, cuando apunta a una sola.
 *
 * Sirve para el recibo ("abono de la cuota 2 de 3"). La verdad de lo imputado
 * la lleva `refreshAllocation`; esto es una etiqueta, no un saldo.
 */
export async function scheduleRefFor(
  companyId: string,
  orderId: string,
  amount: number,
  now: Date = new Date()
): Promise<string | null> {
  const rows = await liveSchedule(companyId, orderId);
  const live = rows.filter((row) => !DEAD.has(row.status || ""));
  if (live.length === 0) return null;
  const { allocations } = allocate(live, amount, now);
  return allocations.length === 1 ? (allocations[0].installment as ScheduleRow)._id : null;
}
