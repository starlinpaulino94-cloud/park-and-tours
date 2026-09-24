/**
 * ACEPTAR O RECHAZAR UN SERVICIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS EJES, NO UNO
 *
 * `status` dice lo que la operadora sabe del recurso —previsto, confirmado, en
 * conflicto, cancelado—. Esto dice lo que el PROVEEDOR contestó. Son dos cosas
 * distintas y por eso son dos columnas (0087): con una sola, «confirmado»
 * querría decir a la vez «el despacho lo dio por bueno» y «el transportista
 * dijo que sí», y la primera vez que haya que decidir si sale la guagua esa
 * ambigüedad se resolvería a favor de lo que le convenga al que mira.
 *
 * Este módulo es puro a propósito: la pantalla necesita decir «te quedan seis
 * horas» antes de guardar nada, y el servidor necesita calcular el mismo plazo
 * al asignar. Un solo sitio donde está escrito.
 */

export type EstadoDeAceptacion =
  | "not_required"
  | "pending"
  | "accepted"
  | "rejected"
  | "expired";

/**
 * Qué pasa cuando el plazo vence.
 *
 * Dos valores, y el tercero que se barajó —reasignar solo— NO está aquí. No es
 * una política: es una función que no existe. Ofrecerla como una casilla que no
 * mueve nada sería peor que no ofrecerla, y mover una guagua de verdad sin que
 * lo decida una persona, peor todavía.
 */
export type PoliticaDeVencimiento = "alert" | "tacit";

export const POLITICAS: PoliticaDeVencimiento[] = ["alert", "tacit"];

/**
 * Lo que dura el plazo cuando el proveedor no tiene uno declarado.
 *
 * El mismo número está escrito en 0087, y hay una guarda que comprueba que no
 * se separen: si el disparador diera veinticuatro horas y la pantalla dijera
 * cuarenta y ocho, el proveedor leería un plazo y tendría otro.
 */
export const VENTANA_POR_DEFECTO_HORAS = 24;

export interface DatosDelPlazo {
  ahora: Date;
  /** Lo declarado para este proveedor. Nulo: el de la operadora. */
  ventanaHoras?: number | null;
  /** Cuándo es el servicio. Nulo: una salida sin fecha, que no acota nada. */
  fechaDelServicio?: string | Date | null;
}

function comoFecha(valor: string | Date | null | undefined): Date | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Hasta cuándo tiene para contestar.
 *
 * EL PLAZO NUNCA PASA DE LA SALIDA. Un plazo que vence después de que el
 * servicio ocurra no es un plazo, es un recordatorio para después del entierro:
 * el autobús tenía que estar en el hotel a las siete y a las siete y cinco ya
 * da igual lo que conteste nadie.
 *
 * Y una ventana declarada en cero o en negativo no se respeta —se usa la de la
 * casa—: un plazo de cero horas vence en el mismo instante en que se crea, y lo
 * que parecería es que el proveedor no contesta nunca.
 */
export function plazoDeRespuesta({ ahora, ventanaHoras, fechaDelServicio }: DatosDelPlazo): Date {
  const horas = typeof ventanaHoras === "number" && ventanaHoras > 0
    ? ventanaHoras
    : VENTANA_POR_DEFECTO_HORAS;
  const porVentana = new Date(ahora.getTime() + horas * 3_600_000);
  const servicio = comoFecha(fechaDelServicio);
  if (servicio && servicio.getTime() < porVentana.getTime()) return servicio;
  return porVentana;
}

/** Cuántas horas enteras le quedan. Negativo si ya venció. */
export function horasQueQuedan(plazo: string | Date | null | undefined, ahora: Date): number | null {
  const fin = comoFecha(plazo);
  if (!fin) return null;
  return Math.floor((fin.getTime() - ahora.getTime()) / 3_600_000);
}

export function haVencido(plazo: string | Date | null | undefined, ahora: Date): boolean {
  const fin = comoFecha(plazo);
  // Sin plazo NO ha vencido. Al revés —tratar la ausencia como vencimiento—
  // daría por caducados todos los servicios de una salida sin fecha.
  if (!fin) return false;
  return fin.getTime() <= ahora.getTime();
}

export type MotivoParaNoResponder = "sin_peticion" | "ya_respondido" | "vencido";

export interface FilaConAceptacion {
  acceptance?: string | null;
  acceptance_deadline?: string | Date | null;
}

/**
 * Si este servicio admite respuesta AHORA.
 *
 * Devuelve el motivo y no un booleano porque los tres casos se le dicen al
 * proveedor con palabras distintas: «esto no hay que confirmarlo», «ya
 * contestaste» y «se pasó el plazo» son tres llamadas de teléfono diferentes.
 */
export function puedeResponder(
  fila: FilaConAceptacion,
  ahora: Date
): { ok: true } | { ok: false; motivo: MotivoParaNoResponder } {
  const estado = (fila.acceptance || "not_required") as EstadoDeAceptacion;
  if (estado !== "pending") {
    return { ok: false, motivo: estado === "not_required" ? "sin_peticion" : "ya_respondido" };
  }
  if (haVencido(fila.acceptance_deadline, ahora)) return { ok: false, motivo: "vencido" };
  return { ok: true };
}

export interface DesenlaceDelVencimiento {
  estado: Extract<EstadoDeAceptacion, "expired" | "accepted">;
  /** Qué se escribe en `responded_via`. Nulo cuando no contestó nadie. */
  via: "tacito" | null;
  /** Si hay que avisar a operaciones. */
  avisa: boolean;
}

/**
 * Qué hacer con un servicio cuyo plazo venció.
 *
 * `alert` es el valor por defecto porque es el único que no decide nada en
 * nombre de nadie: el servicio queda marcado como vencido, sin conformidad, y
 * alguien de operaciones lo ve y llama.
 *
 * `tacit` existe porque hay proveedores de toda la vida con los que se trabaja
 * así. Y aun así deja rastro de que NADIE contestó: `responded_via` queda en
 * «tacito», no en «enlace». El día que se discuta si aceptaron de verdad, esa
 * palabra es toda la prueba que hay.
 *
 * Lo desconocido es lo de hoy: una política que no se reconoce cae en `alert`,
 * nunca en la que da el servicio por aceptado.
 */
export function alVencer(politica: string | null | undefined): DesenlaceDelVencimiento {
  if (politica === "tacit") return { estado: "accepted", via: "tacito", avisa: true };
  return { estado: "expired", via: null, avisa: true };
}

/** El texto que ve el proveedor para cada estado. */
export const ETIQUETA_DE_ACEPTACION: Record<EstadoDeAceptacion, string> = {
  not_required: "No hace falta confirmar",
  pending: "Pendiente de tu respuesta",
  accepted: "Aceptado",
  rejected: "Rechazado",
  expired: "Sin respuesta a tiempo",
};
