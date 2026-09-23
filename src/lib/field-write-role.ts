/**
 * EL RANGO QUE HACE FALTA PARA CAMBIAR UN CAMPO CONCRETO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO BASTA EL RANGO DEL RECURSO
 *
 * `writeRole` es una propiedad del recurso ENTERO. `order` lo tiene en
 * `seller` —tiene que tenerlo: quien vende registra la venta— y entre sus
 * campos editables están `seller` y `partner`. Es decir, el mismo rango que
 * permite anotar una nota permite cambiar A QUIÉN SE LE PAGA LA COMISIÓN de
 * esa venta.
 *
 * Con `seller.user` es todavía más grave: esa columna es la llave que decide de
 * quién son las ventas (`seller-scope.ts`). Quien la reapunte hereda las
 * ventas, las comisiones y la liquidación de otra persona. Hoy la escribe
 * cualquier `manager` desde el CRUD genérico.
 *
 * Subir el recurso entero a `admin` no sirve: rompería el alta de vendedores
 * por gerencia, que es trabajo normal. Hace falta grano fino.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE PROHÍBE CAMBIAR, NO ENVIAR
 *
 * La comprobación es contra el valor ACTUAL, no contra la presencia del campo.
 * El formulario genérico manda todos sus campos en cada guardado —también los
 * que nadie tocó—, así que rechazar por «viene el campo» convertiría cualquier
 * edición de una nota en un 403 incomprensible. Lo que se rechaza es el
 * CAMBIO, y con un mensaje que dice cuál.
 *
 * Y se rechaza en vez de recortarse en silencio: quitar el campo sin avisar
 * dejaría a quien edita convencido de que guardó lo que ve en pantalla.
 */

import type { AppRole } from "@/lib/auth";
import { atLeast } from "@/lib/tenant";
import { refId } from "@/lib/types";

/** Campo → rango mínimo para CAMBIARLO, por recurso. */
export const FIELD_WRITE_ROLE: Record<string, Record<string, AppRole>> = {
  // La atribución de la venta y del embudo: detrás va la comisión.
  order: { seller: "manager", partner: "manager" },
  lead: { seller: "manager", partner: "manager" },
  quote: { seller: "manager", partner: "manager" },
  // La cartera asignada de un cliente.
  customer: { assigned_seller: "manager" },
  // La llave de identidad. `admin` y no `manager`: es la única columna del
  // sistema que traslada el dinero de una persona a otra con un solo cambio.
  seller: { user: "admin" },
};

/** Etiqueta legible del campo, para que el rechazo diga qué se intentó cambiar. */
const ETIQUETA: Record<string, string> = {
  seller: "el vendedor",
  partner: "el socio",
  assigned_seller: "el vendedor asignado",
  user: "la cuenta de acceso",
};

export function fieldWriteRoleFor(table: string, field: string): AppRole | null {
  return FIELD_WRITE_ROLE[table]?.[field] ?? null;
}

export function hasProtectedFields(table: string): boolean {
  return Object.prototype.hasOwnProperty.call(FIELD_WRITE_ROLE, table);
}

/**
 * Los campos protegidos que este payload CAMBIA y este rango no puede cambiar.
 *
 * `actual` es la fila tal como está hoy. Sin ella —una creación— cualquier
 * valor no vacío cuenta como cambio, que es lo correcto: nacer con el
 * vendedor de otro es lo mismo que reasignárselo después.
 *
 * La comparación va por `refId` porque una referencia viaja unas veces como
 * uuid y otras como objeto expandido; comparar en crudo daría «cambió» cada
 * vez que el formulario devuelve lo que leyó.
 */
export function protectedFieldChanges(
  table: string,
  role: AppRole,
  payload: Record<string, unknown>,
  actual?: Record<string, unknown> | null
): string[] {
  const reglas = FIELD_WRITE_ROLE[table];
  if (!reglas) return [];

  const bloqueados: string[] = [];
  for (const [campo, minimo] of Object.entries(reglas)) {
    if (!(campo in payload)) continue;
    if (atLeast(role, minimo)) continue;
    const nuevo = refId(payload[campo]) ?? null;
    const viejo = actual ? refId(actual[campo]) ?? null : null;
    if (nuevo !== viejo) bloqueados.push(campo);
  }
  return bloqueados;
}

/** El mensaje del rechazo, nombrando los campos en castellano. */
export function protectedFieldMessage(campos: string[]): string {
  const nombres = campos.map((c) => ETIQUETA[c] ?? c);
  const lista = nombres.length > 1
    ? `${nombres.slice(0, -1).join(", ")} ni ${nombres[nombres.length - 1]}`
    : nombres[0];
  return `No tienes permisos para cambiar ${lista} de este registro`;
}
