/**
 * EL CUPO DEL SOCIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PROMETÍA Y NO CUMPLÍA
 *
 * `allotment` existe desde la migración 0010 con todo lo que hace falta —plazas
 * contratadas, plazas usadas, plazas liberadas, días de liberación, tipo de
 * cupo, días de la semana— y NADIE la leía nunca. Era una pantalla de alta que
 * guardaba filas que no acotaban nada.
 *
 * Lo que pasaba de verdad en una operadora con agencias: se le prometían 10
 * plazas garantizadas a una agencia por contrato, y el sistema le dejaba vender
 * las 40 de la salida o ninguna, según la suerte. El cupo se llevaba en un
 * Excel y se revisaba por WhatsApp la mañana de la salida.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS CUATRO TIPOS, Y QUÉ SIGNIFICAN DE VERDAD
 *
 *  · **free_sale** — venta libre: el socio vende hasta donde llegue la
 *    capacidad de la salida. El cupo existe para registrar la relación, no
 *    para limitar.
 *  · **guaranteed** — plazas apartadas para él. Nadie más las toca hasta que se
 *    liberan, y él no puede pasar de ahí.
 *  · **on_request** — vende, pero cada reserva necesita confirmación. No
 *    consume plazas garantizadas.
 *  · **closed** — cerrado. No vende.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA LIBERACIÓN AUTOMÁTICA
 *
 * `release_days` es el corazón del acuerdo: «te guardo 10 plazas hasta 3 días
 * antes; lo que no hayas vendido vuelve a la venta libre». Sin ella, un cupo
 * garantizado que el socio no usa se queda bloqueado hasta la salida y la
 * operadora pierde esas plazas.
 *
 * Todo lo de aquí es puro. Quien lee la base y escribe es
 * `allotment-service.ts`.
 */

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown) => Math.max(0, Math.floor(num(v)));

export type AllotmentType = "free_sale" | "guaranteed" | "on_request" | "closed";

/** Los tipos que apartan plazas de verdad. */
export const HOLDS_SEATS = new Set<AllotmentType>(["guaranteed"]);
/** Los tipos con los que se puede vender. */
export const SELLABLE = new Set<AllotmentType>(["free_sale", "guaranteed", "on_request"]);

/** Los días de la semana como los guarda la tabla. */
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export interface AllotmentRow {
  _id?: string | null;
  id?: string | null;
  allotment_type?: string | null;
  seats?: number | null;
  seats_used?: number | null;
  seats_released?: number | null;
  release_days?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  weekdays?: string[] | null;
  status?: string | null;
  partner?: unknown;
  product?: unknown;
  departure?: unknown;
  product_modality?: unknown;
}

function ref(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const row = v as { _id?: unknown; id?: unknown };
    const id = row._id ?? row.id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/** El día de la semana de una fecha `YYYY-MM-DD`, en el vocabulario de la tabla. */
export function weekdayOf(dateISO: string): string {
  const d = new Date(`${String(dateISO).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : WEEKDAYS[d.getUTCDay()];
}

/**
 * ¿Este cupo aplica a esta venta?
 *
 * Un cupo atado a UNA salida gana al que está atado al producto: es más
 * específico, y para eso se creó. Sin fechas ni días de la semana, aplica
 * siempre — un contrato sin restricción de temporada es lo normal.
 */
export function applies(
  allotment: AllotmentRow,
  query: { partnerId: string; productId?: string | null; departureId?: string | null; travelDate?: string | null }
): boolean {
  if (String(allotment.status || "active") !== "active") return false;
  if (ref(allotment.partner) !== query.partnerId) return false;

  const depId = ref(allotment.departure);
  if (depId) {
    if (depId !== query.departureId) return false;
  } else {
    const prodId = ref(allotment.product);
    if (prodId && prodId !== query.productId) return false;
  }

  const day = query.travelDate ? String(query.travelDate).slice(0, 10) : null;
  if (day) {
    const from = allotment.valid_from ? String(allotment.valid_from).slice(0, 10) : null;
    const to = allotment.valid_to ? String(allotment.valid_to).slice(0, 10) : null;
    if (from && day < from) return false;
    if (to && day > to) return false;

    const days = allotment.weekdays ?? [];
    // Una lista vacía significa «todos los días», no «ningún día». Al revés, un
    // cupo al que nadie le puso días no vendería nunca.
    if (days.length > 0 && !days.includes(weekdayOf(day))) return false;
  }
  return true;
}

/**
 * El cupo que manda cuando hay varios.
 *
 * El de la salida concreta gana al del producto; entre iguales, el que caduca
 * antes —es el más restrictivo y el que el socio negoció para esa temporada—.
 */
export function pickAllotment(
  allotments: AllotmentRow[],
  query: { partnerId: string; productId?: string | null; departureId?: string | null; travelDate?: string | null }
): AllotmentRow | null {
  const candidatos = allotments.filter((a) => applies(a, query));
  if (candidatos.length === 0) return null;
  return candidatos.sort((a, b) => {
    const ad = ref(a.departure) ? 0 : 1;
    const bd = ref(b.departure) ? 0 : 1;
    if (ad !== bd) return ad - bd;
    const at = a.valid_to ? String(a.valid_to) : "9999-12-31";
    const bt = b.valid_to ? String(b.valid_to) : "9999-12-31";
    return at.localeCompare(bt);
  })[0];
}

export interface AllotmentState {
  allotmentId: string | null;
  type: AllotmentType;
  /** Plazas contratadas. */
  seats: number;
  used: number;
  released: number;
  /** Lo que le queda al socio de SU cupo. */
  remaining: number;
  /** Este cupo aparta plazas del inventario general. */
  holds: boolean;
  /** Se puede vender con él. */
  sellable: boolean;
  /** Cada venta necesita confirmación. */
  needsConfirmation: boolean;
}

/**
 * El estado de un cupo.
 *
 * Las plazas LIBERADAS ya no son suyas: volvieron a la venta libre, así que
 * restan de lo que le queda. Contarlas como disponibles sería prometerle dos
 * veces la misma plaza —una al socio y otra a quien la compró después—.
 */
export function allotmentState(allotment: AllotmentRow | null): AllotmentState {
  if (!allotment) {
    // Sin cupo, el socio vende contra la capacidad general. Es el caso normal
    // de una agencia sin contrato de plazas.
    return {
      allotmentId: null, type: "free_sale", seats: 0, used: 0, released: 0,
      remaining: Infinity, holds: false, sellable: true, needsConfirmation: false,
    };
  }
  const type = (allotment.allotment_type || "free_sale") as AllotmentType;
  const seats = int(allotment.seats);
  const used = int(allotment.seats_used);
  const released = int(allotment.seats_released);
  const holds = HOLDS_SEATS.has(type);

  return {
    allotmentId: (allotment._id ?? allotment.id ?? null) as string | null,
    type,
    seats,
    used,
    released,
    // Solo el cupo garantizado tiene tope propio; los demás venden contra la
    // capacidad de la salida.
    remaining: holds ? Math.max(0, seats - used - released) : Infinity,
    holds,
    sellable: SELLABLE.has(type),
    needsConfirmation: type === "on_request",
  };
}

export type SaleBlock = "closed" | "no_seats";

export const SALE_BLOCK_MESSAGE: Record<SaleBlock, string> = {
  closed: "Este socio tiene el cupo cerrado para esta salida.",
  no_seats: "El socio ya agotó su cupo para esta salida.",
};

/**
 * ¿Puede este socio vender estas plazas?
 *
 * Devuelve el motivo o `null`. No mira la capacidad de la salida —de eso se
 * encarga `assertCapacity`—: aquí solo se decide lo que el CONTRATO permite.
 */
export function saleBlocker(state: AllotmentState, pax: number): SaleBlock | null {
  if (!state.sellable) return "closed";
  if (state.holds && int(pax) > state.remaining) return "no_seats";
  return null;
}

/* ═══════════════════════════════════════════════ la liberación automática */

export interface ReleaseCandidate {
  allotment: AllotmentRow;
  departureAt: string;
}

/** Días de calendario entre dos fechas, ignorando la hora. */
export function calendarDaysUntil(departureAt: string, now: Date): number {
  const departs = new Date(String(departureAt).slice(0, 10) + "T00:00:00Z").getTime();
  const today = Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(departs) || Number.isNaN(today)) return NaN;
  return Math.round((departs - today) / 86_400_000);
}

/**
 * ¿Toca liberar ya lo que este socio no vendió?
 *
 * Se libera cuando faltan `release_days` DÍAS DE CALENDARIO o menos para la
 * salida. La cuenta es por días y no por horas a propósito: el contrato dice
 * «te las guardo hasta tres días antes», y eso significa una fecha, no un
 * instante.
 *
 * Medirlo en instantes tiene una consecuencia que no se ve hasta que pasa: con
 * `release_days: 0` —«libéralas el día de la salida»— las plazas no se
 * liberarían hasta que el autobús ya hubiera arrancado, que es exactamente
 * cuando ya no sirven para nada.
 *
 * Sin `release_days` no se libera nunca: es un cupo en firme hasta el final, y
 * hay contratos así.
 */
export function shouldRelease(
  allotment: AllotmentRow,
  departureAt: string,
  now: Date = new Date()
): boolean {
  const type = (allotment.allotment_type || "free_sale") as AllotmentType;
  if (!HOLDS_SEATS.has(type)) return false;

  const days = allotment.release_days;
  if (days === null || days === undefined) return false;
  const window = Math.max(0, Math.floor(num(days)));

  const left = calendarDaysUntil(departureAt, now);
  if (Number.isNaN(left)) return false;

  return left <= window;
}

/**
 * Cuántas plazas se liberan: las contratadas que no se vendieron.
 *
 * Nunca se libera lo ya vendido —esas reservas existen y el socio las pagó— ni
 * se libera dos veces lo que ya se liberó.
 */
export function releasableSeats(allotment: AllotmentRow): number {
  const seats = int(allotment.seats);
  const used = int(allotment.seats_used);
  const released = int(allotment.seats_released);
  return Math.max(0, seats - used - released);
}

/* ═══════════════════════════════════════════════════ la matriz de la pantalla */

export interface MatrixCell {
  date: string;
  seats: number;
  used: number;
  released: number;
  remaining: number;
  type: AllotmentType;
  allotmentId: string | null;
}

/**
 * El cupo de un socio día a día, que es como se mira un contrato de plazas.
 *
 * Una lista de filas no responde a la pregunta que se hace el comercial —«¿qué
 * le queda a esta agencia la semana que viene?»—: eso se ve en una rejilla.
 */
export function allotmentMatrix(
  allotments: AllotmentRow[],
  partnerId: string,
  dates: string[],
  productId?: string | null
): MatrixCell[] {
  return dates.map((date) => {
    const pick = pickAllotment(allotments, { partnerId, productId, travelDate: date });
    const state = allotmentState(pick);
    return {
      date,
      seats: state.seats,
      used: state.used,
      released: state.released,
      remaining: Number.isFinite(state.remaining) ? state.remaining : -1,
      type: state.type,
      allotmentId: state.allotmentId,
    };
  });
}
