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
export const TABLE_SPECS = [
  { source: "company", target: "organizations", global: true,
    // company becomes the tenant org node; handled specially in etl.mjs
    yn: [], json: ["modules_enabled"], refs: {}, drop: ["logo"] },
  { source: "customer", target: "customer",
    refs: { hotel: "hotel_id", assigned_seller: "seller_id" }, yn: [], json: ["tags"] },
  { source: "product", target: "product",
    refs: { category: "product_category_id", cancellation_policy: "cancellation_policy_id" }, yn: [] },
  { source: "product_modality", target: "product_modality", refs: { product: "product_id" } },
  { source: "cancellation_policy", target: "cancellation_policy", json: ["tiers"] },
  { source: "departure", target: "departure", refs: { product: "product_id" } },
  { source: "seller", target: "seller",
    refs: { user: "user_id", partner: "partner_id", supervisor: "supervisor_id" } },
  { source: "order", target: "order",
    refs: { customer: "customer_id", seller: "seller_id", partner: "partner_id", created_by: "created_by" } },
  { source: "booking", target: "booking",
    refs: { order: "order_id", customer: "customer_id", product: "product_id", departure: "departure_id",
            modality: "modality_id", seller: "seller_id", partner: "partner_id" },
    yn: ["capacity_override"], json: ["price_snapshot"] },
  { source: "participant", target: "participant", refs: { booking: "booking_id" } },
  { source: "voucher", target: "voucher", refs: { booking: "booking_id", order: "order_id" } },
  { source: "payment", target: "payment",
    refs: { order: "order_id", booking: "booking_id", customer: "customer_id", partner: "partner_id",
            cash_session: "cash_session_id", user: "user_id" } },
  { source: "commission", target: "commission",
    refs: { booking: "booking_id", order: "order_id", rule: "rule_id", settlement: "settlement_id",
            seller: "seller_id", partner: "partner_id" }, json: ["snapshot"] },
  { source: "settlement", target: "settlement", refs: { partner: "partner_id", seller: "seller_id", approved_by: "approved_by" } },
  { source: "receivable", target: "receivable", refs: { order: "order_id", partner: "partner_id", customer: "customer_id" } },
  // ... extend with the remaining tables following the same pattern.
];

/** Transforms a Totalum record into a Postgres row per its spec. */
export function transformRecord(spec, record, orgUuid) {
  const row = {};
  const refs = spec.refs || {};
  const yn = new Set(spec.yn || []);
  const json = new Set(spec.json || []);
  const drop = new Set(spec.drop || []);
  const rename = spec.rename || {};

  for (const [key, value] of Object.entries(record)) {
    if (drop.has(key)) continue;
    if (key === "_id") { row.id = toUuid(value); continue; }
    if (key === "company") { row.organization_id = orgUuid ?? toUuid(refId(value)); continue; }
    if (key in refs) { row[refs[key]] = toUuid(refId(value)); continue; }
    if (yn.has(key)) { row[rename[key] ?? key] = ynToBool(value); continue; }
    if (json.has(key)) { row[rename[key] ?? key] = parseJsonMaybe(value); continue; }
    // Skip Totalum bookkeeping fields.
    if (key === "createdAt" || key === "updatedAt" || key === "__v") continue;
    row[rename[key] ?? key] = value;
  }
  return row;
}
