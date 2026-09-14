import "server-only";
import type { MessageChannel } from "@/lib/messaging/render";

/**
 * Los proveedores por los que sale un mensaje.
 *
 * Se hablan por `fetch` contra su API HTTP a propósito: añadir un SDK por canal
 * mete tres dependencias y un runtime de Node en una aplicación que corre en el
 * borde. Aquí no hace falta nada de eso — son dos peticiones POST.
 *
 * Las credenciales viven en variables de entorno de la plataforma, NUNCA en una
 * fila por inquilino: la pantalla de integraciones lee esas filas y las manda al
 * navegador, así que una `config jsonb` con la clave de la API la publicaría.
 *
 * Cuando no hay proveedor configurado, `deliver` no falla ni descarta: devuelve
 * `not_configured` y el mensaje se queda en la cola con el motivo escrito. En
 * cuanto haya credenciales, la cola sale sola.
 */

export interface OutgoingMessage {
  channel: MessageChannel;
  to: string;
  toName?: string | null;
  subject?: string | null;
  body: string;
  fromName?: string | null;
  replyTo?: string | null;
}

/**
 * Tres resultados, no dos.
 *
 * "No se pudo entregar" y "no hay por dónde entregarlo todavía" se tratan
 * distinto: el primero gasta un intento, el segundo no. Un discriminante de
 * texto además narra el tipo de forma fiable en este proyecto, que compila con
 * `strict: false` y ahí un `ok: boolean` no acota la unión.
 */
export type DeliveryResult =
  | { status: "sent"; provider: string; providerMessageId?: string | null }
  | { status: "error"; provider: string; error: string; retryable: boolean }
  | { status: "not_configured"; provider: "none"; error: string };

const env = (name: string): string => (process.env[name] || "").trim();

/** Qué canales pueden salir ahora mismo, para avisarlo en la pantalla. */
export function configuredChannels(): Record<MessageChannel, boolean> {
  return {
    email: Boolean(env("RESEND_API_KEY") && env("MESSAGING_FROM_EMAIL")),
    whatsapp: Boolean(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")),
    sms: false,
  };
}

const NOT_CONFIGURED: Record<MessageChannel, string> = {
  email: "Sin proveedor de correo: falta RESEND_API_KEY o MESSAGING_FROM_EMAIL en el entorno",
  whatsapp: "Sin proveedor de WhatsApp: falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en el entorno",
  sms: "El canal SMS todavía no tiene proveedor conectado",
};

/** Un 5xx o un corte de red se reintenta; un 4xx es un dato mal puesto. */
const retryableStatus = (status: number) => status >= 500 || status === 429 || status === 408;

async function sendEmail(message: OutgoingMessage): Promise<DeliveryResult> {
  const from = env("MESSAGING_FROM_EMAIL");
  const name = message.fromName || env("MESSAGING_FROM_NAME") || from;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${name} <${from}>`,
        to: [message.to],
        subject: message.subject || "(sin asunto)",
        // El cuerpo se compone en texto plano: es lo que se ve igual en todos
        // los clientes de correo y lo que se puede leer desde el móvil del guía.
        text: message.body,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      return {
        status: "error", provider: "resend",
        error: payload.message || payload.name || `HTTP ${res.status}`,
        retryable: retryableStatus(res.status),
      };
    }
    return { status: "sent", provider: "resend", providerMessageId: payload.id ?? null };
  } catch (err) {
    // Una caída de red no es culpa del mensaje: se reintenta.
    return { status: "error", provider: "resend", error: (err as Error).message, retryable: true };
  }
}

async function sendWhatsApp(message: OutgoingMessage): Promise<DeliveryResult> {
  const phoneId = env("WHATSAPP_PHONE_NUMBER_ID");
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        // El número ya viene en E.164 desde `normalizePhone`; la API lo quiere
        // sin el '+'.
        to: message.to.replace(/^\+/, ""),
        type: "text",
        text: { preview_url: false, body: message.body },
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[]; error?: { message?: string };
    };
    if (!res.ok) {
      return {
        status: "error", provider: "whatsapp",
        error: payload.error?.message || `HTTP ${res.status}`,
        retryable: retryableStatus(res.status),
      };
    }
    return { status: "sent", provider: "whatsapp", providerMessageId: payload.messages?.[0]?.id ?? null };
  } catch (err) {
    return { status: "error", provider: "whatsapp", error: (err as Error).message, retryable: true };
  }
}

/** Entrega un mensaje por su canal. */
export async function deliver(message: OutgoingMessage): Promise<DeliveryResult> {
  const available = configuredChannels();
  if (!available[message.channel]) {
    return { status: "not_configured", provider: "none", error: NOT_CONFIGURED[message.channel] };
  }
  if (message.channel === "email") return sendEmail(message);
  if (message.channel === "whatsapp") return sendWhatsApp(message);
  return { status: "not_configured", provider: "none", error: NOT_CONFIGURED.sms };
}
