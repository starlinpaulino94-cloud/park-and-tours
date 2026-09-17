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
  booking_rescheduled: [
    "cliente", "empresa", "reserva", "producto", "fecha_anterior", "fecha", "hora",
    "motivo", "punto_encuentro", "telefono_empresa",
  ],
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
  booking_rescheduled: "Al mover la reserva de fecha",
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
    key: "booking_rescheduled", channel: "email", language: "es",
    trigger: TEMPLATE_TRIGGER.booking_rescheduled,
    subject: "Nueva fecha para {{producto}}: {{fecha}}",
    body: `Hola {{cliente}},

Tu excursión cambió de fecha. Tu reserva sigue siendo la misma y el voucher que
ya tienes sirve igual: solo cambia el día.

Reserva: {{reserva}}
Excursión: {{producto}}
Fecha anterior: {{fecha_anterior}}
NUEVA FECHA: {{fecha}} a las {{hora}}
Punto de encuentro: {{punto_encuentro}}

Motivo del cambio: {{motivo}}

Si esta fecha no te sirve, escríbenos a {{telefono_empresa}} y lo resolvemos.

{{empresa}}`,
  },
  {
    key: "booking_rescheduled", channel: "whatsapp", language: "es",
    trigger: TEMPLATE_TRIGGER.booking_rescheduled,
    body: `Hola {{cliente}}: tu excursión {{producto}} se movió del {{fecha_anterior}} al {{fecha}} a las {{hora}}.
Motivo: {{motivo}}. Tu voucher {{reserva}} sigue valiendo.
Si esa fecha no te sirve, escríbenos. {{empresa}}`,
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

  /* ══════════════════════════════════════════════════════════ inglés ══
   *
   * EL HUÉSPED QUE NO HABLA ESPAÑOL.
   *
   * El mecanismo de idiomas existía desde la ola 3 y NO HABÍA una sola
   * plantilla que no fuera española: `resolveTemplate` buscaba el inglés, no lo
   * encontraba y caía al español, así que el turista canadiense que reservaba en
   * inglés en la página pública recibía la confirmación, el recordatorio de la
   * víspera y el recibo en un idioma que no lee.
   *
   * Y el recordatorio de la víspera es el mensaje que MÁS importa que se
   * entienda: lleva la hora y el lugar de recogida. Un huésped que no lo
   * entiende no es un huésped molesto, es un asiento vacío y una reclamación.
   *
   * No es una traducción literal. «Te pedimos estar 10 minutos antes» no se
   * dice igual en inglés, y un texto que suena a traducción automática hace
   * dudar de la operadora entera.
   */
  {
    key: "booking_confirmation", channel: "email", language: "en",
    trigger: TEMPLATE_TRIGGER.booking_confirmation,
    subject: "Booking confirmed · {{producto}} · {{fecha}}",
    body: `Hi {{cliente}},

Your booking with {{empresa}} is confirmed.

Booking: {{reserva}}
Tour: {{producto}}
Date: {{fecha}} at {{hora}}
Travellers: {{pax}}
Total: {{total}} {{moneda}}
Voucher: {{voucher}}

Please show this voucher on the day of the tour. We'll write again the day
before with your exact pickup time.

Any questions, reach us at {{telefono_empresa}}.

{{empresa}}`,
  },
  {
    key: "booking_confirmation", channel: "whatsapp", language: "en",
    trigger: TEMPLATE_TRIGGER.booking_confirmation,
    body: `Hi {{cliente}}, your booking with {{empresa}} is confirmed ✅
{{producto}} · {{fecha}} {{hora}} · {{pax}} travellers
Voucher: {{voucher}}
We'll message you the day before with your pickup time.`,
  },
  {
    key: "pre_tour_reminder", channel: "email", language: "en",
    trigger: TEMPLATE_TRIGGER.pre_tour_reminder, offset_hours: -24,
    subject: "Tomorrow: {{producto}} · pickup at {{hora_recogida}}",
    body: `Hi {{cliente}},

Your tour with {{empresa}} is tomorrow.

Tour: {{producto}}
Pickup: {{hora_recogida}} at {{lugar_recogida}}
Travellers: {{pax}}

Please be at the pickup point 10 minutes early. The vehicle can only wait
5 minutes so the rest of the group isn't delayed.

Bring sunscreen, water and a photo ID.

{{empresa}} · {{telefono_empresa}}`,
  },
  {
    key: "pre_tour_reminder", channel: "whatsapp", language: "en",
    trigger: TEMPLATE_TRIGGER.pre_tour_reminder, offset_hours: -24,
    body: `Hi {{cliente}} 👋 Your tour with {{empresa}} is tomorrow.
{{producto}}
🚐 Pickup: {{hora_recogida}} at {{lugar_recogida}}
Please be there 10 min early. See you!`,
  },
  {
    key: "balance_due", channel: "email", language: "en",
    trigger: TEMPLATE_TRIGGER.balance_due,
    subject: "Balance due on booking {{reserva}}",
    body: `Hi {{cliente}},

Your booking {{reserva}} for {{producto}} on {{fecha}} has an outstanding
balance of {{saldo}} {{moneda}}.

You can settle it before the tour or on the day with your guide. If you'd
rather pay in advance, write to us at {{telefono_empresa}}.

{{empresa}}`,
  },
  {
    key: "payment_receipt", channel: "email", language: "en",
    trigger: TEMPLATE_TRIGGER.payment_receipt,
    subject: "Payment receipt · {{reserva}}",
    body: `Hi {{cliente}},

We've recorded your payment.

Booking: {{reserva}}
Amount: {{importe}} {{moneda}}
Method: {{metodo}}
Date: {{fecha}}
Outstanding balance: {{saldo}} {{moneda}}

Thank you,
{{empresa}}`,
  },
  {
    key: "booking_cancelled", channel: "email", language: "en",
    trigger: TEMPLATE_TRIGGER.booking_cancelled,
    subject: "Booking {{reserva}} cancelled",
    body: `Hi {{cliente}},

Your booking {{reserva}} for {{producto}} on {{fecha}} has been cancelled.

Reason: {{motivo}}

If a refund applies, it will appear in the next few days depending on your
payment method. Any questions, write to us at {{telefono_empresa}}.

{{empresa}}`,
  },
  {
    key: "booking_rescheduled", channel: "email", language: "en",
    trigger: TEMPLATE_TRIGGER.booking_rescheduled,
    subject: "New date for {{producto}}: {{fecha}}",
    body: `Hi {{cliente}},

Your tour has moved to a new date. Your booking is the same and the voucher you
already have still works: only the day changes.

Booking: {{reserva}}
Tour: {{producto}}
Previous date: {{fecha_anterior}}
NEW DATE: {{fecha}} at {{hora}}
Meeting point: {{punto_encuentro}}

Reason for the change: {{motivo}}

If this date doesn't work for you, write to us at {{telefono_empresa}} and
we'll sort it out.

{{empresa}}`,
  },
  {
    key: "booking_rescheduled", channel: "whatsapp", language: "en",
    trigger: TEMPLATE_TRIGGER.booking_rescheduled,
    body: `Hi {{cliente}}: your tour {{producto}} moved from {{fecha_anterior}} to {{fecha}} at {{hora}}.
Reason: {{motivo}}. Your voucher {{reserva}} is still valid.
If that date doesn't work, just write to us. {{empresa}}`,
  },
  {
    key: "quote_sent", channel: "email", language: "en",
    trigger: TEMPLATE_TRIGGER.quote_sent,
    subject: "Your proposal: {{titulo}}",
    body: `Hi {{cliente}},

Here's the proposal we put together for you.

Proposal: {{cotizacion}} — {{titulo}}
Total: {{total}} {{moneda}}
Valid until: {{vigencia}}
Deposit to book: {{anticipo}} {{moneda}}

Let me know if you'd like anything adjusted.

{{vendedor}}
{{empresa}}`,
  },
  {
    key: "quote_sent", channel: "whatsapp", language: "en",
    trigger: TEMPLATE_TRIGGER.quote_sent,
    body: `Hi {{cliente}}, here's proposal {{cotizacion}} — {{titulo}}.
Total: {{total}} {{moneda}} · valid until {{vigencia}}.
Happy to adjust anything. {{vendedor}} · {{empresa}}`,
  },
  {
    key: "post_tour_thanks", channel: "email", language: "en",
    trigger: TEMPLATE_TRIGGER.post_tour_thanks, offset_hours: 4,
    subject: "How was {{producto}}?",
    body: `Hi {{cliente}},

Thank you for joining {{empresa}} on {{producto}} on {{fecha}}.

If you have a minute, tell us how it went: it helps us improve and helps other
travellers decide. And if something didn't go as expected, just reply to this
email — we'd rather hear it from you first.

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
