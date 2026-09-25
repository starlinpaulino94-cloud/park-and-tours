/**
 * EL PROVEEDOR ASIGNA SU PROPIA FLOTA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASABA
 *
 * La operadora encarga «una guagua de 30 plazas para la Saona del jueves» y el
 * transportista decide cuál manda y quién la conduce — eso lo sabe él, no la
 * oficina—. Pero en el sistema solo podía escribirlo la operadora: el
 * transportista lo decía por WhatsApp y alguien lo teclaba. Cuando no lo teclaba,
 * el manifiesto salía con «sin asignar» y la hoja de ruta sin chofer.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ES LA PRIMERA ESCRITURA QUE HACE UN PROVEEDOR SOBRE LA OPERACIÓN
 *
 * Hasta ahora solo contestaba sobre su propia fila (aceptar, rechazar, facturar).
 * Aquí escribe dos referencias que la operadora usa para despachar, y eso
 * significa que hay tres preguntas nuevas que el rango NO responde:
 *
 *  1. ¿Es SUYA la fila que está tocando? Lo decide `supplier_id`, no el rango.
 *  2. ¿Es SUYO el vehículo que pone? Sin esto, un transportista podría asignar
 *     la guagua de la competencia —o la de la operadora— a su propio servicio, y
 *     descubrirlo sería cosa del día del viaje.
 *  3. ¿Puede todavía? Un servicio que rechazó, que se le venció, o que ya pasó,
 *     no se asigna: escribir ahí es cambiar la historia.
 *
 * Los papeles del vehículo (8.6) y el choque de agenda (esta ola) los contesta el
 * mismo código que la escritura interna. Dos comprobaciones distintas para la
 * misma pregunta acabarían diciendo cosas distintas, y la del proveedor sería la
 * floja.
 */

import type { EstadoDeAceptacion } from "@/lib/aceptacion-proveedor";

/** Lo que hace falta saber de la fila para decidir si se puede asignar. */
export interface ServicioAsignable {
  status?: string | null;
  acceptance?: string | null;
  service_date?: string | null;
}

export type MotivoParaNoAsignar = "cancelado" | "rechazado" | "vencido" | "pasado";

export interface VetoDeAsignacion {
  motivo: MotivoParaNoAsignar;
  mensaje: string;
  status: number;
}

const MENSAJES: Record<MotivoParaNoAsignar, string> = {
  cancelado: "Este servicio está cancelado",
  rechazado: "Rechazaste este servicio: no hay nada que asignar",
  vencido: "Se venció el plazo de respuesta de este servicio",
  pasado: "Este servicio ya pasó",
};

const veto = (motivo: MotivoParaNoAsignar, status = 409): VetoDeAsignacion =>
  ({ motivo, mensaje: MENSAJES[motivo], status });

/**
 * ¿Puede el proveedor poner su flota en este servicio?
 *
 * Devuelve el motivo y no un booleano porque el motivo se le enseña: «no se
 * puede» sin decir por qué acaba en una llamada a la oficina, que es justo lo
 * que este portal existe para evitar.
 *
 * **El día se compara por FECHA y no por instante.** Un servicio de hoy a las
 * seis de la mañana se puede seguir asignando a las siete: el chofer ya salió,
 * pero apuntar quién fue es exactamente lo que hace falta para que la hoja de
 * ruta y la liquidación digan la verdad. Comparar contra el reloj habría cerrado
 * la puerta en el peor momento posible — cuando hay que corregir un cambio de
 * última hora.
 */
export function vetoDeAsignacion(
  servicio: ServicioAsignable,
  hoy: string
): VetoDeAsignacion | null {
  if (String(servicio.status ?? "").toLowerCase() === "cancelled") return veto("cancelado");

  const aceptacion = String(servicio.acceptance ?? "") as EstadoDeAceptacion | "";
  if (aceptacion === "rejected") return veto("rechazado");
  if (aceptacion === "expired") return veto("vencido");

  const dia = typeof servicio.service_date === "string" ? servicio.service_date.slice(0, 10) : null;
  // Sin fecha NO se veta: la fila existe, es suya, y bloquear por un dato que la
  // operadora no rellenó dejaría al transportista sin poder decir quién va.
  if (dia && dia < hoy) return veto("pasado");

  return null;
}

/* ───────────────────────────────────────────────── qué campos puede escribir */

/**
 * LO QUE EL PROVEEDOR PUEDE ESCRIBIR EN CADA TABLA, Y NADA MÁS.
 *
 * Lista blanca, no lista negra, por la razón de siempre: el día que estas tablas
 * ganen una columna —un coste acordado, una nota de la operadora— no se le abre
 * sola. Y no está `pax_assigned` ni `status` a propósito: cuánta gente lleva el
 * servicio y en qué estado está lo decide quien vende, no quien transporta.
 */
export const CAMPOS_QUE_ASIGNA_EL_PROVEEDOR: Record<string, string[]> = {
  departure_resource: ["vehicle", "staff"],
  pickup_route: ["vehicle", "driver", "guide"],
};

/** Los campos de una tabla que apuntan a personal de su plantilla. */
export const CAMPOS_DE_PERSONAL: Record<string, string[]> = {
  departure_resource: ["staff"],
  pickup_route: ["driver", "guide"],
};

export type TipoDeServicio = "recurso" | "ruta";

export const TABLA_DEL_TIPO: Record<TipoDeServicio, string> = {
  recurso: "departure_resource",
  ruta: "pickup_route",
};

/**
 * El payload limpio: solo lo que ese tipo de servicio admite.
 *
 * Se construye eligiendo de la lista blanca y no copiando y borrando, igual que
 * el recorte del manifiesto: borrar deja dentro lo que nadie se acordó de
 * borrar. Y `null` SÍ pasa —es «quítalo»—, mientras `undefined` es «no lo
 * toques»: sin esa distinción, un transportista no podría retirar la guagua que
 * se le acaba de averiar.
 */
export function payloadDeAsignacion(
  tipo: TipoDeServicio,
  entrada: Record<string, unknown>
): Record<string, unknown> {
  const permitidos = CAMPOS_QUE_ASIGNA_EL_PROVEEDOR[TABLA_DEL_TIPO[tipo]] ?? [];
  const salida: Record<string, unknown> = {};
  for (const campo of permitidos) {
    if (entrada[campo] === undefined) continue;
    salida[campo] = entrada[campo] === null || entrada[campo] === "" ? null : entrada[campo];
  }
  return salida;
}
