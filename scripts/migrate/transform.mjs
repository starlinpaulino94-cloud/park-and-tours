// ETL transforms: Totalum record → Postgres row (M5). Pure + unit-tested.
import { createHash } from "node:crypto";

// Fixed namespace so old Totalum ids map DETERMINISTICALLY to the same uuid on
// every run — FK references resolve by re-deriving the target's uuid, so no
// lookup table is needed and the whole ETL is idempotent/re-runnable.
export const NAMESPACE = "6f9619ff-8b86-d011-b42d-00cf4fc964ff";

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToUuid(b) {
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

/** Deterministic UUID v5 (SHA-1) from an arbitrary Totalum id string. */
export function toUuid(oldId) {
  if (oldId == null || oldId === "") return null;
  const ns = Buffer.from(uuidToBytes(NAMESPACE));
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(String(oldId), "utf8")])).digest();
  const bytes = Uint8Array.prototype.slice.call(hash, 0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

/** Totalum "yes"/"no" option → boolean. */
export function ynToBool(v) {
  if (v == null) return null;
  return v === "yes" || v === true;
}

/** Totalum stores JSON as a string; return a parsed object/array for jsonb. */
export function parseJsonMaybe(v, fallback = null) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/** Extracts the id from a Totalum ref (string id or expanded {_id} object). */
export function refId(v) {
  if (v == null) return null;
  if (typeof v === "object") return v._id ?? null;
  return v;
}

const RELATIONSHIP_TYPES = new Set([
  "distributor", "subagency", "tour_operator", "reseller", "hotel", "agency", "tour_center",
]);
const PARTNER_TYPE_MAP = { ota: "agency" };
// organization_relationships.status sólo admite estos tres (CHECK en 0002); el
// `status` de un partner de Totalum puede ser "blocked" o "pending", que harían
// fallar el INSERT de toda la tanda.
const RELATIONSHIP_STATUS = new Set(["active", "inactive", "suspended"]);
const ORG_STATUS = new Set(["active", "inactive", "suspended", "blocked", "pending"]);

/** Quita nulos para que el jsonb de metadata quede limpio (0 y "" se conservan). */
function pruneNulls(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v != null) out[k] = v;
  return out;
}
const AUTH_REF_FIELDS = new Set([
  "user", "created_by", "checked_in_by", "supervisor", "approved_by", "second_approver",
  "requested_by", "impersonated_by", "owner", "assigned_to", "reported_by", "verified_by",
  "performed_by", "manager", "driver", "guide",
]);
const PAYMENT_METHOD_MAP = { b2b_credit: "credit", payment_link: "link" };
const LEAD_SOURCE_MAP = { instagram: "social", ota: "agency", direct: "web" };

export function transformPartnerOrganization(partner) {
  const partnerId = refId(partner._id);
  const tenant = toUuid(refId(partner.company));
  return {
    id: toUuid(partnerId),
    kind: "partner",
    // Sin `parent_partner` el nodo cuelga de su propio tenant, no de null.
    parent_org_id: toUuid(refId(partner.parent_partner)) ?? tenant,
    tenant_org_id: tenant,
    // En Totalum `name` es la razón social ("… SRL") y `commercial_name` el
    // nombre comercial. La app ya muestra `commercial_name || name`
    // (booking-service.ts), así que organizations.name debe seguir ese criterio.
    name: partner.commercial_name || partner.name || String(partnerId),
    slug: partner.slug ?? null,
    legal_name: partner.legal_name ?? partner.name ?? null,
    tax_id: partner.tax_id ?? null,
    email: partner.email ?? null,
    phone: partner.phone ?? null,
    country: partner.country ?? null,
    timezone: partner.timezone ?? null,
    currency: partner.currency || partner.base_currency || "usd",
    status: ORG_STATUS.has(partner.status) ? partner.status : "active",
    // Campos reales de `partner` que no tienen columna en organizations. Sin
    // esto se perderían en silencio, y la migración es de una sola pasada.
    // `balance` es una foto histórica: el saldo real se recalcula de
    // receivables/payments tras la carga.
    metadata: pruneNulls({
      contact_name: partner.contact_name,
      address: partner.address,
      city: partner.city,
      whatsapp: partner.whatsapp,
      logo_url: partner.logo_url,
      commercial_terms: partner.commercial_terms,
      notes: partner.notes,
      legacy_balance: partner.balance,
      legacy_created_by: refId(partner.createdBy),
    }),
  };
}

export function transformPartnerRelationship(partner) {
  const partnerId = refId(partner._id);
  const companyId = refId(partner.company);
  // from_org_id/to_org_id son NOT NULL: sin ancla no hay fila que insertar, y
  // colarla haría fallar la tanda entera. El ETL descarta los nulos.
  if (!companyId || !partnerId) return null;
  const rawType = partner.relationship_type || partner.partner_type;
  const relationshipType = RELATIONSHIP_TYPES.has(rawType)
    ? rawType
    : PARTNER_TYPE_MAP[rawType] || "agency";
  return {
    id: toUuid(`partner-relationship:${companyId}:${partnerId}:${relationshipType}`),
    from_org_id: toUuid(companyId),
    to_org_id: toUuid(partnerId),
    relationship_type: relationshipType,
    default_commission_pct: partner.default_commission_pct ?? null,
    credit_limit: partner.credit_limit ?? null,
    credit_days: partner.credit_days ?? null,
    currency: partner.currency || partner.base_currency || "usd",
    contract_from: partner.contract_from ?? null,
    contract_to: partner.contract_to ?? null,
    status: RELATIONSHIP_STATUS.has(partner.status) ? partner.status : "active",
  };
}

/**
 * Per-table migration spec:
 *   source  Totalum table name
 *   target  Postgres table name
 *   refs    { totalumField: 'postgres_column' } — each value is an id → toUuid()
 *   yn      fields to convert 'yes'/'no' → boolean
 *   json    fields to parse into jsonb
 *   drop    fields to omit
 *   rename  { totalumField: 'postgres_field' } for plain (non-ref) renames
 * `_id`→`id` and `company`→`organization_id` are handled globally.
 */
// `company`→`organizations` and `partner`→`organizations` are NOT here: both
// become `organizations` rows, handled by loadOrganizations() in etl.mjs.
// Every `refs` value was cross-checked against the real Postgres column.
export const TABLE_SPECS = [
  { source: "customer", target: "customer", refs: {} },
  { source: "cancellation_policy", target: "cancellation_policy", refs: {}, json: ["tiers"] },
  { source: "product", target: "product", refs: { cancellation_policy: "cancellation_policy_id" } },
  { source: "product_modality", target: "product_modality", refs: { product: "product_id" } },
  { source: "price_rule", target: "price_rule", refs: { product: "product_id", modality: "modality_id", partner: "partner_id", seller: "seller_id" } },
  { source: "departure", target: "departure", refs: { product: "product_id" } },
  { source: "seller", target: "seller", refs: { user: "user_id", partner: "partner_id", supervisor: "supervisor_id" } },
  { source: "order", target: "sales_order", refs: { customer: "customer_id", seller: "seller_id", partner: "partner_id", created_by: "created_by" } },
  { source: "booking", target: "booking", refs: { order: "order_id", customer: "customer_id", product: "product_id", departure: "departure_id", modality: "modality_id", seller: "seller_id", partner: "partner_id", created_by: "created_by", checked_in_by: "checked_in_by" }, yn: ["capacity_override"], json: ["price_snapshot"] },
  { source: "participant", target: "participant", refs: { booking: "booking_id" } },
  { source: "voucher", target: "voucher", refs: { booking: "booking_id", order: "order_id" } },
  { source: "cash_register", target: "cash_register", refs: {} },
  { source: "cash_session", target: "cash_session", refs: { cash_register: "cash_register_id", user: "user_id" } },
  { source: "commission_rule", target: "commission_rule", refs: { product: "product_id", partner: "partner_id", seller: "seller_id" }, json: ["tiers"] },
  { source: "commission", target: "commission", refs: { booking: "booking_id", order: "order_id", rule: "rule_id", settlement: "settlement_id", seller: "seller_id", partner: "partner_id" }, json: ["snapshot"] },
  { source: "settlement", target: "settlement", refs: { partner: "partner_id", seller: "seller_id", approved_by: "approved_by" } },
  { source: "payment", target: "payment", refs: { order: "order_id", booking: "booking_id", customer: "customer_id", partner: "partner_id", cash_session: "cash_session_id", user: "user_id" } },
  { source: "receivable", target: "receivable", refs: { partner: "partner_id", customer: "customer_id", order: "order_id" } },
  { source: "payable", target: "payable", refs: { partner: "partner_id", seller: "seller_id", settlement: "settlement_id" } },
  { source: "plan", target: "plan", refs: {}, yn: ["is_premium"] },
  { source: "subscription_invoice", target: "subscription_invoice", refs: { plan: "plan_id" } },
  { source: "zone", target: "zone", refs: {} },
  { source: "branch", target: "branch", refs: { manager: "manager_id", parent_branch: "parent_branch_id" } },
  { source: "supplier", target: "supplier", refs: {} },
  { source: "vehicle", target: "vehicle", refs: { supplier: "supplier_id", driver: "driver_id" } },
  { source: "staff", target: "staff", refs: { supplier: "supplier_id", user: "user_id" } },
  { source: "shift", target: "shift", refs: { staff: "staff_id", zone: "zone_id", attraction: "attraction_id", branch: "branch_id", departure: "departure_id", user: "user_id" } },
  { source: "attendance", target: "attendance", refs: { staff: "staff_id", shift: "shift_id", approved_by: "approved_by" } },
  { source: "certification", target: "certification", refs: { staff: "staff_id" }, yn: ["blocks_assignment"] },
  { source: "hotel", target: "hotel", refs: { zone: "zone_id" } },
  { source: "audit_log", target: "audit_log", refs: { user: "user_id", impersonated_by: "impersonated_by" }, json: ["metadata_json"] },
  { source: "notification", target: "notification", refs: { user: "user_id", partner: "partner_id" }, yn: ["read_status"] },
  { source: "approval_request", target: "approval_request", refs: { requested_by: "requested_by", approved_by: "approved_by", second_approver: "second_approver_id", order: "order_id", booking: "booking_id", payment: "payment_id", purchase_order: "purchase_order_id" }, yn: ["requires_two"], json: ["payload"] },
  { source: "integration", target: "integration", refs: { partner: "partner_id", user: "user_id" }, yn: ["webhook_secret_set"], json: ["config"] },
  { source: "document", target: "document", refs: { owner: "owner_id" }, yn: ["requires_ack"] },
  { source: "document_ack", target: "document_ack", refs: { document: "document_id", user: "user_id" } },
  { source: "stripe_event", target: "stripe_event", refs: {}, drop: ["company"] },
  { source: "product_category", target: "product_category", refs: {} },
  { source: "product_cost", target: "product_cost", refs: { product: "product_id", supplier: "supplier_id" } },
  { source: "promotion", target: "promotion", refs: {} },
  { source: "departure_resource", target: "departure_resource", refs: { departure: "departure_id", vehicle: "vehicle_id", staff: "staff_id" } },
  { source: "allotment", target: "allotment", refs: { partner: "partner_id", product: "product_id", departure: "departure_id", product_modality: "product_modality_id" } },
  { source: "lead", target: "lead", refs: { customer: "customer_id", seller: "seller_id", product: "product_id", partner: "partner_id" } },
  { source: "crm_activity", target: "crm_activity", refs: { lead: "lead_id", customer: "customer_id", user: "user_id" } },
  { source: "quote", target: "quote", refs: { customer: "customer_id", partner: "partner_id", seller: "seller_id", lead: "lead_id", order: "order_id", user: "user_id" } },
  { source: "quote_line", target: "quote_line", refs: { quote: "quote_id", product: "product_id", product_modality: "product_modality_id", departure: "departure_id" } },
  { source: "guest_case", target: "guest_case", refs: { customer: "customer_id", booking: "booking_id", participant: "participant_id", assigned_to: "assigned_to_id", order: "order_id", incident: "incident_id" } },
  { source: "membership_plan", target: "membership_plan", refs: {}, yn: ["auto_renew"], json: ["blackout_dates"] },
  { source: "membership", target: "membership", refs: { membership_plan: "membership_plan_id", customer: "customer_id", order: "order_id" }, yn: ["auto_renew"] },
  { source: "access_ticket", target: "access_ticket", refs: { booking: "booking_id", participant: "participant_id", customer: "customer_id", product: "product_id", order: "order_id", membership: "membership_id" } },
  { source: "gift_card", target: "gift_card", refs: { customer: "customer_id", order: "order_id", product: "product_id" } },
  { source: "gift_card_movement", target: "gift_card_movement", refs: { gift_card: "gift_card_id", order: "order_id", user: "user_id" } },
  { source: "pickup_route", target: "pickup_route", refs: { departure: "departure_id", zone: "zone_id", vehicle: "vehicle_id", driver: "driver_id", guide: "guide_id" } },
  { source: "pickup", target: "pickup", refs: { booking: "booking_id", hotel: "hotel_id", route: "route_id" } },
  { source: "expense_category", target: "expense_category", refs: {} },
  { source: "expense", target: "expense", refs: { category: "category_id", branch: "branch_id", supplier: "supplier_id", user: "user_id", cash_session: "cash_session_id" } },
  { source: "cash_movement", target: "cash_movement", refs: { cash_session: "cash_session_id", user: "user_id", payment: "payment_id" } },
  { source: "ledger_account", target: "ledger_account", refs: { parent: "parent_id" }, yn: ["is_postable"] },
  { source: "ledger_entry", target: "ledger_entry", refs: { ledger_account: "ledger_account_id", user: "user_id", order: "order_id", payment: "payment_id", settlement: "settlement_id", expense: "expense_id", payable: "payable_id", receivable: "receivable_id" }, yn: ["reversed"] },
  { source: "currency_rate", target: "currency_rate", refs: {} },
  { source: "tax_profile", target: "tax_profile", refs: {}, yn: ["included_in_price", "efac_enabled"] },
  { source: "invoice", target: "invoice", refs: { customer: "customer_id", order: "order_id", partner: "partner_id", settlement: "settlement_id", tax_profile: "tax_profile_id", user: "user_id" } },
  { source: "warehouse", target: "warehouse", refs: { branch: "branch_id", zone: "zone_id" }, yn: ["allows_negative"] },
  { source: "inventory_item", target: "inventory_item", refs: { product_category: "product_category_id", supplier: "supplier_id", product: "product_id" }, yn: ["is_sellable", "tracks_lots"] },
  { source: "stock_level", target: "stock_level", refs: { warehouse: "warehouse_id", inventory_item: "inventory_item_id" } },
  { source: "purchase_order", target: "purchase_order", refs: { supplier: "supplier_id", warehouse: "warehouse_id", requested_by: "requested_by", approved_by: "approved_by", payable: "payable_id" } },
  { source: "stock_movement", target: "stock_movement", refs: { warehouse: "warehouse_id", to_warehouse: "to_warehouse_id", inventory_item: "inventory_item_id", user: "user_id", purchase_order: "purchase_order_id", order: "order_id", work_order: "work_order_id" } },
  { source: "purchase_order_line", target: "purchase_order_line", refs: { purchase_order: "purchase_order_id", inventory_item: "inventory_item_id" } },
  { source: "attraction", target: "attraction", refs: { zone: "zone_id" }, yn: ["requires_waiver", "weather_sensitive"] },
  { source: "asset", target: "asset", refs: { zone: "zone_id", vehicle: "vehicle_id", supplier: "supplier_id", branch: "branch_id", attraction: "attraction_id" }, yn: ["blocks_capacity"] },
  { source: "attraction_log", target: "attraction_log", refs: { attraction: "attraction_id", user: "user_id", staff: "staff_id" } },
  { source: "waiver_template", target: "waiver_template", refs: {}, yn: ["requires_guardian"] },
  { source: "waiver", target: "waiver", refs: { waiver_template: "waiver_template_id", participant: "participant_id", customer: "customer_id", booking: "booking_id", product: "product_id" } },
  { source: "incident", target: "incident", refs: { attraction: "attraction_id", asset: "asset_id", zone: "zone_id", participant: "participant_id", booking: "booking_id", customer: "customer_id", vehicle: "vehicle_id", departure: "departure_id", reported_by: "reported_by", assigned_to: "assigned_to_id" }, yn: ["medical_attention", "evacuation", "authority_notified", "insurance_claim"] },
  { source: "incident_action", target: "incident_action", refs: { incident: "incident_id", assigned_to: "assigned_to_id", verified_by: "verified_by" } },
  { source: "inspection_template", target: "inspection_template", refs: { asset: "asset_id", attraction: "attraction_id" }, yn: ["requires_signature", "blocks_operation_on_fail"] },
  { source: "maintenance_plan", target: "maintenance_plan", refs: { asset: "asset_id", attraction: "attraction_id", vehicle: "vehicle_id", inspection_template: "inspection_template_id", staff: "staff_id" }, yn: ["takes_asset_down"] },
  { source: "work_order", target: "work_order", refs: { asset: "asset_id", attraction: "attraction_id", vehicle: "vehicle_id", assigned_to: "assigned_to_id", supplier: "supplier_id", incident: "incident_id", maintenance_plan: "maintenance_plan_id", requested_by: "requested_by" }, yn: ["takes_asset_down"] },
  { source: "inspection", target: "inspection", refs: { inspection_template: "inspection_template_id", asset: "asset_id", attraction: "attraction_id", vehicle: "vehicle_id", performed_by: "performed_by", work_order: "work_order_id" }, yn: ["blocked_operation"] },
  { source: "task", target: "task", refs: { assigned_to: "assigned_to_id", created_by: "created_by", booking: "booking_id", order: "order_id", incident: "incident_id", work_order: "work_order_id", guest_case: "guest_case_id", customer: "customer_id", lead: "lead_id" } },
];

/**
 * Transforms a Totalum record into a Postgres row per its spec.
 * `allowedCols` (a Set of the target table's real columns) drops any pass-through
 * field with no matching column — many Totalum descriptive fields have no PG
 * column, and without this the upsert would fail. Ref/YN/JSON targets are always
 * kept (their columns are validated separately). Omit `allowedCols` (e.g. in
 * unit tests) to disable filtering.
 */
export function transformRecord(spec, record, orgUuid, allowedCols = null) {
  const row = {};
  const refs = spec.refs || {};
  const yn = new Set(spec.yn || []);
  const json = new Set(spec.json || []);
  const drop = new Set(spec.drop || []);
  const rename = spec.rename || {};
  const keep = (col) => !allowedCols || allowedCols.has(col);

  for (const [key, value] of Object.entries(record)) {
    if (drop.has(key)) continue;
    if (key === "_id") { row.id = toUuid(value); continue; }
    if (key === "company") { row.organization_id = orgUuid ?? toUuid(refId(value)); continue; }
    if (key in refs) {
      row[refs[key]] = AUTH_REF_FIELDS.has(key) ? null : toUuid(refId(value));
      continue;
    }
    if (spec.source === "payment" && key === "method") {
      row.method = PAYMENT_METHOD_MAP[value] || value;
      continue;
    }
    if (spec.source === "lead" && key === "source") {
      row.source = LEAD_SOURCE_MAP[value] || value;
      continue;
    }
    if (yn.has(key)) { row[rename[key] ?? key] = ynToBool(value); continue; }
    if (json.has(key)) { row[rename[key] ?? key] = parseJsonMaybe(value); continue; }
    if (key === "createdAt" || key === "updatedAt" || key === "__v") continue;
    const col = rename[key] ?? key;
    if (keep(col)) row[col] = value; // drop unknown pass-through columns
  }
  return row;
}
