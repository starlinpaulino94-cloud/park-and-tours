-- ============================================================================
-- 0010 — Catalog + CRM extras: product_category, product_cost, promotion,
-- departure_resource, allotment, lead, crm_activity, quote, quote_line,
-- guest_case.
-- ============================================================================

create table product_category (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  description text,
  color       text,
  icon        text,
  sort_order  integer,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index product_category_org_idx on product_category (organization_id, status);
create trigger product_category_touch before update on product_category for each row execute function app.touch_updated_at();

create table product_cost (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  product_id  uuid references product(id) on delete cascade,
  supplier_id uuid references supplier(id) on delete set null,
  concept     text,
  cost_type   text check (cost_type in ('per_person','per_group','per_departure','per_vehicle','percentage','fixed')),
  amount      numeric(14,2) not null default 0 check (amount >= 0),
  currency    currency,
  status      text not null default 'active' check (status in ('active','inactive')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index product_cost_org_idx     on product_cost (organization_id, status);
create index product_cost_product_idx on product_cost (product_id);
create trigger product_cost_touch before update on product_cost for each row execute function app.touch_updated_at();

create table promotion (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  code        text,
  discount_type text check (discount_type in ('percentage','fixed')),
  value       numeric(14,3) check (value >= 0),
  valid_from  date,
  valid_to    date,
  max_uses    integer check (max_uses >= 0),
  used_count  integer not null default 0 check (used_count >= 0),
  min_amount  numeric(14,2) check (min_amount >= 0),
  channels    text[] default '{}',
  status      text not null default 'active' check (status in ('active','inactive','expired')),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index promotion_org_idx on promotion (organization_id, status);
create trigger promotion_touch before update on promotion for each row execute function app.touch_updated_at();

create table departure_resource (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  departure_id uuid not null references departure(id) on delete cascade,
  vehicle_id   uuid,   -- FK added at end of 0014
  staff_id     uuid references staff(id) on delete set null,
  resource_role text check (resource_role in ('guide','driver','photographer','coordinator','vehicle','equipment')),
  pax_assigned integer check (pax_assigned >= 0),
  start_time   text,
  end_time     text,
  cost         numeric(14,2) check (cost >= 0),
  currency     currency,
  status       text not null default 'planned' check (status in ('planned','confirmed','conflict','cancelled')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index departure_resource_org_idx       on departure_resource (organization_id, status);
create index departure_resource_departure_idx on departure_resource (departure_id);
create trigger departure_resource_touch before update on departure_resource for each row execute function app.touch_updated_at();

create table allotment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  allotment_type text check (allotment_type in ('free_sale','guaranteed','on_request','closed')),
  seats          integer not null default 0 check (seats          >= 0),
  seats_used     integer not null default 0 check (seats_used     >= 0),
  seats_released integer not null default 0 check (seats_released >= 0),
  release_days   integer check (release_days >= 0),
  valid_from  date,
  valid_to    date,
  weekdays    text[] default '{}',
  status      text not null default 'active' check (status in ('active','inactive')),
  notes       text,
  partner_id  uuid references organizations(id) on delete cascade,
  product_id  uuid references product(id) on delete cascade,
  departure_id uuid references departure(id) on delete cascade,
  product_modality_id uuid references product_modality(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index allotment_org_idx      on allotment (organization_id, status);
create index allotment_partner_idx  on allotment (organization_id, partner_id);
create index allotment_product_idx  on allotment (product_id);
create trigger allotment_touch before update on allotment for each row execute function app.touch_updated_at();

create table lead (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  customer_id uuid references customer(id) on delete set null,
  seller_id   uuid references seller(id) on delete set null,
  product_id  uuid references product(id) on delete set null,
  partner_id  uuid references organizations(id) on delete set null,
  name        text,
  email       text,
  phone       text,
  whatsapp    text,
  source      text check (source in
                ('walk_in','referral','web','whatsapp','social','hotel','agency','campaign','phone','other')),
  status      text not null default 'new' check (status in
                ('new','contacted','interested','quoted','follow_up','booked','lost')),
  estimated_value numeric(14,2) check (estimated_value >= 0),
  currency    currency,
  pax         integer check (pax >= 0),
  travel_date date,
  next_action_at timestamptz,
  lost_reason text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index lead_org_idx      on lead (organization_id, status);
create index lead_seller_idx   on lead (organization_id, seller_id);
create index lead_customer_idx on lead (organization_id, customer_id);
create trigger lead_touch before update on lead for each row execute function app.touch_updated_at();

create table crm_activity (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  lead_id     uuid references lead(id) on delete cascade,
  customer_id uuid references customer(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  activity_type text check (activity_type in ('call','whatsapp','email','sms','note','task','meeting')),
  subject     text,
  notes       text,
  due_at      timestamptz,
  done_at     timestamptz,
  status      text not null default 'pending' check (status in ('pending','done','cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index crm_activity_org_idx  on crm_activity (organization_id, status);
create index crm_activity_lead_idx on crm_activity (lead_id);
create trigger crm_activity_touch before update on crm_activity for each row execute function app.touch_updated_at();

create table quote (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text not null,
  status      text not null default 'draft' check (status in
                ('draft','sent','negotiating','accepted','rejected','expired','converted')),
  quote_type  text check (quote_type in ('group','corporate','wedding','school','incentive','cruise','custom')),
  issued_at   timestamptz,
  valid_until timestamptz,
  event_date  date,
  pax         integer check (pax >= 0),
  subtotal    numeric(14,2) not null default 0,
  discount    numeric(14,2) not null default 0,
  tax         numeric(14,2) not null default 0,
  total       numeric(14,2) not null default 0,
  currency    currency not null default 'usd',
  margin_percent numeric(6,3),
  terms       text,
  notes       text,
  rejection_reason text,
  sent_at     timestamptz,
  decided_at  timestamptz,
  customer_id uuid references customer(id) on delete set null,
  partner_id  uuid references organizations(id) on delete set null,
  seller_id   uuid references seller(id) on delete set null,
  lead_id     uuid references lead(id) on delete set null,
  order_id    uuid references sales_order(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index quote_org_idx      on quote (organization_id, status);
create index quote_customer_idx on quote (organization_id, customer_id);
create trigger quote_touch before update on quote for each row execute function app.touch_updated_at();

create table quote_line (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  description text,
  quantity    numeric(14,2) not null default 1 check (quantity >= 0),
  unit_price  numeric(14,2) not null default 0 check (unit_price >= 0),
  unit_cost   numeric(14,2) check (unit_cost >= 0),
  discount_percent numeric(6,3),
  line_total  numeric(14,2) not null default 0,
  service_date date,
  quote_id    uuid not null references quote(id) on delete cascade,
  product_id  uuid references product(id) on delete set null,
  product_modality_id uuid references product_modality(id) on delete set null,
  departure_id uuid references departure(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index quote_line_quote_idx on quote_line (quote_id);
create trigger quote_line_touch before update on quote_line for each row execute function app.touch_updated_at();

create table guest_case (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text not null,
  case_type   text check (case_type in
                ('complaint','claim','compliment','lost_item','found_item','refund_request',
                 'accessibility','special_request')),
  status      text not null default 'open' check (status in
                ('open','in_progress','waiting_customer','resolved','closed','escalated')),
  priority    text check (priority in ('low','medium','high','urgent')),
  channel     text check (channel in ('counter','phone','email','whatsapp','web','social','review_site')),
  opened_at   timestamptz not null default now(),
  subject     text,
  description text,
  resolution  text,
  resolved_at timestamptz,
  satisfaction_score integer check (satisfaction_score >= 0),
  compensation_amount numeric(14,2) check (compensation_amount >= 0),
  currency    currency,
  compensation_type text check (compensation_type in ('none','refund','voucher','free_visit','upgrade','gift')),
  customer_id uuid references customer(id) on delete set null,
  booking_id  uuid references booking(id) on delete set null,
  participant_id uuid references participant(id) on delete set null,
  assigned_to_id uuid references auth.users(id) on delete set null,
  order_id    uuid references sales_order(id) on delete set null,
  incident_id uuid,   -- FK added at end of 0014
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index guest_case_org_idx      on guest_case (organization_id, status);
create index guest_case_customer_idx on guest_case (organization_id, customer_id);
create trigger guest_case_touch before update on guest_case for each row execute function app.touch_updated_at();
