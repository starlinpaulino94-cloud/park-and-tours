import type { AppRole } from "@/lib/auth";
import { companyTimeZone, dayBounds, zoneOffsetMs, zonedParts } from "@/lib/time";

export const VALID_SALE_STATUSES = new Set([
  "confirmed", "partially_paid", "paid", "checked_in", "completed", "no_show", "partially_refunded",
]);
export const INVALID_SALE_STATUSES = new Set(["draft", "pending", "pending_payment", "cancelled", "refunded"]);
export const CASH_IN_PAYMENT_TYPES = new Set(["payment", "deposit"]);
export const CASH_OUT_PAYMENT_TYPES = new Set(["refund", "credit_note"]);
export const OPEN_RECEIVABLE_STATUSES = new Set(["pending", "partially_paid", "overdue"]);
export const OPEN_PAYABLE_STATUSES = new Set(["pending", "partially_paid"]);
export const UNSETTLED_COMMISSION_STATUSES = new Set(["pending", "approved", "held", "disputed"]);

export type DashboardPeriodKey = "today" | "yesterday" | "week" | "month" | "quarter" | "year" | "custom";
export type DashboardRankCriterion = "sales" | "margin" | "bookings" | "pax";

export interface DashboardPeriod {
  key: DashboardPeriodKey;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  label: string;
  timezone: string;
}

export interface DashboardPermissions {
  canCreateSale: boolean;
  canViewRevenue: boolean;
  canViewCollections: boolean;
  canViewMargin: boolean;
  canViewReceivables: boolean;
  canViewPayables: boolean;
  canViewCommissions: boolean;
  canViewCash: boolean;
  canViewGlobalRankings: boolean;
  forcedSellerId?: string;
  forcedPartnerId?: string;
}

export interface DashboardMoneyInput {
  amount?: number | null;
  baseAmount?: number | null;
  currency?: string | null;
  baseCurrency: string;
  exchangeRate?: number | null;
}

export interface DashboardMoneyResult {
  amount: number;
  incomplete: boolean;
}

export interface DashboardBookingInput {
  status?: string | null;
  total_amount?: number | null;
  base_amount?: number | null;
  refund_amount?: number | null;
  base_refund_amount?: number | null;
  cost_amount?: number | null;
  base_cost_amount?: number | null;
  pax_total?: number | null;
  currency?: string | null;
  exchange_rate?: number | null;
}

export interface DashboardPaymentInput {
  status?: string | null;
  payment_type?: string | null;
  amount?: number | null;
  base_amount?: number | null;
  currency?: string | null;
  exchange_rate?: number | null;
}

export interface DashboardSummary {
  netSales: number;
  collected: number;
  contributionMargin: number;
  marginPct: number | null;
  avgTicket: number;
  validBookings: number;
  pax: number;
  cancellations: number;
  refunds: number;
  partialRefunds: number;
  noShows: number;
  cancellationRate: number;
  incompleteFinancialData: boolean;
}

const LABELS: Record<DashboardPeriodKey, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  week: "Esta semana",
  month: "Este mes",
  quarter: "Trimestre",
  year: "Año",
  custom: "Personalizado",
};

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function wallDateFromParts(
  parts: { year: number; month: number; day: number },
  timezone: string,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second, 0);
  const reference = new Date(wall);
  const first = new Date(wall - zoneOffsetMs(reference, timezone));
  return new Date(wall - zoneOffsetMs(first, timezone));
}

function zonedDateKey(date: Date, timezone: string): string {
  const p = zonedParts(date, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function shiftRange(from: Date, to: Date, days: number, timezone: string) {
  const fromParts = zonedParts(from, timezone);
  const toParts = zonedParts(to, timezone);
  const shiftedFrom = wallDateFromParts(fromParts, timezone);
  shiftedFrom.setUTCDate(shiftedFrom.getUTCDate() + days);
  const shiftedTo = wallDateFromParts(toParts, timezone, 23, 59, 59);
  shiftedTo.setUTCDate(shiftedTo.getUTCDate() + days);
  return { from: shiftedFrom, to: new Date(shiftedTo.getTime() + 999) };
}

function startOfZonedMonth(now: Date, timezone: string): Date {
  const p = zonedParts(now, timezone);
  return wallDateFromParts({ year: p.year, month: p.month, day: 1 }, timezone);
}

function parseDateOnly(value: string | null | undefined, fallback: Date, timezone: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return zonedParts(fallback, timezone);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function endOfToday(now: Date, timezone: string): Date {
  return dayBounds(now, timezone).end;
}

export function resolveDashboardPeriod(
  period: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
  company: { timezone?: string | null } | null | undefined,
  now = new Date()
): DashboardPeriod {
  const timezone = companyTimeZone(company);
  const key = (["today", "yesterday", "week", "month", "quarter", "year", "custom"].includes(period || "")
    ? period
    : "month") as DashboardPeriodKey;
  let start: Date;
  let end: Date;

  if (key === "today") {
    ({ start, end } = dayBounds(now, timezone));
  } else if (key === "yesterday") {
    const y = new Date(now.getTime() - 86_400_000);
    ({ start, end } = dayBounds(y, timezone));
  } else if (key === "week") {
    const p = zonedParts(now, timezone);
    const day = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
    start = wallDateFromParts({ year: p.year, month: p.month, day: p.day - day }, timezone);
    end = endOfToday(now, timezone);
  } else if (key === "quarter") {
    const p = zonedParts(now, timezone);
    const qStartMonth = Math.floor((p.month - 1) / 3) * 3 + 1;
    start = wallDateFromParts({ year: p.year, month: qStartMonth, day: 1 }, timezone);
    end = endOfToday(now, timezone);
  } else if (key === "year") {
    const p = zonedParts(now, timezone);
    start = wallDateFromParts({ year: p.year, month: 1, day: 1 }, timezone);
    end = endOfToday(now, timezone);
  } else if (key === "custom") {
    const fromParts = parseDateOnly(from, now, timezone);
    const toParts = parseDateOnly(to, now, timezone);
    start = wallDateFromParts(fromParts, timezone);
    end = new Date(wallDateFromParts(toParts, timezone, 23, 59, 59).getTime() + 999);
  } else {
    start = startOfZonedMonth(now, timezone);
    end = endOfToday(now, timezone);
  }

  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const previous = shiftRange(start, end, -spanDays, timezone);

  return {
    key,
    from: start.toISOString(),
    to: end.toISOString(),
    previousFrom: previous.from.toISOString(),
    previousTo: previous.to.toISOString(),
    label: LABELS[key],
    timezone,
  };
}

export function dayKey(value: string | Date | null | undefined, timezone: string): string {
  if (!value) return "Sin fecha";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  return zonedDateKey(d, timezone);
}

export function resolveDashboardPermissions(
  role: AppRole,
  ids: { userId: string; sellerId?: string | null; partnerId?: string | null }
): DashboardPermissions {
  if (["superadmin", "owner", "admin"].includes(role)) {
    return {
      canCreateSale: true,
      canViewRevenue: true,
      canViewCollections: true,
      canViewMargin: true,
      canViewReceivables: true,
      canViewPayables: true,
      canViewCommissions: true,
      canViewCash: true,
      canViewGlobalRankings: true,
    };
  }
  if (role === "manager") {
    return {
      canCreateSale: true,
      canViewRevenue: true,
      canViewCollections: true,
      canViewMargin: false,
      canViewReceivables: false,
      canViewPayables: false,
      canViewCommissions: true,
      canViewCash: false,
      canViewGlobalRankings: true,
    };
  }
  if (role === "operations") {
    return {
      canCreateSale: false,
      canViewRevenue: false,
      canViewCollections: false,
      canViewMargin: false,
      canViewReceivables: false,
      canViewPayables: false,
      canViewCommissions: false,
      canViewCash: false,
      canViewGlobalRankings: false,
    };
  }
  if (role === "cashier") {
    return {
      canCreateSale: true,
      canViewRevenue: true,
      canViewCollections: true,
      canViewMargin: false,
      canViewReceivables: false,
      canViewPayables: false,
      canViewCommissions: false,
      canViewCash: true,
      canViewGlobalRankings: false,
    };
  }
  return {
    canCreateSale: true,
    canViewRevenue: true,
    canViewCollections: false,
    canViewMargin: false,
    canViewReceivables: false,
    canViewPayables: false,
    canViewCommissions: true,
    canViewCash: false,
    canViewGlobalRankings: false,
    forcedSellerId: ids.sellerId || "00000000-0000-0000-0000-000000000000",
    forcedPartnerId: role === "partner" ? ids.partnerId || undefined : undefined,
  };
}

export function moneyToBase(input: DashboardMoneyInput): DashboardMoneyResult {
  const amount = Number(input.amount ?? 0);
  const baseAmount = Number(input.baseAmount);
  if (Number.isFinite(baseAmount)) return { amount: round2(baseAmount), incomplete: false };
  const currency = (input.currency || input.baseCurrency).toLowerCase();
  const baseCurrency = input.baseCurrency.toLowerCase();
  if (currency === baseCurrency) return { amount: round2(amount), incomplete: false };
  const rate = Number(input.exchangeRate);
  if (Number.isFinite(rate) && rate > 0 && rate !== 1) return { amount: round2(amount * rate), incomplete: false };
  return { amount: 0, incomplete: true };
}

export function netBookingAmount(row: DashboardBookingInput, baseCurrency: string): DashboardMoneyResult {
  if (!VALID_SALE_STATUSES.has(row.status || "")) return { amount: 0, incomplete: false };
  const gross = moneyToBase({
    amount: row.total_amount,
    baseAmount: row.base_amount,
    currency: row.currency,
    baseCurrency,
    exchangeRate: row.exchange_rate,
  });
  const refund = moneyToBase({
    amount: row.refund_amount,
    baseAmount: row.base_refund_amount,
    currency: row.currency,
    baseCurrency,
    exchangeRate: row.exchange_rate,
  });
  return { amount: Math.max(0, round2(gross.amount - refund.amount)), incomplete: gross.incomplete || refund.incomplete };
}

export function bookingCostAmount(row: DashboardBookingInput, baseCurrency: string): DashboardMoneyResult {
  return moneyToBase({
    amount: row.cost_amount,
    baseAmount: row.base_cost_amount,
    currency: row.currency,
    baseCurrency,
    exchangeRate: row.exchange_rate,
  });
}

export function netPaymentAmount(row: DashboardPaymentInput, baseCurrency: string): DashboardMoneyResult {
  if (row.status !== "completed") return { amount: 0, incomplete: false };
  const sign = CASH_OUT_PAYMENT_TYPES.has(row.payment_type || "") ? -1 : CASH_IN_PAYMENT_TYPES.has(row.payment_type || "") ? 1 : 0;
  if (sign === 0) return { amount: 0, incomplete: false };
  const money = moneyToBase({
    amount: row.amount,
    baseAmount: row.base_amount,
    currency: row.currency,
    baseCurrency,
    exchangeRate: row.exchange_rate,
  });
  return { amount: round2(sign * money.amount), incomplete: money.incomplete };
}

export function summarizeDashboard(
  bookings: DashboardBookingInput[],
  payments: DashboardPaymentInput[],
  commissions: { status?: string | null; amount?: number | null; currency?: string | null }[],
  baseCurrency: string
): DashboardSummary {
  let netSales = 0;
  let collected = 0;
  let costs = 0;
  let commissionCost = 0;
  let pax = 0;
  let validBookings = 0;
  let incompleteFinancialData = false;
  let cancellations = 0;
  let refunds = 0;
  let partialRefunds = 0;
  let noShows = 0;
  let nonDraftBookings = 0;

  for (const booking of bookings) {
    if (booking.status !== "draft") nonDraftBookings++;
    if (booking.status === "cancelled") cancellations++;
    if (booking.status === "refunded") refunds++;
    if (booking.status === "partially_refunded") partialRefunds++;
    if (booking.status === "no_show") noShows++;
    if (!VALID_SALE_STATUSES.has(booking.status || "")) continue;

    const sales = netBookingAmount(booking, baseCurrency);
    const cost = bookingCostAmount(booking, baseCurrency);
    incompleteFinancialData ||= sales.incomplete || cost.incomplete;
    netSales += sales.amount;
    costs += cost.amount;
    pax += Number(booking.pax_total ?? 0);
    validBookings++;
  }

  for (const payment of payments) {
    const net = netPaymentAmount(payment, baseCurrency);
    incompleteFinancialData ||= net.incomplete;
    collected += net.amount;
  }

  for (const commission of commissions) {
    if (!UNSETTLED_COMMISSION_STATUSES.has(commission.status || "")) continue;
    const money = moneyToBase({ amount: commission.amount, currency: commission.currency, baseCurrency });
    incompleteFinancialData ||= money.incomplete;
    commissionCost += money.amount;
  }

  const contributionMargin = round2(netSales - costs - commissionCost);
  return {
    netSales: round2(netSales),
    collected: round2(collected),
    contributionMargin,
    marginPct: netSales > 0 ? round2((contributionMargin / netSales) * 100) : null,
    avgTicket: validBookings > 0 ? round2(netSales / validBookings) : 0,
    validBookings,
    pax,
    cancellations,
    refunds,
    partialRefunds,
    noShows,
    cancellationRate: nonDraftBookings > 0 ? round2((cancellations / nonDraftBookings) * 100) : 0,
    incompleteFinancialData,
  };
}

export function trendPct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}
