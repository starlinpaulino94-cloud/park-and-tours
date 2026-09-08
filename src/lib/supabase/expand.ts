import "server-only";
import { spQuery } from "@/lib/supabase/data-provider";
import { aliasesFor } from "@/lib/supabase/query-translator";
import { getResource } from "@/lib/resources";
import { pgTable } from "@/lib/data-backend";
import { resolveUserNames } from "@/lib/user-directory";

/**
 * Expansión de relaciones para las consultas con ámbito de empresa.
 *
 * Toda la aplicación escribe sus consultas con la misma gramática —
 * `tenantQuery(company, "order", { _filter, customer: true, booking: { _limit: 20,
 * product: true } })`— pero `spQuery` solo leía `_filter`, `_sort`, `_limit` y
 * `_offset`: el resto de claves se ignoraban en silencio. Las referencias
 * llegaban como uuid y el código que las leía como objeto veía `undefined`:
 *
 *  · el informe de antigüedad agrupaba TODAS las filas en "Sin asignar", porque
 *    `receivable.partner` nunca era un objeto;
 *  · el POS cargaba el catálogo sin modalidades;
 *  · el despacho de operaciones no veía ni las reservas ni los recursos de cada
 *    salida;
 *  · la bitácora del CRM y el desglose de líneas de una cotización salían
 *    vacíos, porque las relaciones de uno-a-muchos no se resolvían NUNCA, ni
 *    siquiera por la ruta genérica de ERP —que solo cubría las de uno-a-uno.
 *
 * Aquí se resuelven las dos formas, en una consulta por relación (no por fila) y
 * con el mismo ámbito de empresa que la consulta original. Un fallo al resolver
 * una relación se registra y deja el valor crudo: enriquecer no puede tumbar la
 * respuesta entera.
 */

/** Profundidad máxima de anidamiento; corta expansiones circulares. */
const MAX_DEPTH = 3;

/**
 * Tope de filas traídas por relación, para que un expand no barra la tabla.
 *
 * Cuando se alcanza, la expansión queda incompleta: se avisa por consola en vez
 * de recortar en silencio, que es justo el fallo que este módulo viene a cerrar.
 */
const MAX_RELATED = 2000;

/** Campos que apuntan a `auth.users`, que no es una tabla consultable. */
export const USER_REF_FIELDS = new Set([
  "approved_by", "assigned_to", "checked_in_by", "created_by", "impersonated_by", "manager",
  "owner", "performed_by", "reported_by", "requested_by", "second_approver", "user",
]);

/** Campos cuyo nombre no coincide con el recurso al que apuntan. */
export const RELATION_RESOURCE: Record<string, string> = {
  assigned_seller: "seller",
  driver: "staff",
  guide: "staff",
  ledger_account: "ledger_account",
  modality: "product_modality",
  parent: "ledger_account",
  parent_partner: "partner",
  pickup_hotel: "hotel",
  product_modality: "product_modality",
  rule: "commission_rule",
  route: "pickup_route",
  supervisor: "seller",
};

/**
 * Relaciones cuyo destino depende de la tabla de origen.
 *
 * `category` apunta a `product_category` desde el catálogo y a
 * `expense_category` desde los gastos: el mismo nombre de campo, dos destinos,
 * igual que en el mapa de alias de columnas.
 */
export const TABLE_RELATION_RESOURCE: Record<string, Record<string, string>> = {
  product: { category: "product_category" },
  commission_rule: { category: "product_category" },
  expense: { category: "expense_category" },
};

/**
 * Clave ajena del hijo cuando NO se llama como el padre.
 *
 * `pickup` apunta a su ruta con `route_id`, no con `pickup_route_id`.
 */
export const CHILD_FOREIGN_KEY: Record<string, string> = {
  "pickup_route.pickup": "route_id",
};

export interface QueryShape {
  _filter?: Record<string, unknown>;
  _sort?: Record<string, "asc" | "desc">;
  _limit?: number;
  _offset?: number;
}

export type ExpandNode = true | Record<string, unknown>;
export type ExpandSpec = Record<string, ExpandNode>;

/** Separa las opciones de consulta de las relaciones a expandir. */
export function splitExpand(options: Record<string, unknown> = {}): {
  query: QueryShape;
  expand: ExpandSpec;
} {
  const query: Record<string, unknown> = {};
  const expand: ExpandSpec = {};
  for (const [key, value] of Object.entries(options)) {
    if (key.startsWith("_")) query[key] = value;
    else if (value === true || (value && typeof value === "object" && !Array.isArray(value))) {
      expand[key] = value as ExpandNode;
    }
  }
  return { query: query as QueryShape, expand };
}

/** Opciones propias de un nodo de expansión, sin sus relaciones anidadas. */
export function nodeOptions(node: ExpandNode): Record<string, unknown> {
  return node === true ? {} : node;
}

/** Recurso al que apunta un campo de referencia, o null si no es una relación. */
export function relationResource(field: string, parentTable?: string): string | null {
  if (USER_REF_FIELDS.has(field)) return null;
  const scoped = parentTable ? TABLE_RELATION_RESOURCE[parentTable]?.[field] : undefined;
  return scoped || RELATION_RESOURCE[field] || (getResource(field) ? field : null);
}

/**
 * Columna del hijo que apunta al padre.
 *
 * En el esquema toda referencia se llama `<campo>_id`, y el mapa de alias cubre
 * las excepciones (`order` -> `order_id` aunque la tabla sea `sales_order`).
 */
export function childForeignKey(parentResource: string, childTable: string): string {
  return CHILD_FOREIGN_KEY[`${parentResource}.${childTable}`]
    ?? aliasesFor(childTable)[parentResource]
    ?? `${parentResource}_id`;
}

function refId(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as { _id?: unknown; id?: unknown };
    const id = row._id ?? row.id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/** Etiqueta presentable de una fila relacionada, para pintarla sin más consultas. */
export function labelFor(row: Record<string, unknown>): string | undefined {
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return fullName || String(
    row.name || row.commercial_name || row.full_name || row.title || row.code || row.order_number ||
    row.booking_number || row.document_number || row.reference || ""
  ).trim() || undefined;
}

/** Agrupa los hijos por su padre, respetando el tope por padre. */
export function groupChildren<T extends Record<string, unknown>>(
  children: T[],
  foreignKey: string,
  perParent: number
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const child of children) {
    const parent = refId(child[foreignKey]);
    if (!parent) continue;
    const bucket = out.get(parent) || [];
    if (bucket.length >= perParent) continue;
    bucket.push(child);
    out.set(parent, bucket);
  }
  return out;
}

/**
 * ¿La relación es de uno-a-uno?
 *
 * Lo decide la fila, no un catálogo: si el padre trae la columna de referencia
 * (`product_id`, `hotel_id`…) es de uno-a-uno; si no, el campo nombra a una
 * tabla hija que apunta de vuelta.
 */
function isToOne(rows: Record<string, unknown>[], table: string, field: string): boolean {
  const column = aliasesFor(table)[field] ?? `${field}_id`;
  return rows.some((row) => column in row || field in row);
}

async function expandToOne(
  orgId: string,
  parentResource: string,
  rows: Record<string, unknown>[],
  field: string,
  node: ExpandNode,
  depth: number
): Promise<void> {
  const table = pgTable(parentResource);
  const column = aliasesFor(table)[field] ?? `${field}_id`;
  const ids = [...new Set(rows.map((r) => refId(r[column] ?? r[field])).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return;

  if (USER_REF_FIELDS.has(field)) {
    const names = await resolveUserNames(ids);
    for (const row of rows) {
      const id = refId(row[column] ?? row[field]);
      if (id) row[field] = { _id: id, name: names.get(id) || "Usuario sin nombre registrado" };
    }
    return;
  }

  const resource = relationResource(field, table);
  if (!resource) return;

  const related = await spQuery<Record<string, unknown>>(orgId, pgTable(resource), {
    _filter: { _id: { in: ids } },
    _limit: Math.min(ids.length, MAX_RELATED),
  });
  const byId = new Map(related.map((r) => [String(r._id ?? r.id), r]));

  const nested = splitExpand(nodeOptions(node)).expand;
  if (Object.keys(nested).length > 0) await expandRows(orgId, resource, related, nested, depth + 1);

  for (const row of rows) {
    const id = refId(row[column] ?? row[field]);
    const match = id ? byId.get(id) : undefined;
    if (match) row[field] = { ...match, name: labelFor(match) || match.name || id };
  }
}

async function expandToMany(
  orgId: string,
  parentResource: string,
  rows: Record<string, unknown>[],
  field: string,
  node: ExpandNode,
  depth: number
): Promise<void> {
  const resource = relationResource(field, pgTable(parentResource));
  if (!resource) return;

  const parentIds = rows.map((r) => String(r._id ?? r.id)).filter(Boolean);
  if (parentIds.length === 0) return;

  const options = nodeOptions(node);
  const { query, expand: nested } = splitExpand(options);
  const perParent = Math.max(1, Number(query._limit ?? 50));
  const foreignKey = childForeignKey(parentResource, pgTable(resource));

  const wanted = perParent * parentIds.length;
  const children = await spQuery<Record<string, unknown>>(orgId, pgTable(resource), {
    _filter: { ...(query._filter || {}), [foreignKey]: { in: parentIds } },
    _sort: query._sort,
    _limit: Math.min(wanted, MAX_RELATED),
  });
  if (wanted > MAX_RELATED && children.length === MAX_RELATED) {
    console.warn(
      `[expand] ${parentResource}.${field}: se alcanzó el tope de ${MAX_RELATED} filas; ` +
      `algunos ${resource} pueden faltar. Baja el _limit o pagina la consulta.`
    );
  }

  if (Object.keys(nested).length > 0) await expandRows(orgId, resource, children, nested, depth + 1);

  const grouped = groupChildren(children, foreignKey, perParent);
  for (const row of rows) row[field] = grouped.get(String(row._id ?? row.id)) || [];
}

/**
 * Rellena las relaciones pedidas sobre las filas ya cargadas.
 *
 * Cada relación se resuelve por separado y con su propio `try`: si una falla
 * —una tabla que no existe, un campo que no es relación— se registra y el resto
 * de la respuesta sigue en pie.
 */
export async function expandRows<T extends Record<string, unknown>>(
  orgId: string,
  resourceName: string,
  rows: T[],
  expand: ExpandSpec,
  depth = 0
): Promise<T[]> {
  const fields = Object.keys(expand);
  if (rows.length === 0 || fields.length === 0 || depth >= MAX_DEPTH) return rows;

  const table = pgTable(resourceName);
  const mutable = rows as unknown as Record<string, unknown>[];

  await Promise.all(fields.map(async (field) => {
    try {
      if (isToOne(mutable, table, field)) {
        await expandToOne(orgId, resourceName, mutable, field, expand[field], depth);
      } else {
        await expandToMany(orgId, resourceName, mutable, field, expand[field], depth);
      }
    } catch (err) {
      console.warn(`[expand] ${resourceName}.${field} no se pudo resolver:`, err instanceof Error ? err.message : err);
    }
  }));

  return rows;
}
