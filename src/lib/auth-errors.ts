/**
 * QUÉ SE LE DICE A ALGUIEN QUE NO CONSIGUE ENTRAR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UN MÓDULO Y NO UN `if` EN LA PANTALLA
 *
 * El proveedor de identidad contesta lo mismo —`invalid_credentials`— a tres
 * situaciones distintas, y lo hace a propósito: distinguirlas en la respuesta
 * convertiría el formulario en un buscador de cuentas («este correo existe,
 * este no»), que es como se prepara un ataque dirigido.
 *
 *   · la cuenta no existe en ESTE proyecto de Supabase;
 *   · la cuenta existe y la contraseña no es esa;
 *   · la cuenta existía en OTRO proyecto (el de antes de una migración).
 *
 * El mensaje que había aquí elegía una de las tres y la afirmaba: «Verifica que
 * la cuenta exista en este proyecto». En el caso corriente —una contraseña mal
 * tecleada— eso manda a la persona a revisar la base de datos. Un mensaje que
 * inventa la causa cuesta más que uno que no dice nada.
 *
 * Así que aquí se dice lo único que se sabe (no coinciden) y se ofrece lo único
 * que se puede hacer sin adivinar (restablecerla). Quien administra tiene un
 * comprobador aparte —`npm run check:account`— que SÍ puede mirar, porque corre
 * con credenciales y no delante de un desconocido.
 *
 * Lo que sí se distingue es lo que no es ambiguo: correo sin confirmar, cuenta
 * bloqueada, demasiados intentos y servidor inalcanzable. Los cuatro llegaban
 * en inglés y crudos.
 */

/** Lo que la pantalla necesita de un error de autenticación. */
export type AuthFailure = {
  /** El texto que se enseña. Siempre en español y siempre accionable. */
  message: string;
  /**
   * Si conviene ofrecer el enlace de «¿La olvidaste?» junto al mensaje.
   * No se ofrece cuando el problema no es la contraseña: mandar a
   * restablecerla a quien está bloqueado por intentos sólo suma un intento.
   */
  offerReset: boolean;
};

/** Forma mínima del error que devuelve el cliente de autenticación. */
export type AuthErrorLike = {
  message?: string | null;
  code?: string | null;
  status?: number | null;
} | null | undefined;

const POR_CODIGO: Record<string, AuthFailure> = {
  invalid_credentials: {
    message: "El email o la contraseña no coinciden. Si no recuerdas la contraseña, pide una nueva desde «¿La olvidaste?».",
    offerReset: true,
  },
  email_not_confirmed: {
    message: "La cuenta existe pero su email no está confirmado. Abre el enlace de confirmación que recibiste, o pide a un administrador que la confirme.",
    offerReset: false,
  },
  user_banned: {
    message: "Esta cuenta está bloqueada. Habla con el administrador de tu empresa.",
    offerReset: false,
  },
  over_request_rate_limit: {
    message: "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.",
    offerReset: false,
  },
  validation_failed: {
    message: "Revisa el email y la contraseña: falta alguno de los dos o el email no tiene un formato válido.",
    offerReset: false,
  },
  signup_disabled: {
    message: "El registro por email está desactivado en este entorno. Pide a un administrador que te dé de alta.",
    offerReset: false,
  },
  user_already_exists: {
    message: "Ya existe una cuenta con ese email. Entra con ella, o pide una contraseña nueva desde «¿La olvidaste?».",
    offerReset: true,
  },
  weak_password: {
    message: "Esa contraseña es demasiado débil. Usa al menos 8 caracteres y combina letras y números.",
    offerReset: false,
  },
};

/**
 * Versiones del cliente sin `code` traen sólo el texto en inglés. Se reconoce
 * por ahí, que es frágil, pero es la diferencia entre un mensaje útil y uno
 * crudo — y el camino con `code` sigue siendo el primero que se intenta.
 */
const POR_TEXTO: [RegExp, string][] = [
  [/invalid login credentials/i, "invalid_credentials"],
  [/email not confirmed/i, "email_not_confirmed"],
  [/user is banned/i, "user_banned"],
  [/rate limit|too many requests/i, "over_request_rate_limit"],
  [/user already registered/i, "user_already_exists"],
  [/password should be/i, "weak_password"],
  [/signups? not allowed|signup is disabled/i, "signup_disabled"],
];

const SIN_RED: AuthFailure = {
  message: "No se pudo contactar con el servidor. Revisa tu conexión y vuelve a intentarlo.",
  offerReset: false,
};

const DESCONOCIDO: AuthFailure = {
  message: "No se pudo iniciar sesión. Vuelve a intentarlo en un momento.",
  offerReset: false,
};

/**
 * Traduce un fallo de autenticación al mensaje que se enseña.
 *
 * `null`/`undefined` no es un caso de error: significa que no hubo fallo, y
 * devolver un mensaje ahí pintaría una alerta roja tras un acceso correcto.
 */
export function describeAuthError(error: AuthErrorLike): AuthFailure | null {
  if (!error) return null;

  const codigo = typeof error.code === "string" ? error.code : "";
  if (codigo && POR_CODIGO[codigo]) return POR_CODIGO[codigo];

  const texto = typeof error.message === "string" ? error.message : "";

  // Un 429 sin código es igualmente un límite de intentos: el número lo dice.
  if (error.status === 429) return POR_CODIGO.over_request_rate_limit;

  for (const [patron, clave] of POR_TEXTO) {
    if (patron.test(texto)) return POR_CODIGO[clave];
  }

  // `fetch` caído no trae ni código ni estado; es lo que distingue «el servidor
  // dijo que no» de «no hubo servidor».
  if (!error.status && /fetch|network|load failed/i.test(texto)) return SIN_RED;

  return DESCONOCIDO;
}
