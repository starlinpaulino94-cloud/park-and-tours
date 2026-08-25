/**
 * Lógica temporal centralizada (zona horaria de la empresa).
 *
 * Todo cálculo de "hoy", "vencida" y "próxima" debe pasar por aquí. El proceso
 * de Node corre en UTC en Vercel, así que usar la hora local del servidor
 * desplazaría el corte del día cuatro horas en República Dominicana: a las
 * 20:00 hora local el servidor ya estaría contando el día siguiente.
 *
 * Módulo puro (solo `Intl`), sin acceso a red ni a base de datos, para poder
 * probarlo con el proceso fijado en UTC.
 */

export const DEFAULT_TIME_ZONE = "America/Santo_Domingo";

const formatters = new Map<string, Intl.DateTimeFormat>();
const validity = new Map<string, boolean>();

/** true si `Intl` reconoce la zona; el resultado se memoiza. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  const cached = validity.get(tz);
  if (cached !== undefined) return cached;
  let okay = true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    okay = false;
  }
  validity.set(tz, okay);
  return okay;
}

/**
 * Zona horaria efectiva de la empresa: la configurada, si no la del entorno, y
 * como último recurso República Dominicana. Una zona inválida no lanza: avisa y
 * cae al respaldo, porque `organizations.timezone` es texto libre.
 */
export function companyTimeZone(company?: { timezone?: string | null } | null): string {
  const configured = company?.timezone?.trim();
  if (configured) {
    if (isValidTimeZone(configured)) return configured;
    console.warn(`[time] zona horaria inválida en la empresa: "${configured}" — se usa ${DEFAULT_TIME_ZONE}`);
  }
  const fromEnv = process.env.DEFAULT_TIMEZONE?.trim();
  if (fromEnv && isValidTimeZone(fromEnv)) return fromEnv;
  return DEFAULT_TIME_ZONE;
}

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
}

/** Descompone un instante en los componentes de calendario de la zona dada. */
export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = formatterFor(tz).formatToParts(date);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = read("hour");
  return {
    year: read("year"), month: read("month"), day: read("day"),
    // Algunos motores emiten "24" para la medianoche con hour12:false.
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"), second: read("second"),
  };
}

/** Desfase de la zona respecto a UTC en el instante dado (positivo al este). */
export function zoneOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // El instante se trunca a segundos porque `Date.UTC` no lleva milisegundos.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convierte una hora de pared de la zona al instante UTC correspondiente. */
function wallClockToInstant(p: ZonedParts, tz: string, reference: Date): Date {
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Primera aproximación con el desfase del instante de referencia; se refina
  // una vez porque en un cambio de horario de verano el desfase de la medianoche
  // puede diferir del actual.
  const first = new Date(wall - zoneOffsetMs(reference, tz));
  return new Date(wall - zoneOffsetMs(first, tz));
}

export interface DayBounds {
  /** Primer instante del día en la zona de la empresa. */
  start: Date;
  /** Último instante del día (23:59:59.999) en la zona de la empresa. */
  end: Date;
}

/** Inicio y fin del día que contiene `now` según la zona de la empresa. */
export function dayBounds(now: Date, tz: string): DayBounds {
  const p = zonedParts(now, tz);
  const start = wallClockToInstant({ ...p, hour: 0, minute: 0, second: 0 }, tz, now);
  const end = wallClockToInstant({ ...p, hour: 23, minute: 59, second: 59 }, tz, now);
  return { start, end: new Date(end.getTime() + 999) };
}

/** Parseo defensivo: null, cadena vacía y fechas inválidas devuelven null. */
export function toValidDate(value?: string | Date | null): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Vencida = tiene fecha y ya pasó. Una tarea sin fecha nunca está vencida. */
export function isOverdue(due: string | Date | null | undefined, now: Date): boolean {
  const d = toValidDate(due);
  return d !== null && d.getTime() < now.getTime();
}

/** Vence hoy = queda dentro del día actual de la empresa y todavía no pasó. */
export function isDueToday(due: string | Date | null | undefined, now: Date, tz: string): boolean {
  const d = toValidDate(due);
  if (!d) return false;
  const { end } = dayBounds(now, tz);
  return d.getTime() >= now.getTime() && d.getTime() <= end.getTime();
}

/** Mismo día de calendario en la zona de la empresa (independiente de la hora). */
export function isSameZonedDay(a: Date, b: Date, tz: string): boolean {
  const x = zonedParts(a, tz);
  const y = zonedParts(b, tz);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

const MONTHS_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** Fecha corta en la zona de la empresa: "12 sep 2026". */
export function formatDateInZone(value: string | Date | null | undefined, tz: string): string {
  const d = toValidDate(value);
  if (!d) return "—";
  const p = zonedParts(d, tz);
  return `${p.day} ${MONTHS_ES[p.month - 1]} ${p.year}`;
}

/** Hora en la zona de la empresa. */
export function formatTimeInZone(value: string | Date | null | undefined, tz: string): string {
  const d = toValidDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString("es-DO", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true });
}

export function formatDateTimeInZone(value: string | Date | null | undefined, tz: string): string {
  const d = toValidDate(value);
  if (!d) return "—";
  return `${formatDateInZone(d, tz)} · ${formatTimeInZone(d, tz)}`;
}

/** Duración transcurrida en palabras: "hace 3 h", "hace 2 d". */
export function humanizeElapsed(from: string | Date | null | undefined, now: Date): string {
  const d = toValidDate(from);
  if (!d) return "—";
  const diff = Math.max(0, now.getTime() - d.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "hace instantes";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  const months = Math.floor(days / 30);
  return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
}

/**
 * Etiqueta de vencimiento lista para la interfaz. Comunica el estado con texto,
 * no solo con color, que es lo que exige la regla de accesibilidad.
 */
export function dueLabel(due: string | Date | null | undefined, now: Date, tz: string): string {
  const d = toValidDate(due);
  if (!d) return "Sin vencimiento";

  if (d.getTime() < now.getTime()) {
    return `Vencida ${humanizeElapsed(d, now)}`;
  }
  if (isSameZonedDay(d, now, tz)) {
    return `Hoy ${formatTimeInZone(d, tz)}`;
  }
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (isSameZonedDay(d, tomorrow, tz)) {
    return `Mañana ${formatTimeInZone(d, tz)}`;
  }
  return `${formatDateInZone(d, tz)} · ${formatTimeInZone(d, tz)}`;
}
