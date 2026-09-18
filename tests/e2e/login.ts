import type { Page } from "@playwright/test";

/**
 * Entrar al sistema, y —si no se entra— DECIR POR QUÉ.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE PASÓ, Y QUE ES LA RAZÓN DE QUE ESTO EXISTA
 *
 * Los dos E2E hacían el login a mano y esperaban con `waitForURL`. Cuando dejó
 * de entrar, el registro del CI decía exactamente esto y nada más:
 *
 *     TimeoutError: page.waitForURL: Timeout 60000ms exceeded.
 *     waiting for navigation until "load"
 *
 * Con eso no se puede diagnosticar: caben tres fallos distintos, en tres sitios
 * distintos, y se arreglan de tres maneras distintas.
 *
 *   1. El formulario mostró un error → las credenciales o la propia cuenta.
 *   2. La petición de sesión fue rechazada → el servidor de autenticación, o el
 *      enganche que inyecta `org_id` en el token.
 *   3. La sesión se creó pero la pantalla destino no respondió → la aplicación
 *      o la base, no el login.
 *
 * El comentario que había en la prueba afirmaba que un login fallido «produce un
 * timeout claro». No lo produce. Un tiempo agotado dice CUÁNDO se rindió la
 * prueba, no QUÉ pasó.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ SE REGISTRA, Y QUÉ NO
 *
 * Se apunta el CÓDIGO de un rechazo de autenticación, nunca el cuerpo entero de
 * la respuesta: el de una respuesta correcta lleva el token de sesión, y
 * volcarlo lo dejaría escrito en el registro del CI, que se lee sin permisos
 * especiales. La contraseña no aparece por ninguna parte — se envía, no se
 * registra.
 */

/** El endpoint de GoTrue que emite la sesión. */
const TOKEN_PATH = "/auth/v1/token";

/** Lo mismo que esperaban las pruebas antes: un minuto para entrar. */
export const LOGIN_TIMEOUT_MS = 60_000;

/** Los campos del error de autenticación que SÍ se pueden registrar. */
function authErrorCode(body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>;
  return ["error_code", "error", "code", "msg", "message", "error_description"]
    .map((k) => b[k])
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" · ");
}

export interface LoginOptions {
  email: string;
  password: string;
  /** La ruta a la que se entra; es la que decide si el login sirvió. */
  expectPath: string;
}

export async function login(page: Page, { email, password, expectPath }: LoginOptions): Promise<void> {
  // Los tres testigos. Se enganchan ANTES de pulsar: lo que se quiere saber
  // ocurre entre el clic y el tiempo agotado, no después.
  const authRejections: string[] = [];
  const pageErrors: string[] = [];
  const targetResponses: string[] = [];

  page.on("response", (res) => {
    let pathname: string;
    try {
      pathname = new URL(res.url()).pathname;
    } catch {
      return;
    }

    if (pathname.endsWith(TOKEN_PATH) && res.status() >= 400) {
      // `.json()` sobre una respuesta ya consumida puede fallar; el estado solo
      // ya distingue un 400 (credenciales) de un 500 (base o enganche).
      res
        .json()
        .then((body) => authRejections.push(`${res.status()} ${authErrorCode(body)}`.trim()))
        .catch(() => authRejections.push(String(res.status())));
      return;
    }

    // La respuesta de la pantalla destino: su ausencia es un diagnóstico en sí
    // misma —el servidor no llegó a contestar— y con ella, su código.
    if (pathname === expectPath) targetResponses.push(`${res.status()}`);
  });

  page.on("pageerror", (err) => pageErrors.push(String(err?.message ?? err)));

  await page.goto(`/login?redirect=${encodeURIComponent(expectPath)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);

  const startedAt = Date.now();
  await page.getByRole("button", { name: "Entrar" }).click();

  // Se compara el PATHNAME, no la URL entera: `/login?redirect=/dashboard`
  // contiene la ruta destino en el query, así que un patrón sobre la URL
  // completa daría por buena la navegación aunque siguiéramos en /login.
  try {
    await page.waitForURL((url) => url.pathname === expectPath, { timeout: LOGIN_TIMEOUT_MS });
  } catch (err) {
    throw new Error(await explain(page, expectPath, Date.now() - startedAt, {
      authRejections, pageErrors, targetResponses,
    }), { cause: err });
  }
}

async function explain(
  page: Page,
  expectPath: string,
  elapsedMs: number,
  seen: { authRejections: string[]; pageErrors: string[]; targetResponses: string[] }
): Promise<string> {
  const lines: string[] = [
    `No se entró a ${expectPath} en ${Math.round(elapsedMs / 1000)}s.`,
    `URL al rendirse: ${safePathname(page)}`,
  ];

  // Lo que el usuario habría visto: el texto de la alerta del formulario. Es lo
  // primero que se mira en el mostrador, y aquí no se veía nunca.
  const alerts = await page
    .getByRole("alert")
    .allTextContents()
    .catch(() => [] as string[]);
  const visible = alerts.map((t) => t.trim()).filter(Boolean);
  lines.push(visible.length ? `Mensaje en pantalla: ${visible.join(" | ")}` : "Sin mensaje de error en pantalla.");

  lines.push(
    seen.authRejections.length
      ? `La petición de sesión fue rechazada: ${seen.authRejections.join(" | ")}`
      : "La petición de sesión no fue rechazada."
  );

  // Ningún código de respuesta para la ruta destino significa que la navegación
  // se lanzó y el servidor no contestó — o que nunca se lanzó, que es el caso
  // en el que el login no llegó a crear la sesión.
  lines.push(
    seen.targetResponses.length
      ? `${expectPath} respondió: ${seen.targetResponses.join(", ")}`
      : `${expectPath} no llegó a responder (o la navegación nunca se lanzó).`
  );

  if (seen.pageErrors.length) lines.push(`Errores de JavaScript: ${seen.pageErrors.join(" | ")}`);

  return lines.join("\n  ");
}

function safePathname(page: Page): string {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return page.url();
  }
}
