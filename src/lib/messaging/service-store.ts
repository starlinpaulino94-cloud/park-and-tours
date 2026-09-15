import "server-only";
import { supabaseService } from "@/lib/supabase/service";
import { aliasesFor } from "@/lib/supabase/query-translator";
import type { OutboxStore, MessageRow } from "@/lib/messaging/outbox";

/**
 * El almacén de la cola para un trabajo SIN sesión.
 *
 * Con `SUPABASE_USE_RLS=true`, las ayudas de inquilino resuelven el cliente a
 * partir de las cookies de la petición. Un cron no las tiene, así que leería
 * cero mensajes y diría que la cola está vacía —el peor fallo posible aquí: en
 * vez de romperse, mentiría—. El ámbito lo pone esta consulta, que filtra por
 * `organization_id` explícitamente en cada operación.
 */
export function serviceStore(): OutboxStore {
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
