/**
 * COMBOS: ARMAR EL ITINERARIO DE UN PAQUETE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 *
 * «Saona + Buggy + Hoyo Azul, tres días, 180 dólares» es el producto que más
 * margen deja y el que una operadora pone en la portada. Venderlo bien no es
 * cobrar 180: es encontrar, para cada actividad, UNA SALIDA REAL con plazas que
 * no choque con las otras — porque el autobús de Saona sale a las 7:00 y vuelve
 * a las 18:00, y el buggy de ese mismo día no existe.
 *
 * Hacerlo a mano en el mostrador, con un cliente delante, es cómo se venden
 * paquetes que después hay que deshacer.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE MOTOR HACE, Y LO QUE NO
 *
 * HACE: validar un itinerario propuesto, resolver uno automáticamente,
 * proponer alternativas y decir POR QUÉ no se puede cuando no se puede.
 *
 * NO HACE: inventar salidas. Solo elige entre las que la operadora ya tiene
 * programadas, con las plazas que de verdad quedan. Un motor que «encuentra»
 * una salida que no existe es un motor que vende algo que no se puede operar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MARGEN ENTRE ACTIVIDADES NO ES UN DETALLE
 *
 * Dos actividades que no se solapan por un minuto no forman un itinerario: hay
 * que llegar de una a otra. El margen lo declara la operadora en el paquete
 * (`bundle_buffer_minutes`), porque depende de la zona: media hora en Bávaro,
 * dos horas si hay que cruzar a Samaná.
 *
 * Todo lo de aquí es puro. Quien lee la base y escribe es `bundle-service.ts`.
 */

/** Minutos desde medianoche de una hora 'HH:MM'. */
export function minutesOfDay(time: string | null | undefined): number | null {
  if (typeof time !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(time.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 'HH:MM' desde minutos, dando la vuelta al día si hace falta. */
export function hhmm(minutes: number): string {
  const norm = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, "0")}:${String(norm % 60).padStart(2, "0")}`;
}

/** El día local de un instante, en la zona que se le pase. */
export function dayOf(at: string | Date, timeZone?: string): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  if (!timeZone) return d.toISOString().slice(0, 10);
  // `en-CA` da 'YYYY-MM-DD', que es el único formato que se puede comparar
  // como texto sin volver a parsear.
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Suma días a una fecha 'YYYY-MM-DD' sin tocar husos horarios. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return day;
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

// ── Lo que compone un paquete ───────────────────────────────────────────────

export interface BundleItem {
  id: string;
  productId: string;
  productName: string;
  modalityId?: string | null;
  /** Qué día del paquete: 0 = el primero. */
  dayOffset: number;
  sortOrder: number;
  /** Hora pactada, cuando el paquete la fija. */
  fixedTime?: string | null;
  allowOverlap?: boolean;
  isOptional?: boolean;
  /** Cuánto dura, en minutos. Sin dato, se asume media jornada. */
  durationMin?: number | null;
}

/**
 * Cuánto dura una actividad cuando el catálogo no lo dice.
 *
 * Cuatro horas y no dos: una excursión típica de una operadora dominicana es de
 * medio día, y quedarse corto produce itinerarios que parecen válidos y no lo
 * son — que es peor que rechazar uno bueno, porque el que se rechaza se ve.
 */
export const DEFAULT_DURATION_MIN = 240;

export function durationOf(item: BundleItem): number {
  const d = Number(item.durationMin ?? 0);
  return Number.isFinite(d) && d > 0 ? Math.round(d) : DEFAULT_DURATION_MIN;
}

// ── Las salidas candidatas ──────────────────────────────────────────────────

export interface Slot {
  departureId: string;
  productId: string;
  /** Instante de salida, ISO. */
  at: string;
  /** Plazas libres. `null` = sin aforo declarado, o sea sin techo. */
  seatsLeft: number | null;
  /** Hora local en la zona de la empresa, ya resuelta por quien leyó la base. */
  localDay: string;
  localTime: string;
}

export function slotFits(slot: Slot, pax: number): boolean {
  return slot.seatsLeft === null || slot.seatsLeft >= pax;
}

// ── Un bloque del itinerario ────────────────────────────────────────────────

export interface Block {
  itemId: string;
  productId: string;
  productName: string;
  departureId: string;
  at: string;
  day: string;
  /** Minutos desde medianoche. */
  start: number;
  end: number;
  durationMin: number;
  allowOverlap: boolean;
  seatsLeft: number | null;
}

export function blockOf(item: BundleItem, slot: Slot): Block {
  const start = minutesOfDay(slot.localTime) ?? 0;
  const duration = durationOf(item);
  return {
    itemId: item.id,
    productId: item.productId,
    productName: item.productName,
    departureId: slot.departureId,
    at: slot.at,
    day: slot.localDay,
    start,
    end: start + duration,
    durationMin: duration,
    allowOverlap: item.allowOverlap === true,
    seatsLeft: slot.seatsLeft,
  };
}

/**
 * ¿Chocan estos dos bloques?
 *
 * Solo pueden chocar el mismo día, y no chocan si CUALQUIERA de los dos admite
 * solaparse: un pase de día a un parque no compite con una excursión de dos
 * horas dentro de ese mismo parque.
 *
 * El margen cuenta como parte del choque: salir de un sitio a las 12:00 y
 * entrar en otro a las 12:05 no es un itinerario, es un deseo.
 */
export function clash(a: Block, b: Block, bufferMin: number): boolean {
  if (a.day !== b.day) return false;
  if (a.allowOverlap || b.allowOverlap) return false;
  const buffer = Math.max(0, bufferMin);
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  return second.start < first.end + buffer;
}

export interface Conflict {
  itemA: string;
  itemB: string;
  message: string;
}

/** Los choques de un itinerario, dichos como se los explicaría a un cliente. */
export function conflictsIn(blocks: Block[], bufferMin: number): Conflict[] {
  const sorted = [...blocks].sort((x, y) => (x.day === y.day ? x.start - y.start : x.day < y.day ? -1 : 1));
  const out: Conflict[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!clash(a, b, bufferMin)) continue;
    out.push({
      itemA: a.itemId,
      itemB: b.itemId,
      message:
        `«${a.productName}» termina a las ${hhmm(a.end)} y «${b.productName}» sale a las ${hhmm(b.start)} ` +
        `el ${b.day}. Con ${bufferMin} minutos de margen no da tiempo.`,
    });
  }
  return out;
}

export interface ItineraryResult {
  ok: boolean;
  blocks: Block[];
  conflicts: Conflict[];
  /** Componentes para los que no había ninguna salida servible. */
  unresolved: { itemId: string; productName: string; reason: string }[];
}

/** Valida un itinerario ya elegido, sin tocar nada. */
export function validateItinerary(blocks: Block[], bufferMin: number): ItineraryResult {
  const conflicts = conflictsIn(blocks, bufferMin);
  return { ok: conflicts.length === 0, blocks, conflicts, unresolved: [] };
}

// ── Resolver automáticamente ────────────────────────────────────────────────

export interface ResolveOptions {
  /** El día en que empieza el paquete, 'YYYY-MM-DD'. */
  startDay: string;
  pax: number;
  bufferMin: number;
  /** Cuántas salidas se consideran por actividad. Más no mejora y sí tarda. */
  candidatesPerItem?: number;
  /** Tope de combinaciones exploradas: un mostrador no espera. */
  maxCombinations?: number;
  /** Incluir los componentes opcionales. Por defecto sí. */
  includeOptional?: boolean;
}

export const DEFAULT_CANDIDATES = 6;
export const DEFAULT_MAX_COMBINATIONS = 20_000;

/**
 * Las salidas que sirven para un componente, ya filtradas y ordenadas.
 *
 * Tiene que ser del producto correcto, del día que le toca al componente, con
 * plazas para todo el grupo y —si el paquete fija la hora— a esa hora exacta.
 */
export function candidatesFor(
  item: BundleItem,
  slots: Slot[],
  options: ResolveOptions
): Slot[] {
  const day = addDays(options.startDay, Math.max(0, item.dayOffset));
  const fixed = minutesOfDay(item.fixedTime);

  return slots
    .filter((s) => s.productId === item.productId)
    .filter((s) => s.localDay === day)
    .filter((s) => slotFits(s, options.pax))
    .filter((s) => fixed === null || minutesOfDay(s.localTime) === fixed)
    .sort((a, b) => (minutesOfDay(a.localTime) ?? 0) - (minutesOfDay(b.localTime) ?? 0))
    .slice(0, Math.max(1, options.candidatesPerItem ?? DEFAULT_CANDIDATES));
}

/** Por qué un componente se quedó sin salidas: el mensaje decide qué se arregla. */
function whyNoCandidates(item: BundleItem, slots: Slot[], options: ResolveOptions): string {
  const day = addDays(options.startDay, Math.max(0, item.dayOffset));
  const sameProduct = slots.filter((s) => s.productId === item.productId);
  if (sameProduct.length === 0) return `«${item.productName}» no tiene ninguna salida programada.`;

  const sameDay = sameProduct.filter((s) => s.localDay === day);
  if (sameDay.length === 0) return `«${item.productName}» no sale el ${day}.`;

  const fixed = minutesOfDay(item.fixedTime);
  if (fixed !== null && !sameDay.some((s) => minutesOfDay(s.localTime) === fixed)) {
    return `«${item.productName}» no sale a las ${item.fixedTime} el ${day}.`;
  }
  // Quedan salidas ese día pero ninguna con plazas: es lo único que se arregla
  // vendiendo otro día, y decirlo así ahorra la llamada.
  const best = Math.max(...sameDay.map((s) => s.seatsLeft ?? Number.POSITIVE_INFINITY));
  return `«${item.productName}» sale el ${day} pero no quedan ${options.pax} plazas juntas (libres: ${Number.isFinite(best) ? best : "sin límite"}).`;
}

interface Combination {
  blocks: Block[];
  /** A qué hora termina el último día: se prefiere terminar pronto. */
  finish: number;
  /** Huecos muertos entre actividades, en minutos: menos es mejor itinerario. */
  idle: number;
}

function score(a: Combination, b: Combination): number {
  // Primero el que deja menos tiempo muerto —un paquete con cuatro horas de
  // espera entre actividades se vende mal aunque «quepa»—, y a igualdad el que
  // termina antes.
  if (a.idle !== b.idle) return a.idle - b.idle;
  return a.finish - b.finish;
}

function measure(blocks: Block[]): Combination {
  const byDay = new Map<string, Block[]>();
  for (const b of blocks) {
    const list = byDay.get(b.day) ?? [];
    list.push(b);
    byDay.set(b.day, list);
  }

  let idle = 0;
  let finish = 0;
  for (const list of byDay.values()) {
    const sorted = [...list].sort((x, y) => x.start - y.start);
    for (let i = 0; i < sorted.length - 1; i++) {
      idle += Math.max(0, sorted[i + 1].start - sorted[i].end);
    }
    finish = Math.max(finish, sorted[sorted.length - 1]?.end ?? 0);
  }
  return { blocks, finish, idle };
}

export interface AutoResolveResult extends ItineraryResult {
  /** Otras combinaciones válidas, de la mejor a la peor. */
  alternatives: Block[][];
  /** Si se llegó al tope de exploración: la respuesta es buena, no exhaustiva. */
  truncated: boolean;
}

/**
 * Encuentra el mejor itinerario posible, y hasta `keepAlternatives` alternativas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE EXPLORA Y NO SE ELIGE LO PRIMERO QUE ENCAJA
 *
 * Un algoritmo voraz —coge la salida más temprana de cada actividad y sigue—
 * falla en el caso más común: Saona a las 7:00 ocupa todo el día, así que si se
 * coge primero, el buggy de ese día ya no cabe. La respuesta correcta suele ser
 * mover Saona al día siguiente, y eso un voraz no lo encuentra nunca.
 *
 * Con un tope de combinaciones: un mostrador con un cliente delante no espera, y
 * un paquete de seis actividades con seis salidas cada una son 46.656 caminos.
 * Al llegar al tope se devuelve lo mejor encontrado y se DICE que la respuesta
 * no es exhaustiva, en vez de fingir que sí.
 */
export function autoResolve(
  items: BundleItem[],
  slots: Slot[],
  options: ResolveOptions,
  keepAlternatives = 3
): AutoResolveResult {
  const wanted = items
    .filter((i) => options.includeOptional === false ? !i.isOptional : true)
    .sort((a, b) => a.dayOffset - b.dayOffset || a.sortOrder - b.sortOrder);

  const unresolved: AutoResolveResult["unresolved"] = [];
  const pools: { item: BundleItem; slots: Slot[] }[] = [];

  for (const item of wanted) {
    const candidates = candidatesFor(item, slots, options);
    if (candidates.length === 0) {
      // Un componente OPCIONAL sin salida no rompe el paquete: se queda fuera y
      // se dice. Uno obligatorio sí, y eso lo decide `blocking` más abajo.
      unresolved.push({
        itemId: item.id,
        productName: item.productName,
        reason: whyNoCandidates(item, slots, options),
      });
      continue;
    }
    pools.push({ item, slots: candidates });
  }

  const blocking = unresolved.filter((u) => !wanted.find((i) => i.id === u.itemId)?.isOptional);
  if (pools.length === 0 || blocking.length > 0) {
    return { ok: false, blocks: [], conflicts: [], unresolved, alternatives: [], truncated: false };
  }

  const maxCombinations = options.maxCombinations ?? DEFAULT_MAX_COMBINATIONS;
  const found: Combination[] = [];
  let explored = 0;
  let truncated = false;

  const walk = (index: number, chosen: Block[]) => {
    if (truncated) return;
    if (index === pools.length) {
      found.push(measure(chosen));
      return;
    }
    for (const slot of pools[index].slots) {
      if (++explored > maxCombinations) { truncated = true; return; }
      const block = blockOf(pools[index].item, slot);
      // Se poda AQUÍ y no al final: descartar un camino en cuanto choca es lo
      // que hace que esto termine en un paquete de seis actividades.
      if (chosen.some((b) => clash(b, block, options.bufferMin))) continue;
      walk(index + 1, [...chosen, block]);
      if (truncated) return;
    }
  };

  walk(0, []);

  if (found.length === 0) {
    /**
     * Hay salidas para todo pero ninguna combinación encaja.
     *
     * Se devuelve el itinerario más temprano de cada componente —el que el
     * mostrador habría armado a mano— con sus choques explicados, porque
     * decirle a alguien «no se puede» sin enseñarle qué choca no le deja
     * arreglarlo.
     */
    const naive = pools.map((p) => blockOf(p.item, p.slots[0]));
    return {
      ok: false,
      blocks: naive,
      conflicts: conflictsIn(naive, options.bufferMin),
      unresolved,
      alternatives: [],
      truncated,
    };
  }

  found.sort(score);
  return {
    ok: true,
    blocks: found[0].blocks,
    conflicts: [],
    unresolved,
    alternatives: found.slice(1, 1 + Math.max(0, keepAlternatives)).map((c) => c.blocks),
    truncated,
  };
}

// ── El resumen que ve una persona ───────────────────────────────────────────

export interface ItineraryDay {
  day: string;
  blocks: Block[];
}

/** El itinerario agrupado por día, para el voucher y para la pantalla. */
export function byDay(blocks: Block[]): ItineraryDay[] {
  const map = new Map<string, Block[]>();
  for (const b of blocks) {
    const list = map.get(b.day) ?? [];
    list.push(b);
    map.set(b.day, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, list]) => ({ day, blocks: [...list].sort((x, y) => x.start - y.start) }));
}

/** Cuántos días ocupa el paquete de verdad, según lo que se resolvió. */
export function spanDays(blocks: Block[]): number {
  return new Set(blocks.map((b) => b.day)).size;
}

/**
 * Las plazas más ajustadas del itinerario.
 *
 * Es el número que decide si el paquete se puede vender a un grupo: de nada
 * sirve que dos actividades tengan 40 plazas si la tercera tiene 3.
 */
export function tightestSeats(blocks: Block[]): number | null {
  const declared = blocks.map((b) => b.seatsLeft).filter((s): s is number => s !== null);
  return declared.length === 0 ? null : Math.min(...declared);
}

/** El primer instante del paquete: es la fecha de viaje de la cabecera. */
export function startsAt(blocks: Block[]): string | null {
  if (blocks.length === 0) return null;
  return [...blocks].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())[0].at;
}

/**
 * Qué falta para poder vender este paquete.
 *
 * Devuelve el motivo en la voz en que hay que decírselo al cliente, o `null`
 * cuando se puede vender.
 */
export function sellBlocker(result: AutoResolveResult, pax: number): string | null {
  if (result.unresolved.length > 0) {
    return result.unresolved.map((u) => u.reason).join(" ");
  }
  if (!result.ok) {
    if (result.conflicts.length > 0) return result.conflicts[0].message;
    return "No hay ninguna combinación de salidas que encaje en esas fechas.";
  }
  const seats = tightestSeats(result.blocks);
  if (seats !== null && seats < pax) {
    return `Solo quedan ${seats} plazas en la actividad más ajustada del paquete.`;
  }
  return null;
}
