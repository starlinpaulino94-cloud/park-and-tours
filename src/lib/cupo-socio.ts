import type { AllotmentState } from "@/lib/allotments";

/**
 * LO QUE EL SOCIO PUEDE RESERVAR DE VERDAD.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MOTOR DE CUPOS ESTABA ENTERO; LO QUE FALTABA ERA ENSEÑARLO
 *
 * `allotments.ts` decide, `allotment-service.ts` lo aplica y
 * `createOrderWithBookings` —el único camino que crea reservas— lo comprueba
 * antes de tomar plazas. Eso funciona: un socio con diez plazas garantizadas no
 * vende once.
 *
 * Lo que no funcionaba es que el socio no lo sabía. Su catálogo y su pantalla
 * de reservar le enseñaban las plazas libres de la SALIDA —cuarenta— y su
 * contrato eran diez. Vendía quince y el sistema le contestaba un 409 en la
 * cara del turista que tenía delante. El contrato no estaba roto: estaba
 * escondido, y un límite que solo aparece al final es indistinguible de un
 * fallo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA FUNCIÓN PARA LAS TRES SUPERFICIES
 *
 * El catálogo del portal, la pantalla de reservar y la API de disponibilidad
 * tienen que decir el MISMO número, y el mismo que va a comprobar la reserva.
 * Por el mismo motivo que el tarifario: dos cuentas del mismo cupo no divergen
 * el día uno, divergen el día que alguien toca una de las dos.
 *
 * Esto es puro: no lee la base. El estado del cupo se lo da
 * `resolveAllotment`, y las plazas de la salida, `plazasLibres`.
 */

/** Por qué no se puede reservar. Cada motivo tiene un remedio distinto. */
export type MotivoCupo =
  /** El contrato está cerrado para esta salida: lo arregla su comercial. */
  | "cerrado"
  /** Se le acabaron SUS plazas: lo arregla su comercial ampliándole el cupo. */
  | "cupo_agotado"
  /** La guagua está llena para todo el mundo: lo arregla otro día. */
  | "salida_llena";

export const MOTIVO_CUPO_MENSAJE: Record<MotivoCupo, string> = {
  cerrado: "Tu contrato no permite vender esta salida. Habla con tu comercial.",
  cupo_agotado: "Agotaste tus plazas contratadas para esta salida.",
  salida_llena: "Esta salida no tiene plazas libres.",
};

/**
 * ¿Esperando cambia?
 *
 * La pantalla de reservar AVISA en vez de bloquear, a propósito: el número que
 * tiene delante es de hace dos minutos y bloquear con él le impediría al socio
 * vender una plaza que acaba de liberarse. Pero eso vale para los topes que se
 * mueven solos, no para el contrato: un cupo CERRADO no se abre porque alguien
 * cancele, así que dejar el botón vivo ahí solo sirve para que el socio escriba
 * los datos del turista y se coma un 409 al final.
 */
export const MOTIVO_DEFINITIVO: Record<MotivoCupo, boolean> = {
  cerrado: true,
  // Se le amplía el cupo, o se cancela una de sus reservas y le vuelve una
  // plaza. Las dos cosas pasan entre que carga la pantalla y confirma.
  cupo_agotado: false,
  // Una cancelación libera plazas todo el rato.
  salida_llena: false,
};

export interface ContratoVisible {
  tipo: AllotmentState["type"];
  contratadas: number;
  usadas: number;
  liberadas: number;
  /** Lo que le queda de SU cupo. `null` cuando el contrato no aparta plazas. */
  restantes: number | null;
}

export interface CupoVisible {
  /**
   * Plazas que este socio puede reservar ahora mismo.
   *
   * `null` es «no se sabe», y NO es cero: una salida sin cupo calculado —creada
   * por SQL, importada, anterior a la columna— no está agotada. Enseñarla como
   * agotada le cierra al socio una salida que está vacía.
   */
  disponible: number | null;
  motivo: MotivoCupo | null;
  /** Cada reserva necesita que la operadora la confirme (`on_request`). */
  requiere_confirmacion: boolean;
  /**
   * Quién pone el tope: su contrato o la salida. Cambia el mensaje y a quién
   * tiene que llamar el socio.
   */
  limita_el_contrato: boolean;
  /** El contrato detrás del número, `null` cuando no tiene ninguno. */
  contrato: ContratoVisible | null;
}

function contratoDe(state: AllotmentState): ContratoVisible | null {
  // Sin fila de cupo, `allotmentState` devuelve un `free_sale` inventado para
  // que la venta siga adelante. Eso es un valor por defecto, no un contrato, y
  // presentarlo como tal le diría al socio que tiene un acuerdo que no firmó.
  if (!state.allotmentId) return null;
  return {
    tipo: state.type,
    contratadas: state.seats,
    usadas: state.used,
    liberadas: state.released,
    restantes: Number.isFinite(state.remaining) ? state.remaining : null,
  };
}

/**
 * Lo que el socio puede reservar: lo menor entre su contrato y la salida.
 *
 * El ORDEN de los motivos no es casual. Primero lo que dice el contrato
 * —cerrado, agotado—, porque eso se sabe con certeza incluso cuando las plazas
 * de la salida no se saben, y porque el remedio es distinto: su comercial le
 * amplía el cupo, pero nadie le agranda la guagua.
 */
export function cupoVisible(plazasDeLaSalida: number | null, state: AllotmentState): CupoVisible {
  const contrato = contratoDe(state);
  const base = {
    requiere_confirmacion: state.needsConfirmation,
    contrato,
  };

  if (!state.sellable) {
    return { ...base, disponible: 0, motivo: "cerrado", limita_el_contrato: true };
  }

  // `remaining` es `Infinity` en venta libre y a petición: esos venden contra
  // la capacidad de la salida y no tienen tope propio.
  const tope = state.remaining;
  if (Number.isFinite(tope) && tope <= 0) {
    return { ...base, disponible: 0, motivo: "cupo_agotado", limita_el_contrato: true };
  }

  if (plazasDeLaSalida === null) {
    // El contrato deja vender, pero de la salida no se sabe nada. Se dice que
    // no se sabe en vez de rellenarlo con el tope del contrato, que sería
    // prometer plazas sin haber mirado si caben.
    return { ...base, disponible: null, motivo: null, limita_el_contrato: false };
  }

  const libres = Math.max(0, Math.floor(plazasDeLaSalida));
  if (libres === 0) {
    return { ...base, disponible: 0, motivo: "salida_llena", limita_el_contrato: false };
  }

  const limita = Number.isFinite(tope) && tope < libres;
  return {
    ...base,
    disponible: limita ? (tope as number) : libres,
    motivo: null,
    limita_el_contrato: limita,
  };
}

/**
 * Lo mismo, listo para pintar.
 *
 * Existe para que la pantalla NO vuelva a calcular las plazas a partir de
 * `capacity`. Cuando el servidor contesta «no se sabe», reconstruirlo en el
 * navegador con la capacidad y cero vendidas devuelve la guagua entera: la
 * pantalla afirmaría cuarenta plazas libres justo cuando nadie las ha contado.
 */
export function cupoParaMostrar(cupo: CupoVisible | null | undefined): {
  libres: number;
  desconocido: boolean;
  bloqueado: boolean;
  /** Tres palabras para poner al lado del número, o `null`. */
  nota: string | null;
} {
  if (!cupo) return { libres: 0, desconocido: true, bloqueado: false, nota: null };
  if (cupo.motivo) {
    const nota = cupo.motivo === "cerrado" ? "cupo cerrado"
      : cupo.motivo === "cupo_agotado" ? "cupo agotado"
      : "salida llena";
    return { libres: 0, desconocido: false, bloqueado: true, nota };
  }
  if (cupo.disponible === null) {
    return { libres: 0, desconocido: true, bloqueado: false, nota: null };
  }
  return {
    libres: cupo.disponible,
    desconocido: false,
    bloqueado: false,
    // Para que el socio sepa a quién llamar: si el tope es suyo, su comercial
    // se lo amplía; si es la guagua, no se lo amplía nadie.
    nota: cupo.limita_el_contrato ? "de tu cupo" : null,
  };
}
