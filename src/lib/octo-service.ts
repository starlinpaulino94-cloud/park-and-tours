import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { tenantQuery, tenantUpdate, type TenantContext } from "@/lib/tenant";
import { createOrderWithBookings, releaseExpiredHolds, syncOrderTotals } from "@/lib/booking-service";
import { cancelBookingFully, TERMINAL_STATES } from "@/lib/booking-cancel-service";
import { resolvePrice } from "@/lib/pricing";
import { parseJson } from "@/lib/format";
import { APP_URL } from "@/lib/stripe";
import {
  DEFAULT_OPTION_ID, SELLABLE_DEPARTURE,
  cancellationCutoffHours, canTransition, holdMinutesFor, holderName,
  isOptionModality, localDate, octoStatusOf, optionsOf, paxOf, seatsOf,
  toOctoAvailability, toOctoBooking, toOctoCalendar, toOctoProduct, toOctoSupplier,
  type CancellationTierLike, type DepartureLike, type ModalityLike, type OctoAvailability,
  type OctoBooking, type OctoCalendarDay, type OctoCapability, type OctoErrorCode,
  type OctoProduct, type OctoSupplier, type ProductLike, type ReservationInput,
} from "@/lib/octo";
import type { Company } from "@/lib/types";

/**
 * EL CONECTOR OCTO CONTRA LA BASE.
 *
 * Aquí no hay reglas del estándar: están en `octo.ts`, que es puro y se prueba.
 * Lo de este archivo es leer, escribir y —sobre todo— NO duplicar nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE ORDENA TODO ESTO
 *
 * Una reserva que entra por una OTA tiene que pasar por EL MISMO camino que una
 * del mostrador: `createOrderWithBookings` para crearla y `cancelBookingFully`
 * para cancelarla. No hay un camino corto «porque es API».
 *
 * La tentación es real —escribir la fila de `booking` a mano es diez líneas— y
 * el precio de caer en ella es que la reserva de la OTA no comprobaría el cupo
 * de la salida, no consumiría el cupo contratado del socio, no devengaría la
 * comisión, no apartaría los almuerzos del almacén, no generaría el voucher y
 * no aparecería en el manifiesto. Media operación funcionando a medias, y
 * descubriéndose en el punto de encuentro.
 */

export class OctoError extends Error {
  constructor(
    readonly code: OctoErrorCode,
    message: string,
    readonly pointer: Record<string, string> = {}
  ) {
    super(message);
    this.name = "OctoError";
  }
}

export interface OctoContext {
  companyId: string;
  company: Company | null;
  partnerId: string | null;
  keyId: string;
  capabilities: OctoCapability[];
}

/** La zona horaria del producto. Sin ella, cada hora que se publica es una apuesta. */
export function timeZoneOf(company: Company | null): string {
  const zone = (company as { timezone?: string } | null)?.timezone;
  return typeof zone === "string" && zone.trim() !== "" ? zone.trim() : "America/Santo_Domingo";
}

function currencyOf(company: Company | null): string {
  return String(company?.base_currency || "usd");
}

/* ══════════════════════════════════════════════════════════════ catálogo ══ */

/**
 * Qué productos ve un revendedor.
 *
 * Los PUBLICADOS, igual que la página pública y que la API de socios. No se
 * inventa un interruptor «vender en OTA» aparte: sería una casilla que nadie
 * marcaría nunca y el revendedor recibiría un catálogo vacío el día del
 * estreno. Cerrarle un producto a UN revendedor concreto ya tiene su
 * mecanismo, que es el cupo (`allotment_type = 'closed'`).
 */
async function publishedProducts(companyId: string, id?: string): Promise<ProductLike[]> {
  const rows = await tenantQuery<ProductLike>(companyId, "product", {
    _filter: id ? { _id: id, published: true } : { published: true },
    _limit: id ? 1 : 200,
    _sort: { sort_order: "asc" },
  });
  return rows.filter((row) => (row.status ?? "active") === "active");
}

async function modalitiesOf(companyId: string, productIds: string[]): Promise<Map<string, ModalityLike[]>> {
  const out = new Map<string, ModalityLike[]>();
  if (productIds.length === 0) return out;
  const rows = await tenantQuery<ModalityLike & { product?: unknown }>(companyId, "product_modality", {
    _filter: { product: { in: productIds } }, _limit: 500, _sort: { sort_order: "asc" },
  });
  for (const row of rows) {
    const key = String((row as { product?: { id?: string } | string }).product &&
      typeof row.product === "object" ? (row.product as { id?: string }).id : row.product);
    const list = out.get(key);
    if (list) list.push(row);
    else out.set(key, [row]);
  }
  return out;
}

/** Los horarios de salida que se publican en la opción, en hora local. */
async function startTimesOf(companyId: string, productIds: string[], timeZone: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (productIds.length === 0) return out;
  const { data } = await supabaseService()
    .from("departure")
    .select("product_id,departure_at")
    .eq("organization_id", companyId)
    .in("product_id", productIds)
    .gte("departure_at", new Date().toISOString())
    .in("status", [...SELLABLE_DEPARTURE])
    .order("departure_at", { ascending: true })
    .limit(2000);

  for (const row of data ?? []) {
    const key = String(row.product_id);
    const hour = localDate(String(row.departure_at), timeZone).length === 10
      ? new Date(String(row.departure_at)).toISOString()
      : String(row.departure_at);
    const local = hourOf(hour, timeZone);
    const list = out.get(key) ?? [];
    if (!list.includes(local)) list.push(local);
    out.set(key, list);
  }
  for (const [key, list] of out) out.set(key, list.sort());
  return out;
}

function hourOf(iso: string, timeZone: string): string {
  // `localDate` devuelve el día; la hora sale del mismo formateo completo.
  const full = new Date(iso);
  if (Number.isNaN(full.getTime())) return "00:00";
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  return fmt.format(full);
}

async function tiersOf(companyId: string, productIds: string[]): Promise<Map<string, CancellationTierLike[]>> {
  const out = new Map<string, CancellationTierLike[]>();
  if (productIds.length === 0) return out;
  const products = await tenantQuery<{ _id: string; cancellation_policy?: unknown }>(companyId, "product", {
    _filter: { _id: { in: productIds } }, _limit: 200,
  });
  const policyIds = [...new Set(products
    .map((p) => refOf(p.cancellation_policy))
    .filter((id): id is string => !!id))];
  if (policyIds.length === 0) return out;

  const policies = await tenantQuery<{ _id: string; tiers?: unknown }>(companyId, "cancellation_policy", {
    _filter: { _id: { in: policyIds } }, _limit: 100,
  });
  const byPolicy = new Map(policies.map((p) => [p._id, parseJson<CancellationTierLike[]>(p.tiers, [])]));
  for (const product of products) {
    const policyId = refOf(product.cancellation_policy);
    if (policyId && byPolicy.has(policyId)) out.set(product._id, byPolicy.get(policyId) as CancellationTierLike[]);
  }
  return out;
}

function refOf(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object") {
    const id = (value as { id?: string; _id?: string }).id ?? (value as { _id?: string })._id;
    return id ? String(id) : null;
  }
  return null;
}

async function hasDepartures(companyId: string, productIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (productIds.length === 0) return out;
  const { data } = await supabaseService()
    .from("departure")
    .select("product_id")
    .eq("organization_id", companyId)
    .in("product_id", productIds)
    .limit(5000);
  for (const row of data ?? []) out.add(String(row.product_id));
  return out;
}

async function buildProducts(ctx: OctoContext, rows: ProductLike[]): Promise<OctoProduct[]> {
  const ids = rows.map((r) => r._id);
  const timeZone = timeZoneOf(ctx.company);
  const [modalities, startTimes, tiers, withDepartures] = await Promise.all([
    modalitiesOf(ctx.companyId, ids),
    startTimesOf(ctx.companyId, ids, timeZone),
    tiersOf(ctx.companyId, ids),
    hasDepartures(ctx.companyId, ids),
  ]);

  return rows.map((product) =>
    toOctoProduct({
      product,
      modalities: modalities.get(product._id) ?? [],
      startTimes: startTimes.get(product._id) ?? [],
      cancellationTiers: tiers.get(product._id) ?? null,
      currency: product.currency || currencyOf(ctx.company),
      capabilities: ctx.capabilities,
      timeZone,
      locale: "es",
      hasDepartures: withDepartures.has(product._id),
    })
  );
}

export async function octoProducts(ctx: OctoContext): Promise<OctoProduct[]> {
  return buildProducts(ctx, await publishedProducts(ctx.companyId));
}

export async function octoProduct(ctx: OctoContext, id: string): Promise<OctoProduct> {
  const rows = await publishedProducts(ctx.companyId, id);
  if (rows.length === 0) {
    throw new OctoError("INVALID_PRODUCT_ID", "Ese producto no está a la venta.", { productId: id });
  }
  return (await buildProducts(ctx, rows))[0];
}

export function octoSupplier(ctx: OctoContext): OctoSupplier {
  return toOctoSupplier(
    ctx.company as never,
    `${APP_URL.replace(/\/$/, "")}/api/octo/v1`,
    APP_URL || null
  );
}

/* ═════════════════════════════════════════════════════════ disponibilidad ══ */

export interface AvailabilityQuery {
  productId: string;
  optionId: string;
  localDateStart?: string | null;
  localDateEnd?: string | null;
  availabilityIds?: string[];
  units?: { id: string; quantity: number }[];
}

/**
 * Comprueba que el producto y la opción existan ANTES de mirar salidas.
 *
 * Sin esto, preguntar por un producto que la operadora no publicó devolvería
 * una lista vacía en vez de un error, y el revendedor concluiría que está
 * agotado. Peor: sería la forma de sondear qué productos existen sin que nadie
 * se enterara.
 */
async function assertProductOption(ctx: OctoContext, productId: string, optionId: string): Promise<{ product: ProductLike; modality: ModalityLike | null }> {
  const [product] = await publishedProducts(ctx.companyId, productId);
  if (!product) {
    throw new OctoError("INVALID_PRODUCT_ID", "Ese producto no está a la venta.", { productId });
  }
  if (optionId === DEFAULT_OPTION_ID) return { product, modality: null };

  const modalities = (await modalitiesOf(ctx.companyId, [productId])).get(productId) ?? [];
  const modality = modalities.find((m) => m._id === optionId && isOptionModality(m)) ?? null;
  if (!modality) {
    throw new OctoError("INVALID_OPTION_ID", "Esa opción no existe en este producto.", { productId, optionId });
  }
  return { product, modality };
}

/**
 * El precio por unidad de una fecha concreta.
 *
 * Se resuelve con el MISMO motor que la venta —tarifa del socio, temporada,
 * promoción, tramos por cantidad— y con la mezcla de viajeros que el revendedor
 * mandó, si la mandó. Publicar el precio de catálogo cuando el socio tiene
 * tarifa propia sería enseñarle al cliente final un precio que la reserva luego
 * no respeta.
 */
async function unitPricesFor(
  ctx: OctoContext,
  product: ProductLike,
  modality: ModalityLike | null,
  travelDate: string | null,
  units: { id: string; quantity: number }[] | undefined
): Promise<{ unitId: string; amount: number }[]> {
  const asked = units && units.length > 0 ? units : [{ id: "adult", quantity: 1 }];
  const adults = asked.find((u) => u.id === "adult")?.quantity ?? 0;
  const children = asked.find((u) => u.id === "child")?.quantity ?? 0;
  const billable = Math.max(1, adults + children);

  try {
    const price = await resolvePrice({
      companyId: ctx.companyId,
      productId: product._id,
      modalityId: modality?._id ?? null,
      partnerId: ctx.partnerId,
      sellerId: null,
      channel: "ota",
      quantity: billable,
      travelDate,
      discountPct: 0,
      taxPct: 0,
      exchangeRate: 1,
      unitPriceOverride: null,
      overrideCurrency: null,
      quoteId: null,
    } as never);
    const unit = Number(price.unitPrice ?? 0);
    return [
      { unitId: "adult", amount: unit },
      { unitId: "child", amount: unit },
      // El infante nunca paga: es la única regla de precio que es siempre
      // cierta sin mirar la tarifa.
      { unitId: "infant", amount: 0 },
    ];
  } catch {
    const fallback = Number(modality?.price ?? product.base_price ?? 0);
    return [
      { unitId: "adult", amount: fallback },
      { unitId: "child", amount: fallback },
      { unitId: "infant", amount: 0 },
    ];
  }
}

async function departuresFor(
  companyId: string,
  productId: string,
  window: { from: string; to: string },
  ids?: string[]
): Promise<DepartureLike[]> {
  let query = supabaseService()
    .from("departure")
    .select("id,departure_at,capacity,available_pax,cutoff_hours,status,meeting_point")
    .eq("organization_id", companyId)
    .eq("product_id", productId)
    .order("departure_at", { ascending: true })
    .limit(400);

  if (ids && ids.length > 0) query = query.in("id", ids.slice(0, 100));
  else query = query.gte("departure_at", window.from).lte("departure_at", window.to);

  const { data } = await query;
  return (data ?? []).map((row) => ({
    _id: String(row.id),
    departure_at: row.departure_at as string,
    capacity: row.capacity as number | null,
    available_pax: row.available_pax as number | null,
    cutoff_hours: row.cutoff_hours as number | null,
    status: row.status as string | null,
    meeting_point: row.meeting_point as string | null,
  }));
}

/** La ventana por defecto: de hoy a un año. Sin techo, un revendedor pide diez años. */
function windowOf(from?: string | null, to?: string | null): { from: string; to: string } {
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date();
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
  const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date(safeStart.getTime() + 365 * 86_400_000);
  const safeEnd = Number.isNaN(end.getTime()) ? new Date(safeStart.getTime() + 365 * 86_400_000) : end;
  const capped = Math.min(safeEnd.getTime(), safeStart.getTime() + 365 * 86_400_000);
  return { from: safeStart.toISOString(), to: new Date(capped).toISOString() };
}

export async function octoAvailability(ctx: OctoContext, query: AvailabilityQuery): Promise<OctoAvailability[]> {
  // Antes de contar plazas se sueltan las que ya nadie retiene: contestar
  // SOLD_OUT por un carrito abandonado hace tres horas es perder la venta.
  await sweepExpiredOctoHolds(ctx.companyId);
  const { product, modality } = await assertProductOption(ctx, query.productId, query.optionId);
  const timeZone = timeZoneOf(ctx.company);
  const window = windowOf(query.localDateStart, query.localDateEnd);
  const departures = await departuresFor(ctx.companyId, product._id, window, query.availabilityIds);

  const prices = await unitPricesFor(ctx, product, modality, departures[0]?.departure_at ?? null, query.units);
  const currency = product.currency || currencyOf(ctx.company);
  const duration = Number(product.duration_hours ?? 0);

  return departures.map((departure) =>
    toOctoAvailability({
      departure, durationHours: duration, timeZone, currency,
      unitPrices: prices, capabilities: ctx.capabilities,
    })
  );
}

export async function octoCalendar(ctx: OctoContext, query: AvailabilityQuery): Promise<OctoCalendarDay[]> {
  await sweepExpiredOctoHolds(ctx.companyId);
  const { product, modality } = await assertProductOption(ctx, query.productId, query.optionId);
  const timeZone = timeZoneOf(ctx.company);
  const window = windowOf(query.localDateStart, query.localDateEnd);
  const departures = await departuresFor(ctx.companyId, product._id, window);
  const prices = await unitPricesFor(ctx, product, modality, departures[0]?.departure_at ?? null, query.units);

  return toOctoCalendar(departures, timeZone, {
    currency: product.currency || currencyOf(ctx.company),
    unitPrices: prices,
    capabilities: ctx.capabilities,
  });
}

/* ═══════════════════════════════════════════════════════════ la reserva ══ */

interface BookingRow {
  id: string;
  booking_number: string | null;
  status: string | null;
  travel_date: string | null;
  departure_id: string | null;
  product_id: string | null;
  order_id: string | null;
  customer_id: string | null;
  adults: number | null; children: number | null; infants: number | null;
  total_amount: number | null; paid_amount: number | null; refund_amount: number | null;
  currency: string | null;
  cancelled_at: string | null; cancel_reason: string | null;
  checked_in_at: string | null;
  voucher_code: string | null;
  created_at: string; updated_at: string | null;
  octo_uuid: string | null;
  octo_option_id: string | null;
  octo_status: string | null;
  octo_reseller_reference: string | null;
  octo_unit_items: unknown;
  octo_contact: unknown;
  octo_test_mode: boolean | null;
  octo_confirmed_at: string | null;
  partner_id: string | null;
}

// Una sola cadena literal y no una concatenación: el cliente de Supabase
// deduce el tipo de la fila del LITERAL del select, y un `string` cualquiera le
// hace devolver el tipo de error en vez de la fila.
const BOOKING_COLUMNS = "id,booking_number,status,travel_date,departure_id,product_id,order_id,customer_id,adults,children,infants,total_amount,paid_amount,refund_amount,currency,cancelled_at,cancel_reason,checked_in_at,voucher_code,created_at,updated_at,octo_uuid,octo_option_id,octo_status,octo_reseller_reference,octo_unit_items,octo_contact,octo_test_mode,octo_confirmed_at,partner_id";

/**
 * Busca la reserva por el uuid del revendedor, dentro de SU empresa y de SU
 * socio.
 *
 * El filtro por socio no es paranoia: dos revendedores distintos de la misma
 * operadora no tienen por qué poder leerse las reservas el uno al otro, y sin
 * este filtro bastaría con adivinar un uuid para ver el nombre y el teléfono
 * del cliente de la competencia.
 */
async function loadRow(ctx: OctoContext, uuid: string): Promise<BookingRow | null> {
  let query = supabaseService()
    .from("booking")
    .select(BOOKING_COLUMNS)
    .eq("organization_id", ctx.companyId)
    .eq("octo_uuid", uuid)
    .limit(1);
  if (ctx.partnerId) query = query.eq("partner_id", ctx.partnerId);

  const { data } = await query;
  return (data?.[0] as BookingRow | undefined) ?? null;
}

async function holdUntilOf(companyId: string, orderId: string | null): Promise<string | null> {
  if (!orderId) return null;
  const { data } = await supabaseService()
    .from("sales_order").select("hold_until").eq("organization_id", companyId).eq("id", orderId).maybeSingle();
  return (data?.hold_until as string | null) ?? null;
}

async function cutoffHoursOf(companyId: string, productId: string | null): Promise<number> {
  if (!productId) return cancellationCutoffHours(null);
  const tiers = (await tiersOf(companyId, [productId])).get(productId) ?? null;
  return cancellationCutoffHours(tiers);
}

/** La reserva tal como se le contesta al revendedor. */
export async function bookingView(ctx: OctoContext, row: BookingRow): Promise<OctoBooking> {
  const holdUntil = await holdUntilOf(ctx.companyId, row.order_id);
  const status = octoStatusOf({ stored: row.octo_status, internal: row.status, holdUntil });
  const cutoffHours = await cutoffHoursOf(ctx.companyId, row.product_id);
  const unitItems = Array.isArray(row.octo_unit_items)
    ? (row.octo_unit_items as ReservationInput["unitItems"])
    : [];

  return toOctoBooking({
    bookingId: row.id,
    uuid: String(row.octo_uuid),
    testMode: row.octo_test_mode === true,
    resellerReference: row.octo_reseller_reference,
    supplierReference: row.booking_number,
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    holdUntil,
    redeemedAt: row.checked_in_at,
    confirmedAt: row.octo_confirmed_at,
    productId: String(row.product_id ?? ""),
    optionId: row.octo_option_id ?? DEFAULT_OPTION_ID,
    availabilityId: row.departure_id,
    availability: null,
    contact: (row.octo_contact as never) ?? null,
    notes: null,
    unitItems,
    travelDate: row.travel_date,
    cutoffHours,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    refundAmount: Number(row.refund_amount ?? 0),
    paidAmount: Number(row.paid_amount ?? 0),
    totalAmount: Number(row.total_amount ?? 0),
    currency: String(row.currency || currencyOf(ctx.company)),
    voucherUrl: row.voucher_code ? `${APP_URL.replace(/\/$/, "")}/api/bookings/${row.id}/voucher` : null,
    capabilities: ctx.capabilities,
  });
}

export async function getBooking(ctx: OctoContext, uuid: string): Promise<OctoBooking> {
  const row = await loadRow(ctx, uuid);
  if (!row) throw new OctoError("INVALID_BOOKING_UUID", "No hay ninguna reserva con ese uuid.", { uuid });
  return bookingView(ctx, row);
}

export async function listBookings(
  ctx: OctoContext,
  filter: { resellerReference?: string | null; supplierReference?: string | null }
): Promise<OctoBooking[]> {
  let query = supabaseService()
    .from("booking")
    .select(BOOKING_COLUMNS)
    .eq("organization_id", ctx.companyId)
    .not("octo_uuid", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (ctx.partnerId) query = query.eq("partner_id", ctx.partnerId);
  if (filter.resellerReference) query = query.eq("octo_reseller_reference", filter.resellerReference);
  if (filter.supplierReference) query = query.eq("booking_number", filter.supplierReference);

  const { data } = await query;
  const rows = (data ?? []) as BookingRow[];
  return Promise.all(rows.map((row) => bookingView(ctx, row)));
}

/**
 * La ficha del cliente de una reserva de OTA.
 *
 * Se reutiliza la que ya existe por correo: el mismo huésped que reservó por la
 * web el año pasado y ahora llega por GetYourGuide es UNA persona, y partirla en
 * dos fichas rompe su historial y las alertas de cliente recurrente.
 *
 * Sin correo se crea una ficha nueva: la OTA a veces no lo cede hasta después
 * de confirmar, y negarse a reservar por eso sería perder la venta.
 */
async function resolveCustomer(companyId: string, input: ReservationInput): Promise<string> {
  const sb = supabaseService();
  const email = input.contact?.emailAddress ?? null;
  if (email) {
    const { data } = await sb.from("customer").select("id")
      .eq("organization_id", companyId).eq("email", email).limit(1);
    if (data?.[0]) return String(data[0].id);
  }

  const name = holderName(input.contact, input.unitItems);
  const parts = name.split(/\s+/);
  const { data, error } = await sb.from("customer").insert({
    organization_id: companyId,
    first_name: parts[0] || name,
    last_name: parts.slice(1).join(" ") || null,
    email,
    phone: input.contact?.phoneNumber ?? null,
    country: input.contact?.country ?? null,
    source: "ota",
    status: "active",
    notes: input.contact?.notes ?? null,
  }).select("id").single();
  if (error || !data) throw new OctoError("INTERNAL_SERVER_ERROR", "No se pudo registrar al cliente.");
  return String(data.id);
}

export interface ReserveResult {
  booking: OctoBooking;
  repeated: boolean;
}

/**
 * RESERVAR: retener la plaza sin cobrar.
 *
 * El reintento se resuelve ANTES de escribir nada. Un revendedor reintenta
 * —se le cae la conexión, su cola lo reencola— y sin esto cada reintento
 * apartaría otras tres plazas para el mismo pasajero, que es cómo se queda una
 * guagua con asientos vacíos que el sistema daba por vendidos.
 */
export async function reserve(ctx: OctoContext, input: ReservationInput): Promise<ReserveResult> {
  // También aquí: la comprobación de cupo que viene a continuación tiene que
  // ver las plazas reales, no las que retiene un carrito que ya venció.
  await sweepExpiredOctoHolds(ctx.companyId);

  const existing = await loadRow(ctx, input.uuid);
  if (existing) return { booking: await bookingView(ctx, existing), repeated: true };

  const { product, modality } = await assertProductOption(ctx, input.productId, input.optionId);

  // ── la fecha ────────────────────────────────────────────────────────────
  let departureId: string | null = null;
  let travelDate: string | null = null;
  const productHasDepartures = (await hasDepartures(ctx.companyId, [product._id])).has(product._id);

  if (input.availabilityId) {
    const [departure] = await departuresFor(ctx.companyId, product._id, windowOf(), [input.availabilityId]);
    if (!departure) {
      throw new OctoError("INVALID_AVAILABILITY_ID", "Esa fecha no existe para este producto.", {
        productId: product._id, availabilityId: input.availabilityId,
      });
    }
    if (!SELLABLE_DEPARTURE.has((departure.status ?? "").toLowerCase())) {
      throw new OctoError("UNPROCESSABLE_ENTITY", "Esa salida ya no admite reservas.", {
        productId: product._id, availabilityId: input.availabilityId,
      });
    }
    departureId = departure._id;
    travelDate = departure.departure_at ?? null;
  } else if (productHasDepartures) {
    // El producto se vende contra salidas y no vino ninguna: reservar «para
    // cualquier día» dejaría una reserva sin cupo comprobado y sin manifiesto.
    throw new OctoError("INVALID_AVAILABILITY_ID", "Este producto se vende por fecha: manda el availabilityId.", {
      productId: product._id,
    });
  }

  const pax = paxOf(input.unitItems);
  const customerId = await resolveCustomer(ctx.companyId, input);

  /**
   * El contexto de una venta SIN usuario, igual que el del motor público: el
   * rango es el mínimo que permite vender y el identificador va vacío a
   * propósito, para que la reserva quede marcada como lo que es —entrada de un
   * revendedor— en vez de atribuírsela a alguien del equipo.
   */
  const saleCtx = {
    userId: "", email: "", name: "OTA", role: "seller",
    companyId: ctx.companyId, partnerId: ctx.partnerId, branchId: null, company: ctx.company,
  } as unknown as TenantContext & { companyId: string };

  const result = await createOrderWithBookings(saleCtx, {
    customer_id: customerId,
    partner_id: ctx.partnerId,
    channel: "ota",
    items: [{
      product_id: product._id,
      departure_id: departureId ?? undefined,
      modality_id: modality?._id ?? undefined,
      adults: pax.adults,
      children: pax.children,
      infants: pax.infants,
      notes: input.notes ?? undefined,
    }],
  } as never);

  const booking = result.bookings[0];
  const bookingId = String(booking?._id ?? "");
  if (!bookingId) throw new OctoError("INTERNAL_SERVER_ERROR", "La reserva no llegó a crearse.");

  // La retención que se le prometió al revendedor manda sobre la de mostrador:
  // 30 minutos de una OTA no son las 24 horas de una transferencia bancaria.
  const minutes = holdMinutesFor(
    input.expirationMinutes,
    (ctx.company as { octo_max_hold_minutes?: number } | null)?.octo_max_hold_minutes ?? null
  );
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();

  await supabaseService().from("sales_order")
    .update({ hold_until: expiresAt, idempotency_key: `octo:${input.uuid}` })
    .eq("organization_id", ctx.companyId)
    .eq("id", String(result.order._id));

  await supabaseService().from("booking").update({
    octo_uuid: input.uuid,
    octo_option_id: input.optionId,
    octo_status: "ON_HOLD",
    octo_reseller_reference: input.resellerReference,
    octo_unit_items: input.unitItems,
    octo_contact: input.contact,
    octo_api_key_id: ctx.keyId,
  }).eq("organization_id", ctx.companyId).eq("id", bookingId);

  const row = await loadRow(ctx, input.uuid);
  if (!row) throw new OctoError("INTERNAL_SERVER_ERROR", "La reserva se creó pero no se pudo releer.");
  void travelDate;
  void seatsOf(input.unitItems);
  return { booking: await bookingView(ctx, row), repeated: false };
}

/**
 * CONFIRMAR: la retención se convierte en venta.
 *
 * Confirmar una reserva vencida no vale y el estándar es explícito: la plaza ya
 * volvió a la venta y puede haberla comprado otro. Decir que sí y luego no
 * tener asiento es peor que negarse ahora.
 */
export async function confirmBooking(
  ctx: OctoContext,
  uuid: string,
  patch: { resellerReference?: string | null; contact?: unknown }
): Promise<OctoBooking> {
  const row = await loadRow(ctx, uuid);
  if (!row) throw new OctoError("INVALID_BOOKING_UUID", "No hay ninguna reserva con ese uuid.", { uuid });

  const holdUntil = await holdUntilOf(ctx.companyId, row.order_id);
  const status = octoStatusOf({ stored: row.octo_status, internal: row.status, holdUntil });
  const verdict = canTransition(status, "confirm");
  if (!verdict.ok) throw new OctoError(verdict.code ?? "UNPROCESSABLE_ENTITY", verdict.message ?? "", { uuid });
  if (status === "CONFIRMED") return bookingView(ctx, row);

  const now = new Date().toISOString();
  await supabaseService().from("booking").update({
    status: "confirmed",
    octo_status: "CONFIRMED",
    octo_confirmed_at: now,
    ...(patch.resellerReference ? { octo_reseller_reference: patch.resellerReference } : {}),
    ...(patch.contact ? { octo_contact: patch.contact } : {}),
  }).eq("organization_id", ctx.companyId).eq("id", row.id);

  // La retención deja de correr: confirmada, la plaza ya no se libera sola.
  if (row.order_id) {
    await supabaseService().from("sales_order")
      .update({ hold_until: null, status: "confirmed" })
      .eq("organization_id", ctx.companyId).eq("id", row.order_id);
    await syncOrderTotals(ctx.companyId, row.order_id);
  }

  const fresh = await loadRow(ctx, uuid);
  return bookingView(ctx, fresh ?? row);
}

/**
 * PRORROGAR la retención.
 *
 * Existe porque el revendedor la necesita —el cliente está pagando con tarjeta
 * y el cobro tarda— y porque sin ella la alternativa es cancelar y volver a
 * reservar, que suelta la plaza en medio y puede perderla.
 */
export async function extendBooking(ctx: OctoContext, uuid: string, minutes: number): Promise<OctoBooking> {
  const row = await loadRow(ctx, uuid);
  if (!row) throw new OctoError("INVALID_BOOKING_UUID", "No hay ninguna reserva con ese uuid.", { uuid });

  const holdUntil = await holdUntilOf(ctx.companyId, row.order_id);
  const status = octoStatusOf({ stored: row.octo_status, internal: row.status, holdUntil });
  const verdict = canTransition(status, "extend");
  if (!verdict.ok) throw new OctoError(verdict.code ?? "UNPROCESSABLE_ENTITY", verdict.message ?? "", { uuid });

  const capped = holdMinutesFor(
    minutes,
    (ctx.company as { octo_max_hold_minutes?: number } | null)?.octo_max_hold_minutes ?? null
  );
  if (row.order_id) {
    await supabaseService().from("sales_order")
      .update({ hold_until: new Date(Date.now() + capped * 60_000).toISOString() })
      .eq("organization_id", ctx.companyId).eq("id", row.order_id);
  }
  const fresh = await loadRow(ctx, uuid);
  return bookingView(ctx, fresh ?? row);
}

/**
 * CANCELAR: exactamente lo mismo que cancelar de mostrador.
 *
 * Pasa por `cancelBookingFully`, que suelta la plaza, anula la comisión,
 * devuelve el cupo del socio, cancela el devengo del proveedor, libera las
 * existencias apartadas, invalida el voucher y avisa. Escribir aquí un
 * `status: 'cancelled'` y devolver 200 sería mucho más corto y dejaría la
 * operación mintiendo en seis sitios a la vez.
 */
export async function cancelBooking(
  ctx: OctoContext,
  uuid: string,
  options: { reason?: string | null; force?: boolean }
): Promise<OctoBooking> {
  const row = await loadRow(ctx, uuid);
  if (!row) throw new OctoError("INVALID_BOOKING_UUID", "No hay ninguna reserva con ese uuid.", { uuid });

  const holdUntil = await holdUntilOf(ctx.companyId, row.order_id);
  const status = octoStatusOf({ stored: row.octo_status, internal: row.status, holdUntil });
  const verdict = canTransition(status, "cancel");
  if (!verdict.ok) throw new OctoError(verdict.code ?? "UNPROCESSABLE_ENTITY", verdict.message ?? "", { uuid });

  // Ya estaba cancelada: se contesta lo mismo en vez de reembolsar dos veces.
  if (status === "CANCELLED" || (row.status && TERMINAL_STATES.includes(row.status))) {
    if (row.octo_status !== "CANCELLED") {
      await supabaseService().from("booking").update({ octo_status: "CANCELLED" })
        .eq("organization_id", ctx.companyId).eq("id", row.id);
    }
    const same = await loadRow(ctx, uuid);
    return bookingView(ctx, same ?? row);
  }

  const cancelCtx = {
    userId: "", email: "", name: "OTA", role: "seller",
    companyId: ctx.companyId, partnerId: ctx.partnerId, branchId: null, company: ctx.company,
  } as unknown as TenantContext & { companyId: string };

  const booking = await tenantQuery<Record<string, unknown>>(ctx.companyId, "booking", {
    _filter: { _id: row.id }, _limit: 1, product: true, departure: true,
  });
  if (!booking[0]) throw new OctoError("INTERNAL_SERVER_ERROR", "No se pudo leer la reserva para cancelarla.");

  await cancelBookingFully(cancelCtx, booking[0] as never, {
    reason: options.reason || "Cancelada por el revendedor",
  });

  await supabaseService().from("booking").update({ octo_status: "CANCELLED" })
    .eq("organization_id", ctx.companyId).eq("id", row.id);

  const fresh = await loadRow(ctx, uuid);
  return bookingView(ctx, fresh ?? row);
}

/* ══════════════════════════════════════════════════════ retenciones ══ */

/**
 * BARRER LAS RETENCIONES VENCIDAS DE OTA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTA CON EL CRON QUE YA EXISTE
 *
 * El barrido de retenciones (`releaseExpiredHolds`, dentro del cron de cobros)
 * corre UNA VEZ AL DÍA, y está bien para lo que se pensó: una venta de
 * mostrador que se paga por transferencia y se retiene 24 horas.
 *
 * Una retención de OTA dura TREINTA MINUTOS. Esperar al barrido diario
 * significa que la plaza de un carrito abandonado a las nueve de la mañana
 * sigue bloqueada a las siete de la tarde: la salida dice «completo» con
 * asientos que nadie compró, y el revendedor que sí tenía un cliente recibe
 * SOLD_OUT.
 *
 * Por eso esto se llama TAMBIÉN desde las consultas de disponibilidad y desde
 * la propia reserva. Quien pregunta por plazas es exactamente quien necesita
 * que estén al día, y el coste habitual es una consulta indexada que no
 * devuelve nada.
 *
 * El orden importa: primero se MARCA `EXPIRED` y después se cancela. Al revés,
 * la cancelación dejaría la reserva en un estado terminal y el revendedor
 * leería CANCELLED —una incidencia que atender— en vez de EXPIRED, que es suya
 * por no haber pagado a tiempo.
 */
export async function sweepExpiredOctoHolds(companyId: string, now: Date = new Date()): Promise<number> {
  const sb = supabaseService();

  // Las ventas con la retención pasada. Es la consulta barata y la que casi
  // siempre vuelve vacía: si no hay ninguna, no se toca nada más.
  const { data: orders } = await sb
    .from("sales_order")
    .select("id")
    .eq("organization_id", companyId)
    .eq("status", "pending_payment")
    .not("hold_until", "is", null)
    .lt("hold_until", now.toISOString())
    .limit(200);

  const orderIds = (orders ?? []).map((o) => String(o.id));
  if (orderIds.length === 0) return 0;

  const { data } = await sb
    .from("booking")
    .select("id")
    .eq("organization_id", companyId)
    .eq("octo_status", "ON_HOLD")
    .in("order_id", orderIds)
    .limit(200);

  const ids = (data ?? []).map((row) => String(row.id));
  if (ids.length > 0) {
    await sb.from("booking").update({ octo_status: "EXPIRED" })
      .eq("organization_id", companyId).in("id", ids);
  }

  // Y ahora sí se suelta la plaza de verdad, con el mismo camino de siempre:
  // compensa la venta, libera el cupo de la salida y devuelve el del socio.
  try {
    await releaseExpiredHolds(companyId, now);
  } catch (err) {
    // Que no se pueda compensar una venta no puede impedir contestar la
    // disponibilidad: la marca de vencida ya quedó puesta.
    console.error("[octo] no se pudieron liberar las retenciones vencidas:", err);
  }
  return ids.length;
}

/* ════════════════════════════════════════════════════ para la pantalla ══ */

export interface ChannelRow {
  partnerId: string | null;
  partnerName: string;
  keyId: string | null;
  bookings: number;
  onHold: number;
  confirmed: number;
  cancelled: number;
  expired: number;
  redeemed: number;
  revenue: number;
  lastAt: string | null;
}

/**
 * El resumen por canal que ve la operadora.
 *
 * Se calcula sobre el estado RECONCILIADO, no sobre la columna: si un cupo de
 * retenciones venció y el barrido todavía no pasó, enseñar «12 retenidas»
 * haría que la operadora creyera que tiene doce ventas a punto de cerrar.
 */
export async function octoChannels(companyId: string, days = 90): Promise<ChannelRow[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const sb = supabaseService();
  const { data } = await sb
    .from("booking")
    .select("id,partner_id,octo_status,status,order_id,total_amount,created_at,octo_test_mode")
    .eq("organization_id", companyId)
    .not("octo_uuid", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = data ?? [];
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean).map(String))];
  const holds = new Map<string, string | null>();
  if (orderIds.length > 0) {
    const { data: orders } = await sb.from("sales_order").select("id,hold_until")
      .eq("organization_id", companyId).in("id", orderIds).limit(2000);
    for (const order of orders ?? []) holds.set(String(order.id), (order.hold_until as string | null) ?? null);
  }

  const partnerIds = [...new Set(rows.map((r) => r.partner_id).filter(Boolean).map(String))];
  const names = new Map<string, string>();
  if (partnerIds.length > 0) {
    const { data: partners } = await sb.from("partner").select("id,name")
      .eq("organization_id", companyId).in("id", partnerIds).limit(500);
    for (const partner of partners ?? []) names.set(String(partner.id), String(partner.name || "Socio"));
  }

  const byPartner = new Map<string, ChannelRow>();
  for (const row of rows) {
    // Las reservas de prueba no son negocio: una certificación con la OTA
    // dejaría el panel enseñando ventas que nunca existieron.
    if (row.octo_test_mode === true) continue;
    const key = String(row.partner_id ?? "");
    const current = byPartner.get(key) ?? {
      partnerId: row.partner_id ? String(row.partner_id) : null,
      partnerName: row.partner_id ? (names.get(String(row.partner_id)) ?? "Socio") : "Sin socio asignado",
      keyId: null, bookings: 0, onHold: 0, confirmed: 0, cancelled: 0, expired: 0, redeemed: 0,
      revenue: 0, lastAt: null,
    };

    const status = octoStatusOf({
      stored: row.octo_status as string | null,
      internal: row.status as string | null,
      holdUntil: row.order_id ? holds.get(String(row.order_id)) ?? null : null,
    });

    current.bookings += 1;
    if (status === "ON_HOLD") current.onHold += 1;
    else if (status === "CONFIRMED") current.confirmed += 1;
    else if (status === "CANCELLED") current.cancelled += 1;
    else if (status === "EXPIRED") current.expired += 1;
    else if (status === "REDEEMED") current.redeemed += 1;

    if (status === "CONFIRMED" || status === "REDEEMED") current.revenue += Number(row.total_amount ?? 0);
    const at = String(row.created_at);
    if (!current.lastAt || at > current.lastAt) current.lastAt = at;
    byPartner.set(key, current);
  }

  return [...byPartner.values()].sort((a, b) => b.bookings - a.bookings);
}

/** Las últimas reservas entrantes, para la lista de la pantalla. */
export async function recentOctoBookings(companyId: string, limit = 50) {
  const sb = supabaseService();
  const { data } = await sb
    .from("booking")
    .select("id,booking_number,octo_uuid,octo_status,octo_reseller_reference,octo_test_mode,status,order_id,travel_date,total_amount,currency,adults,children,infants,partner_id,product_id,created_at")
    .eq("organization_id", companyId)
    .not("octo_uuid", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = data ?? [];
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean).map(String))];
  const holds = new Map<string, string | null>();
  if (orderIds.length > 0) {
    const { data: orders } = await sb.from("sales_order").select("id,hold_until")
      .eq("organization_id", companyId).in("id", orderIds).limit(500);
    for (const order of orders ?? []) holds.set(String(order.id), (order.hold_until as string | null) ?? null);
  }

  const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean).map(String))];
  const products = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: list } = await sb.from("product").select("id,name")
      .eq("organization_id", companyId).in("id", productIds).limit(300);
    for (const product of list ?? []) products.set(String(product.id), String(product.name || ""));
  }

  const partnerIds = [...new Set(rows.map((r) => r.partner_id).filter(Boolean).map(String))];
  const partners = new Map<string, string>();
  if (partnerIds.length > 0) {
    const { data: list } = await sb.from("partner").select("id,name")
      .eq("organization_id", companyId).in("id", partnerIds).limit(300);
    for (const partner of list ?? []) partners.set(String(partner.id), String(partner.name || ""));
  }

  return rows.map((row) => ({
    id: String(row.id),
    reference: String(row.booking_number ?? ""),
    uuid: String(row.octo_uuid ?? ""),
    resellerReference: (row.octo_reseller_reference as string | null) ?? null,
    testMode: row.octo_test_mode === true,
    status: octoStatusOf({
      stored: row.octo_status as string | null,
      internal: row.status as string | null,
      holdUntil: row.order_id ? holds.get(String(row.order_id)) ?? null : null,
    }),
    holdUntil: row.order_id ? holds.get(String(row.order_id)) ?? null : null,
    product: row.product_id ? products.get(String(row.product_id)) ?? "" : "",
    partner: row.partner_id ? partners.get(String(row.partner_id)) ?? "" : "",
    travelDate: (row.travel_date as string | null) ?? null,
    pax: Number(row.adults ?? 0) + Number(row.children ?? 0) + Number(row.infants ?? 0),
    total: Number(row.total_amount ?? 0),
    currency: String(row.currency || "usd"),
    createdAt: String(row.created_at),
  }));
}

/** Para el contrato de esquema: las columnas OCTO que la aplicación escribe. */
export const OCTO_BOOKING_FIELDS = [
  "octo_uuid", "octo_option_id", "octo_status", "octo_reseller_reference",
  "octo_unit_items", "octo_contact", "octo_test_mode", "octo_confirmed_at", "octo_api_key_id",
] as const;

void tenantUpdate;
