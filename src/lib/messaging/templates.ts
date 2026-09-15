import type { MessageChannel, TemplateKey } from "@/lib/messaging/render";

/**
 * Las plantillas con las que el sistema comunica desde el primer día.
 *
 * Un módulo de comunicaciones que exige escribir siete plantillas antes de
 * mandar el primer correo no se usa: la empresa lo deja "para después" y sigue
 * avisando por WhatsApp personal. Estas son el punto de partida, y cada empresa
 * reescribe las que quiera en `message_template` sin tocar código.
 *
 * El texto está escrito para el sector: lo que un cliente de una excursión
 * necesita saber la noche antes es la hora y el sitio de recogida, no un
 * "gracias por su compra". Los de WhatsApp son deliberadamente más cortos —se
 * leen en la pantalla de bloqueo— y no llevan asunto.
 */

export interface DefaultTemplate {
  key: TemplateKey;
  channel: MessageChannel;
  language: string;
  subject?: string;
  body: string;
  /** Horas respecto al hecho: negativo = antes. */
  offset_hours?: number;
  /** Qué dispara el mensaje, para la pantalla de plantillas. */
  trigger: string;
}

/** Variables que cada plantilla puede usar, para la ayuda del editor. */
export const TEMPLATE_VARIABLES: Record<TemplateKey, string[]> = {
  booking_confirmation: [
    "cliente", "empresa", "reserva", "producto", "fecha", "hora", "pax",
    "total", "saldo", "moneda", "voucher", "punto_encuentro", "telefono_empresa",
  ],
  booking_cancelled: ["cliente", "empresa", "reserva", "producto", "fecha", "motivo", "telefono_empresa"],
  pre_tour_reminder: [
    "cliente", "empresa", "producto", "fecha", "hora_recogida", "lugar_recogida",
    "punto_encuentro", "pax", "saldo", "moneda", "telefono_empresa",
  ],
  payment_receipt: ["cliente", "empresa", "reserva", "importe", "moneda", "metodo", "fecha", "saldo"],
  balance_due: ["cliente", "empresa", "reserva", "producto", "fecha", "saldo", "moneda", "vence", "telefono_empresa"],
  quote_sent: ["cliente", "empresa", "cotizacion", "titulo", "total", "moneda", "vigencia", "anticipo", "vendedor"],
  post_tour_thanks: ["cliente", "empresa", "producto", "fecha", "telefono_empresa"],
};

/** Qué hecho dispara cada plantilla, en una línea. */
export const TEMPLATE_TRIGGER: Record<TemplateKey, string> = {
  booking_confirmation: "Al crear la reserva",
  booking_cancelled: "Al cancelar la reserva",
  pre_tour_reminder: "24 horas antes de la salida",
  payment_receipt: "Al registrar un cobro",
  balance_due: "Cuando la reserva llega con saldo pendiente",
  quote_sent: "Al enviar la cotización",
  post_tour_thanks: "4 horas después de terminar",
};

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "booking_confirmation", channel: "email", language: "es",
    trigger: TEMPLATE_TRIGGER.booking_confirmation,
    subject: "Reserva confirmada · {{producto}} · {{fecha}}",
    body: `Hola {{cliente}},

Tu reserva con {{empresa}} está confirmada.

Reserva: {{reserva}}
Excursión: {{producto}}
Fecha: {{fecha}} a las {{hora}}
Pasajeros: {{pax}}
Total: {{total}} {{moneda}}
Voucher: {{voucher}}

Presenta este voucher el día de la excursión. Te escribiremos de nuevo la
víspera con la hora exacta de recogida.

Cualquier duda, escríbenos a {{telefono_empresa}}.

{{empresa}}`,
  },
  {
    key: "booking_confirmation", channel: "whatsapp", language: "es",
    trigger: TEMPLATE_TRIGGER.booking_confirmation,
    body: `Hola {{cliente}}, tu reserva con {{empresa}} está confirmada ✅
{{producto}} · {{fecha}} {{hora}} · {{pax}} pax
Voucher: {{voucher}}
Te avisamos la víspera con la hora de recogida.`,
  },
  {
    key: "pre_tour_reminder", channel: "email", language: "es",
    trigger: TEMPLATE_TRIGGER.pre_tour_reminder, offset_hours: -24,
    subject: "Mañana: {{producto}} · recogida {{hora_recogida}}",
    body: `Hola {{cliente}},

Mañana es tu excursión con {{empresa}}.

Excursión: {{producto}}
Recogida: {{hora_recogida}} en {{lugar_recogida}}
Pasajeros: {{pax}}

Te pedimos estar en el punto de recogida 10 minutos antes. El vehículo no
puede esperar más de 5 minutos para no retrasar al resto del grupo.

Lleva protector solar, agua y tu documento de identidad.

{{empresa}} · {{telefono_empresa}}`,
  },
  {
    key: "pre_tour_reminder", channel: "whatsapp", language: "es",
    trigger: TEMPLATE_TRIGGER.pre_tour_reminder, offset_hours: -24,
    body: `Hola {{cliente}} 👋 Mañana es tu excursión con {{empresa}}.
{{producto}}
🚐 Recogida: {{hora_recogida}} en {{lugar_recogida}}
Por favor, estar 10 min antes. ¡Nos vemos!`,
  },
  {
    key: "balance_due", channel: "email", language: "es",
    trigger: TEMPLATE_TRIGGER.balance_due,
    subject: "Saldo pendiente de tu reserva {{reserva}}",
    body: `Hola {{cliente}},

Tu reserva {{reserva}} para {{producto}} del {{fecha}} tiene un saldo
pendiente de {{saldo}} {{moneda}}.

Puedes liquidarlo antes de la excursión o el mismo día al guía. Si prefieres
pagarlo por adelantado, escríbenos a {{telefono_empresa}}.

{{empresa}}`,
  },
  {
    key: "payment_receipt", channel: "email", language: "es",
    trigger: TEMPLATE_TRIGGER.payment_receipt,
    subject: "Recibo de pago · {{reserva}}",
    body: `Hola {{cliente}},

Hemos registrado tu pago.

Reserva: {{reserva}}
Importe: {{importe}} {{moneda}}
Método: {{metodo}}
Fecha: {{fecha}}
Saldo pendiente: {{saldo}} {{moneda}}

Gracias,
{{empresa}}`,
  },
  {
    key: "booking_cancelled", channel: "email", language: "es",
    trigger: TEMPLATE_TRIGGER.booking_cancelled,
    subject: "Reserva {{reserva}} cancelada",
    body: `Hola {{cliente}},

Tu reserva {{reserva}} para {{producto}} del {{fecha}} ha quedado cancelada.

Motivo: {{motivo}}

Si el cargo procede de un reembolso, verás el abono en los próximos días
según tu medio de pago. Cualquier duda, escríbenos a {{telefono_empresa}}.

{{empresa}}`,
  },
  {
    key: "quote_sent", channel: "email", language: "es",
    trigger: TEMPLATE_TRIGGER.quote_sent,
    subject: "Tu propuesta: {{titulo}}",
    body: `Hola {{cliente}},

Te enviamos la propuesta que preparamos para ti.

Propuesta: {{cotizacion}} — {{titulo}}
Total: {{total}} {{moneda}}
Válida hasta: {{vigencia}}
Anticipo para reservar: {{anticipo}} {{moneda}}

Quedo atento a tus comentarios para ajustar lo que haga falta.

{{vendedor}}
{{empresa}}`,
  },
  {
    key: "quote_sent", channel: "whatsapp", language: "es",
    trigger: TEMPLATE_TRIGGER.quote_sent,
    body: `Hola {{cliente}}, te envío la propuesta {{cotizacion}} — {{titulo}}.
Total: {{total}} {{moneda}} · válida hasta {{vigencia}}.
Cualquier ajuste, me dices. {{vendedor}} · {{empresa}}`,
  },
  {
    key: "post_tour_thanks", channel: "email", language: "es",
    trigger: TEMPLATE_TRIGGER.post_tour_thanks, offset_hours: 4,
    subject: "¿Cómo te fue en {{producto}}?",
    body: `Hola {{cliente}},

Gracias por venir con {{empresa}} a {{producto}} el {{fecha}}.

Si tienes un minuto, cuéntanos cómo te fue: nos ayuda a mejorar y a que otros
viajeros se animen. Y si algo no salió como esperabas, contéstanos a este
mismo correo — preferimos saberlo nosotros primero.

{{empresa}} · {{telefono_empresa}}`,
  },
];

/** La plantilla por defecto para una clave, canal e idioma. */
export function defaultTemplate(
  key: TemplateKey,
  channel: MessageChannel,
  language = "es"
): DefaultTemplate | null {
  return (
    DEFAULT_TEMPLATES.find((t) => t.key === key && t.channel === channel && t.language === language) ??
    // Sin versión en ese idioma se usa la española antes que no mandar nada: un
    // aviso en otro idioma sigue diciendo la hora de recogida.
    DEFAULT_TEMPLATES.find((t) => t.key === key && t.channel === channel && t.language === "es") ??
    null
  );
}
