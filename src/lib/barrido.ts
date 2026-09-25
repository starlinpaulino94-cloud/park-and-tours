/**
 * LOS BARRIDOS: RECORRER TODO, O DECIR QUE NO SE PUDO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE
 *
 * Los trabajos programados leían con un tope fijo —`.limit(1000)`,
 * `.limit(2000)`, `.limit(3000)`— y trataban lo que saliera. Un tope es
 * correcto cuando es UNA PÁGINA de una lista que el usuario puede seguir
 * pasando. Es un fallo cuando es un TECHO sobre un trabajo que tiene que
 * pasar por todas las filas, porque lo que queda fuera no se procesa: no se
 * retrasa, no se reintenta, no se avisa. Desaparece.
 *
 * Y desaparece SIEMPRE LO MISMO. Medido contra Postgres 16 con 2 500
 * retenciones vencidas y el tope de mil de la cobranza: las dos pasadas
 * devuelven exactamente las mismas mil filas, sin una sola diferencia, y las
 * mil quinientas restantes no las toca nadie jamás. Peor todavía, sin `order`
 * el orden que sale es el del montón —el de inserción—, así que el barrido
 * atendía retenciones vencidas hacía dieciséis horas mientras ignoraba, para
 * siempre, una vencida hacía un día y diecisiete. La cola se atiende al revés:
 * el que más lleva esperando es justo el que no se atiende nunca.
 *
 * Y empeora con el éxito. Mientras la operadora tiene ochocientas retenciones
 * el tope no se nota; el día que pasa de mil, las plazas se quedan apartadas
 * sin que nadie vea un error en ninguna pantalla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS FORMAS DE BARRER, Y CONFUNDIRLAS ES EL FALLO
 *
 * · **Recorrido.** Tratar la fila NO la saca del filtro (poner una cuota en
 *   `overdue` cuando el filtro admite `overdue`). Hay que AVANZAR la ventana,
 *   porque si no se piden siempre las mismas y el bucle no termina.
 *
 * · **Drenaje.** Tratar la fila SÍ la saca del filtro (un mensaje en cola que
 *   se manda, una retención que se cancela). Hay que pedir SIEMPRE la primera
 *   página, porque las filas ya tratadas dejan de contar y avanzar la ventana
 *   se saltaría tantas filas como se llevaran tratadas.
 *
 * Al revés, cada uno rompe de la forma del otro: un recorrido drenando da
 * vueltas para siempre, y un drenaje recorriendo se salta la mitad. Por eso el
 * modo se declara en la llamada y no se adivina.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL TOPE SIGUE EXISTIENDO — PERO SE OYE
 *
 * Un barrido sin techo es una forma de tumbar la base desde un cron. El techo
 * se queda, mucho más alto, y cuando se toca **se levanta un incidente y se
 * apunta en el resumen del trabajo**. Eso es lo único que cambia de verdad: la
 * diferencia entre un sistema que se queda corto y un sistema que se queda
 * corto **y lo dice**.
 */

/** Cuántas filas se piden por vuelta. */
export const PAGINA = 500;

/**
 * Cuántas filas como mucho trata un barrido antes de rendirse y avisar.
 *
 * Es alto a propósito: tiene que ser un número que una operadora sana no toque
 * nunca, para que tocarlo signifique algo. Veinte mil cuotas vencidas en un
 * solo barrido no es un pico de trabajo, es un síntoma.
 */
export const TOPE = 20_000;

export interface ResumenBarrido {
  /** Filas leídas y entregadas al tratamiento. */
  vistas: number;
  /** Vueltas dadas. */
  vueltas: number;
  /** Verdadero si se acabó por el techo y quedan filas sin tratar. */
  truncado: boolean;
  /** Verdadero si el drenaje dejó de bajar: las filas vuelven y nadie las saca. */
  atascado: boolean;
}

export type ModoDeBarrido = "recorrido" | "drenaje";

/**
 * La ventana que toca pedir.
 *
 * En drenaje es siempre la primera, porque lo tratado ya no está. En recorrido
 * avanza con lo visto. Separada y pura porque es la mitad del asunto: los dos
 * fallos que este módulo existe para evitar —dar vueltas para siempre y
 * saltarse filas— son los dos valores equivocados de esta función.
 */
export function ventana(modo: ModoDeBarrido, vistas: number, pagina = PAGINA): { desde: number; hasta: number } {
  const desde = modo === "drenaje" ? 0 : vistas;
  return { desde, hasta: desde + pagina - 1 };
}

/**
 * ¿Volvió el drenaje a traer exactamente lo mismo?
 *
 * Si tratar la fila falla —la escritura da error y el código sigue con la
 * siguiente—, la fila se queda en el filtro y la vuelta siguiente la trae otra
 * vez. Sin esto, el cron daría vueltas hasta el techo sobre las mismas
 * quinientas filas rotas, gastaría veinte mil lecturas y terminaría diciendo
 * «truncado», que es la explicación equivocada del problema equivocado.
 *
 * Se compara por identidad, no por número: una vuelta que trae la misma
 * cantidad pero otras filas sí está avanzando.
 */
export function atascado(anterior: readonly string[], actual: readonly string[]): boolean {
  if (anterior.length === 0 || anterior.length !== actual.length) return false;
  const previas = new Set(anterior);
  return actual.every((id) => previas.has(id));
}

/** El texto del aviso cuando un barrido no llega al final. */
export function avisoDeTope(etiqueta: string, resumen: ResumenBarrido): string {
  if (resumen.atascado) {
    return `El barrido «${etiqueta}» se atascó: ${resumen.vistas} filas leídas y la última vuelta trajo las mismas. `
      + "Lo más probable es que el tratamiento esté fallando en todas y la fila no salga del filtro.";
  }
  return `El barrido «${etiqueta}» llegó al techo de ${TOPE} filas y quedaron más sin tratar. `
    + "Lo que no entró no se ha retrasado: no se ha hecho.";
}

export interface OpcionesDeBarrido<T> {
  /** Cómo se llama en el aviso y en el resumen del trabajo. */
  etiqueta: string;
  modo: ModoDeBarrido;
  /** Pide una ventana de filas, YA ORDENADA de forma estable. */
  leer: (desde: number, hasta: number) => Promise<T[]>;
  /** Trata una vuelta entera. */
  tratar: (filas: T[]) => Promise<void>;
  /** La identidad de una fila, para detectar el atasco. */
  idDe: (fila: T) => string;
  pagina?: number;
  tope?: number;
}

/**
 * Recorre o drena hasta el final, y devuelve qué pasó.
 *
 * No lanza por llegar al techo: un barrido que trató diecinueve mil filas y no
 * pudo con la veinte mil uno hizo diecinueve mil cosas bien, y tirarlas
 * abortando sería cambiar un problema por otro mayor. Lo dice en el resumen y
 * el llamante decide.
 */
export async function barrer<T>(opciones: OpcionesDeBarrido<T>): Promise<ResumenBarrido> {
  const pagina = opciones.pagina ?? PAGINA;
  const tope = opciones.tope ?? TOPE;
  let vistas = 0;
  let vueltas = 0;
  let previas: string[] = [];

  for (;;) {
    const { desde, hasta } = ventana(opciones.modo, vistas, pagina);
    const filas = await opciones.leer(desde, hasta);
    if (filas.length === 0) return { vistas, vueltas, truncado: false, atascado: false };

    const ids = filas.map(opciones.idDe);
    if (opciones.modo === "drenaje" && atascado(previas, ids)) {
      return { vistas, vueltas, truncado: false, atascado: true };
    }
    previas = ids;

    await opciones.tratar(filas);
    vistas += filas.length;
    vueltas++;

    // Una vuelta corta significa que no había más: es el final normal, y el
    // único que no cuesta una lectura de más.
    if (filas.length < pagina) return { vistas, vueltas, truncado: false, atascado: false };
    if (vistas >= tope) return { vistas, vueltas, truncado: true, atascado: false };
  }
}
