import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { APP_URL } from "@/lib/stripe";

/**
 * EL ENLACE DE UN CLIC DEL PROVEEDOR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE GUARDA EL HASH, NO EL ENLACE
 *
 * Mismo criterio que las llaves de la API pública: el token viaja en la URL que
 * se le manda por correo o WhatsApp y no vuelve a existir en ninguna parte
 * nuestra. Si la tabla se filtra entera —una copia de seguridad, un volcado mal
 * guardado—, los enlaces que contiene no sirven para nada.
 *
 * Es deliberadamente DISTINTO del token de la encuesta (0067), que sí se guarda
 * a secas. Aquel pone una nota a un viaje que ya terminó; este compromete a una
 * empresa a poner un autobús con cuarenta personas dentro.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Y ES ANCHO
 *
 * Treinta y dos bytes de azar criptográfico, no los siete caracteres del token
 * de encuesta. La diferencia no es estética: un enlace que se puede adivinar
 * probando es un enlace con el que alguien acepta servicios en nombre del
 * transportista de enfrente.
 */

export interface EnlaceNuevo {
  /** El token completo. Existe en esta respuesta y en el mensaje que se manda. */
  token: string;
  /** Lo único que se guarda. */
  hash: string;
}

export function nuevoEnlaceDeRespuesta(): EnlaceNuevo {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashDeEnlace(token) };
}

export function hashDeEnlace(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** La dirección que se le manda al proveedor. */
export function urlDeRespuesta(token: string): string {
  return `${APP_URL.replace(/\/+$/, "")}/servicio/${encodeURIComponent(token)}`;
}
