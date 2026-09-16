/**
 * Composición de un mensaje a partir de su plantilla.
 *
 * Todo lo que sale hacia un cliente pasa por aquí, y por eso son funciones
 * puras: el mismo texto tiene que verse igual en la vista previa que en el
 * correo que recibe, y una prueba tiene que poder afirmarlo sin proveedor.
 *
 * La regla que sostiene el módulo: un hueco sin rellenar NO se manda. Un correo
 * que dice "Hola {{cliente}}, tu tour sale a las {{hora}}" es peor que no
 * mandar nada — la empresa queda como si no supiera usar su propio sistema—, así
 * que `missingVariables` lo detecta antes y quien encola decide.
 */

export type MessageChannel = "email" | "whatsapp" | "sms";

export type TemplateKey =
  | "booking_confirmation"
  | "booking_cancelled"
  | "booking_rescheduled"
  | "pre_tour_reminder"
  | "payment_receipt"
  | "balance_due"
  | "quote_sent"
  | "post_tour_thanks";

export type TemplateVars = Record<string, string | number | null | undefined>;

/** `{{ variable }}` con espacios opcionales. */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Todas las variables que menciona un texto, sin repetir. */
export function variablesIn(template: string): string[] {
  return [...new Set([...(template || "").matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

const isBlank = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Variables que la plantilla pide y nadie ha rellenado.
 *
 * Una cadena vacía cuenta como ausente: "tu guía es " no es mejor que
 * "tu guía es {{guia}}".
 */
export function missingVariables(template: string, vars: TemplateVars): string[] {
  return variablesIn(template).filter((name) => isBlank(vars[name]));
}

/**
 * Sustituye las variables. Lo que no se conoce se deja tal cual, para que el
 * hueco sea visible en la vista previa en vez de desaparecer en silencio.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return (template || "").replace(PLACEHOLDER, (whole, name: string) => {
    const value = vars[name];
    return isBlank(value) ? whole : String(value);
  });
}

export interface RenderedMessage {
  subject: string;
  body: string;
  missing: string[];
}

/** Asunto y cuerpo compuestos, más lo que faltó por rellenar. */
export function renderMessage(
  template: { subject?: string | null; body: string },
  vars: TemplateVars
): RenderedMessage {
  const subject = template.subject || "";
  return {
    subject: renderTemplate(subject, vars),
    body: renderTemplate(template.body, vars),
    missing: [...new Set([...missingVariables(subject, vars), ...missingVariables(template.body, vars)])],
  };
}

/* ------------------------------------------------------------- destinatario */

/**
 * Teléfono en formato E.164, que es el único que aceptan WhatsApp y los SMS.
 *
 * Los teléfonos se teclean como se dicen: "809-555-0101", "(809) 555 0101",
 * "1 809 555 0101". Mandarlos así devuelve un error del proveedor por cada
 * mensaje, y el cliente no recibe nada.
 *
 * `defaultCountry` es el prefijo que se asume cuando el número viene sin él —
 * en República Dominicana, +1 sobre un número de 10 dígitos.
 */
export function normalizePhone(raw: unknown, defaultCountry = "1"): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;

  const hadPlus = text.startsWith("+");
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7) return null;          // no es un número, es un apunte
  if (digits.length > 15) return null;         // E.164 no admite más de 15

  if (hadPlus) return `+${digits}`;
  // Un número local de 10 dígitos lleva el prefijo del país por delante; uno que
  // ya empieza por el prefijo se deja como está.
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.startsWith(defaultCountry) && digits.length === defaultCountry.length + 10) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

/** Correo con una forma mínima creíble. No valida el buzón: eso lo dice el envío. */
export function normalizeEmail(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!text) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text) ? text : null;
}

export interface ContactInput {
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
}

/**
 * A qué dirección va el mensaje según su canal.
 *
 * Para WhatsApp manda el número declarado como WhatsApp; si no lo hay, el
 * teléfono, que en la práctica es el mismo aparato. Devolver null es la
 * respuesta correcta cuando no hay por dónde escribir: encolar un mensaje sin
 * destinatario solo produce un fallo del proveedor más tarde.
 */
export function recipientFor(
  channel: MessageChannel,
  contact: ContactInput,
  defaultCountry = "1"
): string | null {
  if (channel === "email") return normalizeEmail(contact.email);
  const preferred = channel === "whatsapp" ? contact.whatsapp || contact.phone : contact.phone || contact.whatsapp;
  return normalizePhone(preferred, defaultCountry);
}

/* ------------------------------------------------------------- programación */

/**
 * Cuándo sale un mensaje atado a una fecha.
 *
 * El recordatorio pre-tour es `offset_hours = -24`: 24 horas ANTES de la salida.
 * Si esa hora ya pasó —la reserva entró esta misma mañana para el tour de
 * mañana— se manda ya, porque el aviso sigue siendo útil; programarlo en el
 * pasado lo dejaría en la cola para siempre.
 */
export function scheduledAt(anchor: string | Date | null | undefined, offsetHours?: number | null, now: Date = new Date()): Date {
  if (!anchor || offsetHours === null || offsetHours === undefined) return now;
  const base = new Date(anchor).getTime();
  if (!Number.isFinite(base)) return now;
  const when = new Date(base + offsetHours * 3_600_000);
  return when.getTime() < now.getTime() ? now : when;
}

/**
 * ¿Sigue teniendo sentido mandarlo?
 *
 * Un recordatorio de un tour que ya salió no avisa de nada: molesta. La cola
 * puede acumular retraso (el proveedor caído, el cron parado), así que cada
 * mensaje atado a una fecha caduca.
 */
export function isStale(anchor: string | Date | null | undefined, offsetHours: number | null | undefined, now: Date = new Date()): boolean {
  if (!anchor) return false;
  const base = new Date(anchor).getTime();
  if (!Number.isFinite(base)) return false;
  // Un aviso previo caduca cuando llega el hecho; uno posterior, un día después.
  const deadline = (offsetHours ?? 0) < 0 ? base : base + 24 * 3_600_000;
  return now.getTime() > deadline;
}
