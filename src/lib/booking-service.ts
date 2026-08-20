import "server-only";
import { totalumSdk } from "@/lib/totalum";
import { tenantCreate, tenantQuery, type TenantContext } from "@/lib/tenant";
import { resolvePrice, resolveCost, billablePax } from "@/lib/pricing";
import { assertCapacity, recalculateDeparture, OversellError } from "@/lib/availability";
import { resolveCommissions, type BeneficiaryDescriptor } from "@/lib/commission-engine";
import { writeAudit } from "@/lib/audit";
import { newBookingNumber, newOrderNumber, newVoucherCode, newDocumentNumber } from "@/lib/codes";
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

export async function createOrderWithBookings(
  ctx: TenantContext & { companyId: string },
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  if (!input.items?.length) throw new Error("La orden debe incluir al menos un producto");

  const companyId = ctx.companyId;
  const currency = (input.currency || ctx.company?.base_currency || "usd") as Currency;
  const exchangeRate = input.exchange_rate ?? 1;
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
  // AUD-F34: Totalum has no transactions, so an order is built as a saga. The
  // order starts as `draft`; only after every child (bookings, vouchers,
  // commissions, receivable) is written does it get PROMOTED to
  // `pending_payment`. If any step fails we COMPENSATE — cancel the bookings
  // created so far (releasing their seats) and void the order — so a failure
  // can never leave a "phantom" order with live seats but zero total, or a B2B
  // sale with no receivable that nobody would ever collect.
  const order = await tenantCreate<Order>(companyId, "order", {
    order_number: newOrderNumber(),
    customer: input.customer_id,
    branch: input.branch_id || undefined,
    seller: input.seller_id || undefined,
    partner: input.partner_id || undefined,
    promotion: input.promotion_id || undefined,
    created_by: ctx.userId,
    channel,
    status: "draft",
    order_date: new Date().toISOString(),
    currency,
    exchange_rate: exchangeRate,
    base_currency: ctx.company?.base_currency || currency,
    subtotal: 0, discount_total: 0, tax_total: 0,
    total: 0, paid_total: 0, balance: 0, base_currency_total: 0,
    notes: input.notes || undefined,
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
    });

    const productRow = (await tenantQuery<Product>(companyId, "product", {
      _filter: { _id: item.product_id }, _limit: 1,
    }))[0];

    const cost = await resolveCost(companyId, item.product_id, billable, productRow?.base_cost ?? 0);
    const voucherCode = newVoucherCode();

    const booking = await tenantCreate<Booking>(companyId, "booking", {
      booking_number: newBookingNumber(),
      order: order._id,
      customer: input.customer_id,
      product: item.product_id,
      departure: item.departure_id || undefined,
      modality: item.modality_id || undefined,
      branch: input.branch_id || undefined,
      seller: input.seller_id || undefined,
      partner: input.partner_id || undefined,
      pickup_hotel: item.pickup_hotel_id || undefined,
      created_by: ctx.userId,
      channel,
      status: "pending_payment",
      booking_date: new Date().toISOString(),
      travel_date: travelDate || undefined,
      adults, children, infants, pax_total: paxTotal,
      unit_price: price.unitPrice,
      gross_amount: price.grossAmount,
      discount_amount: price.discountAmount,
      tax_amount: price.taxAmount,
      total_amount: price.totalAmount,
      cost_amount: cost,
      // AUD-F05: margin excludes tax (tax is not revenue). Previously used
      // `totalAmount` (tax included) with dead `* 0` code, inflating margin.
      margin_amount: round2(price.grossAmount - price.discountAmount - cost),
      paid_amount: 0,
      balance_amount: price.totalAmount,
      refund_amount: 0,
      currency: price.currency,
      exchange_rate: exchangeRate,
      base_currency: ctx.company?.base_currency || price.currency,
      base_amount: round2(price.totalAmount * exchangeRate),
      price_snapshot: JSON.stringify(price.snapshot),
      pickup_time: item.pickup_time || undefined,
      pickup_location: item.pickup_location || undefined,
      room_number: item.room_number || undefined,
      voucher_code: voucherCode,
      checkin_status: "pending",
      checked_in_pax: 0,
      capacity_override: input.capacity_override ? "yes" : "no",
      override_reason: input.override_reason || undefined,
      notes: item.notes || undefined,
    });

    bookings.push(booking);
    subtotal += price.grossAmount;
    discountTotal += price.discountAmount;
    taxTotal += price.taxAmount;
    grandTotal += price.totalAmount;

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
    // Totalum has no transactions or row locks, so the pre-flight
    // assertCapacity above can race with a concurrent order for the last seat.
    // After persisting the booking we recompute occupancy and, if the departure
    // is now oversold, roll THIS booking back so concurrent sales resolve to a
    // single winner instead of silently double-selling the seat.
    if (item.departure_id) {
      const state = await recalculateDeparture(companyId, item.departure_id);
      const overrideAllowed = input.capacity_override === true;
      if (!overrideAllowed && state.capacity > 0 && state.bookedPax + state.pendingPax > state.capacity) {
        await totalumSdk.crud.editRecordById("booking", booking._id, {
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
  const promoted = await totalumSdk.crud.editRecordById("order", order._id, {
    ...totals,
    status: "pending_payment",
  });
  if (promoted.errors) {
    throw new Error(promoted.errors.errorMessage || "Error finalizando la orden");
  }

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
  bookings: Booking[]
): Promise<void> {
  const departures = new Set<string>();
  for (const b of bookings) {
    try {
      await totalumSdk.crud.editRecordById("booking", b._id, {
        status: "cancelled",
        cancel_reason: "Orden incompleta: revertida automáticamente",
        cancelled_at: new Date().toISOString(),
      });
      const dep = refId(b.departure);
      if (dep) departures.add(dep);
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
  try {
    await totalumSdk.crud.editRecordById("order", orderId, {
      status: "cancelled",
      notes: "Orden revertida automáticamente por un fallo durante su creación",
    });
  } catch (e) {
    console.error("[booking-service] compensación: no se pudo anular la orden", orderId, e);
  }
  console.warn(`[booking-service] orden ${orderNumber ?? orderId} revertida (compensación)`);
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

  const total = round2(bookings.reduce((s, b) => s + (b.total_amount ?? 0), 0));
  const paid = round2(
    payments.reduce((s, p) => s + (p.payment_type === "refund" ? -(p.amount ?? 0) : p.amount ?? 0), 0)
  );
  const balance = round2(total - paid);

  const allCancelled = bookings.length > 0 && bookings.every((b) => b.status === "cancelled");
  let status: Order["status"] = "pending_payment";
  if (allCancelled) status = "cancelled";
  else if (paid <= 0) status = "pending_payment";
  else if (balance > 0.009) status = "partially_paid";
  else status = "paid";

  await totalumSdk.crud.editRecordById("order", orderId, {
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
    await totalumSdk.crud.editRecordById("booking", b._id, {
      paid_amount: bookingPaid, balance_amount: bookingBalance, status: bStatus,
    });
  }

  console.log(`[booking-service] orden ${orderId} sincronizada · total=${total} pagado=${paid} saldo=${balance}`);
}
