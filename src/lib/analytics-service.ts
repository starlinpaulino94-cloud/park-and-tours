import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import {
  buildCohorts, repeatRate, averageCustomerValue,
  leadDistribution, learnCurve, forecastOccupancy, departureAlerts,
  DEFAULT_THRESHOLDS, DEFAULT_COHORT_MONTHS, CURVE_HORIZON, leadDays,
  type Alert, type AlertThresholds, type CohortRow, type Forecast,
  type LeadBucket, type PastDeparture, type PickupCurve, type PurchaseRow,
} from "@/lib/analytics";

/**
 * LA ANALÍTICA, CONTRA LA BASE.
 *
 * Las reglas están en `analytics.ts`, que es puro y se prueba. Aquí solo se lee
 * — y se lee con cuidado, porque una consulta mal acotada en analítica no se
 * nota en la operadora de tres salidas al mes y tumba a la que tiene treinta al
 * día, que es justamente la que más la necesita.
 *
 * Dos decisiones de lectura que vale la pena dejar dichas:
 *
 *  · Las cohortes se calculan sobre las reservas VÁLIDAS. Contar las canceladas
 *    inflaría la retención con clientes que pidieron y no llegaron a viajar.
 *  · La curva se aprende de salidas YA OCURRIDAS. Meter las futuras —que están
 *    a medio vender— haría creer que la venta se desploma cerca de la fecha.
 */

/** Estados de reserva que cuentan como negocio de verdad. */
const VALID_BOOKING = ["confirmed", "partially_paid", "paid", "checked_in", "completed"];

/** Techo de filas por consulta. Analítica no puede convertirse en un barrido. */
const MAX_ROWS = 5000;

export interface AnalyticsInput {
  companyId: string;
  /** Meses de historia para las cohortes. */
  months?: number;
  thresholds?: AlertThresholds;
  now?: Date;
}

export interface CohortReport {
  cohorts: CohortRow[];
  repeatRatePct: number;
  averageCustomerValue: number;
  customers: number;
}

/** Cohortes de clientes por mes de primera compra. */
export async function cohortReport(input: AnalyticsInput): Promise<CohortReport> {
  const now = input.now ?? new Date();
  const months = Math.max(3, Math.min(36, input.months ?? DEFAULT_COHORT_MONTHS));
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1)).toISOString();

  const { data } = await supabaseService()
    .from("booking")
    .select("customer_id,booking_date,total_amount")
    .eq("organization_id", input.companyId)
    .in("status", VALID_BOOKING)
    .not("customer_id", "is", null)
    .gte("booking_date", since)
    .order("booking_date", { ascending: true })
    .limit(MAX_ROWS);

  const rows: PurchaseRow[] = (data ?? []).map((row) => ({
    customerId: String(row.customer_id),
    at: String(row.booking_date),
    amount: Number(row.total_amount ?? 0),
  }));

  return {
    cohorts: buildCohorts(rows, months),
    repeatRatePct: repeatRate(rows),
    averageCustomerValue: averageCustomerValue(rows),
    customers: new Set(rows.map((r) => r.customerId)).size,
  };
}

/**
 * La curva de anticipación de esta operadora.
 *
 * Solo de salidas pasadas, y solo de las que llegaron a vender algo: una salida
 * que se canceló sin reservas no enseña nada sobre el ritmo de venta y metería
 * un cero que aplana la curva de todas las demás.
 */
export async function pickupCurveOf(
  companyId: string,
  options: { productId?: string | null; days?: number; now?: Date } = {}
): Promise<{ curve: PickupCurve; leads: LeadBucket[] }> {
  const now = options.now ?? new Date();
  const lookback = Math.max(30, Math.min(730, options.days ?? 365));
  const since = new Date(now.getTime() - lookback * 86_400_000).toISOString();

  let departureQuery = supabaseService()
    .from("departure")
    .select("id,departure_at,product_id")
    .eq("organization_id", companyId)
    .gte("departure_at", since)
    .lt("departure_at", now.toISOString())
    .order("departure_at", { ascending: false })
    .limit(500);
  if (options.productId) departureQuery = departureQuery.eq("product_id", options.productId);

  const { data: departures } = await departureQuery;
  const list = departures ?? [];
  if (list.length === 0) return { curve: { share: [], sample: 0 }, leads: leadDistribution([]) };

  const ids = list.map((d) => String(d.id));
  const { data: bookings } = await supabaseService()
    .from("booking")
    .select("departure_id,booking_date,travel_date,adults,children")
    .eq("organization_id", companyId)
    .in("departure_id", ids)
    .in("status", VALID_BOOKING)
    .limit(MAX_ROWS);

  const byDeparture = new Map<string, { bookedAt: string; seats: number }[]>();
  const paceRows: { bookedAt: string; travelAt: string; seats: number }[] = [];

  for (const row of bookings ?? []) {
    const seats = Number(row.adults ?? 0) + Number(row.children ?? 0);
    const departureId = String(row.departure_id);
    const bookedAt = String(row.booking_date);
    const list_ = byDeparture.get(departureId) ?? [];
    list_.push({ bookedAt, seats });
    byDeparture.set(departureId, list_);
    if (row.travel_date) paceRows.push({ bookedAt, travelAt: String(row.travel_date), seats });
  }

  const past: PastDeparture[] = list.map((departure) => {
    const rows = byDeparture.get(String(departure.id)) ?? [];
    return {
      travelAt: String(departure.departure_at),
      bookings: rows,
      finalSeats: rows.reduce((sum, row) => sum + row.seats, 0),
    };
  });

  return { curve: learnCurve(past, CURVE_HORIZON), leads: leadDistribution(paceRows) };
}

export interface ForecastRow {
  departureId: string;
  product: string;
  travelAt: string;
  capacity: number;
  soldSeats: number;
  daysOut: number;
  forecast: Forecast;
}

export interface OccupancyReport {
  curveSample: number;
  rows: ForecastRow[];
  alerts: Alert[];
  leads: LeadBucket[];
}

/** Previsión de las salidas futuras, con sus alertas. */
export async function occupancyReport(input: AnalyticsInput & { horizonDays?: number }): Promise<OccupancyReport> {
  const now = input.now ?? new Date();
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const horizon = Math.max(7, Math.min(180, input.horizonDays ?? 60));

  const { curve, leads } = await pickupCurveOf(input.companyId, { now });

  const { data } = await supabaseService()
    .from("departure")
    .select("id,departure_at,capacity,booked_pax,pending_pax,status,product_id")
    .eq("organization_id", input.companyId)
    .gte("departure_at", now.toISOString())
    .lte("departure_at", new Date(now.getTime() + horizon * 86_400_000).toISOString())
    .in("status", ["available", "almost_full", "full"])
    .order("departure_at", { ascending: true })
    .limit(400);

  const list = data ?? [];
  const productIds = [...new Set(list.map((d) => d.product_id).filter(Boolean).map(String))];
  const names = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products } = await supabaseService()
      .from("product").select("id,name")
      .eq("organization_id", input.companyId).in("id", productIds).limit(300);
    for (const product of products ?? []) names.set(String(product.id), String(product.name || ""));
  }

  const snapshots = list.map((departure) => {
    const travelAt = String(departure.departure_at);
    return {
      id: String(departure.id),
      product: departure.product_id ? names.get(String(departure.product_id)) ?? "" : "",
      travelAt,
      capacity: Number(departure.capacity ?? 0),
      // Lo vendido es lo confirmado MÁS lo pendiente: una plaza retenida sigue
      // ocupando el asiento, y prever sin ella diría que hay sitio de sobra.
      soldSeats: Number(departure.booked_pax ?? 0) + Number(departure.pending_pax ?? 0),
      daysOut: leadDays(now.toISOString(), travelAt),
    };
  });

  const rows: ForecastRow[] = snapshots.map((snapshot) => ({
    departureId: snapshot.id,
    product: snapshot.product,
    travelAt: snapshot.travelAt,
    capacity: snapshot.capacity,
    soldSeats: snapshot.soldSeats,
    daysOut: snapshot.daysOut,
    forecast: forecastOccupancy({
      soldSeats: snapshot.soldSeats,
      capacity: snapshot.capacity,
      daysOut: snapshot.daysOut,
      curve,
    }),
  }));

  return {
    curveSample: curve.sample,
    rows,
    alerts: departureAlerts(snapshots, curve, thresholds),
    leads,
  };
}
