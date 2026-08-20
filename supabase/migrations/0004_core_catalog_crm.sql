-- ============================================================================
-- 0004 — Core catalog + CRM: customer, product, product_modality, price_rule,
-- cancellation_policy, departure. Every table is org-scoped (organization_id).
-- ============================================================================

-- ── customer ────────────────────────────────────────────────────────────────
create table customer (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  first_name  text,
  last_name   text,
  email       citext,
  phone       text,
  nationality text,
  country     text,
  document_id text,
  birth_date  date,
  tags        text[] default '{}',
  source      text,
  status      text not null default 'active' check (status in ('active','inactive','blacklist')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index customer_org_idx    on customer (organization_id, status);
create index customer_email_idx   on customer (organization_id, email);
create trigger customer_touch before update on customer for each row execute function app.touch_updated_at();

-- ── cancellation_policy ─────────────────────────────────────────────────────
create table cancellation_policy (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  description text,
  tiers       jsonb not null default '[]',    -- [{hours_before, refund_pct, label}]
  no_show_refund_pct numeric(6,3) not null default 0 check (no_show_refund_pct between 0 and 100),
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index cxpolicy_org_idx on cancellation_policy (organization_id);
create trigger cxpolicy_touch before update on cancellation_policy for each row execute function app.touch_updated_at();

-- ── product ─────────────────────────────────────────────────────────────────
create table product (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text,
  name        text not null,
  description text,
  product_type text,
  base_price  numeric(14,2) not null default 0 check (base_price >= 0),
  currency    currency not null default 'usd',
  cancellation_policy_id uuid references cancellation_policy(id) on delete set null,
  status      text not null default 'active' check (status in ('active','inactive','draft','seasonal')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index product_org_idx on product (organization_id, status);
create trigger product_touch before update on product for each row execute function app.touch_updated_at();

-- ── product_modality ────────────────────────────────────────────────────────
create table product_modality (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  product_id  uuid not null references product(id) on delete cascade,
  code        text,
  name        text not null,
  modality_type text,
  price       numeric(14,2) check (price >= 0),
  currency    currency,
  min_pax     integer check (min_pax >= 0),
  max_pax     integer check (max_pax >= 0),
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index modality_org_idx     on product_modality (organization_id);
create index modality_product_idx on product_modality (product_id);
create trigger modality_touch before update on product_modality for each row execute function app.touch_updated_at();

-- ── price_rule ──────────────────────────────────────────────────────────────
create table price_rule (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  product_id  uuid references product(id) on delete cascade,
  modality_id uuid references product_modality(id) on delete cascade,
  partner_id  uuid references organizations(id) on delete cascade,
  seller_id   uuid,   -- FK added in 0006 once seller exists (deferred)
  channel     sales_channel,
  price_type  text,   -- per_person | per_group | per_vehicle
  amount      numeric(14,2) check (amount >= 0),
  currency    currency,
  priority    integer,
  min_qty     integer check (min_qty >= 0),
  max_qty     integer check (max_qty >= 0),
  season_from date,
  season_to   date,
  weekdays    text[],
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index price_rule_org_idx     on price_rule (organization_id, status);
create index price_rule_product_idx on price_rule (product_id);
create trigger price_rule_touch before update on price_rule for each row execute function app.touch_updated_at();

-- ── departure (capacity/inventory unit) ─────────────────────────────────────
create table departure (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  product_id  uuid not null references product(id) on delete restrict,
  departure_at timestamptz not null,
  capacity     integer not null default 0 check (capacity >= 0),  -- 0 = unlimited
  booked_pax   integer not null default 0 check (booked_pax >= 0),
  pending_pax  integer not null default 0 check (pending_pax >= 0),
  cutoff_hours integer not null default 0 check (cutoff_hours >= 0),
  -- status is DERIVED (available|almost_full|full|closed|cancelled|completed);
  -- maintained by the booking service / a trigger, never client-writable.
  status      text not null default 'available'
    check (status in ('available','almost_full','full','closed','cancelled','completed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index departure_org_idx     on departure (organization_id, departure_at);
create index departure_product_idx on departure (product_id, departure_at);
-- Prevent duplicate departures for the same product+datetime (AUD-B09).
create unique index departure_unique on departure (organization_id, product_id, departure_at);
create trigger departure_touch before update on departure for each row execute function app.touch_updated_at();
