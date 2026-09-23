/**
 * DE QUIÉN ES CADA CAJA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL DINERO DE LA CALLE NO CABÍA EN EL MODELO
 *
 * `cash_register`, `cash_session` y `cash_movement` llevaban sucursal y
 * usuario. No había forma de decir «esta caja es del mostrador del tour center
 * Coral» ni «este turno es del vendedor de la playa», así que el efectivo de
 * fuera o no existía o entraba en el cajón de la operadora.
 *
 * Con la identidad puesta (0081) aparece la pregunta que antes no se podía ni
 * formular: quién puede abrir cada caja. Y la respuesta no es un rango.
 *
 * Todo lo de aquí es puro: no lee la base ni el contexto de sesión.
 */

export interface CajaConDueno {
  partner?: unknown;
  seller?: unknown;
  partner_id?: string | null;
  seller_id?: string | null;
  name?: string | null;
  status?: string | null;
}

export interface ActorDeCaja {
  /** Su tour center, si es de uno. */
  partnerId?: string | null;
  /** Lo decide `esDeSocio(ctx)`, el único sitio que mira el nombre del rol. */
  esDeSocio: boolean;
  /** Su ficha de vendedor, si la tiene. */
  sellerId?: string | null;
  /** Manda dentro de su tour center (0073), no en la operadora. */
  esAdminDeSocio?: boolean;
}

function idDe(valor: unknown): string | null {
  if (!valor) return null;
  if (typeof valor === "string") return valor.trim() || null;
  if (typeof valor === "object") {
    const r = valor as { _id?: unknown; id?: unknown };
    const id = r._id ?? r.id;
    return typeof id === "string" ? id.trim() || null : null;
  }
  return null;
}

/** El dueño declarado de una caja o de un turno. */
export function duenoDeLaCaja(caja: CajaConDueno | null | undefined): {
  partnerId: string | null;
  sellerId: string | null;
} {
  if (!caja) return { partnerId: null, sellerId: null };
  return {
    partnerId: idDe(caja.partner) ?? idDe(caja.partner_id),
    sellerId: idDe(caja.seller) ?? idDe(caja.seller_id),
  };
}

/** Una caja SIN socio es de la operadora. Es lo que significa el hueco. */
export function esCajaDeLaOperadora(caja: CajaConDueno | null | undefined): boolean {
  return duenoDeLaCaja(caja).partnerId === null;
}

/**
 * ¿Puede esta persona abrir este turno? Devuelve el motivo o `null`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LAS DOS DIRECCIONES, Y LA SEGUNDA ES LA QUE SE OLVIDA
 *
 * Hacia dentro: el miembro de un tour center no abre la caja de otro, ni —y
 * esta es la que no se piensa— **la de la operadora**. Dejarle abrirla metería
 * su efectivo en el cajón de la casa, que es justo el descuadre que toda esta
 * fase existe para evitar; y el arqueo interno lo contaría como propio porque
 * esos movimientos no llevarían socio.
 *
 * Hacia fuera: el personal interno no abre la caja de un socio. Su arqueo lo
 * firma el socio, y un turno abierto por la operadora en el mostrador de otro
 * es un arqueo que nadie puede defender.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y LA CAJA DE UN VENDEDOR ES SUYA
 *
 * Un turno de vendedor abierto por otra persona es un arqueo con el nombre
 * equivocado: al cuadrar, la diferencia se le apunta a quien no estuvo ahí.
 * Dentro de un tour center, su administrador sí puede —es quien responde por
 * ese mostrador—; dentro de la operadora eso lo resuelve el rango, que se
 * comprueba en la ruta.
 */
export function noPuedeAbrirLaCaja(
  caja: CajaConDueno | null | undefined,
  actor: ActorDeCaja
): string | null {
  if (!caja) return "Caja no encontrada.";
  if ((caja.status ?? "active") !== "active") return "Esta caja está inactiva.";

  const dueno = duenoDeLaCaja(caja);
  const miSocio = (actor.partnerId || "").trim() || null;

  if (actor.esDeSocio) {
    // Sin ficha de socio no se abre ninguna caja de socio — ni la de la
    // operadora. Fallar hacia el silencio, igual que en el resto del ámbito.
    if (!miSocio) return "Tu usuario no está asociado a ningún tour center.";
    if (dueno.partnerId === null) {
      return "Esta caja es de la operadora: tu efectivo no entra en su arqueo.";
    }
    if (dueno.partnerId !== miSocio) return "Esta caja es de otro tour center.";
  } else if (dueno.partnerId !== null) {
    return "Esta caja es de un tour center: su arqueo lo firma él.";
  }

  if (dueno.sellerId) {
    const esSuya = Boolean(actor.sellerId) && dueno.sellerId === actor.sellerId;
    // El administrador del tour center responde por el mostrador de los suyos.
    if (!esSuya && !(actor.esDeSocio && actor.esAdminDeSocio)) {
      return "Esta caja es de otro vendedor.";
    }
  }

  return null;
}

/**
 * El filtro que deja el arqueo de la operadora limpio de dinero ajeno.
 *
 * `{ partner: null }` y no «sin filtro»: el criterio del plan es que un arqueo
 * de la operadora no incluya NI UN movimiento de caja de socio, y eso es una
 * condición que hay que escribir. Omitir el filtro para el personal interno —
 * que es lo que hace la política de la base, donde el interno lo ve todo— haría
 * que el arqueo sumara el efectivo de los tour centers como propio.
 *
 * Para quien es de un socio, su propio identificador: ve su caja y solo la
 * suya.
 */
export function filtroDeArqueo(actor: ActorDeCaja): Record<string, unknown> {
  if (actor.esDeSocio) {
    // Sin ficha, nada: es la misma respuesta que da el resto de su ámbito, y
    // aquí además evita que caiga en el filtro de la operadora.
    return { partner: (actor.partnerId || "").trim() || "__sin_socio__" };
  }
  return { partner: null };
}

/**
 * ¿Le basta el rango para tocar la caja, o tiene que ser la SUYA?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE ABRE, Y HASTA DÓNDE
 *
 * Las rutas de caja pedían `cashier`, y un `seller` está por debajo. Así que el
 * promotor de playa —la persona entera para la que existe el modo «retiene su
 * comisión»— no podía abrir un turno, y sin turno no hay dónde apuntar lo que
 * se queda ni con qué cuadrar al final del día.
 *
 * Se abre lo MÍNIMO: un vendedor puede operar la caja cuyo `seller_id` es el
 * suyo, y ninguna otra. No es un rango nuevo ni una excepción por rol — es la
 * misma regla de propiedad que ya decide todo lo demás en este módulo, y por
 * eso vive aquí y no en cada ruta.
 *
 * Devuelve `true` cuando hace falta el rango de siempre, es decir, cuando la
 * caja NO es suya. Se escribe en ese sentido a propósito: quien llama hace
 * `if (exigeRango(...)) requireAtLeast(ctx, "cashier")`, y olvidarse de la
 * comprobación deja la ruta abierta de par en par — con el sentido contrario,
 * olvidarse la deja cerrada, que es un fallo que se ve el primer día.
 */
export function exigeRangoDeCaja(
  caja: CajaConDueno | null | undefined,
  actor: ActorDeCaja
): boolean {
  const dueno = duenoDeLaCaja(caja);
  // Sin dueño declarado, es la caja del mostrador: el rango de siempre.
  if (!dueno.sellerId) return true;
  // Y sin ficha de vendedor tampoco se libra nadie del rango: un actor sin
  // identificador no puede ser el dueño de nada.
  if (!actor.sellerId) return true;
  return dueno.sellerId !== actor.sellerId;
}
