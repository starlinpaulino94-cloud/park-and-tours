import { NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { ok, fail } from "@/lib/api-response";
import { TenantError } from "@/lib/tenant";
import { serviceStore } from "@/lib/messaging/service-store";
import { notifyBalanceDue } from "@/lib/messaging/events";
import { releaseExpiredHolds } from "@/lib/booking-service";
import { statusFor, collectionStatus, agingBucketFor, dayOf } from "@/lib/collections";
import type { Booking, Company } from "@/lib/types";

/**
 * GET /api/cron/collections — la cobranza diaria.
 *
 * Hace las cuatro cosas que nadie va a hacer a mano con cuarenta salidas a la
 * semana:
 *
 *  1. **Vence lo vencido.** Una cuota cuya fecha pasó queda en `overdue`, y la
 *     venta entera pasa a `overdue` o `due_soon`. Sin esto el estado de cobro
 *     era el que tuviera el día que se creó.
 *
 *  2. **Recuerda el saldo.** Encola el aviso `balance_due` de las cuotas que
 *     vencen pronto o ya vencieron. Esa plantilla existía desde el módulo de
 *     comunicaciones y NADA la disparaba: el sistema prometía recordar el saldo
 *     y no recordaba ninguno.
 *
 *  3. **Sincroniza la antigüedad.** `receivable.aging_bucket` se escribía
 *     'current' al crear y no se tocaba más, así que una deuda de 120 días
 *     seguía diciendo "corriente" a quien la leyera por la columna.
 *
 *  4. **Libera el cupo retenido.** Las reservas sin un peso cobrado pasado su
 *     plazo sueltan las plazas, si la empresa configuró un plazo.
 *
 * Como el resto de los trabajos programados, recorre TODOS los inquilinos y por
 * eso se autentica con el secreto del cron y usa el cliente de servicio con
 * filtro explícito de `organization_id`: bajo RLS, las ayudas de inquilino
 * resuelven la sesión desde las cookies de la petición, que un cron no tiene, y
 * leería cero filas diciendo que no hay nada que cobrar.
 */
export const dynamic = "force-dynamic";

/** A cuántos días de vista se le recuerda el saldo al cliente. */
const REMIND_WINDOW_DAYS = 7;
/** Cada cuánto se le puede repetir el recordatorio de la misma cuota. */
const REMIND_COOLDOWN_DAYS = 5;

interface ScheduleRow {
  id: string;
  organization_id: string;
  order_id: string;
  booking_id: string | null;
  kind: string | null;
  due_date: string | null;
  amount: number | null;
  paid_amount: number | null;
  balance: number | null;
  currency: string | null;
  status: string | null;
  reminded_at: string | null;
}

/** Pone al día el estado de cada cuota y el de la venta que la contiene. */
async function refreshInstallments(now: Date): Promise<{ overdue: number; orders: number }> {
  const today = dayOf(now)!;
  const { data, error } = await supabaseService()
    .from("payment_schedule")
    .select("id, organization_id, order_id, booking_id, kind, due_date, amount, paid_amount, balance, currency, status, reminded_at")
    .in("status", ["pending", "partially_paid", "overdue"])
    .lte("due_date", today)
    .limit(2000);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ScheduleRow[];
  const touchedOrders = new Map<string, string>();
  let overdue = 0;

  for (const row of rows) {
    const next = statusFor(
      { amount: row.amount, paid_amount: row.paid_amount, due_date: row.due_date, status: row.status },
      now
    );
    if (next !== row.status) {
      const { error: updateError } = await supabaseService()
        .from("payment_schedule")
        .update({ status: next })
        .eq("organization_id", row.organization_id)
        .eq("id", row.id);
      if (updateError) {
        console.error(`[cron/collections] cuota ${row.id}:`, updateError.message);
        continue;
      }
      if (next === "overdue") overdue++;
    }
    touchedOrders.set(row.order_id, row.organization_id);
  }

  // El estado de cobro de la venta se recalcula con TODAS sus cuotas, no solo
  // con las que acaban de vencer: una venta con la última cuota pagada y una
  // intermedia vencida sigue vencida.
  for (const [orderId, companyId] of touchedOrders) {
    const { data: all } = await supabaseService()
      .from("payment_schedule")
      .select("amount, paid_amount, due_date, status")
      .eq("organization_id", companyId)
      .eq("order_id", orderId)
      .limit(60);
    const state = collectionStatus(all ?? [], now);
    await supabaseService()
      .from("sales_order")
      .update({ collection_status: state })
      .eq("organization_id", companyId)
      .eq("id", orderId);
  }

  return { overdue, orders: touchedOrders.size };
}

/** Encola el recordatorio del saldo de lo que vence pronto o ya venció. */
async function remindBalances(now: Date): Promise<{ reminded: number; companies: string[] }> {
  const horizon = dayOf(new Date(now.getTime() + REMIND_WINDOW_DAYS * 86_400_000))!;
  const cooldown = new Date(now.getTime() - REMIND_COOLDOWN_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabaseService()
    .from("payment_schedule")
    .select(
      "id, organization_id, order_id, booking_id, kind, due_date, amount, paid_amount, balance, currency, status, reminded_at, " +
      "order:order_id (id, order_number, customer_id, status), " +
      "booking:booking_id (id, booking_number, travel_date, currency, customer_id, product_id)"
    )
    .in("status", ["pending", "partially_paid", "overdue"])
    .lte("due_date", horizon)
    .limit(1000);
  if (error) throw new Error(error.message);

  type Row = ScheduleRow & {
    order?: { id: string; order_number?: string; customer_id?: string; status?: string } | null;
    booking?: {
      id: string; booking_number?: string; travel_date?: string;
      currency?: string; customer_id?: string; product_id?: string;
    } | null;
  };

  const companies = new Set<string>();
  let reminded = 0;

  for (const row of (data ?? []) as unknown as Row[]) {
    const balance = row.balance ?? Math.max((row.amount ?? 0) - (row.paid_amount ?? 0), 0);
    if (balance <= 0.009) continue;
    // Una venta cancelada no se cobra, y escribirle al cliente por ella es
    // peor que no escribirle: le reclama algo que ya no existe.
    if (row.order?.status === "cancelled" || row.order?.status === "refunded") continue;
    // El enfriamiento evita escribirle todos los días hasta que pague.
    if (row.reminded_at && row.reminded_at > cooldown) continue;

    const customerId = row.booking?.customer_id || row.order?.customer_id || null;
    if (!customerId) continue;

    const { data: customer } = await supabaseService()
      .from("customer")
      .select("id, first_name, last_name, email, phone, whatsapp, language")
      .eq("organization_id", row.organization_id)
      .eq("id", customerId)
      .maybeSingle();

    const { data: product } = row.booking?.product_id
      ? await supabaseService()
          .from("product")
          .select("name")
          .eq("organization_id", row.organization_id)
          .eq("id", row.booking.product_id)
          .maybeSingle()
      : { data: null };

    const { data: org } = await supabaseService()
      .from("organizations")
      .select("id, name, email, phone, whatsapp")
      .eq("id", row.organization_id)
      .maybeSingle();

    try {
      await notifyBalanceDue(
        org
          ? ({ _id: org.id, name: org.name, email: org.email, phone: org.phone, whatsapp: org.whatsapp } as Company)
          : null,
        row.organization_id,
        {
          installment: {
            _id: row.id, kind: row.kind, due_date: row.due_date,
            amount: row.amount, paid_amount: row.paid_amount, balance, currency: row.currency,
          },
          order: row.order ? { _id: row.order.id, order_number: row.order.order_number } : null,
          booking: row.booking
            ? ({ ...row.booking, _id: row.booking.id } as unknown as Booking)
            : null,
          customer: customer ? { ...customer, _id: customer.id } : null,
          product: product ?? null,
        },
        serviceStore()
      );
      await supabaseService()
        .from("payment_schedule")
        .update({ reminded_at: now.toISOString() })
        .eq("organization_id", row.organization_id)
        .eq("id", row.id);
      companies.add(row.organization_id);
      reminded++;
    } catch (err) {
      console.error(`[cron/collections] recordatorio de la cuota ${row.id} falló:`, err);
    }
  }

  return { reminded, companies: [...companies] };
}

/** Pone la antigüedad de cada cuenta por cobrar al día con su vencimiento. */
async function syncAging(now: Date): Promise<{ updated: number; overdue: number }> {
  const { data, error } = await supabaseService()
    .from("receivable")
    .select("id, organization_id, due_date, amount, paid_amount, balance, status, aging_bucket")
    .not("status", "in", "(paid,written_off)")
    .limit(2000);
  if (error) throw new Error(error.message);

  let updated = 0;
  let overdue = 0;
  const today = dayOf(now)!;

  for (const row of data ?? []) {
    const balance = Number(row.balance ?? Math.max(Number(row.amount ?? 0) - Number(row.paid_amount ?? 0), 0));
    const bucket = agingBucketFor(row.due_date as string | null, now);
    const due = dayOf(row.due_date as string | null);
    // Vencida solo si queda saldo: una cuenta saldada con fecha pasada no es
    // una deuda, y marcarla vencida la mete en la lista de cobro de nadie.
    const status = balance > 0.009 && due && due < today ? "overdue" : row.status;

    if (bucket === row.aging_bucket && status === row.status) continue;
    const { error: updateError } = await supabaseService()
      .from("receivable")
      .update({ aging_bucket: bucket, status })
      .eq("organization_id", row.organization_id)
      .eq("id", row.id);
    if (updateError) {
      console.error(`[cron/collections] cuenta por cobrar ${row.id}:`, updateError.message);
      continue;
    }
    updated++;
    if (status === "overdue" && row.status !== "overdue") overdue++;
  }

  return { updated, overdue };
}

/** Libera el cupo de las ventas cuya retención expiró, empresa por empresa. */
async function releaseHolds(now: Date): Promise<{ released: number }> {
  const { data, error } = await supabaseService()
    .from("sales_order")
    .select("organization_id")
    .eq("status", "pending_payment")
    .not("hold_until", "is", null)
    .lt("hold_until", now.toISOString())
    .limit(1000);
  if (error) throw new Error(error.message);

  let released = 0;
  for (const companyId of new Set((data ?? []).map((r) => r.organization_id as string))) {
    try {
      const result = await releaseExpiredHolds(companyId, now);
      released += result.released;
    } catch (err) {
      // Una empresa con un problema no puede dejar el cupo de las demás sin liberar.
      console.error(`[cron/collections] liberación de cupo de ${companyId} falló:`, err);
    }
  }
  return { released };
}

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new TenantError("CRON_SECRET no está configurado en el entorno", 503);
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      console.warn("[cron/collections] intento de ejecución sin credencial válida");
      throw new TenantError("No autorizado", 401);
    }

    const now = new Date();
    // Cada paso va por separado: que la antigüedad falle no puede dejar sin
    // recordatorio a quien debe dinero, ni al contrario.
    const results = await Promise.allSettled([
      refreshInstallments(now),
      remindBalances(now),
      syncAging(now),
      releaseHolds(now),
    ]);

    const [installments, reminders, aging, holds] = results;
    const report = {
      installments: installments.status === "fulfilled" ? installments.value : null,
      reminders: reminders.status === "fulfilled" ? reminders.value : null,
      aging: aging.status === "fulfilled" ? aging.value : null,
      holds: holds.status === "fulfilled" ? holds.value : null,
      failed: results
        .map((result, index) => (result.status === "rejected" ? ["cuotas", "recordatorios", "antigüedad", "cupo"][index] : null))
        .filter(Boolean),
      ranAt: now.toISOString(),
    };

    for (const result of results) {
      if (result.status === "rejected") console.error("[cron/collections] paso fallido:", result.reason);
    }

    console.log(
      `[cron/collections] ${report.installments?.overdue ?? 0} cuotas vencidas · ` +
      `${report.reminders?.reminded ?? 0} recordatorios · ` +
      `${report.aging?.updated ?? 0} cuentas al día · ${report.holds?.released ?? 0} retenciones liberadas`
    );

    return ok(report);
  } catch (err) {
    console.error("[cron/collections] error:", err);
    return fail(err);
  }
}
