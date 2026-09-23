/**
 * LOS ROLES Y SU RANGO, EN UN SOLO SITIO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HABÍA TRES TABLAS DE RANGO, IDÉNTICAS Y SEPARADAS
 *
 * `tenant.ts` decidía los permisos, `nav.ts` decidía qué entradas de menú se
 * ven y `notify.ts` decidía a quién alcanza un aviso — cada uno con su propia
 * copia de los mismos ocho números. Copiadas, así que hoy coinciden; separadas,
 * así que el día que alguien añada un rol coincidirán dos de tres.
 *
 * Y el fallo de esa discrepancia no se ve: un rol que en `tenant` está por
 * debajo del vendedor y en `nav` por encima no rompe nada — enseña un menú que
 * lleva a un 403. El que se ve al revés es peor: un menú que no enseña la
 * pantalla y una ruta que sí la sirve.
 *
 * Este módulo es puro y sin dependencias a propósito: `tenant.ts` es
 * `server-only` y por eso los otros dos no podían importarlo. Esa es la razón
 * técnica de que hubiera tres copias, y por eso el sitio único tiene que ser
 * uno que se pueda importar desde cualquier lado.
 */

export type AppRole =
  | "superadmin" | "owner" | "admin" | "manager"
  | "operations" | "cashier" | "seller" | "partner" | "supplier";

/**
 * El rango de cada rol.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOS DE FUERA VAN ABAJO, Y EL PROVEEDOR EL ÚLTIMO
 *
 * `partner` y `supplier` no son escalones de la operadora: son actores
 * externos, y su rango bajo es lo que impide que una ruta interna les conteste
 * por descuido. El proveedor va POR DEBAJO del socio porque ve menos —un tour
 * center vende y cobra; un transportista opera un servicio ya vendido— y
 * porque así ninguna ruta que hoy exige `partner` le contesta.
 *
 * Pero el rango NO es el aislamiento. Eso lo decide el IDENTIFICADOR
 * (`esDeSocio`, `esDeProveedor`), que es la lección de 4.2: un empleado de un
 * tour center con otro rol pasaba de largo cuando el aislamiento miraba el
 * nombre. El rango solo dice hasta dónde llega el permiso.
 */
export const ROLE_RANK: Record<AppRole, number> = {
  superadmin: 100,
  owner: 90,
  admin: 80,
  manager: 60,
  operations: 40,
  cashier: 40,
  seller: 20,
  partner: 10,
  supplier: 5,
};

/** Todos los roles, del más alto al más bajo. */
export const ROLES: AppRole[] = (Object.keys(ROLE_RANK) as AppRole[])
  .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);

/**
 * El rango de un rol, o 0 si no se reconoce.
 *
 * Cero y no un número alto: un rol mal escrito, o uno nuevo que llegue en un
 * token viejo, no puede convertirse en «lo puede todo». Falla cerrado.
 */
export function rankOf(role?: string | null): number {
  return ROLE_RANK[(role || "") as AppRole] ?? 0;
}

/** ¿Este rol llega al mínimo pedido? */
export function atLeast(role: AppRole | string | null | undefined, minimum: AppRole): boolean {
  return rankOf(role) >= ROLE_RANK[minimum];
}

/**
 * Los actores que viven FUERA de la operadora.
 *
 * Se declara para que exista la lista, no para decidir aislamiento con ella:
 * eso se hace por identificador. Sirve para las decisiones de producto —qué
 * portal abre, qué menú ve— donde preguntar por el rango sería adivinar.
 */
export const ROLES_EXTERNOS: AppRole[] = ["partner", "supplier"];

export function esRolExterno(role?: string | null): boolean {
  return ROLES_EXTERNOS.includes((role || "") as AppRole);
}
