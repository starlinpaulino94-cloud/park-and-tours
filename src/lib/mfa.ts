/**
 * EL SEGUNDO FACTOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ PROTEGE, EXACTAMENTE
 *
 * Una contraseña robada. Es el único ataque que importa aquí: nadie va a
 * reventar la criptografía, pero una clave apuntada en una libreta, repetida de
 * otro sitio o pedida por teléfono («soy de soporte») entra igual que su dueño.
 * Y en este sistema entrar significa ver la cartera de clientes, mover caja y
 * anular facturas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VOLUNTARIO, Y AUN ASÍ OBLIGATORIO
 *
 * Nadie está obligado a activarlo. Pero quien lo activa QUEDA protegido de
 * verdad: desde ese momento, una sesión que solo pasó la contraseña no entra a
 * ninguna parte. Un segundo factor que se puede saltar no protege de nada —y es
 * peor que no tenerlo, porque quien lo activó cree que está a salvo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ LA MARCA VIVE EN `app_metadata`
 *
 * La decisión de «esta cuenta exige segundo factor» tiene que viajar en el
 * token, porque si no habría que preguntárselo a Supabase en CADA petición. Y
 * tiene que estar donde el usuario no pueda tocarla: `user_metadata` la escribe
 * el propio usuario con una llamada, así que alguien con la contraseña robada
 * la borraría y entraría. `app_metadata` solo la escribe el rol de servicio.
 */

/** Nivel de garantía de la sesión, tal y como lo pone Supabase en el token. */
export type Aal = "aal1" | "aal2" | string;

export interface MfaClaims {
  aal?: Aal;
  app_metadata?: { mfa_enabled?: boolean } | null;
}

export type MfaGate = "ok" | "verify";

/**
 * ¿Puede pasar esta sesión?
 *
 * `verify` significa «la contraseña ya está, falta el código». No es un error
 * ni un rechazo: es un paso a medio camino, y por eso la pantalla que lo
 * atiende conserva la sesión en vez de cerrarla.
 *
 * `factors` llega cuando Supabase devuelve los factores del usuario. Se usa
 * como segunda señal: si por lo que sea la marca de `app_metadata` no estuviera
 * puesta —una cuenta que se enroló antes de que existiera esta marca—, un
 * factor verificado basta para exigir el código. Entre las dos señales, la
 * decisión se equivoca hacia PEDIR el código, nunca hacia saltárselo.
 */
export function mfaGate(claims: MfaClaims | null | undefined, factorsVerified = false): MfaGate {
  if (!claims) return "ok";
  const required = claims.app_metadata?.mfa_enabled === true || factorsVerified;
  if (!required) return "ok";
  return claims.aal === "aal2" ? "ok" : "verify";
}

/** ¿Tiene esta cuenta un factor ya verificado? */
export function hasVerifiedFactor(
  factors: { status?: string; factor_type?: string }[] | null | undefined
): boolean {
  return (factors ?? []).some((factor) => factor.status === "verified");
}

/**
 * El código de seis dígitos, limpiado antes de mandarlo.
 *
 * Las aplicaciones de autenticación lo enseñan como «123 456», y ese espacio se
 * copia. Quitarlo aquí evita el rechazo más tonto posible: un código correcto
 * que el servidor no reconoce porque llegó con un espacio en medio.
 */
export function normalizeCode(raw: string): string {
  return (raw || "").replace(/[\s-]/g, "").trim();
}

export function isCodeComplete(raw: string): boolean {
  return /^\d{6}$/.test(normalizeCode(raw));
}

/**
 * El nombre con el que la aplicación de autenticación guarda la cuenta.
 *
 * Quien tiene varias empresas ve varias entradas en su teléfono: sin el correo
 * y el sistema delante, son seis dígitos sin dueño y se prueba a ciegas.
 */
export function factorLabel(email: string | null | undefined): string {
  return `Park & Tours (${email || "cuenta"})`;
}
