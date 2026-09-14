import "server-only";
import { tenantCreate, tenantQuery, tenantUpdate } from "@/lib/tenant";
import type { Company } from "@/lib/types";
import {
  renderMessage, recipientFor, scheduledAt, isStale,
  type MessageChannel, type TemplateKey, type TemplateVars, type ContactInput,
} from "@/lib/messaging/render";
import { defaultTemplate } from "@/lib/messaging/templates";
import { deliver, type DeliveryResult } from "@/lib/messaging/providers";

/**
 * La bandeja de salida: el único camino por el que un mensaje llega al cliente.
 *
 * Nada manda directamente. Encolar y entregar son dos pasos separados porque:
 *
 *  · El envío no puede colgar la venta. Si el proveedor tarda cuatro segundos,
 *    el cajero espera cuatro segundos con el cliente delante; peor aún, si falla,
 *    la reserva entera se caería por no haber podido mandar un correo.
 *  · Lo programado necesita una cola de todos modos: el recordatorio de la
 *    víspera no se puede "mandar ahora".
 *  · Y sin registro no hay forma de responder a "¿se le avisó?", que es la
 *    primera pregunta cuando un cliente no aparece en el lobby.
 */

const MAX_ATTEMPTS = 5;

export interface MessageRow {
  _id: string;
  channel: MessageChannel;
  template_key?: string | null;
  language?: string | null;
  status?: string | null;
  to_address?: string | null;
  to_name?: string | null;
  subject?: string | null;
  body?: string | null;
  scheduled_at?: string | null;
  attempts?: number | null;
  last_error?: string | null;
  dedupe_key?: string | null;
}

export interface EnqueueInput {
  key: TemplateKey;
  channel: MessageChannel;
  language?: string | null;
  /** Por dónde se le escribe al cliente. */
  contact: ContactInput;
  toName?: string | null;
  vars: TemplateVars;
  /** Sobre qué trata, para poder abrirlo desde la reserva o la cotización. */
  refs?: {
    customer?: string | null; booking?: string | null; order?: string | null;
    quote?: string | null; departure?: string | null; payment?: string | null;
  };
  /**
   * Identidad del aviso. Con ella, encolar dos veces lo mismo no escribe dos
   * veces al cliente — que es la forma más rápida de acabar en spam.
   */
  dedupeKey?: string | null;
  /** Fecha a la que se ancla un mensaje programado (la salida, el viaje). */
  anchor?: string | Date | null;
  userId?: string | null;
}

export type EnqueueResult =
  | { status: "queued"; id: string }
  | { status: "duplicate"; id: string | null }
  | { status: "undeliverable"; id: string; reason: string }
  | { status: "skipped"; reason: string };

/**
 * Compone y encola un mensaje.
 *
 * Un mensaje que no se puede componer o entregar NO se descarta en silencio: se
 * guarda como fallido con el motivo escrito. Un correo que nunca salió porque el
 * cliente no tenía dirección es justo el dato que la empresa necesita ver.
 */
export async function enqueueMessage(
  company: Company | null,
  companyId: string,
  input: EnqueueInput,
  store: OutboxStore = tenantOutboxStore
): Promise<EnqueueResult> {
  const language = input.language || "es";
  const template = await resolveTemplate(store, companyId, input.key, input.channel, language);
  if (!template) return { status: "skipped", reason: `Sin plantilla para ${input.key}/${input.channel}` };
  if (template.status === "inactive") {
    return { status: "skipped", reason: "La plantilla está desactivada" };
  }

  // Un recordatorio de un tour que ya salió no avisa de nada: molesta.
  if (isStale(input.anchor, template.offset_hours, new Date())) {
    return { status: "skipped", reason: "El momento del aviso ya pasó" };
  }

  const vars: TemplateVars = { empresa: company?.name, telefono_empresa: company?.whatsapp || company?.phone, ...input.vars };
  const rendered = renderMessage(template, vars);
  const to = recipientFor(input.channel, input.contact);

  const base = {
    channel: input.channel,
    template_key: input.key,
    language,
    to_name: input.toName || undefined,
    subject: template.subject ? rendered.subject : undefined,
    body: rendered.body,
    scheduled_at: scheduledAt(input.anchor, template.offset_hours).toISOString(),
    dedupe_key: input.dedupeKey || undefined,
    customer: input.refs?.customer || undefined,
    booking: input.refs?.booking || undefined,
    order: input.refs?.order || undefined,
    quote: input.refs?.quote || undefined,
    departure: input.refs?.departure || undefined,
    payment: input.refs?.payment || undefined,
    created_by: input.userId || undefined,
  };

  // Sin destinatario o con huecos sin rellenar el mensaje se guarda fallido: es
  // visible en la bandeja, se corrige el dato y se reintenta.
  const problem = !to
    ? `El cliente no tiene ${input.channel === "email" ? "correo" : "teléfono"} válido`
    : rendered.missing.length > 0
      ? `Faltan datos en la plantilla: ${rendered.missing.join(", ")}`
      : null;

  try {
    const row = await store.create(companyId, {
      ...base,
      to_address: to || "—",
      status: problem ? "failed" : "queued",
      last_error: problem || undefined,
      attempts: 0,
    });
    if (problem) {
      console.warn(`[mensajería] ${input.key} no se puede entregar: ${problem}`);
      return { status: "undeliverable", id: row._id, reason: problem };
    }
    return { status: "queued", id: row._id };
  } catch (err) {
    // El índice único de `dedupe_key` es lo que sostiene "se avisa una vez"
    // incluso si dos pasadas del cron se solapan.
    if (isDuplicate(err)) {
      const existing = input.dedupeKey ? await store.findByDedupe(companyId, input.dedupeKey) : null;
      return { status: "duplicate", id: existing?._id ?? null };
    }
    throw err;
  }
}

function isDuplicate(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "23505" || /duplicate key|already exists|message_dedupe_idx/i.test(e?.message || "");
}

/** Plantilla del inquilino si la reescribió; si no, la que trae el sistema. */
async function resolveTemplate(
  store: OutboxStore,
  companyId: string,
  key: TemplateKey,
  channel: MessageChannel,
  language: string
): Promise<{ subject?: string | null; body: string; offset_hours?: number | null; status?: string } | null> {
  const rows = await store.templates(companyId, key, channel);
  const own = rows.find((r) => r.language === language) ?? rows.find((r) => r.language === "es");
  if (own?.body) {
    return { subject: own.subject, body: own.body, offset_hours: own.offset_hours, status: own.status };
  }
  const fallback = defaultTemplate(key, channel, language);
  return fallback ? { ...fallback, status: "active" } : null;
}

/**
 * De dónde lee y dónde escribe el despachador.
 *
 * Existe por una razón concreta: con `SUPABASE_USE_RLS=true` las ayudas de
 * inquilino resuelven el cliente a partir de las cookies de la petición, y un
 * trabajo programado no tiene sesión. Un despachador escrito contra ellas no
 * fallaría — leería CERO mensajes y diría que todo está al día, que es peor.
 * La ruta HTTP inyecta el almacén con ámbito de sesión; el cron, uno de
 * servicio, igual que hace la caducidad de aprobaciones.
 */
export interface TemplateRow {
  subject?: string | null;
  body?: string | null;
  offset_hours?: number | null;
  status?: string | null;
  language?: string | null;
}

export interface OutboxStore {
  pending(companyId: string, nowIso: string, limit: number): Promise<MessageRow[]>;
  update(companyId: string, id: string, patch: Record<string, unknown>): Promise<void>;
  create(companyId: string, data: Record<string, unknown>): Promise<{ _id: string }>;
  templates(companyId: string, key: string, channel: string): Promise<TemplateRow[]>;
  findByDedupe(companyId: string, dedupeKey: string): Promise<{ _id: string } | null>;
}

/** El almacén normal: la sesión del usuario que pidió el envío. */
export const tenantOutboxStore: OutboxStore = {
  pending: (companyId, nowIso, limit) =>
    tenantQuery<MessageRow>(companyId, "message", {
      _filter: { status: "queued", scheduled_at: { lte: nowIso } },
      _sort: { scheduled_at: "asc" },
      _limit: limit,
    }),
  update: async (companyId, id, patch) => {
    await tenantUpdate(companyId, "message", id, patch);
  },
  create: (companyId, data) => tenantCreate<{ _id: string }>(companyId, "message", data),
  templates: (companyId, key, channel) =>
    tenantQuery<TemplateRow>(companyId, "message_template", {
      _filter: { key, channel, status: "active" }, _limit: 10,
    }),
  findByDedupe: async (companyId, dedupeKey) => {
    const [row] = await tenantQuery<{ _id: string }>(companyId, "message", {
      _filter: { dedupe_key: dedupeKey }, _limit: 1,
    });
    return row ?? null;
  },
};

export interface DispatchReport {
  picked: number;
  sent: number;
  failed: number;
  waiting: number;
  notConfigured: string[];
}

/**
 * Entrega lo que toca mandar ahora.
 *
 * Un mensaje sin proveedor configurado NO gasta intentos: se queda en cola con
 * el motivo escrito. Si cada pasada del cron consumiera un intento, una semana
 * sin credenciales quemaría la cola entera y los avisos se perderían sin que
 * nadie hubiera decidido perderlos.
 */
export async function dispatchQueue(
  company: Company | null,
  companyId: string,
  limit = 50,
  store: OutboxStore = tenantOutboxStore
): Promise<DispatchReport> {
  const now = new Date().toISOString();
  const pending = await store.pending(companyId, now, Math.min(limit, 200));

  const report: DispatchReport = { picked: pending.length, sent: 0, failed: 0, waiting: 0, notConfigured: [] };

  for (const row of pending) {
    const result: DeliveryResult = await deliver({
      channel: row.channel,
      to: row.to_address || "",
      toName: row.to_name,
      subject: row.subject,
      body: row.body || "",
      fromName: company?.name,
      replyTo: company?.email,
    });

    if (result.status === "not_configured") {
      // No gasta intento: el mensaje espera a que haya credenciales.
      if (!report.notConfigured.includes(row.channel)) report.notConfigured.push(row.channel);
      await store.update(companyId, row._id, { last_error: result.error });
      report.waiting++;
      continue;
    }

    const attempts = (Number(row.attempts) || 0) + 1;

    if (result.status === "sent") {
      await store.update(companyId, row._id, {
        status: "sent", sent_at: new Date().toISOString(), attempts,
        provider: result.provider, provider_message_id: result.providerMessageId || undefined,
        last_error: null,
      });
      report.sent++;
      continue;
    }

    // Un dato mal puesto no mejora reintentándolo; una caída del proveedor sí.
    const exhausted = !result.retryable || attempts >= MAX_ATTEMPTS;
    await store.update(companyId, row._id, {
      status: exhausted ? "failed" : "queued",
      attempts,
      provider: result.provider,
      last_error: result.error,
    });
    if (exhausted) report.failed++;
    else report.waiting++;
  }

  if (report.picked > 0) {
    console.log(`[mensajería] cola: ${report.sent} enviados · ${report.failed} fallidos · ${report.waiting} en espera`);
  }
  return report;
}
