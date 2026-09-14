/**
 * El manifiesto de una salida.
 *
 * Es el papel sin el cual una excursión no sale: quién viaja, dónde y a qué hora
 * se le recoge, qué necesita cada uno y cuánto queda por cobrar a bordo. El
 * sistema tenía todos esos datos —reservas, acompañantes, recogidas, vehículos y
 * guías— y no había ninguna pantalla que los juntara: el despacho enseñaba
 * cuántos pax iban en cada salida, pero no quiénes eran. En la práctica eso
 * significa que la operación se seguía llevando en una hoja de cálculo aparte, y
 * que lo que se cobraba a bordo no volvía nunca al sistema.
 *
 * Aquí se arma, en funciones puras, para que la pantalla, la impresión, el CSV y
 * cualquier envío futuro al guía digan exactamente lo mismo.
 *
 * Decisiones que sostiene este módulo:
 *
 *  · El orden es el de la RUTA, no el de la venta: primero quien se recoge
 *    antes. Un manifiesto ordenado por fecha de reserva obliga al conductor a
 *    releer la hoja entera en cada parada.
 *  · Los bebés cuentan para el asiento del vehículo aunque no paguen: una
 *    furgoneta de 15 plazas con 14 pax y 2 bebés va llena.
 *  · Una reserva cancelada no viaja; una con saldo pendiente sí, pero se marca,
 *    porque ese dinero se cobra en la puerta o se pierde.
 */

export type PickupState = "pending" | "confirmed" | "picked_up" | "no_show" | "cancelled";

export interface ManifestBookingInput {
  _id: string;
  booking_number?: string | null;
  voucher_code?: string | null;
  status?: string | null;
  checkin_status?: string | null;
  checked_in_pax?: number | null;
  adults?: number | null;
  children?: number | null;
  infants?: number | null;
  pax_total?: number | null;
  balance_amount?: number | null;
  total_amount?: number | null;
  currency?: string | null;
  channel?: string | null;
  notes?: string | null;
  internal_notes?: string | null;
  pickup_time?: string | null;
  pickup_location?: string | null;
  room_number?: string | null;
  customer?: unknown;
  pickup_hotel?: unknown;
  partner?: unknown;
  seller?: unknown;
  participant?: unknown[];
}

export interface ManifestParticipant {
  _id: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  age?: number | null;
  category?: string | null;
  document_id?: string | null;
  nationality?: string | null;
  special_requirements?: string | null;
  checkin_status?: string | null;
}

/** Reservas que no viajan: no entran en el manifiesto ni en sus cuentas. */
export const DEAD_BOOKING_STATUSES = new Set(["cancelled", "refunded", "partially_refunded", "draft"]);

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Nombre presentable de una persona, venga como sea. */
export function personName(value: unknown): string {
  const row = obj(value);
  if (!row) return "";
  const full = [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ");
  return full || text(row.full_name) || text(row.commercial_name) || text(row.name) || "";
}

/**
 * Hora de recogida de la reserva, normalizada a `HH:MM`.
 *
 * Se teclea a mano ("7:30", "7.30", "07:30 am"), así que ordenar por el texto
 * crudo colocaba las 7:30 después de las 15:00. Lo que no se entiende se
 * devuelve como null y va al final: es mejor que inventar una hora.
 *
 * El patrón está anclado a la cadena COMPLETA a propósito. Sin anclar, "7:5"
 * casaba con la hora, descartaba el resto y devolvía las 07:00 — una hora que
 * nadie escribió, y que en una hoja de ruta manda al conductor media hora antes
 * de lo que el cliente espera.
 */
export function pickupMinutes(value: unknown): number | null {
  const raw = text(value).toLowerCase();
  if (!raw) return null;
  const m = /^(\d{1,2})(?:[:.h ](\d{1,2}))?\s*(am|pm)?$/.exec(raw);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2] ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) return null;
  if (m[3] === "pm" && hours < 12) hours += 12;
  if (m[3] === "am" && hours === 12) hours = 0;
  if (hours > 23) return null;
  return hours * 60 + minutes;
}

export const formatPickupTime = (value: unknown): string => {
  const mins = pickupMinutes(value);
  if (mins === null) return text(value) || "—";
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
};

export interface ManifestRow {
  booking_id: string;
  booking_number: string;
  voucher_code: string;
  lead_name: string;
  phone: string;
  email: string;
  language: string;
  nationality: string;
  adults: number;
  children: number;
  infants: number;
  /** Plazas que ocupa en el vehículo: el bebé no paga, pero va sentado. */
  seats: number;
  pickup_hotel: string;
  pickup_zone: string;
  pickup_time: string;
  pickup_sort: number | null;
  room: string;
  pickup_location: string;
  balance: number;
  currency: string;
  paid: boolean;
  checkin_status: string;
  checked_in_pax: number;
  sold_by: string;
  requirements: string[];
  notes: string;
  participants: ManifestParticipant[];
  /** Acompañantes que faltan por nombrar, que es lo que pide el seguro. */
  unnamed_pax: number;
}

/** Una reserva del manifiesto, con todo lo que el guía necesita de un vistazo. */
export function manifestRow(booking: ManifestBookingInput): ManifestRow {
  const customer = obj(booking.customer);
  const hotel = obj(booking.pickup_hotel);
  const zone = hotel ? obj(hotel.zone) : null;
  const participants = (booking.participant ?? []).filter((p): p is ManifestParticipant => Boolean(obj(p)));

  const adults = Math.max(Math.floor(num(booking.adults)), 0);
  const children = Math.max(Math.floor(num(booking.children)), 0);
  const infants = Math.max(Math.floor(num(booking.infants)), 0);
  const declared = adults + children + infants;
  const seats = declared > 0 ? declared : Math.max(Math.floor(num(booking.pax_total)), 0);

  const requirements = [
    ...participants.map((p) => text(p.special_requirements)).filter(Boolean),
    text(booking.notes),
  ].filter(Boolean);

  const balance = round2(num(booking.balance_amount));
  const named = participants.filter((p) => personName(p)).length;

  return {
    booking_id: booking._id,
    booking_number: text(booking.booking_number) || "—",
    voucher_code: text(booking.voucher_code),
    lead_name: personName(customer) || "Sin nombre",
    phone: text(customer?.whatsapp) || text(customer?.phone),
    email: text(customer?.email),
    language: text(customer?.language),
    nationality: text(customer?.nationality) || text(customer?.country),
    adults, children, infants, seats,
    pickup_hotel: text(hotel?.name),
    pickup_zone: text(zone?.name),
    pickup_time: formatPickupTime(booking.pickup_time),
    pickup_sort: pickupMinutes(booking.pickup_time),
    room: text(booking.room_number) || text(customer?.room),
    pickup_location: text(booking.pickup_location),
    balance,
    currency: text(booking.currency) || "usd",
    paid: balance <= 0.009,
    checkin_status: text(booking.checkin_status) || "pending",
    checked_in_pax: Math.max(Math.floor(num(booking.checked_in_pax)), 0),
    sold_by: personName(booking.partner) || personName(booking.seller) || text(booking.channel),
    requirements,
    notes: text(booking.internal_notes),
    participants,
    unnamed_pax: Math.max(seats - named, 0),
  };
}

/**
 * Orden de la hoja de ruta: por hora de recogida, luego por hotel.
 *
 * Quien no tiene recogida asignada va al final: se presenta en el punto de
 * encuentro y no forma parte del recorrido del vehículo.
 */
export function sortByRoute(rows: ManifestRow[]): ManifestRow[] {
  return [...rows].sort((a, b) => {
    if (a.pickup_sort === null && b.pickup_sort === null) {
      return a.lead_name.localeCompare(b.lead_name, "es");
    }
    if (a.pickup_sort === null) return 1;
    if (b.pickup_sort === null) return -1;
    if (a.pickup_sort !== b.pickup_sort) return a.pickup_sort - b.pickup_sort;
    return (a.pickup_hotel || "").localeCompare(b.pickup_hotel || "", "es");
  });
}

export interface PickupStop {
  key: string;
  hotel: string;
  zone: string;
  time: string;
  sort: number | null;
  seats: number;
  bookings: ManifestRow[];
}

/**
 * Las paradas del vehículo: una por hotel y hora.
 *
 * Dos reservas del mismo hotel a la misma hora son UNA parada, no dos. El
 * conductor para una vez y sube a todo el mundo.
 */
export function pickupStops(rows: ManifestRow[]): PickupStop[] {
  const stops = new Map<string, PickupStop>();
  for (const row of sortByRoute(rows)) {
    if (!row.pickup_hotel && row.pickup_sort === null) continue;
    const key = `${row.pickup_time}|${row.pickup_hotel}`;
    const stop = stops.get(key) ?? {
      key,
      hotel: row.pickup_hotel || "Punto de encuentro",
      zone: row.pickup_zone,
      time: row.pickup_time,
      sort: row.pickup_sort,
      seats: 0,
      bookings: [],
    };
    stop.seats += row.seats;
    stop.bookings.push(row);
    stops.set(key, stop);
  }
  return [...stops.values()];
}

export interface PaxSummary {
  bookings: number;
  adults: number;
  children: number;
  infants: number;
  seats: number;
  checked_in: number;
  pending_checkin: number;
  no_show: number;
  /** Lo que queda por cobrar en la divisa dominante de la salida. */
  to_collect: number;
  /** Y el desglose completo: sumar divisas distintas 1:1 no significa nada. */
  to_collect_by_currency: Record<string, number>;
  currency: string;
  languages: Record<string, number>;
}

/**
 * El resumen que el guía lee antes de arrancar.
 *
 * El dinero va por divisa. Una salida puede llevar reservas en dólares y en
 * pesos —pasa con el cliente local y el de hotel— y sumarlas 1:1 daba una cifra
 * que no es dinero: ni se puede cuadrar contra la caja ni decirle al guía cuánto
 * tiene que traer de vuelta.
 */
export function paxSummary(rows: ManifestRow[]): PaxSummary {
  const languages: Record<string, number> = {};
  const byCurrency: Record<string, number> = {};
  let adults = 0, children = 0, infants = 0, seats = 0;
  let checkedIn = 0, noShow = 0;

  for (const row of rows) {
    adults += row.adults;
    children += row.children;
    infants += row.infants;
    seats += row.seats;
    checkedIn += row.checked_in_pax;
    if (row.checkin_status === "no_show") noShow += row.seats;
    if (row.balance > 0) {
      byCurrency[row.currency] = round2((byCurrency[row.currency] ?? 0) + row.balance);
    }
    const lang = row.language || "sin indicar";
    languages[lang] = (languages[lang] ?? 0) + row.seats;
  }

  // La divisa dominante es aquella en la que hay más por cobrar; sin cobros
  // pendientes, la de la primera reserva.
  const dominant = Object.entries(byCurrency).sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? rows[0]?.currency ?? "usd";

  return {
    bookings: rows.length,
    adults, children, infants, seats,
    checked_in: checkedIn,
    // Los que ya se marcaron no-show no están pendientes: están resueltos.
    pending_checkin: Math.max(seats - checkedIn - noShow, 0),
    no_show: noShow,
    to_collect: byCurrency[dominant] ?? 0,
    to_collect_by_currency: byCurrency,
    currency: dominant,
    languages,
  };
}

export type ManifestAlert = { level: "danger" | "warning"; message: string };

export interface ManifestContext {
  capacity?: number | null;
  vehicleSeats?: number | null;
  guides?: number;
  vehicles?: number;
  meetingPoint?: string | null;
}

/**
 * Lo que hay que resolver ANTES de que el vehículo salga.
 *
 * No es una lista de avisos decorativos: cada uno corresponde a una salida que
 * en la práctica se ha ido con gente en la acera, sin guía, o sin cobrar.
 */
export function manifestAlerts(rows: ManifestRow[], ctx: ManifestContext = {}): ManifestAlert[] {
  const summary = paxSummary(rows);
  const alerts: ManifestAlert[] = [];

  const seats = num(ctx.vehicleSeats);
  if (seats > 0 && summary.seats > seats) {
    alerts.push({
      level: "danger",
      message: `${summary.seats} plazas necesarias para ${seats} disponibles en los vehículos asignados`,
    });
  }
  if (summary.seats > 0 && !num(ctx.vehicles)) {
    alerts.push({ level: "danger", message: "La salida no tiene vehículo asignado" });
  }
  if (summary.seats > 0 && !num(ctx.guides)) {
    alerts.push({ level: "warning", message: "La salida no tiene guía asignado" });
  }

  const capacity = num(ctx.capacity);
  if (capacity > 0 && summary.seats > capacity) {
    alerts.push({
      level: "danger",
      message: `Sobreventa: ${summary.seats} pax reservados sobre un cupo de ${capacity}`,
    });
  }

  const pendingRows = rows.filter((r) => !r.paid).length;
  if (pendingRows > 0) {
    const amounts = Object.entries(summary.to_collect_by_currency)
      .map(([currency, amount]) => `${amount} ${currency.toUpperCase()}`)
      .join(" + ");
    alerts.push({
      level: "warning",
      message: `${pendingRows} reserva(s) con saldo pendiente: ${amounts} por cobrar a bordo`,
    });
  }

  const unnamed = rows.reduce((s, r) => s + r.unnamed_pax, 0);
  if (unnamed > 0) {
    alerts.push({
      level: "warning",
      message: `${unnamed} pasajero(s) sin nombre registrado: el manifiesto no sirve para el seguro así`,
    });
  }

  // Si unas reservas llevan recogida y otras no, lo normal es que falte
  // asignarla, no que esas personas vayan por su cuenta al punto de encuentro.
  const withPickup = rows.filter((r) => r.pickup_hotel).length;
  const withoutPickup = rows.filter((r) => !r.pickup_hotel && r.pickup_sort === null).length;
  if (withPickup > 0 && withoutPickup > 0) {
    alerts.push({
      level: "warning",
      message: `${withoutPickup} reserva(s) sin recogida asignada mientras el resto sí la tiene`,
    });
  }

  const special = rows.filter((r) => r.requirements.length > 0).length;
  if (special > 0) {
    alerts.push({ level: "warning", message: `${special} reserva(s) con requerimientos especiales` });
  }

  return alerts;
}

/* ------------------------------------------------------------------ cierre */

export type CloseBlock = "already_closed" | "cancelled" | "not_departed" | "pending_checkin";

export const CLOSE_BLOCK_MESSAGE: Record<CloseBlock, string> = {
  already_closed: "Esta salida ya está cerrada",
  cancelled: "Una salida cancelada no se cierra: no llegó a operar",
  not_departed: "La salida todavía no ha partido: ciérrala cuando termine",
  pending_checkin: "Quedan reservas sin check-in ni no-show: resuélvelas antes de cerrar",
};

/** Bloqueos que un responsable puede saltarse dejando constancia del motivo. */
export const FORCEABLE_CLOSE_BLOCKS = new Set<CloseBlock>(["not_departed", "pending_checkin"]);

export interface ClosableDeparture {
  status?: string | null;
  departure_at?: string | null;
  closed_at?: string | null;
}

/**
 * Qué impide cerrar la salida.
 *
 * Cerrar es afirmar cuánta gente viajó de verdad: es el número del que salen la
 * rentabilidad real y la comisión del guía, así que no puede hacerse sobre una
 * lista a medio marcar ni sobre una salida que aún no ha partido.
 */
export function closeBlocker(
  departure: ClosableDeparture,
  rows: ManifestRow[],
  now: Date = new Date()
): CloseBlock | null {
  if (departure.closed_at || departure.status === "completed") return "already_closed";
  if (departure.status === "cancelled") return "cancelled";
  const at = departure.departure_at ? new Date(departure.departure_at).getTime() : NaN;
  if (Number.isFinite(at) && at > now.getTime()) return "not_departed";
  if (rows.some((r) => r.checkin_status !== "done" && r.checkin_status !== "no_show")) return "pending_checkin";
  return null;
}

export interface CloseTotals {
  actual_pax: number;
  no_show_pax: number;
  /** Lo que embarcó y no pagó, por divisa. */
  uncollected: Record<string, number>;
}

/**
 * Lo que se guarda al cerrar.
 *
 * `actual_pax` son las plazas efectivamente embarcadas, no las vendidas: un
 * no-show se vendió pero no viajó, y confundirlos infla la ocupación de la que
 * salen los informes de rentabilidad.
 */
export function closeTotals(rows: ManifestRow[]): CloseTotals {
  const summary = paxSummary(rows);
  const uncollected: Record<string, number> = {};
  // Lo que no pagó quien NO viajó no es una deuda de esta salida: es una reserva
  // no-show, que se resuelve con su política de cancelación.
  for (const row of rows) {
    if (row.paid || row.checkin_status === "no_show") continue;
    uncollected[row.currency] = round2((uncollected[row.currency] ?? 0) + row.balance);
  }
  return { actual_pax: summary.checked_in, no_show_pax: summary.no_show, uncollected };
}
