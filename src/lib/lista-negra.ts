/**
 * LA LISTA NEGRA DEL CLIENTE: las decisiones, en puro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ERA UNA CASILLA, NO UNA FUNCIÓN
 *
 * `customer.status` admite `blacklist` desde la primera migración y el
 * formulario del directorio lo ofrece en un desplegable con su etiqueta. Lo que
 * no existía en ninguna parte del sistema era alguien que lo LEYERA: se marcaba
 * a una persona y seguía comprando por el mostrador, por la web, por la API del
 * socio y por la OTA exactamente igual.
 *
 * Y de las casillas que no hacen nada, esta es de las peores: quien la marca se
 * queda convencido de que hizo algo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ BLOQUEA Y QUÉ NO
 *
 * Bloquea VENDER: una reserva nueva a nombre de esa ficha. No toca nada de lo
 * que ya existe —sus reservas siguen en pie, se le cobra lo que debe, se le
 * cancela si hay que cancelar y viaja si ya pagó—. Una lista negra que
 * cancelara el pasado sería una forma de perder dinero y de dejar tirada a
 * gente en un hotel.
 *
 * Tampoco impide crear la ficha ni escribirle: hace falta poder anotar en ella
 * justamente porque está bloqueada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y NO SE LE DICE AL CLIENTE
 *
 * Hacia fuera —la web, la API— el motivo no viaja y la palabra tampoco. Un
 * desconocido que reserva por internet no tiene por qué enterarse de que está
 * en una lista, y decírselo por una respuesta HTTP es además la peor manera:
 * sin nadie delante que lo explique y con el texto para reenviarlo. Lo que sale
 * es que no se pudo completar en línea y con quién hablar.
 *
 * Dentro es al revés: el cajero tiene a la persona delante y necesita el motivo
 * en la mano para decidir en treinta segundos.
 */

export type EstadoDeCliente = "active" | "inactive" | "blacklist";

export const ESTADOS_DE_CLIENTE: EstadoDeCliente[] = ["active", "inactive", "blacklist"];

export const VETADO: EstadoDeCliente = "blacklist";

/** El código con el que las rutas de fuera reconocen el rechazo sin leer el texto. */
export const CODIGO_VETADO = "CUSTOMER_BLOCKED";

export interface ClienteVetable {
  status?: string | null;
  blocked_reason?: string | null;
  blocked_at?: string | null;
}

/**
 * ¿Está vetado?
 *
 * Solo `blacklist`. `inactive` es otra cosa —una ficha archivada, un duplicado
 * que se retiró del listado— y bloquear ventas por eso convertiría una tarea de
 * limpieza en un veto comercial sin que nadie lo decidiera.
 */
export function estaVetado(cliente: ClienteVetable | null | undefined): boolean {
  return (cliente?.status ?? "") === VETADO;
}

/** Lo que se le enseña a quien vende, que tiene al cliente delante. */
export function mensajeInterno(cliente: ClienteVetable | null | undefined): string {
  const motivo = String(cliente?.blocked_reason ?? "").trim();
  return motivo
    ? `Este cliente está en la lista negra: ${motivo}`
    : "Este cliente está en la lista negra.";
}

/**
 * Lo que sale hacia fuera: ni el motivo ni la palabra.
 *
 * Con teléfono, el mismo texto que usa la página cuando el plan no admite
 * reservas: la venta se salva por la vía de siempre y el cliente no tiene por
 * qué saber de listas ni de suscripciones.
 */
export function mensajePublico(telefono?: string | null): string {
  const tel = String(telefono ?? "").trim();
  return tel
    ? `No pudimos completar esta reserva en línea. Escríbenos al ${tel} y te atendemos.`
    : "No pudimos completar esta reserva en línea. Escríbenos y te atendemos.";
}

/** Un motivo de dos palabras no es un motivo. */
export const MOTIVO_MINIMO = 10;

export function motivoValido(texto: unknown): boolean {
  return typeof texto === "string" && texto.trim().length >= MOTIVO_MINIMO;
}

export const MENSAJE_SIN_MOTIVO =
  `Para bloquear a un cliente hace falta un motivo de al menos ${MOTIVO_MINIMO} caracteres: ` +
  "quien lo encuentre bloqueado dentro de seis meses tiene que poder decidir con eso.";

export type CambioDeVeto = "veta" | "levanta" | "ninguno";

/**
 * Qué clase de cambio es este.
 *
 * Se mira el par ANTES→DESPUÉS y no solo lo que llega: el formulario genérico
 * manda todos sus campos en cada guardado, también los que nadie tocó, así que
 * rechazar por «viene el estado» convertiría cualquier edición de una nota en
 * un error incomprensible. Es el mismo criterio que `field-write-role.ts`.
 */
export function cambioDeVeto(
  actual: string | null | undefined,
  siguiente: string | null | undefined
): CambioDeVeto {
  if (siguiente === undefined || siguiente === null) return "ninguno";
  const antes = String(actual ?? "");
  const despues = String(siguiente);
  if (antes === despues) return "ninguno";
  if (despues === VETADO) return "veta";
  if (antes === VETADO) return "levanta";
  return "ninguno";
}

export const MENSAJE_PUERTA_EQUIVOCADA =
  "La lista negra no se cambia desde la ficha: usa el botón de bloquear, que pide el motivo " +
  "y deja constancia de quién fue.";

/**
 * ¿Este cambio tiene que pasar por la puerta del bloqueo?
 *
 * Se usa desde el CRUD genérico, que es donde vivía la casilla. Devuelve el
 * mensaje cuando hay que rechazar, y `null` cuando no hay nada que decir: así
 * quien lo llama no tiene que repetir la condición.
 */
export function puertaEquivocada(
  table: string,
  payload: Record<string, unknown>,
  actual: Record<string, unknown> | null | undefined
): string | null {
  if (table !== "customer") return null;
  /**
   * No se comprueba aquí si el campo VIENE: eso ya lo decide `cambioDeVeto`,
   * que devuelve «ninguno» para `undefined` y para `null`. Tenerlo en los dos
   * sitios no es defensa en profundidad —viven en el mismo fichero, a tres
   * funciones— sino una segunda copia de la misma regla, y de esas la que se
   * queda desactualizada es siempre la que nadie mira.
   */
  const cambio = cambioDeVeto(
    actual ? (actual.status as string | null | undefined) : null,
    payload.status as string | null | undefined
  );
  return cambio === "ninguno" ? null : MENSAJE_PUERTA_EQUIVOCADA;
}
