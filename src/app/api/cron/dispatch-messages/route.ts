import { NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { ok, fail } from "@/lib/api-response";
import { startJobRun, finishJobRun, reportIncident, barridoVigilado } from "@/lib/system-health-service";
import type { ResumenBarrido } from "@/lib/barrido";
import { TenantError } from "@/lib/tenant";
import { dispatchQueue } from "@/lib/messaging/outbox";
import { serviceStore } from "@/lib/messaging/service-store";
import { enqueuePreTourReminder } from "@/lib/messaging/events";
import { sweepDueSurveys, expireSurveys, SWEEP_LOOKBACK_DAYS } from "@/lib/voice-service";
import { barrerManifiestos } from "@/lib/manifiesto-envio-service";
import { fuenteDeServicio } from "@/lib/manifest-service";
import { VENTANA_DE_ENVIO_HORAS } from "@/lib/manifiesto-envio";
import type { Booking } from "@/lib/types";
import { configuredChannels } from "@/lib/messaging/providers";
import type { Company } from "@/lib/types";

/**
 * GET /api/cron/dispatch-messages — saca la cola de mensajes.
 *
 * Encolar y entregar están separados (ver `src/lib/messaging/outbox.ts`), así
 * que alguien tiene que llamar a la puerta. Este trabajo recorre las empresas
 * que tienen algo pendiente y entrega lo que ya toca: la confirmación que se
 * encoló hace un minuto y el recordatorio de la víspera que llevaba días
 * esperando su hora.
 *
 * No es un trabajo de un inquilino —recorre todos—, así que se autentica con el
 * secreto del cron y no con una sesión.
 *
 * CADENCIA: una vez al día (`0 6 * * *` en `vercel.json`). Estaba cada 15
 * minutos, que es lo que esta cola pide de verdad, y el plan Hobby de Vercel no
 * admite crons sub-diarios: el despliegue ENTERO fallaba con "Hobby accounts are
 * limited to daily cron jobs", así que ninguna versión llegaba a producción. Con
 * un plan Pro, devolverlo a cada cuarto de hora es cambiar esa línea y nada más.
 *
 * Mientras la cadencia sea diaria, un aviso encolado a las 9 de la mañana sale a
 * la mañana siguiente. Para la confirmación de una reserva eso es demasiado
 * tarde, y la vía que no cuesta dinero es despachar al terminar la petición que
 * lo encola —no dentro de ella, para no meter la latencia del proveedor de
 * correo en medio de una venta— dejando este trabajo como barrido y reintento.
 *
 * Sin proveedor configurado no hace nada destructivo: informa de qué canales
 * están sin credenciales y deja la cola intacta.
 */
export const dynamic = "force-dynamic";

/** La forma de la fila del barrido: el cliente tipado no infiere los embebidos. */
interface SweepRow {
  id: string;
  organization_id: string;
  booking_number?: string | null;
  travel_date?: string | null;
  pax_total?: number | null;
  currency?: string | null;
  balance_amount?: number | null;
  pickup_time?: string | null;
  pickup_location?: string | null;
  order_id?: string | null;
  departure_id?: string | null;
  customer_id?: string | null;
  customer?: { id?: string; first_name?: string; last_name?: string; email?: string; phone?: string; whatsapp?: string; language?: string } | null;
  product?: { name?: string; meeting_point?: string } | null;
}

/**
 * Encola el recordatorio de la víspera de lo que sale en las próximas 48 horas.
 *
 * La ventana es de 48 y no de 24 a propósito: el aviso se programa para 24 h
 * antes, y barrer solo las 24 siguientes dejaría fuera justo las salidas que
 * todavía no han llegado a su hora de aviso.
 */
async function sweepReminders(): Promise<{ enqueued: number; companies: string[]; barrido: ResumenBarrido | null }> {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 48 * 3_600_000).toISOString();

  const companies = new Set<string>();
  let enqueued = 0;

  /**
   * RECORRIDO: encolar el aviso no cambia el estado de la reserva, así que la
   * fila sigue en el filtro.
   *
   * Por fecha de viaje ascendente: primero lo que sale antes, que es lo que ya
   * casi no da tiempo a avisar. El tope de mil de antes no tenía orden, así
   * que la reserva que se quedaba sin recordatorio podía ser precisamente la
   * de mañana por la mañana — y el recordatorio de la víspera lleva la hora de
   * recogida: sin él, el cliente no sabe dónde esperar la guagua.
   */
  let barrido: ResumenBarrido | null = null;
  try {
    barrido = await barridoVigilado<SweepRow>({
      etiqueta: "mensajeria:recordatorios",
      modo: "recorrido",
      idDe: (row) => row.id,
      leer: async (desde, hasta) => {
        const { data, error } = await supabaseService()
          .from("booking")
          .select(
            "id, organization_id, booking_number, travel_date, pax_total, currency, balance_amount, " +
            "pickup_time, pickup_location, order_id, departure_id, customer_id, product_id, status, " +
            "customer:customer_id (id, first_name, last_name, email, phone, whatsapp, language), " +
            "product:product_id (name, meeting_point)"
          )
          .gte("travel_date", from)
          .lte("travel_date", to)
          .not("status", "in", "(cancelled,refunded,partially_refunded,draft)")
          .order("travel_date", { ascending: true })
          .order("id", { ascending: true })
          .range(desde, hasta);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as SweepRow[];
      },
      tratar: async (filas) => { enqueued += await recordarVuelta(filas, companies); },
    });
  } catch (err) {
    console.error("[cron/dispatch-messages] barrido de recordatorios falló:", err);
    return { enqueued, companies: [...companies], barrido: null };
  }

  return { enqueued, companies: [...companies], barrido };
}

/** Encola los recordatorios de una vuelta y devuelve cuántos salieron. */
async function recordarVuelta(filas: SweepRow[], companies: Set<string>): Promise<number> {
  let enqueued = 0;
  for (const row of filas) {
    const companyId = row.organization_id;
    companies.add(companyId);
    try {
      await enqueuePreTourReminder(
        null,
        companyId,
        {
          booking: {
            ...row,
            _id: row.id,
            order: row.order_id,
            departure: row.departure_id,
            customer: row.customer_id,
          } as unknown as Booking,
          customer: row.customer ? { ...row.customer, _id: row.customer.id } : null,
          product: row.product ?? null,
        },
        serviceStore()
      );
      enqueued++;
    } catch (err) {
      console.error(`[cron/dispatch-messages] recordatorio de ${row.id} falló:`, err);
    }
  }
  return enqueued;
}

/**
 * Las empresas que operaron algo hace poco.
 *
 * La encuesta de después del viaje se pregunta por SALIDA, no por mensaje
 * pendiente, así que estas empresas no aparecen en la cola: si no se buscaran
 * aparte, la primera encuesta de una operadora no saldría nunca —no hay nada
 * encolado hasta que alguien la encola—.
 */
/**
 * Las empresas que tienen algo que salir pronto.
 *
 * El manifiesto se encola por SALIDA, igual que la encuesta, así que tampoco
 * aparece en la cola de mensajes: sin buscarlas aparte, el primer manifiesto de
 * una operadora no saldría nunca.
 */
/**
 * LAS EMPRESAS DE UNA LECTURA, SIN QUE EL TOPE SE COMA A NINGUNA.
 *
 * Las tres lecturas siguientes solo quieren la lista de empresas a las que hay
 * que repasar; las filas dan igual. Pero el tope de dos mil caía sobre las
 * FILAS: bastaba con que una operadora grande llenara la página para que otra
 * no saliera en la lista y se quedara sin encolar NADA —ni encuesta, ni
 * manifiesto, ni recordatorio—. Y sin orden declarado, era siempre la misma.
 *
 * Recorrido, ordenado por fecha, hasta el final.
 */
async function empresasDe(
  etiqueta: string,
  // El constructor de PostgREST es «thenable» pero no una promesa entera:
  // `PromiseLike` es lo que acepta las dos formas sin un `as` que tape otra cosa.
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<string[]> {
  const empresas = new Set<string>();
  try {
    await barridoVigilado<{ id?: string; organization_id: string }>({
      etiqueta,
      modo: "recorrido",
      idDe: (row) => String(row.id ?? row.organization_id),
      leer: async (desde, hasta) => {
        const { data, error } = await consulta(desde, hasta);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id?: string; organization_id: string }[];
      },
      tratar: async (filas) => { for (const f of filas) empresas.add(String(f.organization_id)); },
    });
  } catch (err) {
    console.error(`[cron/dispatch-messages] ${etiqueta}:`, err);
  }
  return [...empresas];
}

async function companiesWithUpcomingDepartures(now: Date): Promise<string[]> {
  const hasta = new Date(now.getTime() + VENTANA_DE_ENVIO_HORAS * 3_600_000).toISOString();
  return empresasDe("mensajeria:salidas-proximas", (desde, fin) => supabaseService()
    .from("departure")
    .select("id, organization_id")
    .gte("departure_at", now.toISOString())
    .lte("departure_at", hasta)
    .order("departure_at", { ascending: true })
    .order("id", { ascending: true })
    .range(desde, fin));
}

async function companiesWithFinishedDepartures(now: Date): Promise<string[]> {
  const inicio = new Date(now.getTime() - SWEEP_LOOKBACK_DAYS * 86_400_000).toISOString();
  return empresasDe("mensajeria:salidas-terminadas", (desde, fin) => supabaseService()
    .from("departure")
    .select("id, organization_id")
    .gte("departure_at", inicio)
    .lte("departure_at", now.toISOString())
    .order("departure_at", { ascending: true })
    .order("id", { ascending: true })
    .range(desde, fin));
}

export async function GET(req: NextRequest) {
  let runId: string | null = null;
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new TenantError("CRON_SECRET no está configurado en el entorno", 503);
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      console.warn("[cron/dispatch-messages] intento de ejecución sin credencial válida");
      throw new TenantError("No autorizado", 401);
    }

    runId = await startJobRun("dispatch-messages");

    const available = configuredChannels();
    const now = new Date().toISOString();

    // Solo las empresas con algo que mandar: recorrerlas todas sería una
    // consulta por inquilino en cada pasada para nada.
    const pendientes = await empresasDe("mensajeria:cola", (desde, fin) => supabaseService()
      .from("message")
      .select("id, organization_id")
      .eq("status", "queued")
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, fin));

    // Antes de despachar, el barrido de recordatorios: las reservas que salen
    // en las próximas 48 h y todavía no tienen aviso encolado. Cubre la cartera
    // que ya existía antes de que hubiera comunicaciones y las reservas que
    // entraron mientras no había proveedor. La clave de dedupe hace que barrer
    // cien veces deje un solo aviso.
    const reminded = await sweepReminders();

    const companyIds = [...new Set([
      ...pendientes,
      ...reminded.companies,
      // Y las que operaron una salida hace poco: su encuesta todavía no está
      // encolada, así que no aparecería por la cola de mensajes.
      ...(await companiesWithFinishedDepartures(new Date())),
      // Y las que tienen una salida a la vuelta de la esquina: su manifiesto
      // tampoco está encolado todavía.
      ...(await companiesWithUpcomingDepartures(new Date())),
    ])];
    const report = {
      companies: companyIds.length, sent: 0, failed: 0, waiting: 0,
      surveys: 0, surveysExpired: 0, manifests: 0,
    };
    const notConfigured = new Set<string>();

    for (const companyId of companyIds) {
      const { data: org } = await supabaseService()
        .from("organizations")
        .select("id, name, email, phone, whatsapp")
        .eq("id", companyId)
        .maybeSingle();

      // Solo se usa para la identidad del remitente (nombre y responder-a).
      const company = org
        ? ({ _id: org.id, name: org.name, email: org.email, phone: org.phone, whatsapp: org.whatsapp } as Company)
        : null;

      /**
       * La voz del cliente, ANTES de despachar: lo que se encole aquí sale en
       * esta misma pasada y no mañana. Con una cadencia diaria, dejarlo para
       * después significaría preguntar por una excursión de anteayer.
       *
       * Los dos van con su try: ni una encuesta que no se pudo crear ni una
       * caducidad que no se pudo cerrar pueden dejar a una empresa sin sus
       * mensajes —que incluyen el recordatorio con la hora de recogida—.
       */
      try {
        const voz = await sweepDueSurveys(company, companyId, new Date());
        report.surveys += voz.asked;
      } catch (err) {
        console.error(`[cron/dispatch-messages] encuestas de ${companyId} fallaron:`, err);
      }
      try {
        report.surveysExpired += await expireSurveys(companyId);
      } catch (err) {
        console.error(`[cron/dispatch-messages] caducidad de encuestas de ${companyId} falló:`, err);
      }

      /**
       * El manifiesto de lo que sale pronto, también ANTES de despachar: lo que
       * se encole aquí sale en esta misma pasada. Con la cadencia diaria,
       * dejarlo para después sería mandarle al chofer la lista un día tarde.
       *
       * Con la fuente DE SERVICIO. Escrito contra las ayudas de inquilino no
       * habría fallado: habría leído cero salidas y dicho que no había nada que
       * mandar, que es el fallo que no se nota.
       *
       * Y con su propio try, como los otros dos: un manifiesto que no se pudo
       * componer no puede dejar a una empresa sin el recordatorio que lleva la
       * hora de recogida de sus clientes.
       */
      try {
        const manifiestos = await barrerManifiestos(
          company, companyId, new Date(), serviceStore(), fuenteDeServicio()
        );
        report.manifests += manifiestos.encolados;
      } catch (err) {
        console.error(`[cron/dispatch-messages] manifiestos de ${companyId} fallaron:`, err);
      }

      try {
        const result = await dispatchQueue(company, companyId, 100, serviceStore());
        report.sent += result.sent;
        report.failed += result.failed;
        report.waiting += result.waiting;
        for (const channel of result.notConfigured) notConfigured.add(channel);
      } catch (err) {
        // Una empresa con un problema no puede dejar sin avisos a las demás.
        console.error(`[cron/dispatch-messages] empresa ${companyId} falló:`, err);
      }
    }

    console.log(
      `[cron/dispatch-messages] ${report.companies} empresas · ${report.sent} enviados · ` +
      `${report.failed} fallidos · ${report.waiting} en espera · ${report.surveys} encuestas · ` +
      `${report.manifests} manifiestos`
    );

    await finishJobRun(runId, {
      status: "ok",
      summary: {
        companies: report.companies, sent: report.sent, failed: report.failed,
        waiting: report.waiting, surveys: report.surveys, surveysExpired: report.surveysExpired,
        manifests: report.manifests,
      },
    });

    return ok({
      ...report,
      reminders: reminded.enqueued,
      channels: available,
      notConfigured: [...notConfigured],
      ranAt: now,
    });
  } catch (err) {
    console.error("[cron/dispatch-messages] error:", err);
    await finishJobRun(runId, { status: "failed", error: String(err) });
    await reportIncident({ source: "cron:dispatch-messages", error: err });
    return fail(err);
  }
}
