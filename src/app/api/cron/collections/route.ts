import { NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { ok, fail } from "@/lib/api-response";
import { startJobRun, finishJobRun, reportIncident, barridoVigilado } from "@/lib/system-health-service";
import { PAGINA, type ResumenBarrido } from "@/lib/barrido";
import { TenantError } from "@/lib/tenant";
import { serviceStore } from "@/lib/messaging/service-store";
import { notifyBalanceDue } from "@/lib/messaging/events";
import { releaseExpiredHolds } from "@/lib/booking-service";
import { expireOffers, offerFreedSeatsForCompany } from "@/lib/waitlist-service";
import { markExpiredOctoHolds } from "@/lib/octo-service";
import { statusFor, collectionStatus, agingBucketFor, dayOf, daysBetween } from "@/lib/collections";
import { notify } from "@/lib/notify-service";
import type { Booking, Company } from "@/lib/types";
import { tryWrite } from "@/lib/supabase/io";

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
async function refreshInstallments(now: Date): Promise<{ overdue: number; orders: number; barrido: ResumenBarrido }> {
  const today = dayOf(now)!;
  const touchedOrders = new Map<string, string>();
  let overdue = 0;

  /**
   * RECORRIDO, no drenaje: poner una cuota en `overdue` la deja DENTRO del
   * filtro —`overdue` está en la lista de estados que se leen—, así que la
   * ventana tiene que avanzar o se pedirían las mismas quinientas para
   * siempre.
   *
   * Y va ordenado por vencimiento: si algún día se toca el techo, lo que se
   * haya tratado será lo más vencido, que es lo que más urge. Antes no había
   * orden ninguno, así que el corte caía donde quisiera el montón.
   */
  const barrido = await barridoVigilado<ScheduleRow>({
    etiqueta: "cobranza:cuotas",
    modo: "recorrido",
    idDe: (row) => row.id,
    leer: async (desde, hasta) => {
      const { data, error } = await supabaseService()
        .from("payment_schedule")
        .select("id, organization_id, order_id, booking_id, kind, due_date, amount, paid_amount, balance, currency, status, reminded_at")
        .in("status", ["pending", "partially_paid", "overdue"])
        .lte("due_date", today)
        .order("due_date", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta);
      if (error) throw new Error(error.message);
      return (data ?? []) as ScheduleRow[];
    },
    tratar: async (rows) => { await tratarCuotas(rows, now, touchedOrders, (n) => { overdue += n; }); },
  });

  await repasarEstadoDeVentas(touchedOrders, now);
  return { overdue, orders: touchedOrders.size, barrido };
}

/** Lo que se hace con una vuelta de cuotas. */
async function tratarCuotas(
  rows: ScheduleRow[], now: Date,
  touchedOrders: Map<string, string>, sumarVencida: (n: number) => void
): Promise<void> {
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
      if (next === "overdue") sumarVencida(1);
    }
    touchedOrders.set(row.order_id, row.organization_id);
  }
}

/**
 * El estado de cobro de la venta se recalcula con TODAS sus cuotas, no solo
 * con las que acaban de vencer: una venta con la última cuota pagada y una
 * intermedia vencida sigue vencida.
 *
 * Va una sola vez al final y no por vuelta: una venta con cuotas en dos
 * páginas se repasaría dos veces, y la primera con la mitad de los datos.
 */
async function repasarEstadoDeVentas(touchedOrders: Map<string, string>, now: Date): Promise<void> {
  for (const [orderId, companyId] of touchedOrders) {
    const { data: all } = await supabaseService()
      .from("payment_schedule")
      .select("amount, paid_amount, due_date, status")
      .eq("organization_id", companyId)
      .eq("order_id", orderId)
      .limit(60);
    const state = collectionStatus(all ?? [], now);
    // El cron recorre muchas ventas: que una falle no puede dejar sin repasar a
    // las demás. Se anota y se sigue.
    await tryWrite(`marcar el estado de cobro de la venta ${orderId}`, supabaseService()
      .from("sales_order")
      .update({ collection_status: state })
      .eq("organization_id", companyId)
      .eq("id", orderId));
  }
}

/** Encola el recordatorio del saldo de lo que vence pronto o ya venció. */
type FilaConRecordatorio = ScheduleRow & {
  order?: { id: string; order_number?: string; customer_id?: string; status?: string } | null;
  booking?: {
    id: string; booking_number?: string; travel_date?: string;
    currency?: string; customer_id?: string; product_id?: string;
  } | null;
};

async function remindBalances(now: Date): Promise<{ reminded: number; companies: string[]; barrido: ResumenBarrido }> {
  const horizon = dayOf(new Date(now.getTime() + REMIND_WINDOW_DAYS * 86_400_000))!;
  const cooldown = new Date(now.getTime() - REMIND_COOLDOWN_DAYS * 86_400_000).toISOString();

  const companies = new Set<string>();
  let reminded = 0;

  /**
   * RECORRIDO: el recordatorio solo escribe `reminded_at`, así que la cuota
   * sigue en el filtro y la ventana tiene que avanzar.
   *
   * Por vencimiento ascendente, que es el orden en el que importa: a quien
   * debe desde hace más tiempo se le escribe primero. Con el tope de mil de
   * antes y sin orden, el cliente que más debía podía no recibir jamás un
   * recordatorio — y el sistema prometía recordar el saldo.
   */
  const barrido = await barridoVigilado<FilaConRecordatorio>({
    etiqueta: "cobranza:recordatorios",
    modo: "recorrido",
    idDe: (row) => row.id,
    leer: async (desde, hasta) => {
      const { data, error } = await supabaseService()
        .from("payment_schedule")
        .select(
          "id, organization_id, order_id, booking_id, kind, due_date, amount, paid_amount, balance, currency, status, reminded_at, " +
          "order:order_id (id, order_number, customer_id, status), " +
          "booking:booking_id (id, booking_number, travel_date, currency, customer_id, product_id)"
        )
        .in("status", ["pending", "partially_paid", "overdue"])
        .lte("due_date", horizon)
        .order("due_date", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as FilaConRecordatorio[];
    },
    tratar: async (filas) => {
      const hechos = await recordarVuelta(filas, now, cooldown, companies);
      reminded += hechos;
    },
  });

  return { reminded, companies: [...companies], barrido };
}

/** Manda los recordatorios de una vuelta y devuelve cuántos salieron. */
async function recordarVuelta(
  filas: FilaConRecordatorio[], now: Date, cooldown: string, companies: Set<string>
): Promise<number> {
  let reminded = 0;
  for (const row of filas) {
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
      // Si no se puede dejar constancia de que el recordatorio salió, NO se
      // cuenta como enviado — pero tampoco se reintenta el envío en esta
      // vuelta: el correo ya se fue. La cuota volverá mañana, y volver a
      // recordar es mucho menos grave que decir que se recordó y no constar.
      const anotado = await tryWrite(`anotar el recordatorio de la cuota ${row.id}`, supabaseService()
        .from("payment_schedule")
        .update({ reminded_at: now.toISOString() })
        .eq("organization_id", row.organization_id)
        .eq("id", row.id));
      if (!anotado) continue;
      companies.add(row.organization_id);
      reminded++;
    } catch (err) {
      console.error(`[cron/collections] recordatorio de la cuota ${row.id} falló:`, err);
    }
  }
  return reminded;
}

interface FilaDeCobro {
  id: string; organization_id: string; due_date: string | null;
  amount: number | null; paid_amount: number | null; balance: number | null;
  status: string | null; aging_bucket: string | null;
  currency: string | null; document_number: string | null;
}

/** Pone la antigüedad de cada cuenta por cobrar al día con su vencimiento. */
async function syncAging(now: Date): Promise<{ updated: number; overdue: number; barrido: ResumenBarrido }> {
  let updated = 0;
  let overdue = 0;
  const today = dayOf(now)!;

  /**
   * RECORRIDO: pasar una cuenta a `overdue` la deja dentro del filtro, que
   * solo excluye `paid` y `written_off`. Y la mayoría de las vueltas no
   * escriben nada —`continue` cuando el tramo y el estado ya están bien—, así
   * que en drenaje esto no bajaría nunca.
   */
  const barrido = await barridoVigilado<FilaDeCobro>({
    etiqueta: "cobranza:antiguedad",
    modo: "recorrido",
    idDe: (row) => row.id,
    leer: async (desde, hasta) => {
      const { data, error } = await supabaseService()
        .from("receivable")
        .select("id, organization_id, due_date, amount, paid_amount, balance, status, aging_bucket, currency, document_number")
        .not("status", "in", "(paid,written_off)")
        .order("due_date", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as FilaDeCobro[];
    },
    tratar: async (filas) => {
      const hecho = await envejecerVuelta(filas, now, today);
      updated += hecho.updated;
      overdue += hecho.overdue;
    },
  });

  return { updated, overdue, barrido };
}

/** Pone al día la antigüedad de una vuelta. */
async function envejecerVuelta(
  filas: FilaDeCobro[], now: Date, today: string
): Promise<{ updated: number; overdue: number }> {
  let updated = 0;
  let overdue = 0;
  for (const row of filas) {
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
    if (status === "overdue" && row.status !== "overdue") {
      overdue++;
      // El aviso sale UNA vez, cuando la deuda cruza su fecha. El cron vuelve a
      // mirar estas mismas filas todos los días: sin la clave de dedupe de
      // 0044, a la semana habría siete copias de cada deuda en la bandeja y
      // nadie volvería a abrirla.
      await notify({
        companyId: row.organization_id as string,
        event: "receivable_overdue",
        entityType: "receivable",
        entityId: row.id as string,
        vars: {
          monto: balance,
          moneda: String(row.currency || "usd"),
          dias: due ? Math.max(1, daysBetween(due, today)) : null,
          referencia: (row.document_number as string) || null,
        },
      });
    }
  }

  return { updated, overdue };
}

/**
 * Libera el cupo de las ventas cuya retención expiró, empresa por empresa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE ERA EL PEOR DE LOS CUATRO
 *
 * Aquí solo se leen los identificadores de empresa para saber a quién hay que
 * repasar; el trabajo lo hace `releaseExpiredHolds` por dentro. Pero el tope
 * de mil caía sobre las FILAS, no sobre las empresas: bastaba con que mil
 * retenciones vencidas salieran antes en el montón para que una operadora
 * entera no apareciera en la lista y no se le liberara ni una plaza. Y como el
 * montón no cambia entre pasadas, era la MISMA operadora todos los días.
 *
 * Medido con 2 500 retenciones vencidas y el tope de mil: las mil filas que
 * salían eran idénticas en dos pasadas seguidas, y de las 1 500 restantes no
 * se tocaba ninguna. Las plazas se quedaban apartadas para siempre, sin error
 * en ninguna pantalla — el cliente llamando porque la salida «está llena» y la
 * salida con la mitad de los asientos retenidos por ventas muertas.
 *
 * Se lee ENTERO, por orden de vencimiento, y se recorre (no se drena: aquí se
 * juntan primero todas las empresas y se trata después, porque tratar una
 * empresa saca del filtro filas de cualquier página).
 */
async function releaseHolds(now: Date): Promise<{ released: number; barrido: ResumenBarrido }> {
  const empresas = new Set<string>();
  const barrido = await barridoVigilado<{ id: string; organization_id: string }>({
    etiqueta: "cobranza:retenciones",
    modo: "recorrido",
    idDe: (row) => row.id,
    leer: async (desde, hasta) => {
      const { data, error } = await supabaseService()
        .from("sales_order")
        .select("id, organization_id")
        .eq("status", "pending_payment")
        .not("hold_until", "is", null)
        .lt("hold_until", now.toISOString())
        .order("hold_until", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; organization_id: string }[];
    },
    tratar: async (filas) => { for (const f of filas) empresas.add(f.organization_id); },
  });

  let released = 0;
  for (const companyId of empresas) {
    try {
      /**
       * Las retenciones de OTA se MARCAN vencidas antes de soltarlas.
       *
       * El orden importa: `releaseExpiredHolds` cancela la reserva, y si se
       * cancela primero, el revendedor lee CANCELLED —una incidencia que
       * atender, con reembolso que decidir— en vez de EXPIRED, que es suya por
       * no haber pagado a tiempo.
       *
       * Va aquí y no en un cron propio porque el plan Hobby de Vercel solo
       * admite trabajos diarios. Y da igual: lo que de verdad libera a tiempo
       * la plaza de una OTA es el barrido al consultar disponibilidad, porque
       * una plaza bloqueada de más solo hace daño cuando alguien intenta
       * comprarla — y ese intento es lo que lo dispara. Este repaso diario deja
       * al día los contadores que se miran sin que nadie esté comprando.
       */
      const vencidas = await markExpiredOctoHolds(companyId, now);
      if (vencidas > 0) console.log(`[cron/collections] ${vencidas} retención(es) de OTA marcadas como vencidas`);

      const result = await releaseExpiredHolds(companyId, now);
      released += result.released;

      /**
       * LAS OFERTAS DE LISTA DE ESPERA A LAS QUE NADIE CONTESTÓ (0066).
       *
       * Va DESPUÉS de soltar las retenciones y por el mismo motivo que el
       * marcado de las de OTA va antes: el orden cuenta la historia correcta.
       * `releaseExpiredHolds` acaba de cancelar la reserva que guardaba la
       * plaza; marcar aquí la espera como vencida deja las dos cosas diciendo
       * lo mismo, y la plaza recién soltada se le ofrece al siguiente de la
       * cola en el acto.
       *
       * No se cancelan las reservas desde aquí: de eso se encarga
       * `releaseExpiredHolds`, que solo toca las que nadie pagó. Duplicar esa
       * decisión habría sido la forma de que las dos acabaran discrepando.
       */
      try {
        const caducadas = await expireOffers(companyId, now);
        for (const departureId of caducadas.departures) {
          await offerFreedSeatsForCompany(companyId, departureId);
        }
        if (caducadas.expired > 0) {
          console.log(`[cron/collections] ${caducadas.expired} oferta(s) de lista de espera vencidas y reofrecidas`);
        }
      } catch (err) {
        console.error(`[cron/collections] lista de espera de ${companyId} falló:`, err);
      }
    } catch (err) {
      // Una empresa con un problema no puede dejar el cupo de las demás sin liberar.
      console.error(`[cron/collections] liberación de cupo de ${companyId} falló:`, err);
    }
  }
  return { released, barrido };
}

export async function GET(req: NextRequest) {
  let runId: string | null = null;
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new TenantError("CRON_SECRET no está configurado en el entorno", 503);
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      console.warn("[cron/collections] intento de ejecución sin credencial válida");
      throw new TenantError("No autorizado", 401);
    }

    runId = await startJobRun("collections");

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
      /**
       * QUÉ BARRIDOS NO LLEGARON AL FINAL.
       *
       * Va en el resumen del trabajo, que es lo que lee la pantalla de salud.
       * El incidente ya se levantó dentro de `barridoVigilado`; esto es para
       * quien abre la ejecución concreta y quiere saber cuál de los cuatro se
       * quedó corto sin tener que cruzar dos pantallas.
       */
      truncados: [
        ["cuotas", installments], ["recordatorios", reminders],
        ["antigüedad", aging], ["cupo", holds],
      ]
        .filter(([, r]) => {
          const v = (r as PromiseSettledResult<{ barrido?: ResumenBarrido }>);
          return v.status === "fulfilled" && (v.value.barrido?.truncado || v.value.barrido?.atascado);
        })
        .map(([nombre]) => nombre as string),
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

    await finishJobRun(runId, { status: "ok", summary: report as Record<string, unknown> });

    return ok(report);
  } catch (err) {
    console.error("[cron/collections] error:", err);
    await finishJobRun(runId, { status: "failed", error: String(err) });
    await reportIncident({ source: "cron:collections", error: err });
    return fail(err);
  }
}
