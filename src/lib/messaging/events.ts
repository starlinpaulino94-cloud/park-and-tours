import "server-only";
import { tenantQuery } from "@/lib/tenant";
import type { Booking, Company, Customer, Product } from "@/lib/types";
import { refId } from "@/lib/types";
import { enqueueMessage, type EnqueueInput, type OutboxStore } from "@/lib/messaging/outbox";
import { formatDate, formatTime } from "@/lib/format";
import { recipientFor, type MessageChannel, type TemplateKey } from "@/lib/messaging/render";

/**
 * Los avisos que el sistema manda solo, atados al hecho que los provoca.
 *
 * Están aquí y no dentro de cada ruta por dos razones. La primera es que el
 * mismo aviso sale desde varios sitios —una reserva nace en el punto de venta,
 * en el portal B2B y al convertir una cotización— y el texto tiene que ser el
 * mismo. La segunda, y más importante: NINGÚN fallo de mensajería puede tumbar
 * la operación que lo provocó. Que el proveedor de correo esté caído no puede
 * cancelar una venta ya cobrada, así que todo lo de este módulo se llama en
 * segundo plano y se traga sus errores dejándolos en consola y en la bandeja.
 */

/** Canales por los que sale un aviso: los dos, si el cliente tiene ambos. */
const CHANNELS: MessageChannel[] = ["email", "whatsapp"];

interface ContactRow {
  email?: string | null; phone?: string | null; whatsapp?: string | null;
  first_name?: string | null; last_name?: string | null; language?: string | null;
}

const nameOf = (c: ContactRow | null) =>
  [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim() || "";

/**
 * Manda por los canales de los que el cliente dio dirección.
 *
 * No es "correo o WhatsApp": quien dio los dos recibe por los dos, porque el
 * correo deja constancia con el voucher y el WhatsApp es el que se lee. Lo que
 * evita duplicados es la clave de dedupe, que incluye el canal.
 *
 * Un canal para el que el cliente NO dio dirección se omite sin dejar rastro:
 * "este cliente no tiene WhatsApp" no es un fallo de entrega, y registrarlo como
 * tal llenaría la bandeja de fallos permanentes —uno por cada cliente que solo
 * dio correo— hasta que los fallos de verdad dejaran de verse. Solo cuando no
 * hay NINGÚN canal se deja constancia, porque entonces sí hay algo que arreglar
 * en la ficha del cliente.
 */
interface FanOutInput {
  vars: EnqueueInput["vars"];
  refs?: EnqueueInput["refs"];
  anchor?: EnqueueInput["anchor"];
  attachmentKind?: EnqueueInput["attachmentKind"];
  userId?: string | null;
  /** Lo que identifica el aviso; el canal se le añade para la clave final. */
  dedupeSeed: string;
}

async function fanOut(
  company: Company | null,
  companyId: string,
  key: TemplateKey,
  contact: ContactRow | null,
  base: FanOutInput,
  store?: OutboxStore
): Promise<void> {
  const contactInfo = { email: contact?.email, phone: contact?.phone, whatsapp: contact?.whatsapp };
  const reachable = CHANNELS.filter((channel) => recipientFor(channel, contactInfo));
  // Sin ningún canal se encola igualmente por el preferido: la fila fallida es
  // el aviso de que a ese cliente no hay forma de escribirle.
  const targets = reachable.length > 0 ? reachable : [CHANNELS[0]];

  for (const channel of targets) {
    try {
      await enqueueMessage(company, companyId, {
        key,
        channel,
        language: contact?.language || "es",
        contact: contactInfo,
        toName: nameOf(contact),
        vars: base.vars,
        refs: base.refs,
        anchor: base.anchor,
        attachmentKind: base.attachmentKind,
        userId: base.userId,
        dedupeKey: `${key}:${channel}:${base.dedupeSeed}`,
      }, store);
    } catch (err) {
      console.error(`[mensajería] no se pudo encolar ${key}/${channel}:`, err);
    }
  }
}

/**
 * Confirmación de la reserva y recordatorio de la víspera.
 *
 * Se encolan los dos a la vez: el recordatorio no necesita que nadie se acuerde
 * de programarlo el día antes, que es justo lo que no ocurre cuando hay 40
 * salidas. La plantilla lleva su propio desfase (-24 h) y la cola lo respeta.
 */
export async function notifyBookingCreated(
  company: Company | null,
  companyId: string,
  booking: Booking,
  userId?: string | null
): Promise<void> {
  const customerId = refId(booking.customer);
  const productId = refId(booking.product);
  const [customers, products] = await Promise.all([
    customerId
      ? tenantQuery<Customer & ContactRow>(companyId, "customer", { _filter: { _id: customerId }, _limit: 1 })
      : Promise.resolve([]),
    productId
      ? tenantQuery<Product>(companyId, "product", { _filter: { _id: productId }, _limit: 1 })
      : Promise.resolve([]),
  ]);
  const customer = customers[0] ?? null;
  const product = products[0] ?? null;

  const travel = booking.travel_date || null;
  const currency = String(booking.currency || "usd").toUpperCase();
  const refs = {
    customer: customerId, booking: booking._id,
    order: refId(booking.order), departure: refId(booking.departure),
  };

  const shared = {
    cliente: nameOf(customer) || "viajero",
    producto: product?.name,
    fecha: travel ? formatDate(travel) : null,
    pax: booking.pax_total,
    moneda: currency,
    reserva: booking.booking_number,
  };

  await fanOut(company, companyId, "booking_confirmation", customer, {
    vars: {
      ...shared,
      hora: travel ? formatTime(travel) : null,
      total: booking.total_amount,
      saldo: booking.balance_amount,
      voucher: booking.voucher_code,
      punto_encuentro: product?.meeting_point,
    },
    // El voucher viaja con la confirmación: es el papel que el cliente enseña
    // en la puerta, y mandarlo aparte significa que nunca lo tiene a mano.
    attachmentKind: "voucher",
    refs, userId, dedupeSeed: booking._id,
  });

  // El recordatorio solo tiene sentido si sabemos cuándo sale.
  if (!travel) return;
  await enqueuePreTourReminder(company, companyId, { booking, customer, product, userId });
}

export interface ReminderInput {
  booking: Booking;
  customer: (ContactRow & { _id?: string }) | null;
  product: { name?: string | null; meeting_point?: string | null } | null;
  userId?: string | null;
}

/**
 * El recordatorio de la víspera, por separado.
 *
 * Se encola al crear la reserva, pero también lo barre el cron para las reservas
 * que ya existían antes de que hubiera comunicaciones y para las que entraron
 * con más de un día de antelación mientras el sistema estaba sin proveedor. Sin
 * ese barrido, el recordatorio solo funcionaría para las ventas futuras y la
 * cartera actual se quedaría sin avisar — que es justo el grupo que ya compró.
 *
 * Se puede llamar cien veces: la clave de dedupe deja una sola.
 */
export async function enqueuePreTourReminder(
  company: Company | null,
  companyId: string,
  input: ReminderInput,
  store?: OutboxStore
): Promise<void> {
  const { booking, customer, product } = input;
  const travel = booking.travel_date || null;
  if (!travel) return;

  await fanOut(company, companyId, "pre_tour_reminder", customer, {
    anchor: travel,
    vars: {
      cliente: nameOf(customer) || "viajero",
      producto: product?.name,
      fecha: formatDate(travel),
      pax: booking.pax_total,
      moneda: String(booking.currency || "usd").toUpperCase(),
      reserva: booking.booking_number,
      hora_recogida: booking.pickup_time || formatTime(travel),
      lugar_recogida: booking.pickup_location || product?.meeting_point || "el punto de encuentro",
      punto_encuentro: product?.meeting_point,
      saldo: booking.balance_amount,
    },
    refs: {
      customer: customer?._id ?? refId(booking.customer),
      booking: booking._id,
      order: refId(booking.order),
      departure: refId(booking.departure),
    },
    userId: input.userId,
    dedupeSeed: booking._id,
  }, store);
}

/**
 * «¿Cómo te fue?», con un enlace que SÍ lleva a algún sitio.
 *
 * La plantilla `post_tour_thanks` existía desde hace olas con su desfase de
 * cuatro horas y no la encolaba nadie: era una promesa escrita que ninguna
 * línea de código cumplía. Esta función es lo que faltaba, y `voice-service` la
 * llama después de crear la fila de la encuesta.
 *
 * El desfase lo pone la plantilla y el ancla es la fecha del viaje, igual que
 * el recordatorio de la víspera: quien decide CUÁNDO preguntar es el dominio
 * (`askAt`), y la cola solo respeta esa hora.
 *
 * Se puede llamar cien veces: la clave de dedupe deja una sola.
 */
export async function enqueuePostTourSurvey(
  company: Company | null,
  companyId: string,
  input: {
    customer: (ContactRow & { id?: string | null }) | null;
    bookingId: string;
    departureId?: string | null;
    productName?: string | null;
    travelDate?: string | null;
    /** El enlace de la encuesta. Sin él el mensaje no tiene objeto. */
    url: string;
  },
  store?: OutboxStore
): Promise<void> {
  if (!input.url) return;

  await fanOut(company, companyId, "post_tour_thanks", input.customer, {
    // Sin ancla se manda ya: la encuesta se crea cuando YA toca preguntar, así
    // que el desfase de la plantilla no tiene que volver a esperar.
    vars: {
      cliente: nameOf(input.customer) || "viajero",
      empresa: company?.name,
      producto: input.productName,
      fecha: input.travelDate ? formatDate(input.travelDate) : "",
      enlace: input.url,
    },
    refs: {
      customer: input.customer?.id ?? null,
      booking: input.bookingId,
      departure: input.departureId ?? null,
    },
    dedupeSeed: `survey:${input.bookingId}`,
  }, store);
}

/** El recibo de un cobro: lo que el cliente pide cuando paga en efectivo. */
export async function notifyPaymentReceived(
  company: Company | null,
  companyId: string,
  input: {
    paymentId: string; amount: number; currency: string; method?: string | null;
    bookingId?: string | null; orderId?: string | null; customerId?: string | null;
    reference?: string | null; balance?: number | null; userId?: string | null;
  }
): Promise<void> {
  const customers = input.customerId
    ? await tenantQuery<Customer & ContactRow>(companyId, "customer", { _filter: { _id: input.customerId }, _limit: 1 })
    : [];
  const customer = customers[0] ?? null;

  await fanOut(company, companyId, "payment_receipt", customer, {
    vars: {
      cliente: nameOf(customer) || "viajero",
      reserva: input.reference,
      importe: input.amount,
      moneda: String(input.currency || "usd").toUpperCase(),
      metodo: input.method,
      fecha: formatDate(new Date().toISOString()),
      saldo: input.balance ?? 0,
    },
    refs: {
      customer: input.customerId, booking: input.bookingId,
      order: input.orderId, payment: input.paymentId,
    },
    userId: input.userId,
    dedupeSeed: input.paymentId,
  });
}

/** La propuesta que el vendedor acaba de dar por enviada. */
export interface QuoteForMessage {
  _id: string;
  code?: string | null;
  title?: string | null;
  currency?: string | null;
  valid_until?: string | null;
  company_name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  customer?: unknown;
}

export async function notifyQuoteSent(
  company: Company | null,
  companyId: string,
  quote: QuoteForMessage,
  extra: { total: number; deposit: number; sellerName?: string | null; sentCount: number; userId?: string | null }
): Promise<void> {
  const customerId = refId(quote.customer as never);
  const customers = customerId
    ? await tenantQuery<Customer & ContactRow>(companyId, "customer", { _filter: { _id: customerId }, _limit: 1 })
    : [];
  // Una cotización de grupo se negocia con alguien que casi nunca está dado de
  // alta como cliente: el contacto de la propia cotización es el destinatario.
  const contact: ContactRow = customers[0] ?? {
    email: quote.contact_email || null,
    phone: quote.contact_phone || null,
    whatsapp: quote.contact_phone || null,
    first_name: quote.contact_name || null,
  };

  await fanOut(company, companyId, "quote_sent", contact, {
    vars: {
      cliente: nameOf(contact) || quote.company_name || "viajero",
      cotizacion: quote.code,
      titulo: quote.title || quote.code,
      total: extra.total,
      moneda: String(quote.currency || "usd").toUpperCase(),
      vigencia: quote.valid_until ? formatDate(quote.valid_until) : null,
      anticipo: extra.deposit,
      vendedor: extra.sellerName,
    },
    refs: { customer: customerId, quote: quote._id },
    // La propuesta completa va adjunta: el desglose y las alternativas no caben
    // en el cuerpo de un mensaje, y son justo lo que decide la venta.
    attachmentKind: "quote",
    userId: extra.userId,
    // Reenviar una propuesta es legítimo —el cliente pidió que se la mandaran de
    // nuevo—, así que el número de envío entra en la clave.
    dedupeSeed: `${quote._id}:${extra.sentCount}`,
  });
}

/** La cancelación, que el cliente tiene que saber antes de presentarse. */
export async function notifyBookingCancelled(
  company: Company | null,
  companyId: string,
  booking: Booking,
  reason: string,
  userId?: string | null
): Promise<void> {
  const customerId = refId(booking.customer);
  const productId = refId(booking.product);
  const [customers, products] = await Promise.all([
    customerId
      ? tenantQuery<Customer & ContactRow>(companyId, "customer", { _filter: { _id: customerId }, _limit: 1 })
      : Promise.resolve([]),
    productId
      ? tenantQuery<Product>(companyId, "product", { _filter: { _id: productId }, _limit: 1 })
      : Promise.resolve([]),
  ]);
  const customer = customers[0] ?? null;

  await fanOut(company, companyId, "booking_cancelled", customer, {
    vars: {
      cliente: nameOf(customer) || "viajero",
      reserva: booking.booking_number,
      producto: products[0]?.name,
      fecha: booking.travel_date ? formatDate(booking.travel_date) : null,
      motivo: reason,
    },
    refs: { customer: customerId, booking: booking._id, order: refId(booking.order) },
    userId,
    dedupeSeed: booking._id,
  });
}

/* -------------------------------------------------------- reprogramación */

export interface RescheduleNoticeInput {
  departure: { departure_at?: string | null; meeting_point?: string | null };
  reason: string;
  userId?: string | null;
}

/**
 * «Tu excursión cambió de fecha».
 *
 * Es el aviso que evita el peor momento posible de una reprogramación: el
 * cliente en el lobby del hotel el día que ya no es. Dice la fecha nueva, la
 * anterior —para que entienda de qué habla el mensaje— y que su voucher sigue
 * valiendo, porque la primera reacción de quien recibe esto es pensar que su
 * reserva se perdió.
 *
 * La clave de dedupe lleva la fecha nueva: mover la misma reserva dos veces son
 * dos avisos, porque son dos cambios que el cliente tiene que conocer.
 */
export async function notifyBookingRescheduled(
  company: Company | null,
  companyId: string,
  booking: Booking,
  input: RescheduleNoticeInput
): Promise<void> {
  const customerId = refId(booking.customer);
  const productId = refId(booking.product);
  const [customers, products] = await Promise.all([
    customerId
      ? tenantQuery<Customer & ContactRow>(companyId, "customer", { _filter: { _id: customerId }, _limit: 1 })
      : Promise.resolve([]),
    productId
      ? tenantQuery<Product>(companyId, "product", { _filter: { _id: productId }, _limit: 1 })
      : Promise.resolve([]),
  ]);
  const customer = customers[0] ?? null;
  const product = products[0] ?? null;
  const nueva = input.departure.departure_at || null;

  await fanOut(company, companyId, "booking_rescheduled", customer, {
    vars: {
      cliente: nameOf(customer) || "viajero",
      reserva: booking.booking_number,
      producto: product?.name,
      // La fecha ANTERIOR sale de la reserva, que todavía no se ha releído: la
      // ruta llama a esto con el registro de antes del cambio a propósito.
      fecha_anterior: booking.travel_date ? formatDate(booking.travel_date) : null,
      fecha: nueva ? formatDate(nueva) : null,
      hora: nueva ? formatTime(nueva) : null,
      motivo: input.reason,
      punto_encuentro: input.departure.meeting_point || product?.meeting_point,
    },
    refs: { customer: customerId, booking: booking._id, order: refId(booking.order) },
    userId: input.userId,
    dedupeSeed: `${booking._id}:${String(nueva || "").slice(0, 10)}`,
  });
}

/* ------------------------------------------------------- saldo pendiente */

export interface BalanceDueInput {
  /** La cuota que vence. */
  installment: {
    _id: string;
    kind?: string | null;
    due_date?: string | null;
    amount?: number | null;
    paid_amount?: number | null;
    balance?: number | null;
    currency?: string | null;
  };
  order: { _id: string; order_number?: string | null } | null;
  booking: (Booking & { product?: unknown }) | null;
  customer: (ContactRow & { _id?: string }) | null;
  product: { name?: string | null } | null;
  userId?: string | null;
}

/**
 * El recordatorio del saldo pendiente.
 *
 * La plantilla `balance_due` se creó con el módulo de comunicaciones, se
 * documentó y se sembró en cada empresa… y NADA la disparaba nunca. El sistema
 * prometía recordarle al cliente su saldo y no recordaba ninguno: el cobro
 * dependía de que alguien se acordara de mirar la lista, que con cuarenta
 * salidas a la semana es lo mismo que no cobrarlo.
 *
 * Lo llama la cobranza diaria. Se puede llamar cien veces para la misma cuota:
 * la clave de dedupe —la cuota y su vencimiento— deja pasar una sola, así que un
 * reintento del cron no le escribe dos veces al cliente.
 */
export async function notifyBalanceDue(
  company: Company | null,
  companyId: string,
  input: BalanceDueInput,
  store?: OutboxStore
): Promise<void> {
  const { installment, order, booking, customer, product } = input;
  const balance = installment.balance
    ?? Math.max((installment.amount ?? 0) - (installment.paid_amount ?? 0), 0);
  if (balance <= 0) return;

  await fanOut(company, companyId, "balance_due", customer, {
    vars: {
      cliente: nameOf(customer) || "viajero",
      reserva: booking?.booking_number || order?.order_number,
      producto: product?.name,
      fecha: booking?.travel_date ? formatDate(booking.travel_date) : "",
      saldo: balance,
      moneda: String(installment.currency || booking?.currency || "usd").toUpperCase(),
      vence: installment.due_date ? formatDate(installment.due_date) : "",
    },
    refs: {
      customer: customer?._id, booking: booking?._id, order: order?._id,
    },
    userId: input.userId,
    // El vencimiento entra en la clave: si el plan se rehace y la cuota pasa a
    // otra fecha, es un aviso nuevo y sí se manda.
    dedupeSeed: `${installment._id}:${installment.due_date || ""}`,
  }, store);
}
