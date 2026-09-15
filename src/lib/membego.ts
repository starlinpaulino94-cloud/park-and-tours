import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppRole } from "@/lib/auth";

/**
 * El contrato de MembeGo, del lado del satélite.
 *
 * MembeGo (la plataforma de membresías del mismo dueño) define en su
 * `docs/INTEGRACIONES.md` cómo se conecta un sistema vertical: un token SSO
 * firmado con HMAC para que el equipo entre sin otra contraseña, y webhooks
 * firmados con el mismo secreto para empujar clientes, compras y membresías.
 * Este módulo implementa la parte PURA de ese contrato —verificar, mapear,
 * interpretar— y es donde viven las trampas que el propio contrato documenta:
 *
 *  · El token NO es un JWT: son DOS partes (`base64url(JSON).hmacHex`), sin
 *    cabecera. Se parte por el ÚLTIMO punto, no con split('.').
 *  · La firma cubre la cadena base64url TAL CUAL viaja, no el JSON decodificado.
 *  · El hex va en minúsculas y se compara en tiempo constante.
 *  · El webhook se firma sobre el CUERPO CRUDO exacto: re-serializar el JSON
 *    produce, tarde o temprano, otra cadena y una firma que no cuadra.
 *
 * El contrato trae un vector de prueba oficial (secreto `secreto-de-prueba` y
 * un token literal): las pruebas de este módulo lo usan, así que si esta
 * implementación diverge del contrato, falla la suite y no la integración en
 * producción.
 */

export interface MembegoSsoPayload {
  sub: string;
  email?: string;
  rol?: string;
  companyId: string;
  exp: number;
  /** Identificador de un solo uso. Opcional en el contrato; si viene, se canjea una vez. */
  jti?: string;
}

const base64urlDecode = (value: string): string | null => {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
};

/** Compara dos cadenas sin filtrar información por tiempo de ejecución. */
function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Verifica el token SSO de MembeGo. Devuelve el payload o null: un token que
 * no verifica no explica por qué —el detalle va al log del servidor, nunca al
 * navegador de quien lo trae.
 */
export function verifyMembegoToken(
  token: string | null | undefined,
  secret: string,
  now: Date = new Date()
): MembegoSsoPayload | null {
  if (!token || !secret) return null;
  // El último punto, no split('.'): el base64url no lleva puntos, pero un
  // token con tres partes (alguien mandando un JWT) debe fallar limpio.
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  if (!safeEqual(expected, signature)) return null;

  const json = base64urlDecode(body);
  if (!json) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (typeof data.exp !== "number" || data.exp < Math.floor(now.getTime() / 1000)) return null;
  if (typeof data.sub !== "string" || !data.sub) return null;
  if (typeof data.companyId !== "string" || !data.companyId) return null;

  return {
    sub: data.sub,
    email: typeof data.email === "string" ? data.email : undefined,
    rol: typeof data.rol === "string" ? data.rol : undefined,
    companyId: data.companyId,
    exp: data.exp,
    jti: typeof data.jti === "string" && data.jti ? data.jti : undefined,
  };
}

/** Firma HMAC-SHA256 (hex) de un cuerpo — para verificar `X-Membego-Firma`. */
export function membegoSignature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** Verifica la firma de un webhook sobre el cuerpo crudo exacto. */
export function verifyMembegoWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  return safeEqual(membegoSignature(secret, rawBody), signatureHeader);
}

/**
 * Rol de MembeGo → rol local.
 *
 * La regla del contrato es literal y es de seguridad: «un rol desconocido debe
 * caer al permiso MÍNIMO, nunca al máximo — si MembeGo añade un rol mañana, el
 * satélite no puede regalar acceso de admin». El mínimo interno aquí es
 * `seller`; `partner` no se usa porque es un rol EXTERNO (portal B2B) y el SSO
 * trae al equipo de la empresa, nunca a un tercero.
 *
 * `SUPERADMIN` de MembeGo se acota a `admin` DE LA ORGANIZACIÓN: el superadmin
 * local ve todas las organizaciones de esta plataforma, y ese poder no lo
 * concede una plataforma ajena.
 */
export function mapMembegoRole(rol: string | null | undefined): AppRole {
  switch ((rol || "").toUpperCase()) {
    case "SUPERADMIN":
    case "ADMINISTRADOR":
    case "ADMIN_EMPRESA":
      return "admin";
    case "GERENTE":
      return "manager";
    case "SUPERVISOR":
      return "operations";
    case "CAJERO":
    case "RECEPCION":
      return "cashier";
    case "MARKETING":
    case "EMPLEADO":
    default:
      return "seller";
  }
}

/** Roles de MembeGo con potestad para VINCULAR la empresa a una organización. */
export function canLinkCompanies(rol: string | null | undefined): boolean {
  const upper = (rol || "").toUpperCase();
  return upper === "SUPERADMIN" || upper === "ADMINISTRADOR" || upper === "ADMIN_EMPRESA";
}

/* ----------------------------------------------------------------- eventos */

export interface MembegoEvent {
  id: string;
  tipo: string;
  companyId: string;
  payload: Record<string, unknown>;
  emitidoEn: string | null;
}

/**
 * Interpreta el sobre de un webhook.
 *
 * MembeGo manda el sobre v2 (`eventId`, `eventType`, `data`) CON las claves
 * del formato anterior duplicadas dentro (`id`, `tipo`, `payload`), y su
 * documentación promete que ambas siguen viajando mientras haya satélites que
 * las lean. Se leen las clásicas y se cae a las v2: así este satélite funciona
 * con el formato de hoy y con el del día que retiren el legado.
 */
export function parseMembegoEvent(rawBody: string): MembegoEvent | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }

  const id = typeof data.id === "string" && data.id
    ? data.id
    : typeof data.eventId === "string" ? data.eventId : "";
  const tipo = typeof data.tipo === "string" && data.tipo
    ? data.tipo
    : typeof data.eventType === "string" ? data.eventType : "";
  const companyId = typeof data.companyId === "string" ? data.companyId : "";
  const payload = (
    data.payload && typeof data.payload === "object"
      ? data.payload
      : data.data && typeof data.data === "object" ? data.data : {}
  ) as Record<string, unknown>;
  const emitidoEn = typeof data.emitidoEn === "string"
    ? data.emitidoEn
    : typeof data.occurredAt === "string" ? data.occurredAt : null;

  if (!id || !tipo || !companyId) return null;
  return { id, tipo, companyId, payload, emitidoEn };
}

/** La ficha del cliente tal como viaja dentro de los eventos. */
export interface MembegoClientePayload {
  clienteId: string | null;
  nombre: string | null;
  email: string | null;
  telefono: string | null;
}

export function clienteFromPayload(payload: Record<string, unknown>): MembegoClientePayload {
  const cliente = (payload.cliente && typeof payload.cliente === "object" ? payload.cliente : {}) as
    Record<string, unknown>;
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  return {
    clienteId: text(payload.clienteId),
    nombre: text(cliente.nombre),
    email: text(cliente.email),
    telefono: text(cliente.telefono),
  };
}

/** La membresía dentro de un evento, si el tipo la trae. */
export interface MembegoMembresiaPayload {
  id: string | null;
  planId: string | null;
  plan: string | null;
  esDePago: boolean | null;
  vigenteHasta: string | null;
}

export function membresiaFromPayload(payload: Record<string, unknown>): MembegoMembresiaPayload | null {
  const membresia = payload.membresia;
  if (!membresia || typeof membresia !== "object") return null;
  const data = membresia as Record<string, unknown>;
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value : null;
  return {
    id: text(data.id),
    planId: text(data.planId),
    plan: text(data.plan),
    esDePago: typeof data.esDePago === "boolean" ? data.esDePago : null,
    vigenteHasta: text(data.vigenteHasta),
  };
}

/**
 * Divide «Juan Pérez» en nombre y apellido para la ficha local.
 *
 * La primera palabra es el nombre y el resto el apellido: con nombres
 * compuestos se equivoca a veces, pero el dato viene como una sola cadena y
 * cualquier corte es una convención. El original completo no se pierde: queda
 * en MembeGo, que es la fuente.
 */
export function splitNombre(nombre: string | null): { first: string | null; last: string | null } {
  const clean = (nombre || "").trim().replace(/\s+/g, " ");
  if (!clean) return { first: null, last: null };
  const at = clean.indexOf(" ");
  if (at < 0) return { first: clean, last: null };
  return { first: clean.slice(0, at), last: clean.slice(at + 1) };
}
