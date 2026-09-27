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
  post_tour_thanks: ["cliente", "empresa", "producto", "fecha", "enlace", "telefono_empresa"],
  /**
   * La única que NO va a un cliente: va a quien opera la salida. `destinatario`
   * es el guía, el chofer o la oficina del proveedor, y `paradas` es el resumen
   * de recogidas — la lista de pasajeros viaja en el PDF adjunto y recortada,
   * nunca en el cuerpo del mensaje.
   */
  manifest_dispatch: [
    "destinatario", "empresa", "producto", "fecha", "hora", "pax", "vehiculos",
    "punto_encuentro", "paradas",
  ],
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
  manifest_dispatch: "La víspera de la salida, a quien la opera",
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
    /**
     * EL «CONTÉSTANOS A ESTE CORREO» SE FUE, Y CON MOTIVO.
     *
     * Ese texto mandaba la opinión a una bandeja de entrada: nadie la tabulaba,
     * nadie la atribuía a un guía y nadie la convertía en reseña. Ahora lleva
     * un enlace de un solo toque —una nota de 0 a 10— que además bifurca: al
     * que sale encantado se le pide la reseña pública, y al que no, se le abre
     * un caso para llamarlo. Preguntar sin medir es no preguntar.
     */
    key: "post_tour_thanks", channel: "email", language: "es",
    trigger: TEMPLATE_TRIGGER.post_tour_thanks, offset_hours: 4,
    subject: "¿Cómo te fue en {{producto}}?",
    body: `Hola {{cliente}},

Gracias por venir con {{empresa}} a {{producto}} el {{fecha}}.

¿Nos das un minuto? Con un toque nos dices qué tal estuvo:

{{enlace}}

Es una sola pregunta. Y si algo no salió como esperabas, cuéntanoslo ahí:
preferimos saberlo nosotros primero.

{{empresa}} · {{telefono_empresa}}`,
  },
  {
    // En WhatsApp, el enlace y poco más: se lee en la pantalla de bloqueo.
    key: "post_tour_thanks", channel: "whatsapp", language: "es",
    trigger: TEMPLATE_TRIGGER.post_tour_thanks, offset_hours: 4,
    body: `Hola {{cliente}}, ¿qué tal estuvo {{producto}}? Un toque y nos lo cuentas: {{enlace}} — {{empresa}}`,
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

Got a minute? One tap tells us how it went:

{{enlace}}

It's a single question. And if something didn't go as expected, tell us there —
we'd rather hear it from you first.

{{empresa}} · {{telefono_empresa}}`,
  },
  {
    key: "post_tour_thanks", channel: "whatsapp", language: "en",
    trigger: TEMPLATE_TRIGGER.post_tour_thanks, offset_hours: 4,
    body: `Hi {{cliente}}, how was {{producto}}? One tap to tell us: {{enlace}} — {{empresa}}`,
  },
  {
    key: "manifest_dispatch", channel: "email", language: "es",
    // SIN `{{telefono_empresa}}` y sin `offset_hours`, y las dos cosas por el
    // mismo motivo: que este mensaje no se quede sin salir.
    //
    // Un hueco sin rellenar NO se manda (ver `render.ts`), y ese hueco se
    // rellena con el teléfono que la empresa haya escrito en su ficha. En los
    // demás avisos eso es correcto: un cliente que recibe «escríbenos a » no
    // sabe a dónde. Aquí el destinatario es el guía o el transportista, que ya
    // tienen el número de la oficina — y una operadora que no rellenó su propio
    // teléfono se habría quedado sin mandar NINGÚN manifiesto, con el autobús
    // saliendo igual.
    //
    // SIN `offset_hours` a propósito. Los demás avisos se programan respecto al
    // hecho; el manifiesto sale EN CUANTO SE SABE. Con -24 h, el barrido diario
    // de las 6:00 lo dejaría programado para una hora antes de la salida, que
    // es cuando el chofer ya va camino del primer hotel. La ventana la decide
    // quien encola (`vetoDeEnvio`, 36 h), no la plantilla.
    trigger: TEMPLATE_TRIGGER.manifest_dispatch,
    subject: "Manifiesto · {{producto}} · {{fecha}}",
    body: `{{destinatario}}:

Adjunto el manifiesto de la salida de {{empresa}}.

Excursión: {{producto}}
Fecha: {{fecha}} a las {{hora}}
Pasajeros: {{pax}}
Vehículo: {{vehiculos}}
Punto de encuentro: {{punto_encuentro}}

Recogidas:
{{paradas}}

El PDF adjunto lleva la lista con la que se opera. Es información de clientes
de {{empresa}}: se usa para este servicio y no se reenvía fuera del equipo que
lo opera.

Si la lista cambia antes de la salida, recibirás una versión nueva.

{{empresa}}`,
  },
  {
    key: "manifest_dispatch", channel: "whatsapp", language: "es",
    trigger: TEMPLATE_TRIGGER.manifest_dispatch,
    body: `{{destinatario}}, manifiesto de {{empresa}} 🚐
{{producto}} · {{fecha}} {{hora}} · {{pax}} pax
Vehículo: {{vehiculos}}

Recogidas:
{{paradas}}

La lista completa va en el correo.`,
  },
  {
    key: "manifest_dispatch", channel: "email", language: "en",
    trigger: TEMPLATE_TRIGGER.manifest_dispatch,
    subject: "Manifest · {{producto}} · {{fecha}}",
    body: `{{destinatario}}:

Attached is the manifest for this {{empresa}} departure.

Tour: {{producto}}
Date: {{fecha}} at {{hora}}
Passengers: {{pax}}
Vehicle: {{vehiculos}}
Meeting point: {{punto_encuentro}}

Pickups:
{{paradas}}

The attached PDF is the list you operate with. It holds {{empresa}} customer
data: use it for this service and do not forward it outside the team running it.

If the list changes before departure, you'll get a new version.

{{empresa}}`,
  },
  {
    key: "manifest_dispatch", channel: "whatsapp", language: "en",
    trigger: TEMPLATE_TRIGGER.manifest_dispatch,
    body: `{{destinatario}}, manifest from {{empresa}} 🚐
{{producto}} · {{fecha}} {{hora}} · {{pax}} pax
Vehicle: {{vehiculos}}

Pickups:
{{paradas}}

The full list is in the email.`,
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
