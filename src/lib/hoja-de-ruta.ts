/**
 * LA HOJA DE RUTA DEL CHOFER.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA PANTALLA CON MÁS DATOS DE TERCEROS DE TODO EL SISTEMA
 *
 * Una parada es una persona con su nombre, su hotel, su habitación y su
 * teléfono. El chofer necesita las cuatro cosas —sin ellas no sabe a quién
 * busca ni dónde—, así que aquí no cabe el criterio de las otras pantallas del
 * proveedor, donde lo correcto era no enseñar nada de eso.
 *
 * Lo que sí cabe es acotar CUÁNDO y CUÁNTO:
 *
 *  · Solo sus rutas, por columna (0088).
 *  · Solo alrededor del servicio. Un transportista no tiene por qué poder
 *    sacar la lista de clientes de hace tres meses, y sin ventana la hoja de
 *    ruta es exactamente eso: un histórico de clientes con teléfono.
 *  · Y cada apertura queda anotada, porque es una lectura de datos personales
 *    de gente que no es suya.
 *
 * Este módulo es puro: las reglas se escriben una vez y las usan el servidor,
 * que decide, y la pantalla, que explica.
 */

export type EstadoDeParada =
  | "pending" | "confirmed" | "picked_up" | "no_show" | "cancelled";

/**
 * Cuántas horas antes y después del servicio se puede abrir la hoja.
 *
 * Doce por delante porque una salida de las siete de la mañana se prepara la
 * noche anterior, y doce por detrás porque el chofer cierra las marcas al
 * terminar el día, no al bajarse de la guagua.
 */
export const VENTANA_DE_LA_HOJA_HORAS = 12;

/**
 * Lo que se considera haber esperado antes de declarar un no-show.
 *
 * No bloquea nada: un chofer que no puede marcar deja la hoja a medias y la
 * operadora se queda sin saber qué pasó, que es peor. Lo que hace es dejar
 * constancia de que se marcó antes de tiempo, para que la reclamación del
 * turista no sea su palabra contra la del chofer.
 */
export const MINUTOS_DE_ESPERA = 5;

function comoFecha(valor: string | Date | null | undefined): Date | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Si la hoja se puede abrir ahora.
 *
 * Una ruta SIN fecha no se abre. Es lo contrario de lo que pide el cuerpo
 * —«déjalo pasar, que será un dato que falta»— y es a propósito: sin fecha no
 * hay ventana que aplicar, así que «sin fecha» querría decir «siempre», y la
 * hoja de ruta pasaría a ser un listado de clientes sin caducidad.
 */
export function hojaAbierta(
  fechaDelServicio: string | Date | null | undefined,
  ahora: Date
): boolean {
  const servicio = comoFecha(fechaDelServicio);
  if (!servicio) return false;
  const margen = VENTANA_DE_LA_HOJA_HORAS * 3_600_000;
  const distancia = Math.abs(servicio.getTime() - ahora.getTime());
  return distancia <= margen;
}

/** Los dos estados que el chofer puede poner. Ni cancelar, ni reabrir. */
export const MARCAS_DEL_CHOFER = ["picked_up", "no_show"] as const;
export type MarcaDelChofer = (typeof MARCAS_DEL_CHOFER)[number];

export function esMarcaDelChofer(valor: unknown): valor is MarcaDelChofer {
  return (MARCAS_DEL_CHOFER as readonly string[]).includes(String(valor));
}

/**
 * Si una parada admite que el chofer la marque.
 *
 * Una parada CANCELADA no: el cliente canceló y marcarla como no-show le
 * colgaría un incumplimiento a alguien que avisó. Y una ya marcada sí se puede
 * corregir —el chofer se equivoca de fila y lo ve al momento—, pero la
 * corrección queda en la bitácora.
 */
export function puedeMarcar(estado: string | null | undefined): boolean {
  return estado !== "cancelled";
}

/**
 * Si se esperó lo suficiente antes de declarar el no-show.
 *
 * `null` cuando no se puede saber: sin hora prevista no hay contra qué
 * comparar, y decir que no se esperó sería inventarse una acusación.
 */
export function esperoLoSuficiente(
  horaPrevista: string | null | undefined,
  marcadoEn: Date,
  fechaDelServicio: string | Date | null | undefined
): boolean | null {
  const prevista = horaDelDia(horaPrevista, fechaDelServicio);
  if (!prevista) return null;
  return marcadoEn.getTime() - prevista.getTime() >= MINUTOS_DE_ESPERA * 60_000;
}

/**
 * «07:15» sobre el día del servicio.
 *
 * Las horas de recogida se guardan como texto desde 0011, así que hay que
 * pegarlas al día para poder compararlas. Sin día, no hay hora.
 */
export function horaDelDia(
  hhmm: string | null | undefined,
  fechaDelServicio: string | Date | null | undefined
): Date | null {
  const dia = comoFecha(fechaDelServicio);
  if (!dia || !hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const salida = new Date(dia);
  salida.setUTCHours(h, min, 0, 0);
  return salida;
}

export interface ParadaOrdenable {
  sequence: number;
  time: string | null;
}

/**
 * El orden del recorrido.
 *
 * Por `sequence` y, cuando falta, por la hora. Una hoja desordenada obliga al
 * chofer a decidir el recorrido en la calle, que es justo lo que esta pantalla
 * existe para evitar.
 *
 * Las paradas SIN secuencia van al final y no al principio: una parada sin
 * ordenar es una que nadie colocó, y ponerla primera mandaría al chofer al
 * sitio equivocado antes de empezar.
 */
export function ordenarParadas<T extends ParadaOrdenable>(paradas: T[]): T[] {
  return [...paradas].sort((a, b) => {
    const sa = a.sequence || 9999;
    const sb = b.sequence || 9999;
    if (sa !== sb) return sa - sb;
    return String(a.time ?? "99:99").localeCompare(String(b.time ?? "99:99"));
  });
}

export const ETIQUETA_DE_PARADA: Record<EstadoDeParada, string> = {
  pending: "Por recoger",
  confirmed: "Confirmada",
  picked_up: "Recogido",
  no_show: "No se presentó",
  cancelled: "Cancelada",
};
