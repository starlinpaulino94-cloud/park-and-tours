-- ============================================================================
-- 0009 — Org structure + platform: plan, subscription_invoice, branch, staff,
-- shift, attendance, certification, zone, hotel, supplier, audit_log,
-- notification, approval_request, integration, document, document_ack,
-- stripe_event. Every business table is org-scoped EXCEPT plan and stripe_event
-- (global) and audit_log (organization_id NULLABLE — platform events).
-- ============================================================================

create table plan (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text,
  description   text,
  monthly_price numeric(14,2) not null default 0 check (monthly_price >= 0),
  yearly_price  numeric(14,2) not null default 0 check (yearly_price  >= 0),
  currency      currency not null default 'usd',
  max_users          integer check (max_users          >= 0),
  max_bookings_month integer check (max_bookings_month >= 0),
  max_storage_mb     integer check (max_storage_mb     >= 0),
  max_products       integer check (max_products       >= 0),
  trial_days         integer check (trial_days         >= 0),
  modules_enabled text[] default '{}',
  is_premium  boolean not null default false,
  status      text not null default 'active' check (status in ('active','inactive')),
  sort_order  integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (code)
);
create index plan_status_idx on plan (status);
create trigger plan_touch before update on plan for each row execute function app.touch_updated_at();

create table subscription_invoice (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  plan_id     uuid references plan(id) on delete set null,
  invoice_number text not null,
  period_from timestamptz,
  period_to   timestamptz,
  amount      numeric(14,2) not null default 0 check (amount >= 0),
  currency    currency not null default 'usd',
  status      text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  issued_at   timestamptz,
  paid_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, invoice_number)
);
create index subscription_invoice_org_idx on subscription_invoice (organization_id, status);
create trigger subscription_invoice_touch before update on subscription_invoice for each row execute function app.touch_updated_at();

create table zone (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  description text,
  color       text,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index zone_org_idx on zone (organization_id, status);
create trigger zone_touch before update on zone for each row execute function app.touch_updated_at();

create table branch (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  code        text,
  branch_type text check (branch_type in ('park','office','tour_center','pos','warehouse','other')),
  address     text,
  city        text,
  phone       text,
  email       text,
  manager_id  uuid references auth.users(id) on delete set null,
  parent_branch_id uuid references branch(id) on delete set null,
  status      text not null default 'active' check (status in ('active','inactive')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index branch_org_idx on branch (organization_id, status);
create trigger branch_touch before update on branch for each row execute function app.touch_updated_at();

create table supplier (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  supplier_type text check (supplier_type in ('transport','restaurant','boat','park','guide','hotel','equipment','other')),
  tax_id      text,
  contact_name text,
  email       text,
  phone       text,
  address     text,
  currency    currency,
  payment_terms_days integer check (payment_terms_days >= 0),
  balance     numeric(14,2) not null default 0,
  status      text not null default 'active' check (status in ('active','inactive')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index supplier_org_idx on supplier (organization_id, status);
create trigger supplier_touch before update on supplier for each row execute function app.touch_updated_at();

create table staff (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  supplier_id uuid references supplier(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  full_name   text,
  staff_type  text check (staff_type in ('guide','driver','photographer','coordinator','external')),
  languages   text[] default '{}',
  phone       text,
  email       text,
  document_id text,
  document_file text[] default '{}',
  photo_url   text,
  daily_rate  numeric(14,2) check (daily_rate >= 0),
  currency    currency,
  hire_date   date,
  license_expiry date,
  status      text not null default 'active' check (status in ('active','inactive','unavailable')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index staff_org_idx      on staff (organization_id, status);
create index staff_supplier_idx on staff (organization_id, supplier_id);
create trigger staff_touch before update on staff for each row execute function app.touch_updated_at();

create table shift (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  role_label  text,
  shift_date  date,
  starts_at   timestamptz,
  ends_at     timestamptz,
  status      text not null default 'planned' check (status in
                ('planned','published','confirmed','in_progress','completed','no_show','cancelled')),
  break_min      integer check (break_min >= 0),
  hours_planned  numeric(6,2) check (hours_planned >= 0),
  hourly_rate    numeric(14,2) check (hourly_rate >= 0),
  currency    currency,
  notes       text,
  staff_id    uuid references staff(id) on delete set null,
  zone_id     uuid references zone(id) on delete set null,
  attraction_id uuid,   -- FK added at end of 0014
  branch_id   uuid references branch(id) on delete set null,
  departure_id uuid references departure(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index shift_org_idx   on shift (organization_id, status, shift_date);
create index shift_staff_idx on shift (organization_id, staff_id);
create trigger shift_touch before update on shift for each row execute function app.touch_updated_at();

create table attendance (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  attendance_date date,
  clock_in    timestamptz,
  clock_out   timestamptz,
  hours_worked   numeric(6,2) check (hours_worked   >= 0),
  overtime_hours numeric(6,2) check (overtime_hours >= 0),
  status      text not null default 'present' check (status in
                ('present','late','absent','excused','holiday','vacation','sick')),
  method      text check (method in ('kiosk','qr','manual','biometric','mobile')),
  notes       text,
  staff_id    uuid references staff(id) on delete set null,
  shift_id    uuid references shift(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index attendance_org_idx   on attendance (organization_id, attendance_date);
create index attendance_staff_idx on attendance (organization_id, staff_id);
create trigger attendance_touch before update on attendance for each row execute function app.touch_updated_at();

create table certification (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  cert_type   text check (cert_type in
                ('first_aid','lifeguard','driving_license','ride_operator','food_handling',
                 'guide_license','language','forklift','height_work','other')),
  issuer      text,
  number      text,
  issued_at   date,
  expires_at  date,
  status      text not null default 'valid' check (status in ('valid','expiring','expired','revoked','pending')),
  blocks_assignment boolean not null default false,
  document    text,
  notes       text,
  staff_id    uuid references staff(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index certification_org_idx   on certification (organization_id, status);
create index certification_staff_idx on certification (staff_id);
create trigger certification_touch before update on certification for each row execute function app.touch_updated_at();

create table hotel (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  zone_id     uuid references zone(id) on delete set null,
  name        text not null,
  address     text,
  phone       text,
  category    text check (category in ('1_star','2_star','3_star','4_star','5_star','boutique','apartment')),
  pickup_point text,
  latitude    numeric(9,6),
  longitude   numeric(9,6),
  pickup_offset_min integer,
  status      text not null default 'active' check (status in ('active','inactive')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index hotel_org_idx  on hotel (organization_id, status);
create index hotel_zone_idx on hotel (organization_id, zone_id);
create trigger hotel_touch before update on hotel for each row execute function app.touch_updated_at();

create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  user_id         uuid references auth.users(id) on delete set null,
  impersonated_by uuid references auth.users(id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   text,
  description text,
  ip_address  text,
  user_agent  text,
  metadata_json jsonb not null default '{}',
  severity    text not null default 'info' check (severity in ('info','warning','critical')),
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index audit_log_org_idx    on audit_log (organization_id, occurred_at desc);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);
create trigger audit_log_touch before update on audit_log for each row execute function app.touch_updated_at();

create table notification (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  user_id     uuid references auth.users(id) on delete cascade,
  partner_id  uuid references organizations(id) on delete set null,
  title       text not null,
  message     text,
  notification_type text check (notification_type in ('info','booking','payment','operation','alert','settlement')),
  link        text,
  read_status boolean not null default false,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index notification_org_idx  on notification (organization_id, created_at desc);
create index notification_user_idx on notification (user_id, read_status);
create trigger notification_touch before update on notification for each row execute function app.touch_updated_at();

create table approval_request (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text not null,
  action_type text check (action_type in
                ('discount_over_limit','refund','void_sale','cash_adjustment','price_change',
                 'commission_override','clawback','purchase_order','credit_note','capacity_override',
                 'waiver_bypass','payout','expense','schedule_change')),
  status      text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','expired')),
  requested_at timestamptz not null default now(),
  decided_at  timestamptz,
  expires_at  timestamptz,
  amount      numeric(14,2) check (amount >= 0),
  currency    currency,
  reason      text,
  decision_notes text,
  payload     jsonb not null default '{}',
  target_table text,
  target_id   text,
  requires_two boolean not null default false,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by  uuid references auth.users(id) on delete set null,
  second_approver_id uuid references auth.users(id) on delete set null,
  order_id    uuid references "order"(id) on delete set null,
  booking_id  uuid references booking(id) on delete set null,
  payment_id  uuid references payment(id) on delete set null,
  purchase_order_id uuid,   -- FK added at end of 0013
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index approval_request_org_idx on approval_request (organization_id, status);
create trigger approval_request_touch before update on approval_request for each row execute function app.touch_updated_at();

create table integration (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  provider    text check (provider in
                ('octo','viator','getyourguide','expedia','civitatis','tripadvisor','stripe','whatsapp',
                 'mailchimp','quickbooks','dgii','google_calendar','zapier','webhook','custom')),
  category    text check (category in ('distribution','payments','messaging','accounting','tax','marketing','other')),
  status      text not null default 'pending' check (status in ('connected','disconnected','error','pending','sandbox')),
  direction   text,
  endpoint_url text,
  external_id text,
  last_sync_at timestamptz,
  last_error  text,
  sync_frequency text check (sync_frequency in ('realtime','every_5_min','hourly','daily','manual')),
  records_synced integer check (records_synced >= 0),
  config      jsonb not null default '{}',
  webhook_secret_set boolean not null default false,
  partner_id  uuid references organizations(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index integration_org_idx on integration (organization_id, status);
create trigger integration_touch before update on integration for each row execute function app.touch_updated_at();

create table document (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  title       text not null,
  doc_type    text check (doc_type in
                ('sop','policy','manual','contract','permit','insurance','certificate',
                 'emergency_plan','menu','price_list','other')),
  version     text,
  body        text,
  file        text,
  url         text,
  effective_from date,
  expires_at  date,
  requires_ack boolean not null default false,
  audience    text check (audience in ('all','managers','operations','guides','drivers','cashiers','maintenance','safety')),
  status      text not null default 'draft' check (status in ('draft','published','archived')),
  owner_id    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index document_org_idx on document (organization_id, status);
create trigger document_touch before update on document for each row execute function app.touch_updated_at();

create table document_ack (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  document_id uuid not null references document(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  version_acked text,
  acknowledged_at timestamptz not null default now(),
  quiz_score  numeric(6,2),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, document_id, user_id, version_acked)
);
create index document_ack_doc_idx on document_ack (document_id);
create trigger document_ack_touch before update on document_ack for each row execute function app.touch_updated_at();

create table stripe_event (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null,
  event_type   text,
  processed_at timestamptz,
  status       text not null default 'processed' check (status in ('processed','skipped','error')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (event_id)
);
create trigger stripe_event_touch before update on stripe_event for each row execute function app.touch_updated_at();
