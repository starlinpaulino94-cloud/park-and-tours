/**
 * El calendario de cobro: anticipo, cuotas y saldo.
 *
 * Una operadora no cobra el total al reservar. Cobra un anticipo que bloquea la
 * plaza y el saldo antes de la salida, y en grupos, bodas o incentivos lo
 * reparte en cuotas. Hasta ahora la venta solo tenía tres números —total,
 * pagado, saldo— sin una sola fecha, así que el sistema no podía decir si un
 * saldo estaba al día o vencido: no sabía cuándo vencía.
 *
 * Aquí se decide lo que tiene enjundia, y nada de esto toca la base:
 *
 *  · Que las cuotas sumen EXACTAMENTE el total. Tres cuotas de 100 no son
 *    33.33 tres veces: son 33.33, 33.33 y 33.34. Un céntimo perdido por
 *    redondeo deja una reserva pagada con un saldo de 0.01 que nadie va a
 *    cobrar y que bloquea el check-in.
 *
 *  · Cuándo vence el saldo. Se deriva de la salida —"quince días antes"—, no
 *    se teclea. Y nunca después de la salida: cobrar el saldo el martes de un
 *    viaje que salió el lunes no es una política, es un error.
 *
 *  · A qué cuota va cada pago. Por vencimiento, la más antigua primero, sin
 *    que ninguna reciba más de lo que debe.
 */

import { depositDue, type DepositInput } from "@/lib/quotes";

export type DepositType = "none" | "percent" | "amount";
export type InstallmentKind = "deposit" | "installment" | "balance";
export type InstallmentStatus =
  | "pending" | "partially_paid" | "paid" | "overdue" | "waived" | "cancelled";
export type CollectionStatus = "none" | "on_track" | "due_soon" | "overdue" | "settled";
export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const cents = (n: number) => Math.round(num(n) * 100);

/** Solo la fecha, sin hora ni zona: un vencimiento es un día, no un instante. */
export function dayOf(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** Días entre dos fechas, contando por día natural. */
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = new Date(`${dayOf(from)}T00:00:00Z`).getTime();
  const b = new Date(`${dayOf(to)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/* ------------------------------------------------------ política de anticipo */

export interface DepositPolicy {
  deposit_type?: string | null;
  deposit_percent?: number | null;
  deposit_amount?: number | null;
  balance_due_days?: number | null;
}

/**
 * Qué política manda.
 *
 * La de la venta pisa a la del producto, porque es lo que se pactó con ESTE
 * cliente; la del producto es el valor por defecto que evita teclearla en cada
 * reserva. Una venta con `deposit_type: 'none'` explícito no hereda: decir "sin
 * anticipo" es una decisión, no un hueco.
 */
export function effectivePolicy(
  order: DepositPolicy | null | undefined,
  product: DepositPolicy | null | undefined
): DepositPolicy {
  const orderType = order?.deposit_type;
  const uses = orderType === "percent" || orderType === "amount" || orderType === "none";
  const base = uses ? order! : product ?? {};
  return {
    deposit_type: (base.deposit_type as DepositType) || "none",
    deposit_percent: base.deposit_percent ?? null,
    deposit_amount: base.deposit_amount ?? null,
    balance_due_days: order?.balance_due_days ?? product?.balance_due_days ?? null,
  };
}

/**
 * Cuándo vence el saldo de una reserva.
 *
 * `daysBefore` días antes de la salida. Se acota por los dos extremos: nunca
 * después de la salida —el saldo se cobra antes de subir al autobús— y nunca
 * antes de hoy, porque una reserva que se hace a tres días de la salida con
 * política de quince no nace vencida: vence hoy.
 */
export function balanceDueDate(
  departureAt: string | Date | null | undefined,
  daysBefore: number | null | undefined,
  now: Date = new Date()
): string | null {
  const departure = dayOf(departureAt);
  if (!departure) return null;
  const today = dayOf(now)!;
  const days = Math.max(0, Math.trunc(num(daysBefore)));

  const target = new Date(`${departure}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - days);
  const candidate = target.toISOString().slice(0, 10);

  if (candidate < today) return today <= departure ? today : departure;
  return candidate;
}

/* ------------------------------------------------------------- el calendario */

export interface PlannedInstallment {
  sequence: number;
  kind: InstallmentKind;
  due_date: string;
  amount: number;
}

export interface SchedulePlanInput {
  total: number;
  /** Fecha en que vence el anticipo. Por defecto, hoy. */
  depositDueDate?: string | null;
  /** Fecha en que vence el saldo. */
  balanceDueDate?: string | null;
  policy?: DepositPolicy | null;
  /** En cuántas cuotas se reparte el SALDO (1 = un único pago final). */
  installments?: number | null;
  now?: Date;
}

/**
 * El plan de cobro de una venta.
 *
 * Devuelve las cuotas que suman exactamente el total. El céntimo del redondeo
 * va siempre a la ÚLTIMA cuota, no a la primera: nadie discute un céntimo de
 * más en el pago final, y sí lo discute en el anticipo que acaba de pactar.
 */
export function buildSchedule(input: SchedulePlanInput): PlannedInstallment[] {
  const total = round2(Math.max(num(input.total), 0));
  if (total <= 0) return [];

  const now = input.now ?? new Date();
  const today = dayOf(now)!;
  const depositDay = dayOf(input.depositDueDate) || today;
  const balanceDay = dayOf(input.balanceDueDate) || depositDay;

  const { deposit } = depositDue(
    (input.policy ?? {}) as DepositInput,
    total
  );

  const out: PlannedInstallment[] = [];
  let sequence = 1;
  let remainingCents = cents(total);

  if (deposit > 0) {
    out.push({ sequence: sequence++, kind: "deposit", due_date: depositDay, amount: round2(deposit) });
    remainingCents -= cents(deposit);
  }

  if (remainingCents <= 0) return out;

  // El saldo se reparte en cuotas iguales entre el vencimiento del anticipo y
  // el del saldo. Con una sola cuota, es el pago final de toda la vida.
  const parts = Math.max(1, Math.trunc(num(input.installments) || 1));
  const step = parts > 1 ? Math.max(0, daysBetween(depositDay, balanceDay)) / (parts - 1 || 1) : 0;
  const perCent = Math.floor(remainingCents / parts);

  for (let i = 0; i < parts; i++) {
    const last = i === parts - 1;
    // La última se lleva el resto: así la suma cuadra al céntimo.
    const amountCents = last ? remainingCents - perCent * (parts - 1) : perCent;
    const dueDate = last
      ? balanceDay
      : dayOf(new Date(new Date(`${depositDay}T00:00:00Z`).getTime() + Math.round(step * i) * 86_400_000))!;
    out.push({
      sequence: sequence++,
      kind: last ? "balance" : "installment",
      due_date: dueDate < depositDay ? depositDay : dueDate,
      amount: round2(amountCents / 100),
    });
  }

  return out;
}

/* ------------------------------------------------------------- la imputación */

export interface Installment {
  _id?: string;
  sequence?: number | null;
  kind?: string | null;
  due_date?: string | null;
  amount?: number | null;
  paid_amount?: number | null;
  status?: string | null;
}

export interface Allocation {
  installment: Installment;
  applied: number;
  paid_amount: number;
  balance: number;
  status: InstallmentStatus;
}

/** Una cuota perdonada o anulada no espera dinero ni vence. */
const DEAD_INSTALLMENT = new Set(["waived", "cancelled"]);

const byDueDate = (a: Installment, b: Installment): number => {
  const da = dayOf(a.due_date) || "9999-12-31";
  const db = dayOf(b.due_date) || "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  return (a.sequence ?? 0) - (b.sequence ?? 0);
};

/**
 * Reparte un cobro entre las cuotas, la más antigua primero.
 *
 * Ninguna recibe más de lo que debe: el sobrante se devuelve sin imputar, para
 * que quien llama decida —un sobrepago no se reparte a la fuerza entre cuotas
 * futuras que el cliente no ha aceptado adelantar.
 */
export function allocate(
  schedule: Installment[],
  amount: number,
  today: string | Date = new Date()
): { allocations: Allocation[]; unapplied: number } {
  let remaining = cents(Math.max(num(amount), 0));
  const allocations: Allocation[] = [];

  for (const installment of [...schedule].sort(byDueDate)) {
    if (remaining <= 0) break;
    if (DEAD_INSTALLMENT.has(installment.status || "")) continue;
    const due = cents(installment.amount);
    const paid = cents(installment.paid_amount);
    const outstanding = due - paid;
    if (outstanding <= 0) continue;

    const applied = Math.min(remaining, outstanding);
    remaining -= applied;
    const newPaid = paid + applied;
    allocations.push({
      installment,
      applied: round2(applied / 100),
      paid_amount: round2(newPaid / 100),
      balance: round2((due - newPaid) / 100),
      status: statusFor({ ...installment, paid_amount: newPaid / 100 }, today),
    });
  }

  return { allocations, unapplied: round2(remaining / 100) };
}

/**
 * Deshace un cobro: un reembolso quita dinero de las cuotas, la más RECIENTE
 * primero.
 *
 * Al revés que el cobro, y a propósito: devolver dinero que se imputó al
 * anticipo deja la reserva sin anticipo pagado y le quita la plaza al cliente,
 * cuando lo que se devolvió fue la última cuota.
 */
export function unallocate(
  schedule: Installment[],
  amount: number,
  today: string | Date = new Date()
): { allocations: Allocation[]; unapplied: number } {
  let remaining = cents(Math.max(num(amount), 0));
  const allocations: Allocation[] = [];

  for (const installment of [...schedule].sort(byDueDate).reverse()) {
    if (remaining <= 0) break;
    if (DEAD_INSTALLMENT.has(installment.status || "")) continue;
    const due = cents(installment.amount);
    const paid = cents(installment.paid_amount);
    if (paid <= 0) continue;

    const applied = Math.min(remaining, paid);
    remaining -= applied;
    const newPaid = paid - applied;
    allocations.push({
      installment,
      applied: round2(-applied / 100),
      paid_amount: round2(newPaid / 100),
      balance: round2((due - newPaid) / 100),
      status: statusFor({ ...installment, paid_amount: newPaid / 100 }, today),
    });
  }

  return { allocations, unapplied: round2(remaining / 100) };
}

/* ------------------------------------------------------------------ estados */

/** En qué punto está una cuota, mirando lo pagado y el calendario. */
export function statusFor(
  installment: Installment,
  today: string | Date = new Date()
): InstallmentStatus {
  const current = installment.status || "";
  if (DEAD_INSTALLMENT.has(current)) return current as InstallmentStatus;

  const due = cents(installment.amount);
  const paid = cents(installment.paid_amount);
  if (due <= 0 || paid >= due) return "paid";

  const dueDay = dayOf(installment.due_date);
  const todayDay = dayOf(today)!;
  // Vencida manda sobre pagada-en-parte: lo que importa para cobrar es que la
  // fecha pasó, no que llegara una parte.
  if (dueDay && dueDay < todayDay) return "overdue";
  return paid > 0 ? "partially_paid" : "pending";
}

/**
 * El estado de cobro de la venta entera, para poder filtrarla sin recorrer las
 * cuotas: liquidada, vencida, por vencer o al día.
 */
export function collectionStatus(
  schedule: Installment[],
  today: string | Date = new Date(),
  soonDays = 7
): CollectionStatus {
  const live = schedule.filter((i) => !DEAD_INSTALLMENT.has(i.status || ""));
  if (live.length === 0) return "none";

  const todayDay = dayOf(today)!;
  let outstanding = 0;
  let overdue = false;
  let soon = false;

  for (const installment of live) {
    const balance = cents(installment.amount) - cents(installment.paid_amount);
    if (balance <= 0) continue;
    outstanding += balance;
    const dueDay = dayOf(installment.due_date);
    if (!dueDay) continue;
    if (dueDay < todayDay) overdue = true;
    else if (daysBetween(todayDay, dueDay) <= soonDays) soon = true;
  }

  if (outstanding <= 0) return "settled";
  if (overdue) return "overdue";
  if (soon) return "due_soon";
  return "on_track";
}

/**
 * El tramo de antigüedad de una deuda vencida.
 *
 * Mismo vocabulario que la pantalla y que el enum de la base —la migración 0039
 * los unificó, porque decían cosas distintas y guardar el tramo que la propia
 * interfaz ofrecía lo rechazaba la base.
 */
export function agingBucketFor(
  dueDate: string | Date | null | undefined,
  today: string | Date = new Date()
): AgingBucket {
  const due = dayOf(dueDate);
  if (!due) return "current";
  const days = daysBetween(due, dayOf(today)!);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

/* ------------------------------------------------- crédito y retención de cupo */

export interface CreditTerms {
  credit_limit?: number | null;
  credit_days?: number | null;
}

export interface CreditVerdict {
  allowed: boolean;
  limit: number | null;
  outstanding: number;
  available: number | null;
  reason: string | null;
}

/**
 * Si una venta a crédito cabe en el límite del socio.
 *
 * `credit_limit` llevaba desde la migración 0002 sin que nada lo mirara: se
 * podía vender a crédito sin techo y sin que saltara nada. Un límite nulo o
 * cero significa "sin límite fijado", no "no puede comprar" — bloquear a todo
 * el mundo porque nadie configuró el campo sería peor que no comprobarlo.
 */
export function creditCheck(
  terms: CreditTerms | null | undefined,
  outstanding: number,
  newAmount: number
): CreditVerdict {
  const limit = num(terms?.credit_limit);
  const owed = round2(Math.max(num(outstanding), 0));
  const amount = round2(Math.max(num(newAmount), 0));

  if (limit <= 0) {
    return { allowed: true, limit: null, outstanding: owed, available: null, reason: null };
  }
  const available = round2(limit - owed);
  if (round2(owed + amount) > limit + 0.009) {
    return {
      allowed: false, limit, outstanding: owed, available,
      reason: `Supera el límite de crédito: debe ${owed} de ${limit}, y esta venta suma ${amount}.`,
    };
  }
  return { allowed: true, limit, outstanding: owed, available, reason: null };
}

/**
 * Hasta cuándo se le guarda la plaza a una reserva que aún no ha pagado nada.
 *
 * Nunca más allá de la salida —una plaza retenida para un viaje que ya salió no
 * la reclama nadie— y nunca menos de una hora, que es lo que tarda un cliente en
 * ir al cajero.
 */
export function holdUntil(
  createdAt: string | Date,
  hours: number,
  departureAt?: string | Date | null,
  ): string {
  const start = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const span = Math.max(1, num(hours)) * 3_600_000;
  let expiry = new Date(start.getTime() + span);
  const departure = departureAt ? new Date(departureAt) : null;
  if (departure && !Number.isNaN(departure.getTime()) && departure < expiry) expiry = departure;
  return expiry.toISOString();
}
