/**
 * SABER QUE ALGO SE ROMPIÓ ANTES DE QUE TE LO DIGA UN CLIENTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE ESTO
 *
 * El enganche que emite la sesión estuvo roto horas. Durante ese rato nadie
 * podía entrar. Quien se enteró fue un job de integración continua — no la
 * operadora, que se habría enterado por un vendedor en el mostrador con un
 * cliente delante.
 *
 * Y no es el caso raro: hay cinco trabajos que corren de madrugada —avisos de
 * cobro, mensajes a clientes, caducidad de aprobaciones, certificaciones,
 * liberación de cupo— y ninguno deja rastro. Si uno deja de funcionar, se sabe
 * cuando un cliente dice que nunca le llegó su voucher.
 *
 * Todo lo de aquí es PURO: decide qué está sano, qué lleva demasiado sin correr
 * y qué errores son el mismo. Quien habla con la base es `system-health-service`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// El estado de una comprobación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tres estados, y el de en medio es el que justifica que haya tres.
 *
 * `degraded` es «funciona pero algo no está bien»: los avisos de cobro no
 * salieron anoche, y eso no impide vender hoy. Sin ese escalón todo sería verde
 * o rojo, y como no se puede poner en rojo un sistema que vende, acabaría en
 * verde — o sea, callado.
 */
export type HealthLevel = "ok" | "degraded" | "down";

const SEVERITY: Record<HealthLevel, number> = { ok: 0, degraded: 1, down: 2 };

export const HEALTH_LABEL: Record<HealthLevel, string> = {
  ok: "Correcto",
  degraded: "Con problemas",
  down: "Caído",
};

export interface HealthCheck {
  /** Identificador estable: se usa para comparar entre ejecuciones. */
  key: string;
  /** Lo que se le enseña a una persona. */
  label: string;
  level: HealthLevel;
  /** Qué se miró y qué salió. Una frase, no un volcado. */
  detail: string;
  /** Cuánto tardó la comprobación. Un «ok» lentísimo también es una señal. */
  ms?: number;
}

/**
 * El estado del conjunto es EL PEOR de sus partes, nunca el promedio.
 *
 * Promediar diría «bien» con la base caída y nueve comprobaciones triviales en
 * verde. Una sola cosa rota basta para que el sistema no sirva.
 */
export function overallLevel(checks: HealthCheck[]): HealthLevel {
  let worst: HealthLevel = "ok";
  for (const c of checks) if (SEVERITY[c.level] > SEVERITY[worst]) worst = c.level;
  return worst;
}

/** Las que no están bien, lo peor primero: es el orden en que se atienden. */
export function sortBySeverity(checks: HealthCheck[]): HealthCheck[] {
  return [...checks].sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level] || a.label.localeCompare(b.label));
}

// ─────────────────────────────────────────────────────────────────────────────
// Los trabajos que corren solos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cada trabajo, cada cuánto se espera que corra y qué se rompe si no corre.
 *
 * `graceMinutes` no es un adorno: un trabajo diario que corre a las 03:00 no
 * está roto a las 03:05 si el servidor tardó en despertar. Sin margen, la
 * pantalla se pondría roja cada madrugada y a la tercera vez nadie la miraría —
 * que es como se pierde una alerta de verdad.
 *
 * `consequence` se enseña tal cual cuando el trabajo no corrió. «`collections`
 * lleva 30 h sin ejecutarse» no le dice nada a quien lleva la operadora; «no se
 * enviaron los avisos de cobro» sí.
 */
export interface JobExpectation {
  job: string;
  label: string;
  /** Cada cuántas horas se espera. 24 = diario. */
  everyHours: number;
  graceMinutes: number;
  consequence: string;
}

export const JOB_EXPECTATIONS: JobExpectation[] = [
  {
    job: "collections",
    label: "Avisos de cobro",
    everyHours: 24,
    graceMinutes: 180,
    consequence: "No se enviaron los recordatorios de saldo pendiente.",
  },
  {
    job: "dispatch-messages",
    label: "Mensajes a clientes",
    everyHours: 24,
    graceMinutes: 180,
    consequence: "Los mensajes programados no salieron: vouchers y recordatorios de salida.",
  },
  {
    job: "expire-approvals",
    label: "Caducidad de aprobaciones",
    everyHours: 24,
    graceMinutes: 180,
    consequence: "Las solicitudes vencidas siguen contando como pendientes.",
  },
  {
    job: "certifications",
    label: "Certificaciones del personal",
    everyHours: 24,
    graceMinutes: 180,
    consequence: "No se avisó de las certificaciones por vencer: alguien puede quedar sin poder trabajar.",
  },
  {
    job: "supplier-acceptance",
    label: "Plazos de respuesta de proveedores",
    everyHours: 24,
    graceMinutes: 180,
    consequence:
      "Los plazos vencidos siguen figurando como pendientes y nadie avisó de los servicios sin conformidad.",
  },
  {
    job: "allotments",
    label: "Liberación de cupo",
    everyHours: 24,
    graceMinutes: 180,
    consequence: "El cupo reservado a socios no se liberó: plazas que podrían venderse siguen bloqueadas.",
  },
  {
    job: "reconcile-drafts",
    label: "Ventas que se quedaron a medias",
    everyHours: 24,
    graceMinutes: 180,
    consequence:
      "Las ventas que un proceso dejó a medias siguen en pie: sus plazas apartadas, su voucher escaneando "
      + "como válido y su comisión esperando que la próxima liquidación la pague.",
  },
];

export function expectationFor(job: string): JobExpectation | null {
  return JOB_EXPECTATIONS.find((e) => e.job === job) ?? null;
}

export interface JobRunLite {
  job: string;
  started_at: string;
  finished_at?: string | null;
  status: "running" | "ok" | "failed" | string;
  error?: string | null;
}

/** Cuánto puede pasar entre dos ejecuciones antes de que sea un problema. */
export function toleranceMs(e: JobExpectation): number {
  return e.everyHours * 3_600_000 + e.graceMinutes * 60_000;
}

/**
 * El estado de un trabajo a partir de su última ejecución.
 *
 * Los cuatro casos, y el orden importa:
 *
 *  1. NUNCA corrió → `down`. No es «aún no toca»: si el trabajo está declarado
 *     es porque alguien depende de él.
 *  2. Falló la última vez → `down`, con su motivo.
 *  3. Se quedó colgado (empezó y nunca terminó, pasado el margen) → `down`.
 *     Este es el que un registro que solo escribe al terminar no puede ver.
 *  4. Terminó bien pero hace demasiado → `degraded`.
 */
export function jobHealth(e: JobExpectation, last: JobRunLite | null, now: Date = new Date()): HealthCheck {
  const base = { key: `job:${e.job}`, label: e.label };

  if (!last) {
    return { ...base, level: "down", detail: `Nunca se ha ejecutado. ${e.consequence}` };
  }

  const started = Date.parse(last.started_at);
  const age = now.getTime() - started;

  if (last.status === "failed") {
    const why = (last.error || "").trim();
    return { ...base, level: "down", detail: `Falló${why ? `: ${why}` : ""}. ${e.consequence}` };
  }

  // Colgado: empezó, no terminó, y ya pasó el tiempo en el que debería haber
  // terminado. Un trabajo así no vuelve solo, y sin esta rama parecería
  // simplemente «reciente».
  if (last.status === "running" && age > toleranceMs(e)) {
    return { ...base, level: "down", detail: `Se quedó a medias hace ${humanAge(age)}. ${e.consequence}` };
  }

  if (last.status === "running") {
    return { ...base, level: "ok", detail: "En ejecución ahora mismo." };
  }

  if (age > toleranceMs(e)) {
    return { ...base, level: "degraded", detail: `No se ejecuta desde hace ${humanAge(age)}. ${e.consequence}` };
  }

  return { ...base, level: "ok", detail: `Última ejecución hace ${humanAge(age)}.` };
}

/** «hace 3 h», «hace 2 días». Aproximado a propósito: el minuto exacto no decide nada. */
export function humanAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "menos de un minuto";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} días`;
}

// ─────────────────────────────────────────────────────────────────────────────
// La huella: qué errores son EL MISMO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sin agrupar, un fallo que ocurre mil veces produce mil filas y la pantalla es
 * ilegible justo el día que hay que leerla.
 *
 * Y agrupar por el mensaje entero no agrupa nada, porque casi todos los
 * mensajes llevan dentro algo que cambia en cada ocurrencia: el identificador
 * de la fila, una fecha, un número. Así que primero se le quita al mensaje todo
 * lo que varía y de lo que queda se hace la huella.
 *
 * Lo que se borra:
 *  - identificadores (uuid), que son lo más común;
 *  - números largos, que suelen ser importes o identificadores;
 *  - lo que va entre comillas, que suele ser el valor concreto que falló;
 *  - correos, que además no deberían acabar en un registro técnico.
 */
const VARIABLE_PARTS: [RegExp, string][] = [
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<correo>"],
  [/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/g, "<fecha>"],
  [/"[^"]*"|'[^']*'|«[^»]*»/g, "<valor>"],
  [/\b\d[\d.,]{2,}\b/g, "<n>"],
];

/** El mensaje sin lo que cambia en cada ocurrencia. */
export function normalizeMessage(message: string): string {
  let out = String(message ?? "");
  for (const [re, by] of VARIABLE_PARTS) out = out.replace(re, by);
  return out.replace(/\s+/g, " ").trim();
}

/**
 * La huella. Corta a 200: un mensaje larguísimo agruparía igual por su
 * principio, y es el principio lo que identifica el fallo.
 */
export function fingerprintOf(source: string, message: string): string {
  return `${String(source ?? "").trim()}|${normalizeMessage(message).slice(0, 200)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Que no se cuele nada que no deba quedar escrito
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un registro de incidentes se lee sin permisos especiales y se conserva. Lo
 * que entre ahí, ahí se queda.
 *
 * Así que el contexto se acota a una lista corta de claves técnicas y todo lo
 * demás se descarta. Es al revés de lo habitual —permitir lo conocido en vez de
 * prohibir lo peligroso— porque una lista de prohibidos siempre se queda corta:
 * basta que alguien añada `nombre_cliente` al contexto para que empiece a
 * guardarse.
 */
export const ALLOWED_CONTEXT_KEYS = new Set([
  "method", "status", "route", "job", "code", "duration_ms", "attempt", "table", "operation",
]);

export function safeContext(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_CONTEXT_KEYS.has(k)) continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      out[k] = typeof v === "string" ? v.slice(0, 200) : v;
    }
  }
  return out;
}

/**
 * El mensaje que se guarda: normalizado igual que la huella.
 *
 * Guardar el mensaje crudo dejaría el correo o el identificador del cliente
 * escrito en una tabla técnica. Y para leer el incidente no hace falta: para
 * eso está `context`, que sí está acotado.
 */
export function safeMessage(message: unknown): string {
  const text = message instanceof Error ? message.message : String(message ?? "");
  return normalizeMessage(text).slice(0, 500) || "Error sin mensaje";
}

// ─────────────────────────────────────────────────────────────────────────────
// Los incidentes, ordenados como se atienden
// ─────────────────────────────────────────────────────────────────────────────

export interface IncidentLite {
  fingerprint: string;
  level: "error" | "warning" | string;
  occurrences: number;
  last_seen_at: string;
  status: "open" | "acknowledged" | "resolved" | string;
}

export const OPEN_INCIDENT = new Set(["open", "acknowledged"]);

/**
 * Lo que decide el orden es, por este orden: si sigue abierto, la gravedad, y
 * cuántas veces ha pasado.
 *
 * Las veces van ANTES que la fecha a propósito: un fallo que ocurrió trescientas
 * veces esta mañana importa más que uno que ocurrió una vez hace diez minutos, y
 * ordenar por fecha lo enterraría.
 */
export function sortIncidents<T extends IncidentLite>(rows: T[]): T[] {
  const openness = (r: IncidentLite) => (r.status === "open" ? 0 : r.status === "acknowledged" ? 1 : 2);
  const gravity = (r: IncidentLite) => (r.level === "error" ? 0 : 1);
  return [...rows].sort(
    (a, b) =>
      openness(a) - openness(b) ||
      gravity(a) - gravity(b) ||
      b.occurrences - a.occurrences ||
      Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at)
  );
}

/**
 * El estado que aportan los incidentes al conjunto.
 *
 * Un error abierto pone el sistema en «con problemas», no en «caído»: que haya
 * fallado algo no significa que no se pueda vender. Lo que sí lo pone en caído
 * es que el error se esté repitiendo ahora mismo, y eso se mide con el
 * contador, no con su existencia.
 */
export const REPEATED_IS_DOWN = 50;

export function incidentsLevel(rows: IncidentLite[]): HealthLevel {
  const open = rows.filter((r) => OPEN_INCIDENT.has(r.status) && r.level === "error");
  if (open.length === 0) return "ok";
  if (open.some((r) => r.occurrences >= REPEATED_IS_DOWN)) return "down";
  return "degraded";
}
