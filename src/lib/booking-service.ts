import "server-only";
import { tenantCreate, tenantQuery, tenantUpdate, type TenantContext } from "@/lib/tenant";
import { resolvePrice, resolveCost, billablePax } from "@/lib/pricing";
import { assertCapacity, recalculateDeparture, OversellError } from "@/lib/availability";
import { resolveExchangeRate } from "@/lib/currency";
import { uniqueCode } from "@/lib/unique";
import { resolveCommissions, type BeneficiaryDescriptor } from "@/lib/commission-engine";
import { writeAudit } from "@/lib/audit";
import { newBookingNumber, newOrderNumber, newVoucherCode, newDocumentNumber } from "@/lib/codes";
import { notifyBookingCreated } from "@/lib/messaging/events";
import { notify } from "@/lib/notify-service";
import { formatDate } from "@/lib/format";
import { ensureSchedule, refreshAllocation } from "@/lib/schedule-service";
import { creditCheck, holdUntil } from "@/lib/collections";
import { accrueBookingCosts, cancelBookingCosts } from "@/lib/supplier-settlement-service";
import { reserveForSale, stockableOffers } from "@/lib/stock-commitment-service";
import { priceExtras, unknownSelections, type ExtraOffer, type ExtraSelection } from "@/lib/extras";
import type {
  Booking, Channel, Currency, Departure, Order, Partner, Product, Seller,
} from "@/lib/types";
import { refId } from "@/lib/types";

/**
 * Booking service — the single write-path for sales.
 *
 * One order can hold many items (multi-product cart):
 *   Order → OrderItems (bookings) → participants / voucher / commissions / receivable
 *
 * Everything that must stay consistent (availability counters, financial
 * snapshots, commission obligations) is handled here so no caller can bypass it.
 */

export interface BookingItemInput {
  product_id: string;
  departure_id?: string | null;
  modality_id?: string | null;
  adults?: number;
  children?: number;
  infants?: number;
  discount_pct?: number;
  tax_pct?: number;
  pickup_hotel_id?: string | null;
  pickup_time?: string | null;
  pickup_location?: string | null;
  room_number?: string | null;
  notes?: string | null;
  participants?: { full_name: string; age?: number; category?: string; document_id?: string; special_requirements?: string }[];
  /**
   * Precio y coste pactados que sustituyen a los del catálogo.
   *
   * Solo los fija el servidor al convertir una cotización aceptada: es el precio
   * que el cliente firmó. La ruta HTTP los borra del payload (`/api/orders`),
   * porque de lo contrario cualquiera con permiso de venta podría venderse un
   * tour al precio que quisiera.
   */
  unit_price_override?: number | null;
  /** Coste TOTAL de la línea pactado con el proveedor (no unitario). */
  cost_override?: number | null;
  /**
   * Extras contratados con este producto (almuerzo, foto, transfer premium).
   * Los obligatorios del catálogo se añaden solos aunque no vengan aquí.
   */
  extras?: ExtraSelection[];
  /** Cotización de la que sale ese precio, para el snapshot inmutable. */
  quote_id?: string | null;
}

export interface CreateOrderInput {
  customer_id: string;
  branch_id?: string | null;
  seller_id?: string | null;
  partner_id?: string | null;
  promotion_id?: string | null;
  channel?: Channel;
  currency?: Currency;
  exchange_rate?: number;
  notes?: string | null;
  items: BookingItemInput[];
  /** Authorised users may exceed the departure capacity; always audited. */
  capacity_override?: boolean;
  override_reason?: string | null;
  /**
   * Condiciones de cobro pactadas: anticipo, vencimientos y plazos.
   *
   * Vienen de la cotización aceptada. Antes se quedaban en la cotización y la
   * venta nacía sin ellas, así que lo que el cliente firmó —"30% ahora, el
   * resto quince días antes"— no llegaba a existir en el sistema.
   */
  /**
   * Vender a un socio por encima de su límite de crédito. Decisión de gestión,
   * siempre auditada: la ruta HTTP exige rango de manager.
   */
  allow_over_credit?: boolean;
  terms?: {
    deposit_type?: string | null;
    deposit_percent?: number | null;
    deposit_amount?: number | null;
    deposit_due_date?: string | null;
    balance_due_date?: string | null;
    payment_terms?: string | null;
  } | null;
}

export interface CreateOrderResult {
  order: Order;
  bookings: Booking[];
  commissionsCreated: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Coerces a pax count to a non-negative integer (AUD-B08). */
function toCount(value: unknown): number {
  const n = Math.floor(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Estimación del total de una venta antes de construirla.
 *
 * Solo la usa el control de crédito. Resuelve el precio de cada línea con el
 * mismo motor que la venta real, pero sin escribir nada: hace falta un importe
 * para comparar contra el límite, y armar la orden entera para descubrir al
 * final que no cabía dejaría reservas que habría que compensar.
 */
async function estimateOrderTotal(
  companyId: string,
  input: CreateOrderInput,
  currency: Currency,
  exchangeRate: number
): Promise<number> {
  let total = 0;
  for (const item of input.items) {
    const adults = toCount(item.adults);
    const children = toCount(item.children);
    const billable = billablePax(adults, children);
    const departure = item.departure_id
      ? ((await tenantQuery<Departure>(companyId, "departure", {
          _filter: { _id: item.departure_id }, _limit: 1,
        }))[0] ?? null)
      : null;
    const price = await resolvePrice({
      companyId,
      productId: item.product_id,
      modalityId: item.modality_id,
      partnerId: input.partner_id,
      sellerId: input.seller_id,
      channel: (input.channel || "direct") as Channel,
      quantity: billable,
      travelDate: departure?.departure_at ?? null,
      discountPct: item.discount_pct ?? 0,
      taxPct: item.tax_pct ?? 0,
      exchangeRate,
      unitPriceOverride: item.unit_price_override ?? null,
      overrideCurrency: currency,
      quoteId: item.quote_id ?? null,
    });
    total += price.totalAmount ?? 0;
  }
  return round2(total);
}

/** La salida más próxima del pedido, que acota hasta cuándo se retiene la plaza. */
async function firstDeparture(companyId: string, input: CreateOrderInput): Promise<string | null> {
  const ids = input.items
    .map((item) => item.departure_id)
    .filter((id): id is string => typeof id === "string" && id !== "");
  if (ids.length === 0) return null;
  const departures = await tenantQuery<Departure>(companyId, "departure", {
    _filter: { _id: { in: ids } }, _limit: 50, _sort: { departure_at: "asc" },
  });
  return departures[0]?.departure_at ?? null;
}

export async function createOrderWithBookings(
  ctx: TenantContext & { companyId: string },
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  if (!input.items?.length) throw new Error("La orden debe incluir al menos un producto");

  const companyId = ctx.companyId;
  const currency = (input.currency || ctx.company?.base_currency || "usd") as Currency;
  // AUD-F30: resolve the base-currency rate on the server from `currency_rate`,
  // never trusting the client's `exchange_rate` (which defaulted to 1 and made
  // `base_currency_total` meaningless for non-base-currency sales).
  const baseCurrency = ctx.company?.base_currency || currency;
  const exchangeRate = await resolveExchangeRate(companyId, currency, baseCurrency);
  const holdHours = Number((ctx.company as { hold_hours?: number } | null)?.hold_hours ?? 0) || 0;
  const channel = (input.channel || "direct") as Channel;

  // ---- validate capacity before writing anything --------------------------
  // AUD-B01: aggregate requested pax PER DEPARTURE across all items. Previously
  // each item was validated in isolation, so two items on the same departure
  // with one seat left both passed and both got booked.
  const paxByDeparture = new Map<string, number>();
  for (const item of input.items) {
    if (!item.departure_id) continue;
    const pax = toCount(item.adults) + toCount(item.children) + toCount(item.infants);
    paxByDeparture.set(item.departure_id, (paxByDeparture.get(item.departure_id) ?? 0) + pax);
  }
  for (const [departureId, pax] of paxByDeparture) {
    await assertCapacity(companyId, departureId, pax, input.capacity_override === true);
  }

  // ---- order shell --------------------------------------------------------
  // AUD-F34: keep this multi-write flow as a saga until the domain has a DB transaction/RPC.
  // order starts as `draft`; only after every child (bookings, vouchers,
  // commissions, receivable) is written does it get PROMOTED to
  // `pending_payment`. If any step fails we COMPENSATE — cancel the bookings
  // created so far (releasing their seats) and void the order — so a failure
  // can never leave a "phantom" order with live seats but zero total, or a B2B
  // sale with no receivable that nobody would ever collect.
  // ---- límite de crédito del socio (0039) --------------------------------
  // `credit_limit` llevaba desde la migración 0002 sin que nada lo mirara: se
  // podía vender a crédito a un tour center sin techo, y el descubierto solo
  // aparecía cuando ya no pagaba. Se comprueba ANTES de escribir la orden, con
  // lo que ya debe según sus documentos abiertos.
  if (input.partner_id) {
    const creditTerms = (await tenantQuery<Partner>(companyId, "partner", {
      _filter: { _id: input.partner_id }, _limit: 1,
    }))[0];
    if (Number(creditTerms?.credit_limit ?? 0) > 0) {
      const open = await tenantQuery<{ balance?: number; amount?: number; paid_amount?: number }>(
        companyId, "receivable", {
          _filter: { partner: input.partner_id, status: { nin: ["paid", "written_off"] } },
          _limit: 500,
        }
      );
      const outstanding = open.reduce(
        (sum, row) => sum + (row.balance ?? Math.max((row.amount ?? 0) - (row.paid_amount ?? 0), 0)),
        0
      );
      // Se estima con el precio de catálogo antes de armar las reservas: es
      // aproximado a propósito, porque la alternativa es construir la venta
      // entera para descubrir al final que no cabía.
      const estimate = await estimateOrderTotal(companyId, input, currency, exchangeRate);
      const verdict = creditCheck(creditTerms, outstanding, estimate);
      if (!verdict.allowed && input.allow_over_credit !== true) {
        throw Object.assign(new Error(verdict.reason || "Supera el límite de crédito"), { status: 409 });
      }
      if (!verdict.allowed) {
        await writeAudit({
          companyId, userId: ctx.userId,
          action: "credit_limit_override", entityType: "partner", entityId: input.partner_id,
          description: `Venta autorizada por encima del límite de crédito: debe ${outstanding} de ${verdict.limit}, y la venta suma ${estimate}`,
          severity: "warning",
          metadata: { outstanding, limit: verdict.limit, estimate },
        });
      }
    }
  }

  const order = await tenantCreate<Order>(companyId, "order", {
    order_number: await uniqueCode(companyId, "order", "order_number", newOrderNumber),
    customer: input.customer_id,
    // La sucursal de quien vende, salvo que la venta diga otra. Sin esto, la
    // venta del tour center nacía sin sucursal y el corte por punto de venta
    // dejaba fuera justo lo que se quería separar.
    branch: input.branch_id || ctx.branchId || undefined,
    seller: input.seller_id || undefined,
    partner: input.partner_id || undefined,
    promotion: input.promotion_id || undefined,
    // Vacío en una reserva del motor público: no la creó nadie del equipo, y
    // meter una cadena vacía en una columna de identificador la rompe.
    created_by: ctx.userId || undefined,
    channel,
    status: "draft",
    order_date: new Date().toISOString(),
    currency,
    exchange_rate: exchangeRate,
    base_currency: ctx.company?.base_currency || currency,
    subtotal: 0, discount_total: 0, tax_total: 0,
    total: 0, paid_total: 0, balance: 0, base_currency_total: 0,
    notes: input.notes || undefined,
    // Lo pactado en la cotización viaja a la venta. Sin esto, el calendario de
    // cobro se construía con la política genérica del producto y el cliente
    // recibía un vencimiento que nadie había acordado con él.
    deposit_type: input.terms?.deposit_type || "none",
    deposit_percent: input.terms?.deposit_percent ?? undefined,
    deposit_amount: input.terms?.deposit_amount ?? undefined,
    deposit_due_date: input.terms?.deposit_due_date || undefined,
    balance_due_date: input.terms?.balance_due_date || undefined,
    payment_terms: input.terms?.payment_terms || undefined,
    collection_status: "none",
    // Hasta cuándo se guarda la plaza sin haber cobrado nada. Solo si la empresa
    // lo configuró: sin política, nada expira y el comportamiento es el de
    // siempre. La primera salida acota el plazo —una plaza retenida para un
    // viaje que ya salió no la reclama nadie.
    hold_until: holdHours > 0
      ? holdUntil(new Date(), holdHours, await firstDeparture(companyId, input))
      : undefined,
  });

  const bookings: Booking[] = [];
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let grandTotal = 0;
  let commissionsCreated = 0;
  let totals = {
    subtotal: 0, discount_total: 0, tax_total: 0,
    total: 0, balance: 0, base_currency_total: 0,
  };

  try {
  for (const item of input.items) {
    // AUD-B08: validate pax before anything is written. Non-integer or negative
    // counts previously flowed straight into `pax_total`, and a negative pax
    // *subtracts* from a departure's occupancy (inflating availability). Every
    // booking must carry at least one traveller.
    const adults = toCount(item.adults);
    const children = toCount(item.children);
    const infants = toCount(item.infants);
    const paxTotal = adults + children + infants;
    if (paxTotal < 1) {
      throw Object.assign(new Error("La reserva debe incluir al menos un participante"), { status: 400 });
    }
    const billable = billablePax(adults, children);

    // AUD-F01: load the departure BEFORE pricing so seasonal / weekday rules
    // resolve against the real travel date. Previously `travelDate: null` meant
    // every season/weekday price rule was ignored at sale time even though the
    // quote endpoint applied them — the customer was quoted one price and
    // charged another.
    const departure = item.departure_id
      ? ((await tenantQuery<Departure>(companyId, "departure", {
          _filter: { _id: item.departure_id }, _limit: 1, product: true,
        }))[0] ?? null)
      : null;
    const travelDate = departure?.departure_at ?? null;

    const price = await resolvePrice({
      companyId,
      productId: item.product_id,
      modalityId: item.modality_id,
      partnerId: input.partner_id,
      sellerId: input.seller_id,
      channel,
      quantity: billable,
      travelDate,
      discountPct: item.discount_pct ?? 0,
      taxPct: item.tax_pct ?? 0,
      exchangeRate,
      unitPriceOverride: item.unit_price_override ?? null,
      overrideCurrency: currency,
      quoteId: item.quote_id ?? null,
    });

    // AUD-F03: an order carries a single currency. If a line resolves to a
    // different currency (e.g. a DOP price rule inside a USD order), the totals
    // would sum different currencies 1:1 and be meaningless — reject instead.
    if (price.currency && price.currency !== currency) {
      throw Object.assign(
        new Error(
          `El producto tiene precio en ${String(price.currency).toUpperCase()} pero la orden es en ${String(currency).toUpperCase()}. Una orden no puede mezclar monedas.`
        ),
        { status: 400 }
      );
    }

    const productRow = (await tenantQuery<Product>(companyId, "product", {
      _filter: { _id: item.product_id }, _limit: 1,
    }))[0];

    // Un coste pactado con el proveedor para este grupo manda sobre la tarifa
    // general del catálogo: si no, el margen de la venta no es el que se negoció.
    const cost = item.cost_override !== null && item.cost_override !== undefined
      ? round2(Math.max(Number(item.cost_override) || 0, 0))
      // La base de una tarifa por porcentaje es la venta DEL PRODUCTO, sin los
      // extras: el almuerzo tiene su propio proveedor y su propio costo, y
      // meterlo en la base le pagaría dos veces al del tour.
      : await resolveCost(companyId, item.product_id, billable, productRow?.base_cost ?? 0, {
          revenue: price.grossAmount,
        });
    const voucherCode = await uniqueCode(companyId, "voucher", "code", newVoucherCode);

    // ---- extras -----------------------------------------------------------
    // Se valoran ANTES de crear la reserva para que su importe entre en el
    // total desde el principio: sumarlos después dejaría la reserva un instante
    // con un total que no es el que se va a cobrar, y ese instante es el que ve
    // cualquier cálculo concurrente.
    const offers = await tenantQuery<ExtraOffer>(companyId, "product_extra", {
      _filter: { product: item.product_id, status: "active" }, _limit: 50, _sort: { sort_order: "asc" },
    });
    const selections = item.extras ?? [];
    const strangers = unknownSelections(offers, selections);
    if (strangers.length > 0) {
      // Cobrar de menos en silencio es peor que fallar: un extra que el catálogo
      // no reconoce significa una pestaña vieja o un payload a mano.
      throw Object.assign(
        new Error("Hay extras seleccionados que ya no están disponibles para este producto"),
        { status: 409 }
      );
    }
    const extras = priceExtras(offers, selections, billable);

    // El impuesto se aplica TAMBIÉN sobre los extras. Sumarlos después del
    // impuesto los dejaba exentos, y en un grupo de 40 con almuerzo de 35 eso
    // son 1.400 de base sin ITBIS: un error de declaración, no un redondeo.
    // El descuento, en cambio, se queda en el tour: un 10% pactado sobre la
    // excursión no rebaja la langosta que el cliente añadió aparte.
    const taxPct = Math.max(item.tax_pct ?? 0, 0);
    const grossAmount = round2(price.grossAmount + extras.total);
    const netAmount = round2(grossAmount - price.discountAmount);
    const taxAmount = round2((netAmount * taxPct) / 100);
    const totalAmount = round2(netAmount + taxAmount);
    const costAmount = round2(cost + extras.cost);

    const booking = await tenantCreate<Booking>(companyId, "booking", {
      booking_number: await uniqueCode(companyId, "booking", "booking_number", newBookingNumber),
      order: order._id,
      customer: input.customer_id,
      product: item.product_id,
      departure: item.departure_id || undefined,
      modality: item.modality_id || undefined,
      branch: input.branch_id || ctx.branchId || undefined,
      seller: input.seller_id || undefined,
      partner: input.partner_id || undefined,
      pickup_hotel: item.pickup_hotel_id || undefined,
      created_by: ctx.userId || undefined,
      channel,
      status: "pending_payment",
      booking_date: new Date().toISOString(),
      travel_date: travelDate || undefined,
      adults, children, infants, pax_total: paxTotal,
      unit_price: price.unitPrice,
      gross_amount: grossAmount,
      discount_amount: price.discountAmount,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      cost_amount: costAmount,
      extras_amount: extras.total,
      extras_cost: extras.cost,
      // AUD-F05: margin excludes tax (tax is not revenue). Previously used
      // `totalAmount` (tax included) with dead `* 0` code, inflating margin.
      margin_amount: round2(netAmount - costAmount),
      paid_amount: 0,
      balance_amount: totalAmount,
      refund_amount: 0,
      currency: price.currency,
      exchange_rate: exchangeRate,
      base_currency: ctx.company?.base_currency || price.currency,
      base_amount: round2(totalAmount * exchangeRate),
      price_snapshot: JSON.stringify(price.snapshot),
      pickup_time: item.pickup_time || undefined,
      pickup_location: item.pickup_location || undefined,
      room_number: item.room_number || undefined,
      voucher_code: voucherCode,
      checkin_status: "pending",
      checked_in_pax: 0,
      capacity_override: input.capacity_override === true,
      override_reason: input.override_reason || undefined,
      notes: item.notes || undefined,
    });

    // ---- líneas de extra ---------------------------------------------------
    // El nombre y el precio se COPIAN: si el extra se renombra o sube de precio,
    // el voucher de esta reserva tiene que seguir diciendo qué se compró y por
    // cuánto.
    const extraRows: { bookingExtraId: string; extraId: string; units: number }[] = [];
    for (const line of extras.lines) {
      const row = await tenantCreate<{ _id: string }>(companyId, "booking_extra", {
        booking: booking._id,
        extra: line.extra_id,
        name: line.name,
        price_type: line.price_type,
        quantity: line.quantity,
        unit_price: line.unit_price,
        unit_cost: line.unit_cost ?? undefined,
        total_amount: line.total_amount,
        cost_amount: line.cost_amount,
        currency: line.currency,
      });
      extraRows.push({ bookingExtraId: row._id, extraId: line.extra_id, units: line.quantity });
    }

    // ---- apartar las existencias de lo vendido (0052) ---------------------
    // Un almuerzo vendido para el jueves sigue en el almacén, pero ya no se le
    // puede vender a otro. Se sube `reserved` —una columna que existía desde
    // 0013 y que nunca escribió nadie— sin escribir movimiento: la mercancía no
    // ha salido.
    //
    // Fuera de la saga a propósito: un extra mal configurado en el catálogo no
    // puede tumbar la venta de un cliente que ya está delante del mostrador.
    if (extraRows.length > 0) {
      try {
        const ofertas = await stockableOffers(companyId, extraRows.map((e) => e.extraId));
        const avisos = await reserveForSale(
          companyId,
          extraRows
            .map((e) => ({ bookingExtraId: e.bookingExtraId, offer: ofertas.get(e.extraId), soldUnits: e.units }))
            .filter((e): e is { bookingExtraId: string; offer: NonNullable<typeof e.offer>; soldUnits: number } =>
              Boolean(e.offer))
        );
        for (const aviso of avisos) console.warn(`[stock] ${booking.booking_number}: ${aviso}`);
      } catch (err) {
        console.error("[stock] no se pudieron apartar los extras de la reserva:", err);
      }
    }

    // ---- devengo del costo por proveedor (0040) ---------------------------
    // Se congela AHORA, con las tarifas de hoy: calcularlo el viernes al
    // liquidar aplicaría a lo operado el lunes una tarifa que cambió el
    // miércoles. Va dentro de la saga porque una reserva cuyo costo no se sabe
    // de quién es no se puede pagar, y lo que no se puede pagar no debería
    // haberse vendido.
    await accrueBookingCosts(companyId, {
      bookingId: booking._id,
      productId: item.product_id,
      departureId: item.departure_id || null,
      pax: billable,
      revenue: price.grossAmount,
      currency: price.currency || currency,
    });

    bookings.push(booking);
    subtotal += grossAmount;
    discountTotal += price.discountAmount;
    taxTotal += taxAmount;
    grandTotal += totalAmount;

    // ---- participants ----------------------------------------------------
    for (const p of item.participants || []) {
      await tenantCreate(companyId, "participant", {
        booking: booking._id,
        full_name: p.full_name,
        age: p.age,
        category: p.category || "adult",
        document_id: p.document_id,
        special_requirements: p.special_requirements,
        checkin_status: "pending",
      });
    }

    // ---- voucher ---------------------------------------------------------
    await tenantCreate(companyId, "voucher", {
      booking: booking._id,
      order: order._id,
      code: voucherCode,
      qr_data: voucherCode,
      status: "valid",
      issued_at: new Date().toISOString(),
      expires_at: travelDate || undefined,
    });

    // ---- pickup ----------------------------------------------------------
    if (item.pickup_hotel_id) {
      await tenantCreate(companyId, "pickup", {
        booking: booking._id,
        hotel: item.pickup_hotel_id,
        pickup_time: item.pickup_time || undefined,
        location: item.pickup_location || undefined,
        room: item.room_number || undefined,
        pax: paxTotal,
        status: "pending",
      });
    }

    // ---- commissions -----------------------------------------------------
    commissionsCreated += await generateCommissionsForBooking(ctx, booking, {
      productId: item.product_id,
      categoryId: refId(productRow?.category) ?? null,
      travelDate,
    });

    // ---- availability: reserve-then-verify (AUD-B01) ---------------------
    // The pre-flight assertCapacity above can race with a concurrent order for the last seat.
    // After persisting the booking we recompute occupancy and, if the departure
    // is now oversold, roll THIS booking back so concurrent sales resolve to a
    // single winner instead of silently double-selling the seat.
    if (item.departure_id) {
      const state = await recalculateDeparture(companyId, item.departure_id);
      const overrideAllowed = input.capacity_override === true;
      if (!overrideAllowed && state.capacity > 0 && state.bookedPax + state.pendingPax > state.capacity) {
        await tenantUpdate(companyId, "booking", booking._id, {
          status: "cancelled",
          cancel_reason: "Cupo agotado por una reserva simultánea",
          cancelled_at: new Date().toISOString(),
        });
        await recalculateDeparture(companyId, item.departure_id);
        const availableBefore = Math.max(0, state.capacity - state.bookedPax - state.pendingPax + paxTotal);
        throw new OversellError(availableBefore, paxTotal);
      }
    }
  }

  totals = {
    subtotal: round2(subtotal),
    discount_total: round2(discountTotal),
    tax_total: round2(taxTotal),
    total: round2(grandTotal),
    balance: round2(grandTotal),
    base_currency_total: round2(grandTotal * exchangeRate),
  };

  // ---- B2B receivable ----------------------------------------------------
  if (input.partner_id) {
    const partner = (await tenantQuery<Partner>(companyId, "partner", {
      _filter: { _id: input.partner_id }, _limit: 1,
    }))[0];
    const creditDays = partner?.credit_days ?? 0;
    const due = new Date();
    due.setDate(due.getDate() + creditDays);
    await tenantCreate(companyId, "receivable", {
      partner: input.partner_id,
      customer: input.customer_id,
      order: order._id,
      document_number: newDocumentNumber("CXC"),
      issue_date: new Date().toISOString(),
      due_date: due.toISOString(),
      amount: totals.total,
      paid_amount: 0,
      balance: totals.total,
      currency,
      status: "pending",
      aging_bucket: "current",
    });
  }

  // ---- promote the order (AUD-F34): the last critical write. Totals and the
  // final status go together, so the order only becomes a real sale once every
  // child exists. A failure before this point triggers the catch below.
  await tenantUpdate(companyId, "order", order._id, {
    ...totals,
    status: "pending_payment",
  });

  } catch (err) {
    await compensateOrder(companyId, order._id, order.order_number, bookings);
    throw err;
  }

  if (input.capacity_override) {
    await writeAudit({
      companyId, userId: ctx.userId,
      action: "capacity_override",
      entityType: "order", entityId: order._id,
      description: `Override de cupo aplicado en la orden ${order.order_number}. Motivo: ${input.override_reason || "no indicado"}`,
      severity: "warning",
      metadata: { items: input.items.length, reason: input.override_reason },
    });
  }

  await writeAudit({
    companyId, userId: ctx.userId,
    action: "order_created",
    entityType: "order", entityId: order._id,
    description: `Orden ${order.order_number} creada con ${bookings.length} reserva(s) por ${totals.total} ${currency}`,
  });

  // ---- calendario de cobro (0039) ---------------------------------------
  // Fuera de la saga y tolerante a fallos, igual que los avisos: una venta ya
  // cobrada no se deshace porque el plan de cuotas no se pudiera escribir, y el
  // plan se puede reconstruir después —es derivado— mientras que la venta no.
  try {
    await ensureSchedule(companyId, order._id);
  } catch (err) {
    console.error(`[booking-service] no se pudo crear el plan de cobro de ${order.order_number}:`, err);
  }

  // Confirmación al cliente y recordatorio de la víspera. Va DESPUÉS de que la
  // orden esté promovida y fuera del try/catch de la saga a propósito: que el
  // proveedor de correo esté caído no puede revertir una venta ya cobrada, ni
  // hacer esperar al cajero con el cliente delante. Lo que no salga queda en la
  // bandeja con su motivo.
  for (const booking of bookings) {
    try {
      await notifyBookingCreated(ctx.company, companyId, booking, ctx.userId);
    } catch (err) {
      console.error("[booking-service] no se pudo encolar el aviso de la reserva", booking._id, err);
    }
    // Y el aviso INTERNO: la operación necesita ver lo que entra para prever el
    // día. `notify` no lanza, así que no necesita su propio try/catch.
    await notify({
      companyId,
      event: "booking_created",
      entityType: "booking",
      entityId: booking._id,
      vars: {
        referencia: booking.booking_number,
        fecha: booking.travel_date ? formatDate(booking.travel_date) : null,
        pax: booking.pax_total,
      },
    });
  }

  console.log(`[booking-service] orden ${order.order_number} creada · ${bookings.length} reservas · total ${totals.total} ${currency}`);

  return { order: { ...order, ...totals, status: "pending_payment" as const }, bookings, commissionsCreated };
}

/**
 * Compensating action for a failed order build (AUD-F34): cancels the bookings
 * created so far (releasing their seats) and voids the order, so a partial
 * failure never leaves live seats held by a phantom order. Best-effort — every
 * step is guarded so compensation itself cannot throw.
 */
async function compensateOrder(
  companyId: string,
  orderId: string,
  orderNumber: string | undefined,
  bookings: Booking[],
  reason = "Orden incompleta: revertida automáticamente"
): Promise<void> {
  const departures = new Set<string>();
  for (const b of bookings) {
    try {
      await tenantUpdate(companyId, "booking", b._id, {
        status: "cancelled",
        cancel_reason: reason,
        cancelled_at: new Date().toISOString(),
      });
      const dep = refId(b.departure);
      if (dep) departures.add(dep);
      // Una reserva que no se va a operar no le debe nada al transportista:
      // dejar el devengo vivo se lo pagaría en la liquidación del viernes.
      await cancelBookingCosts(companyId, b._id, reason);
    } catch (e) {
      console.error("[booking-service] compensación: no se pudo cancelar la reserva", b._id, e);
    }
  }
  for (const dep of departures) {
    try {
      await recalculateDeparture(companyId, dep);
    } catch (e) {
      console.error("[booking-service] compensación: no se pudo recalcular la salida", dep, e);
    }
  }
  // Also revert the per-item children created before the failure, so no orphan
  // voucher, commission, or receivable survives a half-built order (which would
  // otherwise inflate KPIs or be collectible/redeemable by hand).
  try {
    const vouchers = await tenantQuery<{ _id: string }>(companyId, "voucher", {
      _filter: { order: orderId, status: "valid" }, _limit: 50,
    });
    for (const v of vouchers) {
      await tenantUpdate(companyId, "voucher", v._id, { status: "cancelled" });
    }
  } catch (e) {
    console.error("[booking-service] compensación: no se pudieron anular los vouchers", orderId, e);
  }
  try {
    const commissions = await tenantQuery<{ _id: string }>(companyId, "commission", {
      _filter: { order: orderId, status: { in: ["pending", "approved"] } }, _limit: 50,
    });
    for (const c of commissions) {
      await tenantUpdate(companyId, "commission", c._id, {
        status: "cancelled", notes: "Anulada: orden revertida automáticamente",
      });
    }
  } catch (e) {
    console.error("[booking-service] compensación: no se pudieron anular las comisiones", orderId, e);
  }
  try {
    const receivables = await tenantQuery<{ _id: string }>(companyId, "receivable", {
      _filter: { order: orderId, status: { nin: ["paid", "written_off"] } }, _limit: 20,
    });
    for (const r of receivables) {
      await tenantUpdate(companyId, "receivable", r._id, {
        status: "written_off", balance: 0,
        notes: "Anulada: orden revertida automáticamente",
      });
    }
  } catch (e) {
    console.error("[booking-service] compensación: no se pudieron anular las cuentas por cobrar", orderId, e);
  }
  try {
    await tenantUpdate(companyId, "order", orderId, {
      status: "cancelled",
      notes: reason,
    });
  } catch (e) {
    console.error("[booking-service] compensación: no se pudo anular la orden", orderId, e);
  }
  console.warn(`[booking-service] orden ${orderNumber ?? orderId} revertida (compensación)`);
}

/**
 * Reconciliation for orphaned `draft` orders (AUD-F34 follow-up).
 *
 * The saga leaves an order `draft` only transiently; a normal request promotes
 * or compensates it within itself. But a HARD process crash (not an exception)
 * between creating bookings and compensating can strand a `draft` order whose
 * bookings still hold seats and count as sales. This sweep finds such orders
 * older than a safety window and compensates them (releasing seats, voiding
 * children). Meant to be run periodically (cron) or on demand by an admin.
 */
export async function reconcileStaleDrafts(
  companyId: string,
  olderThanMinutes = 30
): Promise<{ scanned: number; reverted: number }> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const drafts = await tenantQuery<Order>(companyId, "order", {
    _filter: { status: "draft" }, _limit: 100, _sort: { createdAt: "asc" },
  });
  let reverted = 0;
  for (const o of drafts) {
    const created = o.order_date || (o as { createdAt?: string }).createdAt;
    // Skip drafts that could still be an in-flight saga (sub-second normally).
    if (created && created > cutoff) continue;
    const bookings = await tenantQuery<Booking>(companyId, "booking", {
      _filter: { order: o._id }, _limit: 50,
    });
    await compensateOrder(companyId, o._id, o.order_number, bookings);
    reverted++;
  }
  if (reverted > 0) console.warn(`[booking-service] reconciliación: ${reverted} orden(es) draft revertida(s)`);
  return { scanned: drafts.length, reverted };
}

/**
 * Libera el cupo de las reservas cuya retención expiró.
 *
 * Una venta sin un peso cobrado pasado su plazo suelta las plazas para que
 * vuelvan a estar a la venta. Es deliberadamente conservador: solo toca órdenes
 * en `pending_payment` con CERO cobrado. Una venta con un anticipo pagado nunca
 * se cancela sola —el cliente puso dinero—, y una confirmada tampoco.
 */
export async function releaseExpiredHolds(
  companyId: string,
  now: Date = new Date()
): Promise<{ released: number; orders: string[] }> {
  const expired = await tenantQuery<Order>(companyId, "order", {
    _filter: { status: "pending_payment", hold_until: { lt: now.toISOString() } },
    _limit: 100, _sort: { createdAt: "asc" },
  });

  const orders: string[] = [];
  for (const order of expired) {
    // La condición que de verdad importa: nadie pagó nada.
    if ((order.paid_total ?? 0) > 0.009) continue;
    const bookings = await tenantQuery<Booking>(companyId, "booking", {
      _filter: { order: order._id }, _limit: 50,
    });
    const live = bookings.filter((b) => b.status !== "cancelled" && b.status !== "refunded");
    if (live.length === 0) continue;

    await compensateOrder(
      companyId, order._id, order.order_number, live,
      "Retención vencida: la reserva no se pagó dentro del plazo"
    );
    orders.push(order.order_number || order._id);
  }

  if (orders.length > 0) {
    console.warn(`[booking-service] ${orders.length} retención(es) vencida(s) liberada(s): ${orders.join(", ")}`);
  }
  return { released: orders.length, orders };
}

/** Registers every commission obligation generated by a booking. */
export async function generateCommissionsForBooking(
  ctx: TenantContext & { companyId: string },
  booking: Booking,
  meta: { productId: string; categoryId: string | null; travelDate: string | null }
): Promise<number> {
  const companyId = ctx.companyId;
  const sellerId = refId(booking.seller) ?? null;
  const partnerId = refId(booking.partner) ?? null;

  const [seller, partner] = await Promise.all([
    sellerId
      ? tenantQuery<Seller>(companyId, "seller", { _filter: { _id: sellerId }, _limit: 1, supervisor: true })
      : Promise.resolve([]),
    partnerId
      ? tenantQuery<Partner>(companyId, "partner", { _filter: { _id: partnerId }, _limit: 1 })
      : Promise.resolve([]),
  ]);

  const sellerRow = seller[0];
  const partnerRow = partner[0];
  const supervisor = sellerRow?.supervisor && typeof sellerRow.supervisor === "object" ? sellerRow.supervisor : null;

  // Commission base = net revenue (gross − discounts), excluding taxes.
  const baseAmount = round2((booking.gross_amount ?? 0) - (booking.discount_amount ?? 0));

  const beneficiaries: BeneficiaryDescriptor[] = [];
  if (partnerRow) {
    beneficiaries.push({
      type: "partner",
      name: partnerRow.commercial_name || partnerRow.name || "Partner",
      partnerId: partnerRow._id,
      fallbackPct: partnerRow.default_commission_pct ?? null,
    });
  }
  if (supervisor) {
    beneficiaries.push({
      type: "supervisor",
      name: `${supervisor.first_name ?? ""} ${supervisor.last_name ?? ""}`.trim() || "Supervisor",
      sellerId: supervisor._id,
      fallbackPct: supervisor.commission_pct ?? null,
    });
  }
  if (sellerRow) {
    beneficiaries.push({
      type: "seller",
      name: `${sellerRow.first_name ?? ""} ${sellerRow.last_name ?? ""}`.trim() || "Vendedor",
      sellerId: sellerRow._id,
      fallbackPct: sellerRow.commission_pct ?? null,
    });
  }
  if (beneficiaries.length === 0) return 0;

  const resolved = await resolveCommissions(
    {
      companyId,
      baseAmount,
      currency: (booking.currency || "usd") as Currency,
      productId: meta.productId,
      categoryId: meta.categoryId,
      partnerId,
      sellerId,
      supervisorId: supervisor?._id ?? null,
      channel: booking.channel ?? null,
      travelDate: meta.travelDate,
    },
    beneficiaries
  );

  for (const c of resolved) {
    await tenantCreate(companyId, "commission", {
      booking: booking._id,
      order: refId(booking.order),
      rule: c.rule || undefined,
      seller: c.seller || undefined,
      partner: c.partner || undefined,
      beneficiary_type: c.beneficiary_type,
      beneficiary_name: c.beneficiary_name,
      base_amount: c.base_amount,
      calc_type: c.calc_type,
      percentage: c.percentage,
      amount: c.amount,
      currency: c.currency,
      status: "pending",
      generated_at: new Date().toISOString(),
      snapshot: JSON.stringify(c.snapshot),
    });
  }
  return resolved.length;
}

/** Recomputes an order's paid/balance totals and derives its status from its bookings. */
export async function syncOrderTotals(companyId: string, orderId: string): Promise<void> {
  const bookings = await tenantQuery<Booking>(companyId, "booking", {
    _filter: { order: orderId }, _limit: 200,
  });
  const payments = await tenantQuery<{ amount?: number; payment_type?: string; status?: string }>(
    companyId, "payment", { _filter: { order: orderId, status: "completed" }, _limit: 200 }
  );

  // AUD-F25: cancelled/refunded bookings must not inflate the order total, and
  // the payment proration below must run over the live bookings only.
  const DEAD_BOOKING = new Set(["cancelled", "refunded"]);
  const activeBookings = bookings.filter((b) => !DEAD_BOOKING.has(b.status || ""));
  const total = round2(activeBookings.reduce((s, b) => s + (b.total_amount ?? 0), 0));
  // AUD (credit_note): a credit note is an outflow, exactly like a refund.
  const OUTFLOW = new Set(["refund", "credit_note"]);
  const paid = round2(
    payments.reduce((s, p) => s + (OUTFLOW.has(p.payment_type || "") ? -(p.amount ?? 0) : p.amount ?? 0), 0)
  );
  const balance = round2(total - paid);

  // An order with no live booking left (every booking cancelled/refunded) is a
  // cancelled order, not a pending one.
  const noneActive = bookings.length > 0 && activeBookings.length === 0;
  let status: Order["status"] = "pending_payment";
  if (noneActive) status = "cancelled";
  else if (paid <= 0) status = "pending_payment";
  else if (balance > 0.009) status = "partially_paid";
  else status = "paid";

  await tenantUpdate(companyId, "order", orderId, {
    total, paid_total: paid, balance, status,
  });

  // Propagate the payment state down to the bookings.
  for (const b of bookings) {
    if (b.status === "cancelled" || b.status === "refunded") continue;
    const share = total > 0 ? (b.total_amount ?? 0) / total : 0;
    const bookingPaid = round2(paid * share);
    const bookingBalance = round2((b.total_amount ?? 0) - bookingPaid);
    let bStatus: Booking["status"] = b.status;
    if (b.status !== "checked_in" && b.status !== "completed" && b.status !== "no_show") {
      if (bookingPaid <= 0) bStatus = "pending_payment";
      else if (bookingBalance > 0.009) bStatus = "partially_paid";
      else bStatus = "paid";
    }
    await tenantUpdate(companyId, "booking", b._id, {
      paid_amount: bookingPaid, balance_amount: bookingBalance, status: bStatus,
    });
  }

  // El calendario de cobro se recalcula desde `paid_total`, que acaba de
  // cambiar. Es derivado: no puede desviarse de la orden porque parte de ella.
  try {
    await refreshAllocation(companyId, orderId);
  } catch (err) {
    console.error(`[booking-service] no se pudo recalcular el plan de cobro de ${orderId}:`, err);
  }

  console.log(`[booking-service] orden ${orderId} sincronizada · total=${total} pagado=${paid} saldo=${balance}`);
}
