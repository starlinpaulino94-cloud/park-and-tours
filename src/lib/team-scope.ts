import type { AppRole } from "@/lib/auth";
import { atLeast, esDeSocio, TenantError } from "@/lib/tenant";

/**
 * QUIÉN PUEDE GESTIONAR A QUIÉN. LA DECISIÓN, EN UN SOLO SITIO Y PURA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE CAMBIA
 *
 * Hasta aquí, dar de alta a alguien de un tour center solo podía hacerlo la
 * operadora. Es lo que hace todo el mercado al revés: el tour center contrata a
 * un vendedor un martes y tiene que pedirle por teléfono a su operadora que le
 * abra una cuenta. Con dos operadoras, dos llamadas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y LO QUE NO PUEDE CAMBIAR
 *
 * Que el socio gestione a los suyos NO puede convertirse en que el socio
 * gestione a nadie más. Por eso la respuesta de aquí no es «sí/no»: es «sí, y
 * SOBRE ESTA organización», y quien llama la usa como filtro de la consulta en
 * vez de comprobar después. Un permiso que devuelve un ámbito no se puede
 * olvidar de aplicarlo.
 */

export interface Actor {
  role: AppRole;
  companyId: string;
  partnerId?: string | null;
  isPartnerMember?: boolean;
  partnerRole?: string | null;
}

export interface AmbitoEquipo {
  /**
   * La organización cuyas membresías puede tocar. `null` = la operadora y
   * todos sus tour centers (es el personal interno).
   */
  organizationId: string | null;
  esSocio: boolean;
}

/** El administrador DENTRO de un tour center. */
export function esAdminDeSocio(actor: Actor): boolean {
  return esDeSocio(actor) && actor.partnerRole === "admin";
}

/**
 * ¿Puede LEER el equipo? Lanza si no.
 *
 * El socio ve a los suyos aunque no sea administrador: saber quién de tu propia
 * empresa tiene acceso no es una facultad de gestión, y ocultárselo solo
 * conseguiría que las cuentas de quien se fue sigan abiertas porque nadie las
 * ve.
 */
export function ambitoDeLectura(actor: Actor): AmbitoEquipo {
  if (esDeSocio(actor)) {
    if (!actor.partnerId) throw new TenantError("Tu usuario no está asociado a ningún partner", 403);
    return { organizationId: actor.partnerId, esSocio: true };
  }
  if (!atLeast(actor.role, "manager")) {
    throw new TenantError("No tienes permisos para realizar esta acción", 403);
  }
  return { organizationId: null, esSocio: false };
}

/**
 * ¿Puede ESCRIBIR en el equipo? Lanza si no.
 *
 * Aquí sí hace falta ser administrador del socio. Un mensaje aparte para ese
 * caso y no el genérico de permisos: quien lo lee trabaja en otra empresa y no
 * tiene a quién preguntar en la operadora — hay que decirle que la persona a la
 * que se lo tiene que pedir está en su propia oficina.
 */
export function ambitoDeEscritura(actor: Actor): AmbitoEquipo {
  if (esDeSocio(actor)) {
    if (!esAdminDeSocio(actor)) {
      throw new TenantError(
        "Solo quien administra la cuenta de tu empresa puede dar de alta o modificar usuarios",
        403
      );
    }
    return { organizationId: actor.partnerId!, esSocio: true };
  }
  if (!atLeast(actor.role, "admin")) {
    throw new TenantError("No tienes permisos para realizar esta acción", 403);
  }
  return { organizationId: null, esSocio: false };
}

/** La jerarquía interna del socio que se va a otorgar. */
export function partnerRolePedido(valor: unknown): "admin" | "agent" {
  // Por defecto, el que menos puede. Un campo ausente o con basura no puede
  // acabar creando administradores.
  return valor === "admin" ? "admin" : "agent";
}

/**
 * QUE NO SE QUEDE NINGÚN TOUR CENTER SIN ADMINISTRADOR.
 *
 * Es el caso que deja una empresa entera encerrada fuera de su propia gestión,
 * y llega por dos caminos que parecen distintos y son el mismo: bajarse uno
 * mismo a `agent`, o desactivarse. La operadora podría rescatarlos, pero eso es
 * exactamente el trámite que esta entrega existe para quitar.
 */
export function assertNoSeQuedaSinAdmin(input: {
  esSocio: boolean;
  esUnoMismo: boolean;
  administradoresActivos: number;
  nuevoPartnerRole?: string | null;
  nuevoStatus?: string | null;
}): void {
  if (!input.esSocio || !input.esUnoMismo) return;
  const sigueMandando =
    (input.nuevoPartnerRole ?? "admin") === "admin" &&
    (input.nuevoStatus ?? "active") === "active";
  if (sigueMandando) return;
  if (input.administradoresActivos > 1) return;
  throw new TenantError(
    "Eres la única persona que administra la cuenta de tu empresa: nombra a otra antes de quitarte el permiso",
    409
  );
}
