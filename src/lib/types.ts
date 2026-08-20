/**
 * TourFlow ERP — database record types.
 * Mirrors the Totalum schema (see scripts/setup-database.mjs).
 *
 * Convention: object reference fields hold a string id when not expanded,
 * and the full record when expanded via query(). Hence `Ref<T>`.
 */

export type Ref<T> = string | T | null | undefined;

/** Narrow a possibly-expanded reference to its id. */
export function refId<T extends { _id?: string }>(ref: Ref<T>): string | undefined {
  if (!ref) return undefined;
  if (typeof ref === "string") return ref;
  return ref._id;
}

/** Narrow a possibly-expanded reference to the full record (undefined when not expanded). */
export function refObj<T extends { _id?: string }>(ref: Ref<T>): T | undefined {
  if (!ref || typeof ref === "string") return undefined;
  return ref;
}

export interface TotalumFile {
  name: string;
  url?: string;
}

export interface BaseRecord {
  _id: string;
  /** Totalum returns Date objects from the SDK and ISO strings over HTTP. */
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export type Currency = "usd" | "dop" | "eur" | "mxn" | "cop" | "brl";
export type Channel =
  | "direct" | "web" | "phone" | "whatsapp" | "walk_in"
  | "b2b_portal" | "agency" | "tour_center" | "ota" | "pos";
export type Lang = "es" | "en" | "fr" | "de" | "it" | "pt" | "ru";
export type ModuleKey =
  | "bookings" | "crm" | "commissions" | "settlements" | "payments" | "cash_pos"
  | "transport" | "pickups" | "operations" | "b2b_portal" | "accounting" | "reports" | "audit";

// ---------------------------------------------------------------------------
// SaaS core
// ---------------------------------------------------------------------------
export interface Plan extends BaseRecord {
  name?: string; code?: string; description?: string;
  monthly_price?: number; yearly_price?: number; currency?: Currency;
  max_users?: number; max_bookings_month?: number; max_storage_mb?: number;
  max_products?: number; trial_days?: number;
  modules_enabled?: ModuleKey[]; is_premium?: "yes" | "no";
  status?: "active" | "inactive"; sort_order?: number;
}

export type CompanyType =
  | "park" | "excursion_company" | "tour_operator" | "tour_center"
  | "agency" | "transport" | "mixed_operator" | "other";

export interface Company extends BaseRecord {
  name?: string; slug?: string; legal_name?: string; tax_id?: string;
  company_type?: CompanyType; group_name?: string;
  email?: string; phone?: string; whatsapp?: string;
  address?: string; city?: string; country?: string; timezone?: string;
  logo?: TotalumFile; logo_url?: string; brand_color?: string;
  base_currency?: Currency; plan?: Ref<Plan>;
  subscription_status?: "trial" | "active" | "past_due" | "cancelled" | "suspended";
  trial_ends_at?: string; next_billing_at?: string;
  modules_enabled?: ModuleKey[]; storage_used_mb?: number;
  status?: "active" | "inactive" | "suspended"; notes?: string;
}

export interface SubscriptionInvoice extends BaseRecord {
  company?: Ref<Company>; plan?: Ref<Plan>; invoice_number?: string;
  period_from?: string; period_to?: string; amount?: number; currency?: Currency;
  status?: "pending" | "paid" | "failed" | "refunded";
  issued_at?: string; paid_at?: string;
}

export interface AppUser extends BaseRecord {
  email?: string; name?: string; image?: string;
  role?: string; phone?: string; status?: string; last_login_at?: string;
  company_id?: Ref<Company>; partner_id?: Ref<Partner>;
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------
export interface Branch extends BaseRecord {
  company?: Ref<Company>; name?: string; code?: string;
  branch_type?: "park" | "office" | "tour_center" | "pos" | "warehouse" | "other";
  address?: string; city?: string; phone?: string; email?: string;
  manager?: Ref<AppUser>; parent_branch?: Ref<Branch>;
  status?: "active" | "inactive"; notes?: string;
}

export type PartnerType =
  | "tour_center" | "agency" | "subagency" | "tour_operator" | "hotel" | "ota" | "reseller";

export interface Partner extends BaseRecord {
  company?: Ref<Company>; name?: string; commercial_name?: string;
  partner_type?: PartnerType; tax_id?: string; contact_name?: string;
  email?: string; phone?: string; whatsapp?: string;
  address?: string; city?: string; country?: string;
  credit_limit?: number; credit_days?: number; currency?: Currency;
  default_commission_pct?: number; balance?: number;
  logo_url?: string; contract_file?: TotalumFile;
  status?: "active" | "inactive" | "blocked" | "pending";
  contract_from?: string; contract_to?: string;
  commercial_terms?: string; notes?: string;
  parent_partner?: Ref<Partner>; authorized_products?: Product[];
}

export interface Seller extends BaseRecord {
  company?: Ref<Company>; user?: Ref<AppUser>; partner?: Ref<Partner>; branch?: Ref<Branch>;
  code?: string; first_name?: string; last_name?: string;
  email?: string; phone?: string; whatsapp?: string;
  seller_role?: "seller" | "supervisor" | "manager" | "promoter" | "agent";
  commission_pct?: number; monthly_goal?: number; max_discount_pct?: number;
  currency?: Currency; photo_url?: string; hire_date?: string;
  status?: "active" | "inactive" | "suspended"; notes?: string;
  supervisor?: Ref<Seller>; authorized_products?: Product[];
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------
export interface Zone extends BaseRecord {
  company?: Ref<Company>; name?: string; description?: string;
  color?: string; status?: "active" | "inactive";
}

export interface Hotel extends BaseRecord {
  company?: Ref<Company>; zone?: Ref<Zone>; name?: string;
  address?: string; phone?: string;
  category?: "1_star" | "2_star" | "3_star" | "4_star" | "5_star" | "boutique" | "apartment";
  pickup_point?: string; latitude?: number; longitude?: number;
  pickup_offset_min?: number; status?: "active" | "inactive"; notes?: string;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
export interface ProductCategory extends BaseRecord {
  company?: Ref<Company>; name?: string; description?: string;
  color?: string; icon?: string; sort_order?: number; status?: "active" | "inactive";
}

export interface CancellationTier {
  hours_before: number;
  refund_pct: number;
  label?: string;
}

export interface CancellationPolicy extends BaseRecord {
  company?: Ref<Company>; name?: string; description?: string;
  tiers?: CancellationTier[] | string; no_show_refund_pct?: number;
  status?: "active" | "inactive";
}

export type ProductType = "excursion" | "ticket" | "transport" | "package" | "activity" | "rental";

export interface Product extends BaseRecord {
  company?: Ref<Company>; category?: Ref<ProductCategory>;
  cancellation_policy?: Ref<CancellationPolicy>;
  name?: string; code?: string; product_type?: ProductType;
  short_description?: string; description?: string;
  images?: TotalumFile[]; cover_image_url?: string; video_url?: string;
  location?: string; meeting_point?: string;
  duration_hours?: number; languages?: Lang[];
  min_age?: number; default_capacity?: number;
  restrictions?: string; recommendations?: string;
  inclusions?: string; exclusions?: string; terms?: string; instructions?: string;
  base_price?: number; base_cost?: number; currency?: Currency;
  featured?: "yes" | "no"; sort_order?: number;
  status?: "active" | "inactive" | "draft" | "seasonal";
  product_modality?: ProductModality[];
  departure?: Departure[];
  _count?: Record<string, number>;
}

export type ModalityType =
  | "adult" | "child" | "infant" | "resident" | "foreigner"
  | "private" | "vip" | "group" | "vehicle" | "couple";

export interface ProductModality extends BaseRecord {
  company?: Ref<Company>; product?: Ref<Product>;
  name?: string; code?: string; modality_type?: ModalityType;
  price?: number; cost?: number; currency?: Currency;
  min_pax?: number; max_pax?: number; age_from?: number; age_to?: number;
  capacity_weight?: number; sort_order?: number; status?: "active" | "inactive";
}

export interface PriceRule extends BaseRecord {
  company?: Ref<Company>; product?: Ref<Product>; modality?: Ref<ProductModality>;
  partner?: Ref<Partner>; seller?: Ref<Seller>; name?: string;
  price_type?: "standard" | "per_person" | "per_group" | "per_vehicle" | "b2c" | "b2b";
  channel?: Channel; amount?: number; currency?: Currency;
  season_from?: string; season_to?: string;
  weekdays?: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
  time_from?: string; time_to?: string;
  min_qty?: number; max_qty?: number; priority?: number;
  status?: "active" | "inactive";
}

export type DepartureStatus =
  | "available" | "almost_full" | "full" | "closed" | "cancelled" | "completed";

export interface Departure extends BaseRecord {
  company?: Ref<Company>; product?: Ref<Product>; branch?: Ref<Branch>;
  departure_at?: string; departure_time?: string;
  capacity?: number; booked_pax?: number; pending_pax?: number;
  available_pax?: number; waitlist_pax?: number; cutoff_hours?: number;
  status?: DepartureStatus; meeting_point?: string; notes?: string;
  booking?: Booking[];
  departure_resource?: DepartureResource[];
  pickup_route?: PickupRoute[];
  _count?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Customers & CRM
// ---------------------------------------------------------------------------
export interface Customer extends BaseRecord {
  company?: Ref<Company>; hotel?: Ref<Hotel>; assigned_seller?: Ref<Seller>;
  first_name?: string; last_name?: string; email?: string;
  phone?: string; whatsapp?: string; nationality?: string;
  language?: Lang; country?: string; room?: string; address?: string;
  document_id?: string; birth_date?: string;
  tags?: string[]; source?: string;
  total_spent?: number; bookings_count?: number;
  status?: "active" | "inactive" | "blacklist";
  preferences?: string; notes?: string;
  booking?: Booking[]; order?: Order[];
  _count?: Record<string, number>;
}

export type LeadStatus =
  | "new" | "contacted" | "interested" | "quoted" | "follow_up" | "booked" | "lost";

export interface Lead extends BaseRecord {
  company?: Ref<Company>; customer?: Ref<Customer>; seller?: Ref<Seller>;
  product?: Ref<Product>; partner?: Ref<Partner>;
  name?: string; email?: string; phone?: string; whatsapp?: string;
  source?: string; status?: LeadStatus;
  estimated_value?: number; currency?: Currency;
  pax?: number; travel_date?: string; next_action_at?: string;
  lost_reason?: string; notes?: string;
  crm_activity?: CrmActivity[];
}

export interface CrmActivity extends BaseRecord {
  company?: Ref<Company>; lead?: Ref<Lead>; customer?: Ref<Customer>; user?: Ref<AppUser>;
  activity_type?: "call" | "whatsapp" | "email" | "sms" | "note" | "task" | "meeting";
  subject?: string; notes?: string; due_at?: string; done_at?: string;
  status?: "pending" | "done" | "cancelled";
}

// ---------------------------------------------------------------------------
// Orders & bookings
// ---------------------------------------------------------------------------
export interface Promotion extends BaseRecord {
  company?: Ref<Company>; name?: string; code?: string;
  discount_type?: "percentage" | "fixed"; value?: number;
  valid_from?: string; valid_to?: string;
  max_uses?: number; used_count?: number; min_amount?: number;
  channels?: Channel[]; status?: "active" | "inactive" | "expired";
  description?: string; products?: Product[];
}

export type OrderStatus =
  | "draft" | "pending" | "pending_payment" | "confirmed"
  | "partially_paid" | "paid" | "completed" | "cancelled" | "refunded";

export interface Order extends BaseRecord {
  company?: Ref<Company>; order_number?: string;
  customer?: Ref<Customer>; branch?: Ref<Branch>;
  seller?: Ref<Seller>; partner?: Ref<Partner>;
  promotion?: Ref<Promotion>; created_by?: Ref<AppUser>;
  channel?: Channel; status?: OrderStatus; order_date?: string;
  currency?: Currency; exchange_rate?: number;
  subtotal?: number; discount_total?: number; tax_total?: number;
  total?: number; paid_total?: number; balance?: number;
  base_currency?: Currency; base_currency_total?: number;
  notes?: string;
  booking?: Booking[]; payment?: Payment[];
  _count?: Record<string, number>;
}

export type BookingStatus =
  | "draft" | "pending" | "pending_payment" | "confirmed" | "partially_paid"
  | "paid" | "checked_in" | "no_show" | "completed" | "cancelled"
  | "refunded" | "partially_refunded";

export interface PriceSnapshot {
  base_price: number;
  applied_rule_id?: string | null;
  applied_rule_name?: string | null;
  modality_name?: string | null;
  unit_price: number;
  quantity: number;
  discount_pct?: number;
  tax_pct?: number;
  currency: Currency;
  exchange_rate: number;
  captured_at: string;
}

export interface Booking extends BaseRecord {
  company?: Ref<Company>; booking_number?: string;
  order?: Ref<Order>; customer?: Ref<Customer>;
  product?: Ref<Product>; departure?: Ref<Departure>;
  modality?: Ref<ProductModality>; branch?: Ref<Branch>;
  seller?: Ref<Seller>; partner?: Ref<Partner>; pickup_hotel?: Ref<Hotel>;
  created_by?: Ref<AppUser>; checked_in_by?: Ref<AppUser>;
  channel?: Channel; status?: BookingStatus;
  booking_date?: string; travel_date?: string;
  adults?: number; children?: number; infants?: number; pax_total?: number;
  unit_price?: number; gross_amount?: number;
  discount_amount?: number; tax_amount?: number; total_amount?: number;
  cost_amount?: number; margin_amount?: number;
  paid_amount?: number; balance_amount?: number; refund_amount?: number;
  currency?: Currency; exchange_rate?: number;
  base_currency?: Currency; base_amount?: number;
  price_snapshot?: PriceSnapshot | string;
  pickup_time?: string; pickup_location?: string; room_number?: string;
  voucher_code?: string;
  checkin_status?: "pending" | "partial" | "done" | "no_show";
  checked_in_at?: string; checked_in_pax?: number;
  cancelled_at?: string; cancel_reason?: string;
  capacity_override?: "yes" | "no"; override_reason?: string;
  notes?: string; internal_notes?: string;
  participant?: Participant[]; voucher?: Voucher[];
  commission?: Commission[]; payment?: Payment[]; pickup?: Pickup[];
  _count?: Record<string, number>;
}

export interface Participant extends BaseRecord {
  company?: Ref<Company>; booking?: Ref<Booking>;
  full_name?: string; age?: number;
  category?: "adult" | "child" | "infant" | "senior";
  document_id?: string; nationality?: string; document_file?: TotalumFile;
  checkin_status?: "pending" | "done" | "no_show";
  special_requirements?: string; notes?: string;
}

export interface Voucher extends BaseRecord {
  company?: Ref<Company>; booking?: Ref<Booking>;
  code?: string; qr_data?: string;
  status?: "valid" | "used" | "cancelled" | "expired";
  issued_at?: string; used_at?: string; expires_at?: string;
  pdf_file?: TotalumFile; notes?: string;
}

// ---------------------------------------------------------------------------
// Commissions
// ---------------------------------------------------------------------------
export type BeneficiaryType = "seller" | "supervisor" | "partner" | "guide" | "supplier";
export type CalcType = "percentage" | "fixed" | "tiered" | "volume";

export interface CommissionTier {
  from: number;
  to?: number | null;
  value: number;
  calc_type?: "percentage" | "fixed";
}

export interface CommissionRule extends BaseRecord {
  company?: Ref<Company>; name?: string; priority?: number;
  beneficiary_type?: BeneficiaryType; calc_type?: CalcType;
  value?: number; tiers?: CommissionTier[] | string;
  product?: Ref<Product>; category?: Ref<ProductCategory>;
  partner?: Ref<Partner>; seller?: Ref<Seller>; channel?: Channel;
  season_from?: string; season_to?: string;
  min_sales?: number; max_sales?: number; currency?: Currency;
  status?: "active" | "inactive"; description?: string;
}

export type CommissionStatus =
  | "pending" | "approved" | "settled" | "paid" | "cancelled" | "held" | "disputed";

export interface CommissionSnapshot {
  rule_id: string | null;
  rule_name: string;
  priority: number;
  calc_type: CalcType;
  value: number;
  base_amount: number;
  amount: number;
  currency: Currency;
  matched_on: string[];
  captured_at: string;
}

export interface Commission extends BaseRecord {
  company?: Ref<Company>; booking?: Ref<Booking>; order?: Ref<Order>;
  rule?: Ref<CommissionRule>; settlement?: Ref<Settlement>;
  seller?: Ref<Seller>; partner?: Ref<Partner>; user?: Ref<AppUser>;
  beneficiary_type?: BeneficiaryType; beneficiary_name?: string;
  base_amount?: number; calc_type?: CalcType;
  percentage?: number; amount?: number; currency?: Currency;
  status?: CommissionStatus; generated_at?: string; approved_at?: string;
  snapshot?: CommissionSnapshot | string; notes?: string;
}

export interface Settlement extends BaseRecord {
  company?: Ref<Company>; code?: string; beneficiary_type?: BeneficiaryType;
  partner?: Ref<Partner>; seller?: Ref<Seller>; approved_by?: Ref<AppUser>;
  period_from?: string; period_to?: string;
  sales_total?: number; cancellations_total?: number; base_total?: number;
  commission_total?: number; paid_total?: number; pending_total?: number;
  currency?: Currency;
  status?: "pending" | "approved" | "partially_paid" | "paid" | "held" | "disputed" | "void";
  paid_at?: string;
  issued_at?: string; pdf_file?: TotalumFile; notes?: string;
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
export interface CashRegister extends BaseRecord {
  company?: Ref<Company>; branch?: Ref<Branch>;
  name?: string; code?: string; terminal?: string;
  currency?: Currency; status?: "active" | "inactive";
}

export interface CashSession extends BaseRecord {
  company?: Ref<Company>; cash_register?: Ref<CashRegister>;
  branch?: Ref<Branch>; user?: Ref<AppUser>; code?: string;
  opened_at?: string; closed_at?: string;
  opening_amount?: number; expected_cash?: number; counted_cash?: number;
  difference?: number; card_total?: number; transfer_total?: number;
  sales_total?: number; expenses_total?: number; withdrawals_total?: number;
  currency?: Currency; status?: "open" | "closed" | "reconciled"; notes?: string;
  cash_movement?: CashMovement[];
}

export type PaymentMethod =
  | "cash" | "card" | "transfer" | "payment_link" | "deposit" | "b2b_credit" | "mixed" | "other";

export interface Payment extends BaseRecord {
  company?: Ref<Company>; order?: Ref<Order>; booking?: Ref<Booking>;
  customer?: Ref<Customer>; partner?: Ref<Partner>;
  cash_session?: Ref<CashSession>; branch?: Ref<Branch>; user?: Ref<AppUser>;
  reference?: string;
  payment_type?: "payment" | "refund" | "deposit" | "credit_note";
  method?: PaymentMethod;
  status?: "pending" | "authorized" | "completed" | "rejected" | "cancelled" | "refunded" | "partially_refunded";
  amount?: number; currency?: Currency; exchange_rate?: number;
  base_currency?: Currency; base_amount?: number;
  paid_at?: string; receipt_file?: TotalumFile; notes?: string;
}

export interface CashMovement extends BaseRecord {
  company?: Ref<Company>; cash_session?: Ref<CashSession>;
  user?: Ref<AppUser>; payment?: Ref<Payment>;
  movement_type?: "sale" | "refund" | "expense" | "withdrawal" | "deposit" | "adjustment" | "opening" | "closing";
  amount?: number; currency?: Currency;
  concept?: string; reference?: string; movement_at?: string;
}

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export interface Receivable extends BaseRecord {
  company?: Ref<Company>; partner?: Ref<Partner>; customer?: Ref<Customer>; order?: Ref<Order>;
  document_number?: string; issue_date?: string; due_date?: string;
  amount?: number; paid_amount?: number; balance?: number; currency?: Currency;
  status?: "pending" | "partially_paid" | "paid" | "overdue" | "written_off";
  aging_bucket?: AgingBucket; notes?: string;
}

export interface Supplier extends BaseRecord {
  company?: Ref<Company>; name?: string;
  supplier_type?: "transport" | "restaurant" | "boat" | "park" | "guide" | "hotel" | "equipment" | "other";
  tax_id?: string; contact_name?: string; email?: string; phone?: string; address?: string;
  currency?: Currency; payment_terms_days?: number; balance?: number;
  status?: "active" | "inactive"; notes?: string;
}

export interface Payable extends BaseRecord {
  company?: Ref<Company>; supplier?: Ref<Supplier>; partner?: Ref<Partner>;
  seller?: Ref<Seller>; settlement?: Ref<Settlement>;
  concept?: string;
  category?: "transport" | "guide" | "supplier" | "commission" | "salary" | "service" | "other";
  amount?: number; paid_amount?: number; balance?: number; currency?: Currency;
  issue_date?: string; due_date?: string;
  status?: "pending" | "partially_paid" | "paid" | "overdue" | "cancelled";
  reference?: string; notes?: string;
}

export interface ExpenseCategory extends BaseRecord {
  company?: Ref<Company>; name?: string; description?: string;
  color?: string; status?: "active" | "inactive";
}

export interface Expense extends BaseRecord {
  company?: Ref<Company>; category?: Ref<ExpenseCategory>; branch?: Ref<Branch>;
  supplier?: Ref<Supplier>; user?: Ref<AppUser>; cash_session?: Ref<CashSession>;
  concept?: string; amount?: number; currency?: Currency; exchange_rate?: number;
  expense_date?: string;
  payment_method?: "cash" | "card" | "transfer" | "credit" | "other";
  status?: "pending" | "approved" | "paid" | "rejected";
  receipt_file?: TotalumFile; notes?: string;
}

export interface CurrencyRate extends BaseRecord {
  company?: Ref<Company>; currency_from?: Currency; currency_to?: Currency;
  rate?: number; rate_date?: string; source?: string;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export interface Staff extends BaseRecord {
  company?: Ref<Company>; supplier?: Ref<Supplier>; user?: Ref<AppUser>;
  full_name?: string;
  staff_type?: "guide" | "driver" | "photographer" | "coordinator" | "external";
  languages?: Lang[]; phone?: string; email?: string; document_id?: string;
  document_file?: TotalumFile[]; photo_url?: string;
  daily_rate?: number; currency?: Currency;
  hire_date?: string; license_expiry?: string;
  status?: "active" | "inactive" | "unavailable"; notes?: string;
}

export interface Vehicle extends BaseRecord {
  company?: Ref<Company>; supplier?: Ref<Supplier>; driver?: Ref<Staff>;
  name?: string; plate?: string;
  vehicle_type?: "bus" | "minibus" | "van" | "suv_4x4" | "boat" | "catamaran" | "buggy" | "other";
  capacity?: number; photo_url?: string;
  insurance_expiry?: string; inspection_expiry?: string;
  status?: "available" | "in_service" | "maintenance" | "out_of_service"; notes?: string;
}

export interface ProductCost extends BaseRecord {
  company?: Ref<Company>; product?: Ref<Product>; supplier?: Ref<Supplier>;
  concept?: string;
  cost_type?: "per_person" | "per_group" | "per_departure" | "per_vehicle" | "percentage" | "fixed";
  amount?: number; currency?: Currency;
  status?: "active" | "inactive"; notes?: string;
}

export interface PickupRoute extends BaseRecord {
  company?: Ref<Company>; departure?: Ref<Departure>; zone?: Ref<Zone>;
  vehicle?: Ref<Vehicle>; driver?: Ref<Staff>; guide?: Ref<Staff>;
  name?: string; start_time?: string; pax_total?: number; stops_count?: number;
  status?: "planned" | "confirmed" | "in_progress" | "completed" | "cancelled";
  notes?: string; pickup?: Pickup[];
}

export interface Pickup extends BaseRecord {
  company?: Ref<Company>; booking?: Ref<Booking>; hotel?: Ref<Hotel>; route?: Ref<PickupRoute>;
  pickup_time?: string; location?: string; room?: string; pax?: number;
  status?: "pending" | "confirmed" | "picked_up" | "no_show" | "cancelled"; notes?: string;
}

export interface DepartureResource extends BaseRecord {
  company?: Ref<Company>; departure?: Ref<Departure>;
  vehicle?: Ref<Vehicle>; staff?: Ref<Staff>;
  resource_role?: "guide" | "driver" | "photographer" | "coordinator" | "vehicle" | "equipment";
  pax_assigned?: number; start_time?: string; end_time?: string;
  cost?: number; currency?: Currency;
  status?: "planned" | "confirmed" | "conflict" | "cancelled"; notes?: string;
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------
export interface AuditLog extends BaseRecord {
  company?: Ref<Company>; user?: Ref<AppUser>; impersonated_by?: Ref<AppUser>;
  action?: string; entity_type?: string; entity_id?: string;
  description?: string; ip_address?: string; user_agent?: string;
  metadata_json?: Record<string, unknown> | string;
  severity?: "info" | "warning" | "critical"; occurred_at?: string;
}

export interface Notification extends BaseRecord {
  company?: Ref<Company>; user?: Ref<AppUser>; partner?: Ref<Partner>;
  title?: string; message?: string;
  notification_type?: "info" | "booking" | "payment" | "operation" | "alert" | "settlement";
  link?: string; read_status?: "yes" | "no"; read_at?: string;
}
