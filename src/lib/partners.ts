/**
 * Reparto de un partner entre las tres piezas donde vive de verdad.
 *
 * Un partner no es una tabla: es una fila de `organizations` con
 * `kind = 'partner'`. Sus condiciones comerciales —comisión, límite y días de
 * crédito, vigencia del contrato— tienen su propia tabla desde la primera
 * migración, y el comentario del esquema lo dice con todas las letras:
 * "partner-only attributes live on organization_relationships, not here".
 *
 * El traductor nunca se enteró: borraba esos campos del payload y no los
 * guardaba en ningún sitio, así que el límite de crédito volvía siempre en cero.
 * Con él en cero, `credit_available` del portal B2B era siempre cero y el
 * informe de antigüedad no marcaba a nadie por encima de su límite: el control
 * de crédito de la red de ventas no existía.
 *
 * Aquí se decide qué va a cada sitio, en funciones puras que se prueban sin base
 * de datos. La regla es de lista blanca en los dos destinos con columnas, y todo
 * lo que no encaje cae en `metadata`: así ningún campo del formulario puede
 * volver a viajar hacia una columna que no existe (era el caso de `logo_url`,
 * que hacía fallar el alta entera).
 */

import { estadoDeCondiciones } from "@/lib/partner-lifecycle";

/** Columnas reales de `organizations` que un partner puede escribir. */
export const PARTNER_ORG_COLUMNS = [
  "name", "slug", "legal_name", "tax_id", "email", "phone", "country", "timezone", "currency", "status",
] as const;

/** Campo del formulario -> columna de `organization_relationships`. */
export const PARTNER_RELATIONSHIP_COLUMNS: Record<string, string> = {
  partner_type: "relationship_type",
  default_commission_pct: "default_commission_pct",
  credit_limit: "credit_limit",
  credit_days: "credit_days",
  contract_from: "contract_from",
  contract_to: "contract_to",
  /**
   * Cómo gana este socio (0078): a comisión o a neto.
   *
   * Va en la relación y no en la organización porque es del CONTRATO — la
   * misma agencia puede trabajar a comisión con una operadora y a neto con
   * otra. Y es escribible porque lo declara la operadora al pactar; lo que no
   * puede es quedarse sin declarar, y por eso la columna tiene valor por
   * defecto en vez de admitir nulos.
   */
  pricing_model: "pricing_model",
};

/**
 * Campos que no se guardan en ninguna parte, y por qué.
 *
 * `balance` es la deuda viva del partner: se deriva de sus cuentas por cobrar
 * —así lo calcula ya el portal— y guardarlo sería una segunda verdad que se
 * desincroniza sola. `authorized_products` necesita su propia tabla de enlace,
 * que todavía no existe; mientras tanto el catálogo del portal trata la lista
 * vacía como "todo el catálogo".
 */
export const PARTNER_DERIVED_FIELDS = ["balance", "authorized_products"];

/**
 * Columnas de la relación que se LEEN y no se escriben nunca desde el formulario.
 *
 * Están fuera de `PARTNER_RELATIONSHIP_COLUMNS` a propósito, y la diferencia no
 * es de estilo: ese mapa es la lista blanca de escritura del CRUD genérico.
 * Metida ahí, la aceptación de las condiciones sería un campo más del cuerpo de
 * la petición —cualquiera con acceso a la ficha del socio podría fecharla, o
 * firmarla en nombre de otro—, y una aceptación que el propio sistema puede
 * fabricar no acredita nada. Se escriben en un solo sitio: el punto donde el
 * socio acepta.
 */
export const PARTNER_RELATIONSHIP_READONLY = [
  "terms_version", "terms_accepted_version", "terms_accepted_at", "terms_accepted_by",
] as const;

const ORG_COLUMN_SET = new Set<string>(PARTNER_ORG_COLUMNS);
const DERIVED_SET = new Set<string>([...PARTNER_DERIVED_FIELDS, ...PARTNER_RELATIONSHIP_READONLY]);

/** Claves que el traductor genérico ya descarta o resuelve por su cuenta. */
const IGNORED = new Set([
  "_id", "id", "createdAt", "updatedAt", "created_at", "updated_at",
  "company", "organization_id", "kind", "parent_org_id", "tenant_org_id", "metadata",
]);

export interface PartnerSplit {
  /** Columnas de `organizations`. */
  org: Record<string, unknown>;
  /** Lo que va a `organizations.metadata`. */
  metadata: Record<string, unknown>;
  /** Columnas de `organization_relationships`. */
  relationship: Record<string, unknown>;
  /** Partner matriz, si se indicó (una subagencia dentro de una agencia). */
  parentPartnerId?: string;
}

function refId(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (value && typeof value === "object") {
    const row = value as { _id?: unknown; id?: unknown };
    const id = row._id ?? row.id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/**
 * Reparte el payload del formulario.
 *
 * Solo viajan las claves presentes: una edición parcial no puede vaciar lo que
 * no tocó. `undefined` se descarta por lo mismo; `null` sí pasa, porque es la
 * forma de borrar un dato a propósito.
 */
export function splitPartnerInput(data: Record<string, unknown>): PartnerSplit {
  const split: PartnerSplit = { org: {}, metadata: {}, relationship: {} };

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || IGNORED.has(key) || DERIVED_SET.has(key)) continue;

    if (key === "parent_partner" || key === "parent_partner_id") {
      split.parentPartnerId = refId(value);
      continue;
    }
    const relColumn = PARTNER_RELATIONSHIP_COLUMNS[key];
    if (relColumn) {
      split.relationship[relColumn] = value;
      // El tipo de partner se muestra desde la relación, pero se sigue copiando
      // a `metadata` para que las filas creadas antes de esta tabla no pierdan
      // su etiqueta al leerlas.
      if (key === "partner_type") split.metadata[key] = value;
      continue;
    }
    if (ORG_COLUMN_SET.has(key)) {
      split.org[key] = value;
      continue;
    }
    split.metadata[key] = value;
  }

  return split;
}

/**
 * `relationship_type` es obligatorio en la tabla, así que una edición que no
 * toca el tipo necesita heredarlo de lo que ya había.
 */
export function resolveRelationshipType(
  incoming: unknown,
  existing?: { relationship_type?: unknown },
  metadata?: { partner_type?: unknown }
): string {
  return (
    (typeof incoming === "string" && incoming) ||
    (typeof existing?.relationship_type === "string" && existing.relationship_type) ||
    (typeof metadata?.partner_type === "string" && metadata.partner_type) ||
    "agency"
  );
}

/**
 * Reconstruye la vista de partner que espera la aplicación.
 *
 * La relación manda sobre `metadata` porque es la columna tipada; `metadata`
 * queda como respaldo para los partners creados antes de que se usara la tabla.
 */
export function mergePartnerRow(
  orgRow: Record<string, unknown>,
  relationship?: Record<string, unknown> | null
): Record<string, unknown> {
  const metadata = orgRow.metadata && typeof orgRow.metadata === "object" && !Array.isArray(orgRow.metadata)
    ? (orgRow.metadata as Record<string, unknown>)
    : {};

  const out: Record<string, unknown> = {
    ...orgRow,
    company: orgRow.tenant_org_id,
    commercial_name: metadata.commercial_name ?? orgRow.legal_name ?? orgRow.name,
    contact_name: metadata.contact_name,
    whatsapp: metadata.whatsapp,
    address: metadata.address,
    city: metadata.city,
    logo_url: metadata.logo_url,
    notes: metadata.notes,
    commercial_terms: metadata.commercial_terms,
    partner_type: relationship?.relationship_type ?? metadata.partner_type,
  };

  for (const [field, column] of Object.entries(PARTNER_RELATIONSHIP_COLUMNS)) {
    if (field === "partner_type") continue;
    out[field] = relationship?.[column] ?? null;
  }
  for (const column of PARTNER_RELATIONSHIP_READONLY) {
    out[column] = relationship?.[column] ?? null;
  }
  /**
   * El estado de las condiciones, calculado aquí y no en cada pantalla.
   *
   * Es una comparación de dos números y una fecha, y repetirla en la lista, en
   * la ficha y en el portal es garantizar que las tres acaben discrepando —y
   * la que discrepe será la que alguien enseñe en una discusión.
   */
  out.terms_status = estadoDeCondiciones(relationship ?? null);
  // `parent_org_id` apunta al inquilino salvo que el partner cuelgue de otro.
  out.parent_partner =
    orgRow.parent_org_id && orgRow.parent_org_id !== orgRow.tenant_org_id ? orgRow.parent_org_id : null;

  return out;
}
