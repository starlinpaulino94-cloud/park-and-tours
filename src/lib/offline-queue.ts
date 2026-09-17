/**
 * LA COLA DE LO QUE SE HIZO SIN SEÑAL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL CASO QUE ESTO RESUELVE
 *
 * El guía embarca en la playa, en el muelle o en el parking de un hotel a las
 * siete de la mañana. Ahí no hay señal, y hasta ahora el check-in sencillamente
 * no funcionaba: el sistema pedía red para cada persona que subía al bus. Lo que
 * pasaba de verdad es que el guía marcaba en papel y alguien lo pasaba al
 * sistema por la tarde —cuando el manifiesto ya no servía para nada.
 *
 * Ahora lo que hace se guarda en su teléfono y se manda solo cuando vuelve la
 * red.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS TRES REGLAS QUE LA HACEN FIABLE
 *
 *  1. CADA EMBARQUE LLEVA SU CLAVE, generada una vez al ponerlo en la cola. El
 *     servidor la usa para distinguir un reintento (mismo embarque otra vez, se
 *     contesta que sí) de un voucher presentado por dos personas (se rechaza).
 *     Sin esa clave hay que elegir entre aceptar los dos o rechazar los dos.
 *  2. LO QUE NO SE PUEDE ARREGLAR REINTENTANDO, NO SE REINTENTA. Un 409 —ya
 *     tiene check-in con otra clave— o un 403 no mejoran con el tiempo: se
 *     sacan de la cola y se le enseñan al guía. Solo se reintenta lo que es de
 *     la red: sin conexión, tiempo agotado, o un fallo del servidor.
 *  3. LA COLA TIENE TOPE. Un teléfono que pasa el día sin señal no puede
 *     acumular mil peticiones y quedarse sin espacio: pasado el tope, lo más
 *     viejo se descarta avisando, en vez de romper el almacenamiento entero y
 *     perderlo TODO.
 */

export interface QueuedCheckin {
  /** La clave del embarque: identifica la cola Y viaja al servidor. */
  key: string;
  bookingId: string;
  /** Lo que se le enseña al guía: «RES-1024 · Ana Pérez». */
  label: string;
  body: Record<string, unknown>;
  at: number;
  tries: number;
  lastError?: string;
}

/** Lo mínimo que se necesita de `localStorage`, para poder probarlo. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const QUEUE_STORAGE_KEY = "pt.checkin.queue";

/**
 * Cuántos embarques caben esperando.
 *
 * Doscientos: más que un día de trabajo de un guía con varios buses, y lo
 * bastante poco como para no acercarse al límite del almacenamiento del
 * navegador, que al llenarse falla ENTERO y se llevaría por delante la cola
 * completa.
 */
export const MAX_QUEUED = 200;

/** Lee la cola. Un contenido corrupto se trata como cola vacía, nunca revienta. */
export function readQueue(store: KeyValueStore): QueuedCheckin[] {
  try {
    const raw = store.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.key === "string" && typeof item.bookingId === "string");
  } catch {
    // Reventar aquí dejaría al guía sin pantalla de check-in por un dato
    // ilegible; perder la cola es malo, quedarse sin poder embarcar es peor.
    return [];
  }
}

function writeQueue(store: KeyValueStore, queue: QueuedCheckin[]): void {
  try {
    store.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Almacenamiento lleno o denegado (modo privado). No hay nada que hacer
    // salvo no romper la pantalla: la petición ya se intentó por red.
  }
}

/** Mete un embarque en la cola. Si ya estaba esa clave, la reemplaza. */
export function enqueue(store: KeyValueStore, item: QueuedCheckin): QueuedCheckin[] {
  const queue = readQueue(store).filter((queued) => queued.key !== item.key);
  queue.push(item);
  // Lo más viejo primero: si sobra, lo que se pierde es lo que ya se intentó
  // muchas veces, no el embarque que acaba de hacer.
  const trimmed = queue.length > MAX_QUEUED ? queue.slice(queue.length - MAX_QUEUED) : queue;
  writeQueue(store, trimmed);
  return trimmed;
}

export function removeFromQueue(store: KeyValueStore, key: string): QueuedCheckin[] {
  const queue = readQueue(store).filter((item) => item.key !== key);
  writeQueue(store, queue);
  return queue;
}

export function updateQueued(store: KeyValueStore, key: string, patch: Partial<QueuedCheckin>): QueuedCheckin[] {
  const queue = readQueue(store).map((item) => (item.key === key ? { ...item, ...patch } : item));
  writeQueue(store, queue);
  return queue;
}

/**
 * ¿Vale la pena volver a intentarlo?
 *
 * `0` es «no hubo respuesta»: sin conexión o tiempo agotado. Eso y los fallos
 * del servidor (5xx) mejoran solos con el tiempo. Un 409 o un 403 no: significan
 * que el servidor ENTENDIÓ la petición y dijo que no, y reintentar es gastar
 * batería para recibir el mismo no cien veces.
 *
 * El 429 es el caso curioso: el servidor dice «ahora no, más tarde», así que sí
 * se reintenta — es lo único de la familia 4xx que cambia con el tiempo.
 */
export function shouldRetry(status: number): boolean {
  if (status === 0) return true;
  if (status === 429) return true;
  return status >= 500;
}

/** La frase del indicador: lo que el guía necesita saber de un vistazo. */
export function queueSummary(queue: QueuedCheckin[], online: boolean): string {
  if (queue.length === 0) {
    return online ? "" : "Sin conexión. Puedes seguir embarcando: se enviará solo.";
  }
  const uno = queue.length === 1;
  return online
    ? `Enviando ${queue.length} embarque${uno ? "" : "s"} pendiente${uno ? "" : "s"}…`
    : `${queue.length} embarque${uno ? "" : "s"} guardado${uno ? "" : "s"} en este teléfono. Se enviarán al volver la señal.`;
}

/**
 * Una clave por embarque.
 *
 * `crypto.randomUUID` donde exista; si no, hora y azar, que para distinguir
 * embarques de un mismo teléfono basta y sobra.
 */
export function newCheckinKey(): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `ci_${uuid}`;
}
