/**
 * EL CICLO DE VIDA DEL SOCIO. DECISIONES PURAS, SIN BASE DE DATOS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `pending` EXISTÍA Y NO HACÍA NADA
 *
 * `organizations.status` admite `pending` desde la primera migración y el
 * formulario de socios lo ofrece en su desplegable. No lo miraba nadie: el
 * enganche del token comprueba el estado de la MEMBRESÍA, no el de la
 * organización del socio, así que un tour center marcado como pendiente —o
 * suspendido, o bloqueado— seguía entrando al portal y reservando con
 * normalidad. Un estado que no se comprueba no es un estado: es una etiqueta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE NIEGA A SECAS
 *
 * Devolver «no autenticado» para un socio pendiente lo deja dando vueltas en
 * la pantalla de entrada sin saber por qué: la contraseña es correcta y el
 * sistema se comporta como si no lo fuera. Son dos respuestas distintas a dos
 * preguntas distintas —la API rechaza la operación; la pantalla explica el
 * motivo— y por eso la razón viaja en el contexto en vez de morir aquí.
 */

/** El estado del socio que sí puede operar. */
const OPERATIVO = "active";

export type MotivoSocio = "pendiente" | "inactivo";

export interface VetoSocio {
  motivo: MotivoSocio;
  mensaje: string;
}

/**
 * ¿Puede operar este socio? `null` = sí.
 *
 * Un estado DESCONOCIDO —porque la consulta falló, o porque alguien escribió
 * una palabra nueva en la columna— cuenta como no operativo. Es la diferencia
 * entre fallar cerrado y fallar abierto, y aquí lo que hay al otro lado es el
 * ERP de la operadora.
 */
export function vetoDeSocio(estado?: string | null): VetoSocio | null {
  const limpio = (estado || "").trim().toLowerCase();
  if (limpio === OPERATIVO) return null;
  if (limpio === "pending") {
    return {
      motivo: "pendiente",
      mensaje:
        "Tu empresa todavía está pendiente de activación. En cuanto el operador la active, " +
        "podrás entrar al portal con esta misma cuenta.",
    };
  }
  return {
    motivo: "inactivo",
    mensaje:
      "El acceso de tu empresa al portal está desactivado. Contacta con el operador con el " +
      "que trabajas para reactivarlo.",
  };
}

/**
 * LAS CONDICIONES COMERCIALES: TRES ESTADOS, NO DOS.
 *
 * «Hay fecha de aceptación» no significa «aceptó ESTO». La operadora cambia el
 * texto y la fecha vieja se queda ahí, acreditando una aceptación de otra cosa
 * — que es justo el papel que alguien sacaría en una discusión sobre una
 * comisión. Por eso se comparan las dos versiones y no se mira la fecha.
 */
export type EstadoCondiciones = "sin_condiciones" | "pendiente" | "aceptadas";

export function estadoDeCondiciones(rel?: {
  terms_version?: number | null;
  terms_accepted_version?: number | null;
  terms_accepted_at?: string | null;
} | null): EstadoCondiciones {
  const vigente = rel?.terms_version ?? 0;
  // Versión 0 es «la operadora nunca escribió condiciones»: no hay nada que
  // aceptar y pedirlo sería inventarse un trámite.
  if (!vigente) return "sin_condiciones";
  if (!rel?.terms_accepted_at) return "pendiente";
  return rel.terms_accepted_version === vigente ? "aceptadas" : "pendiente";
}

/**
 * La versión que deja el texto al editarse.
 *
 * Sube SOLO si el texto cambió de verdad. Guardar la ficha del socio sin tocar
 * las condiciones no puede invalidar una aceptación: el socio recibiría un
 * aviso de «las condiciones han cambiado» cada vez que alguien corrige un
 * teléfono, y a la tercera vez nadie vuelve a leerlas.
 */
export function versionTrasEditar(
  textoAnterior: unknown,
  textoNuevo: unknown,
  versionActual?: number | null
): number {
  const actual = versionActual ?? 0;
  const antes = typeof textoAnterior === "string" ? textoAnterior.trim() : "";
  const ahora = typeof textoNuevo === "string" ? textoNuevo.trim() : "";
  if (antes === ahora) return actual;
  return actual + 1;
}
