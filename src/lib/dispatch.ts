/**
 * El despacho del día — quién sale, en qué, y con quién choca.
 *
 * Hasta ahora esto vivía entero dentro de una ruta HTTP, sin una sola prueba, y
 * tenía dos defectos que la operación paga todos los días:
 *
 *  · **El conflicto no miraba la hora.** Se contaban los usos de cada vehículo
 *    y de cada persona POR DÍA: dos salidas el mismo día eran un conflicto. Una
 *    guagua que hace el tour de las 8 y el de las 2 es una operación normal y
 *    salía marcada en rojo todas las mañanas. Una alarma que miente a diario se
 *    acaba ignorando, y el día que el choque es de verdad tampoco se mira.
 *
 *  · **El vehículo no se bloqueaba nunca.** Al guía con la licencia vencida se
 *    le impide salir desde la ola 5. A la guagua con el seguro vencido se le
 *    pintaba la fecha en rojo en otra pantalla y salía igual. En la República
 *    Dominicana, mover turistas sin seguro ni inspección vigentes no es un
 *    descuido administrativo: es la responsabilidad de la empresa el día que
 *    pase algo.
 *
 * Es puro a propósito: no toca la base, no lee la sesión. Las reglas de quién
 * puede salir hay que poder probarlas de una en una.
 */

import { dayOf, daysBetween } from "@/lib/hr";
import { instantAtWallTime, wallTimeOf } from "@/lib/time";

/* ════════════════════════════════════════════ 1 · cuándo ocupa un recurso ══ */

/**
 * Lo que dura una salida cuando el producto no lo dice.
 *
 * Ocho horas es la excursión de día completo, que es la forma normal del
 * producto en esta operación. Suponer menos partiría en dos salidas que en la
 * realidad se pisan, y el conflicto que hay que ver desaparecería.
 */
export const DEFAULT_DURATION_HOURS = 8;

export interface Window {
  /** Instante de inicio, en milisegundos. */
  start: number;
  /** Instante de fin, en milisegundos. */
  end: number;
}

export interface DepartureLike {
  _id?: string | null;
  id?: string | null;
  departure_at?: string | null;
  product?: unknown;
  duration_hours?: number | null;
}

/** Las horas que dura la salida: las del producto, o el respaldo. */
export function durationHours(departure: DepartureLike): number {
  const own = Number(departure.duration_hours);
  if (Number.isFinite(own) && own > 0) return own;

  const product = departure.product;
  if (product && typeof product === "object") {
    const fromProduct = Number((product as { duration_hours?: unknown }).duration_hours);
    if (Number.isFinite(fromProduct) && fromProduct > 0) return fromProduct;
  }
  return DEFAULT_DURATION_HOURS;
}

/** La ventana que ocupa la salida entera, o `null` si no tiene hora válida. */
export function departureWindow(departure: DepartureLike): Window | null {
  const start = Date.parse(String(departure.departure_at ?? ""));
  if (!Number.isFinite(start)) return null;
  return { start, end: start + durationHours(departure) * 3_600_000 };
}

export interface ResourceLike {
  _id?: string | null;
  id?: string | null;
  resource_role?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  status?: string | null;
  vehicle?: unknown;
  staff?: unknown;
}

/**
 * La ventana que ocupa un recurso concreto.
 *
 * Si el despacho le puso horas propias («el fotógrafo solo la primera hora»),
 * mandan esas. Si no, ocupa la salida entera, que es lo que de verdad pasa con
 * la guagua y el guía.
 *
 * Una hora de fin anterior a la de inicio se ignora en vez de producir una
 * ventana invertida: invertida no solaparía con nada y el recurso desaparecería
 * silenciosamente de la detección de choques.
 */
export function resourceWindow(
  resource: ResourceLike,
  departure: Window,
  timeZone: string
): Window {
  const reference = new Date(departure.start);
  const start = resource.start_time ? instantAtWallTime(reference, timeZone, resource.start_time) : null;
  const end = resource.end_time ? instantAtWallTime(reference, timeZone, resource.end_time) : null;

  const from = start ? start.getTime() : departure.start;
  const to = end ? end.getTime() : departure.end;

  if (to <= from) return departure;
  return { start: from, end: to };
}

/**
 * ¿Se pisan dos ventanas?
 *
 * Tocarse en el borde no es pisarse: una guagua que vuelve a las 14:00 y sale
 * de nuevo a las 14:00 es el relevo ajustado de siempre, no un choque. Es el
 * mismo criterio que usan los turnos en `hr.ts`; que las dos partes del sistema
 * respondan lo mismo a la misma pregunta importa más que cuál de los dos
 * criterios se elija.
 */
export function windowsOverlap(a: Window, b: Window): boolean {
  return a.start < b.end && b.start < a.end;
}

/* ══════════════════════════════════════════════════ 2 · choques de verdad ══ */

export type ResourceKind = "staff" | "vehicle";

export interface ResourceUse {
  kind: ResourceKind;
  resourceId: string;
  resourceName: string;
  departureId: string;
  /** Cómo se nombra esa salida en pantalla: «Isla Saona 08:00». */
  departureLabel: string;
  window: Window;
}

export interface DispatchConflict {
  kind: ResourceKind;
  resourceId: string;
  resourceName: string;
  /** Qué choca con qué, en palabras que el despacho entiende. */
  message: string;
  /** Las salidas implicadas, para poder marcarlas. */
  departureIds: string[];
}

/** Estados en los que una asignación ya no ocupa el recurso. */
const DEAD_ASSIGNMENT = new Set(["cancelled"]);

/** ¿Esta asignación sigue ocupando al recurso? */
export function assignmentIsLive(resource: ResourceLike): boolean {
  return !DEAD_ASSIGNMENT.has(String(resource.status || "").toLowerCase());
}

/**
 * Los choques reales del día: el mismo recurso en dos salidas que se pisan.
 *
 * Lo que NO es un choque, y antes lo era:
 *
 *  · dos salidas el mismo día que no se solapan —el caso normal de la mañana y
 *    la tarde—;
 *  · el mismo recurso repetido dentro de UNA salida, que es una fila duplicada
 *    en la ficha, no un problema de agenda.
 *
 * Se devuelve un choque por recurso, no uno por pareja: un vehículo metido en
 * cuatro salidas que se pisan produciría seis avisos diciendo lo mismo.
 */
export function resourceConflicts(uses: ResourceUse[]): DispatchConflict[] {
  const byResource = new Map<string, ResourceUse[]>();
  for (const use of uses) {
    if (!use.resourceId) continue;
    const key = `${use.kind}:${use.resourceId}`;
    byResource.set(key, [...(byResource.get(key) || []), use]);
  }

  const conflicts: DispatchConflict[] = [];

  for (const group of byResource.values()) {
    const ordered = [...group].sort((a, b) => a.window.start - b.window.start);

    // Indexado por SALIDA, y ahí está la mitad del trabajo: el mismo recurso
    // repetido dentro de una salida —dos filas para la misma guagua en la misma
    // ficha— cae en la misma clave, el conjunto se queda en uno y no hay
    // choque. Que es lo correcto: eso es una fila duplicada, no un problema de
    // agenda, y avisarlo mandaría al despacho a buscar un conflicto que no
    // existe.
    const choque = new Map<string, ResourceUse>();

    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i];
        const b = ordered[j];
        // Ordenadas por inicio: en cuanto una empieza después de que la
        // anterior acabe, ninguna posterior puede pisarla.
        if (b.window.start >= a.window.end) break;
        if (!windowsOverlap(a.window, b.window)) continue;
        choque.set(a.departureId, a);
        choque.set(b.departureId, b);
      }
    }

    if (choque.size < 2) continue;

    const implicadas = [...choque.values()].sort((a, b) => a.window.start - b.window.start);
    const first = implicadas[0];
    conflicts.push({
      kind: first.kind,
      resourceId: first.resourceId,
      resourceName: first.resourceName,
      message:
        `${first.resourceName} está en ${implicadas.length} salidas que se pisan: ` +
        implicadas.map((u) => u.departureLabel).join(" y "),
      departureIds: implicadas.map((u) => u.departureId),
    });
  }

  return conflicts.sort((a, b) => a.resourceName.localeCompare(b.resourceName, "es"));
}

/* ═══════════════════════════════════════ 3 · el vehículo que no puede salir ══ */

/**
 * Treinta días, los mismos que para las certificaciones del personal.
 *
 * Renovar un seguro o pasar la inspección tampoco es trámite de un día, y que
 * el número sea el mismo evita que la operación tenga que recordar dos reglas
 * distintas para la misma idea.
 */
export const VEHICLE_DOC_WARNING_DAYS = 30;

export interface VehicleLike {
  _id?: string | null;
  id?: string | null;
  name?: string | null;
  plate?: string | null;
  capacity?: number | null;
  status?: string | null;
  insurance_expiry?: string | null;
  inspection_expiry?: string | null;
}

export interface VehicleBlock {
  /** Por qué no puede salir, en palabras que el despacho entiende. */
  reason: string;
  kind: "status" | "insurance" | "inspection";
}

/** Cómo se nombra el vehículo cuando hay que hablar de él. */
export function vehicleLabel(vehicle: VehicleLike): string {
  const name = String(vehicle.name || "").trim();
  const plate = String(vehicle.plate || "").trim();
  if (name && plate) return `${name} (${plate})`;
  return name || plate || "Vehículo";
}

/** Estados del vehículo en los que no se le puede dar servicio. */
const UNAVAILABLE_VEHICLE = new Set(["maintenance", "out_of_service"]);

/**
 * El veredicto de asignación de un vehículo, gemelo de `assignmentBlock` para
 * las personas: devuelve `null` cuando puede salir, y si no, el motivo.
 *
 * Bloquea el papel VENCIDO, nunca el que está por vencer. Bloquear por «vence
 * en tres semanas» dejaría a la operadora sin flota un lunes cualquiera y el
 * sistema se volvería el enemigo; para eso está el aviso.
 *
 * El día del vencimiento todavía vale, igual que en las certificaciones: una
 * póliza que dice «vence el 30» cubre el 30.
 */
export function vehicleBlock(vehicle: VehicleLike, today: string): VehicleBlock | null {
  const status = String(vehicle.status || "").toLowerCase();
  if (UNAVAILABLE_VEHICLE.has(status)) {
    return {
      kind: "status",
      reason:
        status === "maintenance"
          ? `${vehicleLabel(vehicle)} está en mantenimiento.`
          : `${vehicleLabel(vehicle)} está fuera de servicio.`,
    };
  }

  const seguro = dayOf(vehicle.insurance_expiry);
  if (seguro && daysBetween(today, seguro) < 0) {
    return { kind: "insurance", reason: `${vehicleLabel(vehicle)} tiene el seguro vencido (${seguro}).` };
  }

  const inspeccion = dayOf(vehicle.inspection_expiry);
  if (inspeccion && daysBetween(today, inspeccion) < 0) {
    return { kind: "inspection", reason: `${vehicleLabel(vehicle)} tiene la inspección vencida (${inspeccion}).` };
  }

  return null;
}

/** Los papeles que hay que renovar ya: vencidos o a punto de vencer. */
export function vehicleWarnings(vehicle: VehicleLike, today: string): string[] {
  const avisos: string[] = [];
  const mirar = (fecha: string | null | undefined, que: string) => {
    const dia = dayOf(fecha);
    if (!dia) return;
    const quedan = daysBetween(today, dia);
    if (quedan < 0) avisos.push(`${que} vencido el ${dia}`);
    else if (quedan <= VEHICLE_DOC_WARNING_DAYS) {
      avisos.push(quedan === 0 ? `${que} vence hoy` : `${que} vence en ${quedan} días`);
    }
  };
  mirar(vehicle.insurance_expiry, "Seguro");
  mirar(vehicle.inspection_expiry, "Inspección");
  return avisos;
}

/* ═════════════════════════════════════════════ 4 · la hora de la recogida ══ */

export interface HotelLike {
  _id?: string | null;
  id?: string | null;
  name?: string | null;
  pickup_point?: string | null;
  pickup_offset_min?: number | null;
  zone?: unknown;
}

export interface ZoneLike {
  _id?: string | null;
  id?: string | null;
  name?: string | null;
  pickup_offset_min?: number | null;
}

/**
 * Los minutos de antelación con que pasa el transporte por ese hotel.
 *
 * El hotel manda sobre su zona: la zona es el valor por defecto que hace
 * utilizable el campo cuando hay doscientos hoteles cargados, no una regla que
 * pise lo que alguien afinó para un hotel concreto.
 *
 * Devuelve `null` cuando no hay ninguno de los dos. Un cero fabricado sería
 * peor que nada: diría «recógelo a la hora exacta de la salida», que es una
 * hora falsa, y nadie la revisaría porque parece un dato.
 */
export function pickupOffsetMin(
  hotel: HotelLike | null | undefined,
  zone: ZoneLike | null | undefined
): number | null {
  const propio = Number(hotel?.pickup_offset_min);
  if (Number.isFinite(propio) && propio >= 0) return propio;

  const deZona = Number(zone?.pickup_offset_min);
  if (Number.isFinite(deZona) && deZona >= 0) return deZona;

  return null;
}

/**
 * La hora «HH:MM» a la que hay que pasar, en la zona horaria de la empresa.
 *
 * Se calcula en la zona de la empresa y no en UTC: una salida a las 08:00 de
 * Santo Domingo son las 12:00 UTC, y un `toISOString()` le diría al conductor
 * que pase a las 11:00 por un hotel al que tiene que llegar a las 07:00.
 */
export function plannedPickupTime(
  departureAt: string | Date | null | undefined,
  offsetMin: number | null,
  timeZone: string
): string | null {
  if (offsetMin === null || !Number.isFinite(offsetMin)) return null;
  const salida = departureAt instanceof Date ? departureAt : new Date(String(departureAt ?? ""));
  if (Number.isNaN(salida.getTime())) return null;
  return wallTimeOf(new Date(salida.getTime() - offsetMin * 60_000), timeZone);
}

/**
 * La diferencia entre lo prometido al cliente y lo que calcula el motor.
 *
 * Devuelve `null` cuando no hay nada que decir: o coinciden, o todavía no se
 * ha prometido nada. Cuando difieren NO se corrige sola —el cliente tiene un
 * voucher impreso con la hora vieja— sino que se avisa para que el despacho
 * decida si mueve al cliente o respeta lo pactado.
 */
export function pickupDiscrepancy(
  promised: string | null | undefined,
  planned: string | null | undefined
): string | null {
  const p = String(promised || "").trim().slice(0, 5);
  const c = String(planned || "").trim().slice(0, 5);
  if (!p || !c || p === c) return null;
  return `El cliente tiene prometidas las ${p} y al transporte le tocaría pasar a las ${c}.`;
}
