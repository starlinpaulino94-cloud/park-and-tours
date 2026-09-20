/**
 * LA VOZ DEL CLIENTE — a quién se le pregunta, cuándo, y qué se hace con lo que
 * conteste.
 *
 * Puro a propósito: no toca la base ni lee la sesión. Cada regla de aquí decide
 * si a una persona concreta se le escribe o no se le escribe, y esas hay que
 * poder probarlas de una en una — equivocarse en una es escribirle a alguien
 * que canceló, a alguien que no vino, o a un cliente que es de otro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NPS Y NO UNA MEDIA DE ESTRELLAS
 *
 * Una media esconde la forma. Diez pasajeros que ponen 7 y diez que ponen 3 dan
 * la misma media que veinte que ponen 5, y no es el mismo negocio: en el primer
 * caso hay diez personas contándolo mal por ahí. El NPS separa a los que
 * recomiendan de los que desaconsejan, que es la única pregunta que mueve
 * ventas en un sector donde se compra por reseña.
 *
 * Y es comparable: un operador sabe qué significa un NPS de 40 porque el resto
 * del sector usa la misma escala. Una media de 4,2 estrellas no dice nada sin
 * saber sobre cuántas.
 */

/* ══════════════════════════════════════════════════ 1 · la escala y sus bandas ══ */

/** Desde dónde alguien recomienda de verdad. */
export const NPS_PROMOTER_MIN = 9;
/** Hasta dónde alguien está desaconsejando, aunque no lo diga. */
export const NPS_DETRACTOR_MAX = 6;

export type NpsBand = "promoter" | "passive" | "detractor";

/**
 * En qué banda cae una nota.
 *
 * El 7 y el 8 NO son aprobados: son pasivos. Un pasivo vuelve si no encuentra
 * nada mejor y no te defiende delante de nadie, y contarlo como contento es la
 * forma más común de que un panel diga que todo va bien mientras la reputación
 * baja. Por eso no suman en el NPS: ni a favor ni en contra.
 */
export function bandOf(nps: unknown): NpsBand | null {
  /**
   * Estricto a propósito: `Number(null)` es 0, `Number("")` es 0 y
   * `Number([])` es 0. Con una conversión ingenua, una encuesta SIN contestar
   * entraba como un cero —el peor detractor posible— y hundía el NPS del guía
   * con opiniones que nadie dio. Lo encontró la prueba de la escala.
   */
  const n =
    typeof nps === "number" ? nps
    : typeof nps === "string" && nps.trim() !== "" ? Number(nps)
    : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  const nota = Math.round(n);
  if (nota >= NPS_PROMOTER_MIN) return "promoter";
  if (nota <= NPS_DETRACTOR_MAX) return "detractor";
  return "passive";
}

export interface NpsResult {
  /** −100 a 100. Nulo cuando no hay ni una respuesta: un cero sería mentira. */
  score: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  answered: number;
}

/**
 * El NPS de un conjunto de respuestas.
 *
 * Devuelve `null` sin respuestas y no 0. Un 0 en el panel se lee como «la mitad
 * te recomienda y la mitad no», que es una frase sobre el negocio; «todavía no
 * hay datos» es una frase sobre la medición. Confundirlas hace que alguien
 * tome una decisión sobre un guía por una casilla vacía.
 */
export function npsOf(notas: readonly unknown[]): NpsResult {
  let promoters = 0, passives = 0, detractors = 0;
  for (const nota of notas) {
    const banda = bandOf(nota);
    if (banda === "promoter") promoters++;
    else if (banda === "passive") passives++;
    else if (banda === "detractor") detractors++;
  }
  const answered = promoters + passives + detractors;
  if (answered === 0) return { score: null, promoters: 0, passives: 0, detractors: 0, answered: 0 };
  const score = Math.round(((promoters - detractors) / answered) * 100);
  return { score, promoters, passives, detractors, answered };
}

/* ═════════════════════════════════════════════ 2 · a quién se le pregunta ══ */

export type SkipReason = "ota" | "cancelled" | "no_show" | "no_contact" | "fatigue" | "no_consent";

/** Por qué no se le preguntó, dicho para que lo lea la operadora. */
export const SKIP_LABEL: Record<SkipReason, string> = {
  ota: "Reserva de una OTA: el cliente es del revendedor",
  cancelled: "La reserva se canceló",
  no_show: "No se presentó",
  no_contact: "Sin correo ni teléfono en la ficha",
  fatigue: "Ya se le preguntó hace poco",
  no_consent: "Pidió no recibir más encuestas",
};

/**
 * Cuántos días tienen que pasar para volver a preguntarle a la misma persona.
 *
 * Un cliente fiel que hace tres excursiones en una semana recibiría tres
 * encuestas, y a la tercera deja de abrir los correos de la operadora — incluido
 * el recordatorio de la víspera, que es el que lleva la hora de recogida. La
 * fatiga de encuesta no cuesta opiniones: cuesta entregabilidad.
 */
export const SURVEY_FATIGUE_DAYS = 45;

/** Cuánto vale el enlace. Treinta días sobra para opinar de un día concreto. */
export const SURVEY_EXPIRY_DAYS = 30;

/** Cuánto se espera desde que termina el tour. */
export const ASK_AFTER_HOURS = 4;

/**
 * Cuánto se supone que dura una excursión cuando el producto no lo dice.
 *
 * Ocho horas es el día completo típico de esta operación (Saona, Bávaro, los
 * traslados largos). Quedarse corto es el error caro: preguntar mientras el
 * pasajero todavía está en la guagua de vuelta.
 */
export const DEFAULT_DURATION_HOURS = 8;

export interface BookingForSurvey {
  status?: string | null;
  checkin_status?: string | null;
  /** Si la trajo una OTA, esto viene con el uuid del revendedor. */
  octo_uuid?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  /** El cliente pidió no recibir más encuestas. */
  optOut?: boolean | null;
  /** Cuándo se le preguntó por última vez a ESTE cliente, si se le preguntó. */
  lastAskedAt?: string | null;
}

/**
 * Una sola forma con el motivo opcional, y no una unión discriminada.
 *
 * El proyecto compila con `strict: false`, y sin `strictNullChecks` TypeScript
 * NO estrecha uniones por su discriminante: `if (!verdict.ask)` deja el tipo
 * igual y `verdict.reason` no existe para el compilador. Es la misma forma que
 * usa `canTransition` en el conector de OTAs, por el mismo motivo.
 */
export interface AskVerdict {
  ask: boolean;
  /** Presente exactamente cuando `ask` es falso. */
  reason?: SkipReason;
}

const TERMINAL = new Set(["cancelled", "refunded", "partially_refunded"]);

/**
 * ¿Se le pregunta a este pasajero?
 *
 * El orden de las negativas importa, porque la fila guarda UNA y esa es la que
 * la operadora va a leer. Primero lo que es una regla de contrato o de derecho
 * —la OTA y la baja voluntaria—, después lo que es un hecho del viaje —canceló,
 * no vino—, y al final lo que es un problema nuestro: que no tenemos por dónde
 * escribirle. Así, «sin correo ni teléfono» solo aparece cuando de verdad es lo
 * único que falla, y esa cifra sirve para ir a limpiar las fichas.
 */
export function askVerdict(booking: BookingForSurvey, now: Date = new Date()): AskVerdict {
  if (booking.octo_uuid) return { ask: false, reason: "ota" };
  if (booking.optOut === true) return { ask: false, reason: "no_consent" };

  const estado = String(booking.status ?? "").toLowerCase();
  if (TERMINAL.has(estado)) return { ask: false, reason: "cancelled" };

  // `no_show` vive en dos sitios: el estado de la reserva y el del embarque.
  // Se miran los dos porque el guía marca el segundo desde el móvil y el
  // primero no siempre lo sigue.
  if (estado === "no_show" || String(booking.checkin_status ?? "").toLowerCase() === "no_show") {
    return { ask: false, reason: "no_show" };
  }

  if (fatigado(booking.lastAskedAt, now)) return { ask: false, reason: "fatigue" };

  const alcanzable = [booking.email, booking.phone, booking.whatsapp]
    .some((v) => typeof v === "string" && v.trim() !== "");
  if (!alcanzable) return { ask: false, reason: "no_contact" };

  return { ask: true };
}

function fatigado(lastAskedAt: string | null | undefined, now: Date): boolean {
  if (!lastAskedAt) return false;
  const t = Date.parse(String(lastAskedAt));
  // Una fecha que no se entiende NO cuenta como fatiga: preferimos preguntar de
  // más a callarnos por un dato corrupto.
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < SURVEY_FATIGUE_DAYS * 86_400_000;
}

/* ══════════════════════════════════════════════════════ 3 · cuándo y hasta cuándo ══ */

/**
 * Cuándo se le pregunta: al terminar el tour, más unas horas.
 *
 * No al día siguiente. La opinión de una excursión se escribe el mismo día,
 * mientras el pasajero todavía tiene las fotos en el móvil; a las 48 horas ya
 * no contesta ni el que salió encantado.
 *
 * Y no antes de terminar: una encuesta que llega mientras el cliente está en la
 * guagua de vuelta es la forma más rápida de que la nota la ponga el atasco.
 */
export function askAt(
  departureAt: string | Date | null | undefined,
  durationHours: number | null | undefined,
  afterHours: number = ASK_AFTER_HOURS
): Date | null {
  const salida = toDate(departureAt);
  if (!salida) return null;
  const duracion = Number(durationHours);
  const horas = Number.isFinite(duracion) && duracion > 0 ? duracion : DEFAULT_DURATION_HOURS;
  return new Date(salida.getTime() + (horas + Math.max(0, afterHours)) * 3_600_000);
}

/** Hasta cuándo vale el enlace. */
export function expiresAt(askedAt: string | Date | null | undefined): Date | null {
  const base = toDate(askedAt);
  if (!base) return null;
  return new Date(base.getTime() + SURVEY_EXPIRY_DAYS * 86_400_000);
}

export type AnswerRefusal = "not_found" | "already_answered" | "expired" | "not_asked";

export interface SurveyLike {
  status?: string | null;
  expires_at?: string | null;
  asked_at?: string | null;
}

/**
 * ¿Puede esta encuesta recibir una respuesta ahora?
 *
 * Contestar dos veces NO vale, y no por rigidez: la segunda respuesta suele ser
 * alguien reenviando el correo a un amigo, o el mismo cliente pinchando otra vez
 * desde el móvil. Si la segunda pisara a la primera, bastaría con reenviar un
 * enlace para cambiarle la nota a un guía.
 */
export interface AnswerCheck {
  ok: boolean;
  /** Presente exactamente cuando `ok` es falso. */
  reason?: AnswerRefusal;
}

export function canAnswer(survey: SurveyLike, now: Date = new Date()): AnswerCheck {
  const estado = String(survey.status ?? "").toLowerCase();
  if (estado === "answered") return { ok: false, reason: "already_answered" };
  if (estado === "skipped" || !survey.asked_at) return { ok: false, reason: "not_asked" };
  if (estado === "expired") return { ok: false, reason: "expired" };

  const vence = toDate(survey.expires_at);
  // Sin fecha de caducidad NO se da por caducada: el enlace existe y el cliente
  // está delante. Lo que falta es un dato nuestro, y eso no es culpa suya.
  if (vence && vence.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

/* ═════════════════════════════════════════════════════ 4 · qué se hace después ══ */

export type NextStep = "review" | "thanks" | "recover";

/**
 * Qué se le enseña —y qué se hace— según la nota.
 *
 *  · promotor  → se le pide la reseña pública. Es el único momento en que la
 *                escribe: acaba de decir que pondría un 10.
 *  · pasivo    → gracias y nada más. Empujar a un 7 hacia Google es pedir una
 *                reseña de tres estrellas con tu nombre puesto.
 *  · detractor → NO se le pide reseña. Se le pide que cuente qué pasó y alguien
 *                lo llama. Mandar a un detractor a la reseña pública es pagarle
 *                el altavoz.
 */
export function nextStep(nps: unknown): NextStep {
  const banda = bandOf(nps);
  if (banda === "promoter") return "review";
  if (banda === "detractor") return "recover";
  return "thanks";
}

/* ══════════════════════════════════════════════════════════ 5 · el resumen ══ */

export interface SurveyRow {
  status?: string | null;
  skip_reason?: string | null;
  nps?: number | null;
  answered_at?: string | null;
  product_id?: string | null;
  guide_staff_id?: string | null;
}

export interface VoiceSummary {
  /** Reservas que entraron al embudo, se les preguntara o no. */
  total: number;
  /** A las que sí se les preguntó. */
  asked: number;
  answered: number;
  skipped: number;
  /** Sobre las PREGUNTADAS, que es la única tasa de respuesta honesta. */
  responseRate: number | null;
  nps: NpsResult;
  /** Cuántas se omitieron por cada motivo, para saber qué arreglar. */
  skips: Record<string, number>;
}

/**
 * El resumen que ve la operadora.
 *
 * La tasa de respuesta se calcula sobre las PREGUNTADAS y no sobre el total.
 * Meter en el denominador a los clientes de OTA —a los que por contrato no se
 * les escribe— haría que una operadora que vende bien por OTA viera caer su
 * «tasa de respuesta» cuanto mejor le fuera. El dato dejaría de medir la
 * encuesta para medir el canal.
 */
export function summarize(rows: readonly SurveyRow[]): VoiceSummary {
  let asked = 0, answered = 0, skipped = 0;
  const skips: Record<string, number> = {};
  const notas: unknown[] = [];

  for (const row of rows) {
    const estado = String(row.status ?? "").toLowerCase();
    if (estado === "skipped") {
      skipped++;
      const motivo = String(row.skip_reason ?? "desconocido");
      skips[motivo] = (skips[motivo] ?? 0) + 1;
      continue;
    }
    asked++;
    if (estado === "answered") {
      answered++;
      notas.push(row.nps);
    }
  }

  return {
    total: rows.length,
    asked,
    answered,
    skipped,
    responseRate: asked > 0 ? Math.round((answered / asked) * 100) : null,
    nps: npsOf(notas),
    skips,
  };
}

/**
 * El NPS agrupado por algo —producto, guía, mes—.
 *
 * Devuelve también los grupos con pocas respuestas, con su recuento al lado, en
 * vez de esconderlos: quién decide si tres respuestas bastan para hablar de un
 * guía es quien mira el panel, no esta función. Lo que sí se hace es no
 * inventarse un número cuando no hay ninguna (`score: null`).
 */
export function groupNps<T extends SurveyRow>(
  rows: readonly T[],
  clave: (row: T) => string | null
): { key: string; nps: NpsResult }[] {
  const porGrupo = new Map<string, unknown[]>();
  for (const row of rows) {
    if (String(row.status ?? "").toLowerCase() !== "answered") continue;
    const key = clave(row);
    if (!key) continue;
    const lista = porGrupo.get(key) ?? [];
    lista.push(row.nps);
    porGrupo.set(key, lista);
  }
  return [...porGrupo.entries()]
    .map(([key, notas]) => ({ key, nps: npsOf(notas) }))
    .sort((a, b) => (b.nps.answered - a.nps.answered) || a.key.localeCompare(b.key));
}

/* ═══════════════════════════════════════════════════════════════ utilidades ══ */

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}
