import { NextRequest } from "next/server";
import { supabaseService } from "@/lib/supabase/service";
import { aliasesFor } from "@/lib/supabase/query-translator";
import { ok, fail } from "@/lib/api-response";
import { TenantError } from "@/lib/tenant";
import { dispatchQueue, type OutboxStore, type MessageRow } from "@/lib/messaging/outbox";
import { enqueuePreTourReminder } from "@/lib/messaging/events";
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
 * Corre cada 15 minutos. No es un trabajo de un inquilino —recorre todos—, así
 * que se autentica con el secreto del cron y no con una sesión.
 *
 * Sin proveedor configurado no hace nada destructivo: informa de qué canales
 * están sin credenciales y deja la cola intacta.
 */
export const dynamic = "force-dynamic";

/**
 * El almacén de la cola para un trabajo SIN sesión.
 *
 * Con `SUPABASE_USE_RLS=true`, las ayudas de inquilino resuelven el cliente a
 * partir de las cookies de la petición. Un cron no las tiene, así que leería
 * cero mensajes y diría que la cola está vacía —el peor fallo posible aquí: en
 * vez de romperse, mentiría—. El ámbito lo pone esta consulta, que filtra por
 * `organization_id` explícitamente en cada operación.
 */
function serviceStore(): OutboxStore {
  return {
    async pending(companyId, nowIso, limit) {
      const { data, error } = await supabaseService()
        .from("message")
        .select("*")
        .eq("organization_id", companyId)
        .eq("status", "queued")
        .lte("scheduled_at", nowIso)
        .order("scheduled_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({ ...row, _id: row.id as string })) as MessageRow[];
    },
    async update(companyId, id, patch) {
      const { error } = await supabaseService()
        .from("message")
        .update(patch)
        .eq("organization_id", companyId)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    async create(companyId, data) {
      // Los payloads del módulo usan los nombres cortos del proyecto
      // (`customer`, `booking`, `order`), que las ayudas de inquilino traducen a
      // `customer_id`, `booking_id`… Aquí se inserta en crudo, así que hay que
      // aplicar el MISMO mapa: sin esto el barrido fallaba con "la columna
      // customer no existe" y ningún recordatorio se encolaba.
      const aliases = aliasesFor("message");
      const row: Record<string, unknown> = { organization_id: companyId };
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        row[aliases[key] ?? key] = value;
      }
      const { data: created, error } = await supabaseService()
        .from("message")
        .insert(row)
        .select("id")
        .single();
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return { _id: created.id as string };
    },
    async templates(companyId, key, channel) {
      const { data, error } = await supabaseService()
        .from("message_template")
        .select("subject, body, offset_hours, status, language")
        .eq("organization_id", companyId)
        .eq("key", key)
        .eq("channel", channel)
        .eq("status", "active")
        .limit(10);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async findByDedupe(companyId, dedupeKey) {
      const { data } = await supabaseService()
        .from("message")
        .select("id")
        .eq("organization_id", companyId)
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      return data ? { _id: data.id as string } : null;
    },
  };
}

/**
 * Encola el recordatorio de la víspera de lo que sale en las próximas 48 horas.
 *
 * La ventana es de 48 y no de 24 a propósito: el aviso se programa para 24 h
 * antes, y barrer solo las 24 siguientes dejaría fuera justo las salidas que
 * todavía no han llegado a su hora de aviso.
 */
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

async function sweepReminders(): Promise<{ enqueued: number; companies: string[] }> {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 48 * 3_600_000).toISOString();

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
    .limit(1000);

  if (error) {
    console.error("[cron/dispatch-messages] barrido de recordatorios falló:", error.message);
    return { enqueued: 0, companies: [] };
  }

  const companies = new Set<string>();
  let enqueued = 0;
  for (const row of (data ?? []) as unknown as SweepRow[]) {
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
  return { enqueued, companies: [...companies] };
}

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new TenantError("CRON_SECRET no está configurado en el entorno", 503);
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      console.warn("[cron/dispatch-messages] intento de ejecución sin credencial válida");
      throw new TenantError("No autorizado", 401);
    }

    const available = configuredChannels();
    const now = new Date().toISOString();

    // Solo las empresas con algo que mandar: recorrerlas todas sería una
    // consulta por inquilino cada cuarto de hora para nada.
    const { data: pending, error } = await supabaseService()
      .from("message")
      .select("organization_id")
      .eq("status", "queued")
      .lte("scheduled_at", now)
      .limit(2000);
    if (error) throw new Error(error.message);

    // Antes de despachar, el barrido de recordatorios: las reservas que salen
    // en las próximas 48 h y todavía no tienen aviso encolado. Cubre la cartera
    // que ya existía antes de que hubiera comunicaciones y las reservas que
    // entraron mientras no había proveedor. La clave de dedupe hace que barrer
    // cien veces deje un solo aviso.
    const reminded = await sweepReminders();

    const companyIds = [...new Set([
      ...(pending ?? []).map((r) => r.organization_id as string),
      ...reminded.companies,
    ])];
    const report = { companies: companyIds.length, sent: 0, failed: 0, waiting: 0 };
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
      `${report.failed} fallidos · ${report.waiting} en espera`
    );

    return ok({
      ...report,
      reminders: reminded.enqueued,
      channels: available,
      notConfigured: [...notConfigured],
      ranAt: now,
    });
  } catch (err) {
    console.error("[cron/dispatch-messages] error:", err);
    return fail(err);
  }
}
