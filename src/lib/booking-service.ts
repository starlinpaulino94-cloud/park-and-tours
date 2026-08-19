import "server-only";
import { totalumSdk } from "@/lib/totalum";
import { tenantCreate, tenantQuery, type TenantContext } from "@/lib/tenant";
import { resolvePrice, resolveCost, billablePax } from "@/lib/pricing";
import { assertCapacity, recalculateDeparture } from "@/lib/availability";
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

export async function createOrderWithBookings(
  ctx: TenantContext & { companyId: string },
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  if (!input.items?.length) throw new Error("La orden debe incluir al menos un producto");

  const companyId = ctx.companyId;
  const currency = (input.currency || ctx.company?.base_currency || "usd") as Currency;
  const exchangeRate = input.exchange_rate ?? 1;
  const channel = (input.channel || "direct") as Channel;

  // ---- validate capacity for every item before writing anything -----------
  for (const item of input.items) {
    if (!item.departure_id) continue;
    const pax = (item.adults ?? 0) + (item.children ?? 0) + (item.infants ?? 0);
    await assertCapacity(companyId, item.departure_id, pax, input.capacity_override === true);
  }

  // ---- order shell --------------------------------------------------------
  const order = await tenantCreate<Order>(companyId, "order", {
    order_number: newOrderNumber(),
    customer: input.customer_id,
    branch: input.branch_id || undefined,
    seller: input.seller_id || undefined,
    partner: input.partner_id || undefined,
    promotion: input.promotion_id || undefined,
    created_by: ctx.userId,
    channel,
    status: "pending_payment",
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

  for (const item of input.items) {
    const adults = item.adults ?? 0;
    const children = item.children ?? 0;
    const infants = item.infants ?? 0;
    const paxTotal = adults + children + infants;
    const billable = billablePax(adults, children);

    const price = await resolvePrice({
      companyId,
      productId: item.product_id,
      modalityId: item.modality_id,
      partnerId: input.partner_id,
      sellerId: input.seller_id,
      channel,
      quantity: billable,
      travelDate: null,
      discountPct: item.discount_pct ?? 0,
      taxPct: item.tax_pct ?? 0,
      exchangeRate,
    });

    const departure = item.departure_id
      ? ((await tenantQuery<Departure>(companyId, "departure", {
          _filter: { _id: item.departure_id }, _limit: 1, product: true,
        }))[0] ?? null)
      : null;

    const productRow = (await tenantQuery<Product>(companyId, "product", {
      _filter: { _id: item.product_id }, _limit: 1,
    }))[0];

    const cost = await resolveCost(companyId, item.product_id, billable, productRow?.base_cost ?? 0);
    const travelDate = departure?.departure_at ?? null;
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
      margin_amount: round2(price.totalAmount - price.discountAmount * 0 - cost),
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

    // ---- availability ----------------------------------------------------
    if (item.departure_id) await recalculateDeparture(companyId, item.departure_id);
  }

  const totals = {
    subtotal: round2(subtotal),
    discount_total: round2(discountTotal),
    tax_total: round2(taxTotal),
    total: round2(grandTotal),
    balance: round2(grandTotal),
    base_currency_total: round2(grandTotal * exchangeRate),
  };
  const updated = await totalumSdk.crud.editRecordById("order", order._id, totals);
  if (updated.errors) {
    console.error("[booking-service] failed updating order totals:", updated.errors);
    throw new Error(updated.errors.errorMessage || "Error actualizando los totales de la orden");
  }

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

  return { order: { ...order, ...totals }, bookings, commissionsCreated };
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
