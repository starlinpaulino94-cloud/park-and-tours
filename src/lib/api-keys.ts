import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * LAS LLAVES DE LA API PÚBLICA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA FORMA DEL TOKEN, Y POR QUÉ ESTA
 *
 *     pt_live_a1b2c3d4.<treinta y dos bytes en base64url>
 *     └──┬───┘ └──┬───┘ └──────────────┬──────────────┘
 *      entorno  prefijo              secreto
 *
 *  · EL PREFIJO se guarda en claro y es por donde se busca la llave: una
 *    consulta por índice en vez de comparar el secreto contra todas las llaves
 *    de la base. También es lo que la pantalla enseña —«pt_live_a1b2c3d4…»—
 *    para que un administrador sepa cuál está revocando sin ver el secreto.
 *  · EL SECRETO no se guarda nunca. Se guarda su SHA-256, igual que una
 *    contraseña: quien consiga leer la tabla —una copia de seguridad, un
 *    volcado mal guardado— no obtiene llaves con las que vender en nombre de
 *    nadie.
 *  · EL ENTORNO delante evita el accidente más común: pegar la llave de
 *    producción en el sistema de pruebas del socio y descubrirlo cuando entran
 *    reservas de mentira en la operación real.
 *
 * La comparación es en tiempo constante. La diferencia es teórica sobre una red
 * con ruido, pero cuesta una línea y el día que alguien mida desde dentro de la
 * misma nube deja de ser teórica.
 */

export type ApiScope = "read" | "write";

export interface ApiKeyMaterial {
  /** El token completo. Se enseña UNA vez y no se puede volver a ver. */
  token: string;
  prefix: string;
  secretHash: string;
}

const ENV_TAG = process.env.NODE_ENV === "production" ? "live" : "test";

/** Crea una llave nueva. El secreto solo existe en esta respuesta. */
export function createApiKey(): ApiKeyMaterial {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return {
    token: `pt_${ENV_TAG}_${prefix}.${secret}`,
    prefix,
    secretHash: hashSecret(secret),
  };
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface ParsedToken {
  prefix: string;
  secret: string;
}

/**
 * Parte el token en prefijo y secreto.
 *
 * Se corta por el ÚLTIMO punto: el secreto es base64url y nunca lleva puntos,
 * pero el prefijo podría llevarlos algún día y partir por el primero dejaría de
 * funcionar sin avisar. Es la misma cautela que con el token de MembeGo.
 */
export function parseToken(raw: string | null | undefined): ParsedToken | null {
  const token = (raw || "").trim();
  if (!token.startsWith("pt_")) return null;
  const body = token.slice(token.indexOf("_", 3) + 1);
  const at = body.lastIndexOf(".");
  if (at <= 0 || at === body.length - 1) return null;
  return { prefix: body.slice(0, at), secret: body.slice(at + 1) };
}

/** Lee el token de la cabecera, aceptando las dos formas que se usan. */
export function tokenFromHeaders(headers: Headers): string | null {
  const auth = headers.get("authorization") || "";
  if (/^bearer /i.test(auth)) return auth.slice(7).trim();
  // Algunos clientes antiguos —y casi todos los ejemplos de curl que circulan—
  // mandan la llave en su propia cabecera. Aceptarla no debilita nada.
  return headers.get("x-api-key");
}

/** Comparación en tiempo constante de dos hashes hexadecimales. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashSecret(secret), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (candidate.length !== stored.length || stored.length === 0) return false;
  return timingSafeEqual(candidate, stored);
}

/* ------------------------------------------------------- lo que puede hacer */

export type KeyProblem = "missing" | "malformed" | "unknown" | "revoked" | "scope";

export const KEY_PROBLEM_MESSAGE: Record<KeyProblem, string> = {
  // Todos dicen lo mismo hacia fuera salvo el de alcance: distinguir «no existe»
  // de «no es válida» le diría a quien prueba llaves cuáles existen.
  missing: "Falta la llave de API. Mándala como «Authorization: Bearer pt_…».",
  malformed: "La llave no tiene el formato esperado.",
  unknown: "Llave no válida.",
  revoked: "Llave no válida.",
  scope: "Esta llave es de solo lectura: no puede crear reservas.",
};

export const KEY_PROBLEM_STATUS: Record<KeyProblem, number> = {
  missing: 401,
  malformed: 401,
  unknown: 401,
  revoked: 401,
  // 403 y no 401: la llave es buena, lo que falta es permiso. Contestar 401
  // haría que el socio revisara su llave durante horas.
  scope: 403,
};

export interface StoredKey {
  id: string;
  organization_id: string;
  secret_hash: string;
  scope: ApiScope;
  partner_id?: string | null;
  revoked_at?: string | null;
}

export type KeyCheck =
  | { ok: true; key: StoredKey }
  | { ok: false; problem: KeyProblem };

/**
 * ¿Sirve esta llave para lo que se está pidiendo?
 *
 * Puro: recibe lo que la base devolvió y decide, así que se prueba sin base de
 * datos. El orden —existe, secreto correcto, no revocada, alcance— no cambia
 * QUÉ pasa (una llave revocada no entra de ninguna forma), cambia QUÉ SE
 * CONTESTA: primero lo que hace inválida a la llave y después lo que le falta
 * de permiso, para que el socio lea «revocada» —que es lo que tiene que
 * arreglar— en vez de «solo lectura», que lo mandaría a pedir otro alcance para
 * una llave que ya no sirve.
 */
export function checkKey(
  stored: StoredKey | null | undefined,
  secret: string,
  needed: ApiScope
): KeyCheck {
  if (!stored) return { ok: false, problem: "unknown" };
  if (!secretMatches(secret, stored.secret_hash)) return { ok: false, problem: "unknown" };
  if (stored.revoked_at) return { ok: false, problem: "revoked" };
  if (needed === "write" && stored.scope !== "write") return { ok: false, problem: "scope" };
  return { ok: true, key: stored };
}

/** Lo que la pantalla enseña de una llave que ya existe. */
export function maskedToken(prefix: string): string {
  return `pt_${ENV_TAG}_${prefix}…`;
}
