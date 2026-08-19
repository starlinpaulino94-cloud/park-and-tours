import "server-only";
import type { AppRole } from "@/lib/auth";

/**
 * Registry of tables exposed through the generic REST layer
 * (`/api/erp/[resource]`). Anything not listed here is not reachable,
 * and every query is company-scoped by `tenantQuery`.
 */
export interface ResourceDef {
  table: string;
  /** Fields matched by the `?q=` search parameter. */
  search: string[];
  /** Relations expanded on list endpoints. */
  expand?: Record<string, unknown>;
  /** Relations expanded on the detail endpoint (defaults to `expand`). */
  expandOne?: Record<string, unknown>;
  /** Default sort. */
  sort?: Record<string, "asc" | "desc">;
  /** Fields accepted from the client on create/update. */
  writable: string[];
  /** Minimum role required to write. Reads require any authenticated tenant user. */
  writeRole?: AppRole;
  /** Fields coerced to numbers before writing. */
  numeric?: string[];
  /** Fields coerced to ISO dates before writing. */
  dates?: string[];
}


export const RESOURCES: Record<string, ResourceDef> = {
  branch: {
    table: "branch",
    search: ["name", "code", "city"],
    expand: { manager: true },
    sort: { name: "asc" },
    writable: ["name", "code", "branch_type", "address", "city", "phone", "email", "manager", "parent_branch", "status", "notes"],
    writeRole: "manager",
  },
  partner: {
    table: "partner",
    search: ["name", "commercial_name", "tax_id", "email", "contact_name"],
    expand: { parent_partner: true },
    expandOne: { parent_partner: true, seller: { _limit: 100 }, authorized_products: true },
    sort: { name: "asc" },
    writable: [
      "name", "commercial_name", "partner_type", "tax_id", "contact_name", "email", "phone", "whatsapp",
      "address", "city", "country", "credit_limit", "credit_days", "currency", "default_commission_pct",
      "logo_url", "status", "contract_from", "contract_to", "commercial_terms", "notes", "parent_partner",
    ],
    numeric: ["credit_limit", "credit_days", "default_commission_pct"],
    dates: ["contract_from", "contract_to"],
    writeRole: "manager",
  },
  seller: {
    table: "seller",
    search: ["first_name", "last_name", "code", "email", "phone"],
    expand: { partner: true, branch: true, supervisor: true },
    expandOne: { partner: true, branch: true, supervisor: true, user: true, authorized_products: true },
    sort: { first_name: "asc" },
    writable: [
      "user", "partner", "branch", "code", "first_name", "last_name", "email", "phone", "whatsapp",
      "seller_role", "commission_pct", "monthly_goal", "max_discount_pct", "currency", "photo_url",
      "hire_date", "status", "notes", "supervisor",
    ],
    numeric: ["commission_pct", "monthly_goal", "max_discount_pct"],
    dates: ["hire_date"],
    writeRole: "manager",
  },
  zone: {
    table: "zone",
    search: ["name"],
    sort: { name: "asc" },
    writable: ["name", "description", "color", "status"],
    writeRole: "manager",
  },
  hotel: {
    table: "hotel",
    search: ["name", "address", "pickup_point"],
    expand: { zone: true },
    sort: { name: "asc" },
    writable: ["zone", "name", "address", "phone", "category", "pickup_point", "latitude", "longitude", "pickup_offset_min", "status", "notes"],
    numeric: ["latitude", "longitude", "pickup_offset_min"],
    writeRole: "operations",
  },
  product_category: {
    table: "product_category",
    search: ["name"],
    sort: { sort_order: "asc" },
    writable: ["name", "description", "color", "icon", "sort_order", "status"],
    numeric: ["sort_order"],
    writeRole: "manager",
  },
  cancellation_policy: {
    table: "cancellation_policy",
    search: ["name"],
    sort: { name: "asc" },
    writable: ["name", "description", "tiers", "no_show_refund_pct", "status"],
    numeric: ["no_show_refund_pct"],
    writeRole: "manager",
  },
  product: {
    table: "product",
    search: ["name", "code", "location"],
    expand: { category: true, product_modality: { _limit: 30 } },
    expandOne: {
      category: true, cancellation_policy: true,
      product_modality: { _limit: 50, _sort: { sort_order: "asc" } },
      product_cost: { _limit: 50, supplier: true },
      price_rule: { _limit: 50, partner: true, modality: true },
      departure: { _limit: 30, _sort: { departure_at: "asc" } },
    },
    sort: { sort_order: "asc" },
    writable: [
      "category", "cancellation_policy", "name", "code", "product_type", "short_description", "description",
      "cover_image_url", "video_url", "location", "meeting_point", "duration_hours", "languages",
      "min_age", "default_capacity", "restrictions", "recommendations", "inclusions", "exclusions",
      "terms", "instructions", "base_price", "base_cost", "currency", "featured", "sort_order", "status",
    ],
    numeric: ["duration_hours", "min_age", "default_capacity", "base_price", "base_cost", "sort_order"],
    writeRole: "manager",
  },
  product_modality: {
    table: "product_modality",
    search: ["name", "code"],
    expand: { product: true },
    sort: { sort_order: "asc" },
    writable: ["product", "name", "code", "modality_type", "price", "cost", "currency", "min_pax", "max_pax", "age_from", "age_to", "capacity_weight", "sort_order", "status"],
    numeric: ["price", "cost", "min_pax", "max_pax", "age_from", "age_to", "capacity_weight", "sort_order"],
    writeRole: "manager",
  },
  price_rule: {
    table: "price_rule",
    search: ["name"],
    expand: { product: true, modality: true, partner: true, seller: true },
    sort: { priority: "asc" },
    writable: ["product", "modality", "partner", "seller", "name", "price_type", "channel", "amount", "currency", "season_from", "season_to", "weekdays", "time_from", "time_to", "min_qty", "max_qty", "priority", "status"],
    numeric: ["amount", "min_qty", "max_qty", "priority"],
    dates: ["season_from", "season_to"],
    writeRole: "manager",
  },
  departure: {
    table: "departure",
    search: ["meeting_point"],
    expand: { product: true, branch: true },
    expandOne: {
      product: true, branch: true,
      booking: { _limit: 300, customer: true, pickup_hotel: true },
      departure_resource: { _limit: 50, vehicle: true, staff: true },
      pickup_route: { _limit: 50, vehicle: true, driver: true, guide: true, zone: true },
    },
    sort: { departure_at: "asc" },
    writable: ["product", "branch", "departure_at", "departure_time", "capacity", "cutoff_hours", "status", "meeting_point", "notes"],
    numeric: ["capacity", "cutoff_hours"],
    dates: ["departure_at"],
    writeRole: "operations",
  },
  customer: {
    table: "customer",
    search: ["first_name", "last_name", "email", "phone", "document_id"],
    expand: { hotel: true, assigned_seller: true },
    expandOne: {
      hotel: true, assigned_seller: true,
      booking: { _limit: 50, _sort: { createdAt: "desc" }, product: true, departure: true },
      order: { _limit: 50, _sort: { createdAt: "desc" } },
      lead: { _limit: 20, _sort: { createdAt: "desc" } },
    },
    sort: { createdAt: "desc" },
    writable: [
      "hotel", "assigned_seller", "first_name", "last_name", "email", "phone", "whatsapp", "nationality",
      "language", "country", "room", "address", "document_id", "birth_date", "tags", "source",
      "status", "preferences", "notes",
    ],
    dates: ["birth_date"],
    writeRole: "seller",
  },
  lead: {
    table: "lead",
    search: ["name", "email", "phone"],
    expand: { customer: true, seller: true, product: true },
    expandOne: { customer: true, seller: true, product: true, partner: true, crm_activity: { _limit: 100, _sort: { createdAt: "desc" }, user: true } },
    sort: { createdAt: "desc" },
    writable: ["customer", "seller", "product", "partner", "name", "email", "phone", "whatsapp", "source", "status", "estimated_value", "currency", "pax", "travel_date", "next_action_at", "lost_reason", "notes"],
    numeric: ["estimated_value", "pax"],
    dates: ["travel_date", "next_action_at"],
    writeRole: "seller",
  },
  crm_activity: {
    table: "crm_activity",
    search: ["subject"],
    expand: { lead: true, customer: true, user: true },
    sort: { createdAt: "desc" },
    writable: ["lead", "customer", "user", "activity_type", "subject", "notes", "due_at", "done_at", "status"],
    dates: ["due_at", "done_at"],
    writeRole: "seller",
  },
  promotion: {
    table: "promotion",
    search: ["name", "code"],
    expand: { products: true },
    sort: { createdAt: "desc" },
    writable: ["name", "code", "discount_type", "value", "valid_from", "valid_to", "max_uses", "used_count", "min_amount", "channels", "status", "description"],
    numeric: ["value", "max_uses", "used_count", "min_amount"],
    dates: ["valid_from", "valid_to"],
    writeRole: "manager",
  },
  order: {
    table: "order",
    search: ["order_number"],
    expand: { customer: true, seller: true, partner: true, branch: true },
    expandOne: {
      customer: true, seller: true, partner: true, branch: true, created_by: true, promotion: true,
      booking: { _limit: 100, product: true, departure: true, modality: true, pickup_hotel: true },
      payment: { _limit: 100, _sort: { createdAt: "desc" }, user: true },
    },
    sort: { createdAt: "desc" },
    writable: ["status", "notes", "channel", "seller", "partner", "branch", "promotion"],
    writeRole: "seller",
  },
  booking: {
    table: "booking",
    search: ["booking_number", "voucher_code", "room_number"],
    expand: { customer: true, product: true, departure: true, seller: true, partner: true, modality: true },
    expandOne: {
      customer: true, product: true, departure: true, seller: true, partner: true, branch: true,
      modality: true, pickup_hotel: true, order: true, created_by: true, checked_in_by: true,
      participant: { _limit: 100 },
      voucher: { _limit: 10 },
      commission: { _limit: 20, seller: true, partner: true },
      payment: { _limit: 50, _sort: { createdAt: "desc" } },
      pickup: { _limit: 10, hotel: true, route: true },
    },
    sort: { createdAt: "desc" },
    writable: ["status", "notes", "internal_notes", "pickup_hotel", "pickup_time", "pickup_location", "room_number", "checkin_status"],
    writeRole: "seller",
  },
  participant: {
    table: "participant",
    search: ["full_name", "document_id"],
    expand: { booking: true },
    sort: { createdAt: "asc" },
    writable: ["booking", "full_name", "age", "category", "document_id", "nationality", "checkin_status", "special_requirements", "notes"],
    numeric: ["age"],
    writeRole: "seller",
  },
  voucher: {
    table: "voucher",
    search: ["code"],
    expand: { booking: { customer: true, product: true, departure: true } },
    sort: { createdAt: "desc" },
    writable: ["status", "notes", "expires_at"],
    dates: ["expires_at"],
    writeRole: "operations",
  },
  commission_rule: {
    table: "commission_rule",
    search: ["name"],
    expand: { product: true, category: true, partner: true, seller: true },
    sort: { priority: "asc" },
    writable: ["name", "priority", "beneficiary_type", "calc_type", "value", "tiers", "product", "category", "partner", "seller", "channel", "season_from", "season_to", "min_sales", "max_sales", "currency", "status", "description"],
    numeric: ["priority", "value", "min_sales", "max_sales"],
    dates: ["season_from", "season_to"],
    writeRole: "admin",
  },
  commission: {
    table: "commission",
    search: ["beneficiary_name"],
    expand: { booking: { product: true }, seller: true, partner: true, rule: true },
    sort: { createdAt: "desc" },
    writable: ["status", "notes"],
    writeRole: "manager",
  },
  settlement: {
    table: "settlement",
    search: ["code"],
    expand: { partner: true, seller: true },
    expandOne: { partner: true, seller: true, approved_by: true, payable: { _limit: 50 } },
    sort: { createdAt: "desc" },
    writable: ["status", "notes", "paid_total", "pending_total"],
    numeric: ["paid_total", "pending_total"],
    writeRole: "manager",
  },
  cash_register: {
    table: "cash_register",
    search: ["name", "code", "terminal"],
    expand: { branch: true },
    sort: { name: "asc" },
    writable: ["branch", "name", "code", "terminal", "currency", "status"],
    writeRole: "manager",
  },
  cash_session: {
    table: "cash_session",
    search: ["code"],
    expand: { cash_register: true, branch: true, user: true },
    expandOne: { cash_register: true, branch: true, user: true, cash_movement: { _limit: 300, _sort: { createdAt: "desc" } } },
    sort: { createdAt: "desc" },
    writable: ["notes"],
    writeRole: "cashier",
  },
  payment: {
    table: "payment",
    search: ["reference"],
    expand: { order: true, booking: true, customer: true, partner: true, user: true },
    sort: { createdAt: "desc" },
    writable: ["status", "notes"],
    writeRole: "cashier",
  },
  receivable: {
    table: "receivable",
    search: ["document_number"],
    expand: { partner: true, customer: true, order: true },
    sort: { due_date: "asc" },
    writable: ["status", "notes", "due_date", "paid_amount", "balance", "aging_bucket"],
    numeric: ["paid_amount", "balance"],
    dates: ["due_date"],
    writeRole: "manager",
  },
  supplier: {
    table: "supplier",
    search: ["name", "tax_id", "contact_name", "email"],
    sort: { name: "asc" },
    writable: ["name", "supplier_type", "tax_id", "contact_name", "email", "phone", "address", "currency", "payment_terms_days", "status", "notes"],
    numeric: ["payment_terms_days"],
    writeRole: "manager",
  },
  payable: {
    table: "payable",
    search: ["concept", "reference"],
    expand: { supplier: true, partner: true, seller: true, settlement: true },
    sort: { due_date: "asc" },
    writable: ["supplier", "partner", "seller", "settlement", "concept", "category", "amount", "paid_amount", "balance", "currency", "issue_date", "due_date", "status", "reference", "notes"],
    numeric: ["amount", "paid_amount", "balance"],
    dates: ["issue_date", "due_date"],
    writeRole: "manager",
  },
  expense_category: {
    table: "expense_category",
    search: ["name"],
    sort: { name: "asc" },
    writable: ["name", "description", "color", "status"],
    writeRole: "manager",
  },
  expense: {
    table: "expense",
    search: ["concept"],
    expand: { category: true, branch: true, supplier: true, user: true },
    sort: { expense_date: "desc" },
    writable: ["category", "branch", "supplier", "cash_session", "concept", "amount", "currency", "exchange_rate", "expense_date", "payment_method", "status", "notes"],
    numeric: ["amount", "exchange_rate"],
    dates: ["expense_date"],
    writeRole: "cashier",
  },
  currency_rate: {
    table: "currency_rate",
    search: ["source"],
    sort: { rate_date: "desc" },
    writable: ["currency_from", "currency_to", "rate", "rate_date", "source"],
    numeric: ["rate"],
    dates: ["rate_date"],
    writeRole: "manager",
  },
  staff: {
    table: "staff",
    search: ["full_name", "phone", "email", "document_id"],
    expand: { supplier: true },
    sort: { full_name: "asc" },
    writable: ["supplier", "user", "full_name", "staff_type", "languages", "phone", "email", "document_id", "photo_url", "daily_rate", "currency", "hire_date", "license_expiry", "status", "notes"],
    numeric: ["daily_rate"],
    dates: ["hire_date", "license_expiry"],
    writeRole: "operations",
  },
  vehicle: {
    table: "vehicle",
    search: ["name", "plate"],
    expand: { supplier: true, driver: true },
    sort: { name: "asc" },
    writable: ["supplier", "driver", "name", "plate", "vehicle_type", "capacity", "photo_url", "insurance_expiry", "inspection_expiry", "status", "notes"],
    numeric: ["capacity"],
    dates: ["insurance_expiry", "inspection_expiry"],
    writeRole: "operations",
  },
  product_cost: {
    table: "product_cost",
    search: ["concept"],
    expand: { product: true, supplier: true },
    sort: { createdAt: "desc" },
    writable: ["product", "supplier", "concept", "cost_type", "amount", "currency", "status", "notes"],
    numeric: ["amount"],
    writeRole: "manager",
  },
  pickup_route: {
    table: "pickup_route",
    search: ["name"],
    expand: { departure: { product: true }, zone: true, vehicle: true, driver: true, guide: true },
    expandOne: { departure: { product: true }, zone: true, vehicle: true, driver: true, guide: true, pickup: { _limit: 200, hotel: true, booking: { customer: true } } },
    sort: { start_time: "asc" },
    writable: ["departure", "zone", "vehicle", "driver", "guide", "name", "start_time", "pax_total", "stops_count", "status", "notes"],
    numeric: ["pax_total", "stops_count"],
    writeRole: "operations",
  },
  pickup: {
    table: "pickup",
    search: ["location", "room"],
    expand: { booking: { customer: true, product: true }, hotel: true, route: true },
    sort: { pickup_time: "asc" },
    writable: ["booking", "hotel", "route", "pickup_time", "location", "room", "pax", "status", "notes"],
    numeric: ["pax"],
    writeRole: "operations",
  },
  departure_resource: {
    table: "departure_resource",
    search: ["notes"],
    expand: { departure: { product: true }, vehicle: true, staff: true },
    sort: { createdAt: "desc" },
    writable: ["departure", "vehicle", "staff", "resource_role", "pax_assigned", "start_time", "end_time", "cost", "currency", "status", "notes"],
    numeric: ["pax_assigned", "cost"],
    writeRole: "operations",
  },
  audit_log: {
    table: "audit_log",
    search: ["action", "description", "entity_type"],
    expand: { user: true, impersonated_by: true },
    sort: { createdAt: "desc" },
    writable: [],
    writeRole: "admin",
  },
  notification: {
    table: "notification",
    search: ["title"],
    expand: { user: true, partner: true },
    sort: { createdAt: "desc" },
    writable: ["read_status", "read_at"],
    writeRole: "seller",
  },
};

export function getResource(name: string): ResourceDef | null {
  return RESOURCES[name] ?? null;
}

/** Filters and coerces an incoming payload down to the resource's writable fields. */
export function sanitizePayload(def: ResourceDef, body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of def.writable) {
    if (!(key in body)) continue;
    let value = body[key];
    if (value === "" || value === undefined) value = null;
    if (value !== null && def.numeric?.includes(key)) {
      const n = Number(value);
      value = Number.isFinite(n) ? n : null;
    }
    if (value !== null && def.dates?.includes(key)) {
      const d = new Date(value as string);
      value = Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      value = JSON.stringify(value);
    }
    out[key] = value ?? undefined;
  }
  return out;
}
