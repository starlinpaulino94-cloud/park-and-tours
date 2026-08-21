-- ============================================================================
-- 0005 — Sales chain: seller, order, booking, participant, voucher
-- ============================================================================

-- ── seller (commercial profile; identity lives in auth.users + membership) ──
create table seller (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  user_id     uuid references auth.users(id) on delete set null,
  partner_id  uuid references organizations(id) on delete set null,  -- seller of a partner org
  supervisor_id uuid references seller(id) on delete set null,
  code        text,
  first_name  text,
  last_name   text,
  commission_pct   numeric(6,3) check (commission_pct >= 0),
  max_discount_pct numeric(6,3) check (max_discount_pct between 0 and 100),
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index seller_org_idx     on seller (organization_id, status);
create index seller_partner_idx on seller (organization_id, partner_id);
create trigger seller_touch before update on seller for each row execute function app.touch_updated_at();

-- Now that seller exists, wire the deferred price_rule.seller_id FK.
alter table price_rule
  add constraint price_rule_seller_fk foreign key (seller_id) references seller(id) on delete cascade;
create index price_rule_seller_idx on price_rule (seller_id);

-- ── order (header; 1..N bookings) ───────────────────────────────────────────
create table sales_order (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  order_number text not null,
  customer_id  uuid references customer(id) on delete restrict,
  seller_id    uuid references seller(id) on delete set null,
  partner_id   uuid references organizations(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  channel      sales_channel,
  -- derived state machine (maintained by the booking service, not client-writable)
  status       text not null default 'draft' check (status in
                 ('draft','pending','pending_payment','confirmed','partially_paid','paid','completed','cancelled','refunded')),
  currency      currency not null default 'usd',
  exchange_rate numeric(14,6) not null default 1 check (exchange_rate > 0),
  subtotal      numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total     numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  paid_total    numeric(14,2) not null default 0,
  balance       numeric(14,2) not null default 0,
  order_date    timestamptz not null default now(),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (organization_id, order_number)
);
create index order_org_idx      on sales_order (organization_id, status, created_at desc);
create index order_customer_idx on sales_order (organization_id, customer_id);
create index order_partner_idx  on sales_order (organization_id, partner_id);
create trigger order_touch before update on sales_order for each row execute function app.touch_updated_at();

-- ── booking ─────────────────────────────────────────────────────────────────
create table booking (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  booking_number text not null,
  order_id     uuid not null references sales_order(id) on delete cascade,
  customer_id  uuid references customer(id) on delete restrict,
  product_id   uuid not null references product(id) on delete restrict,
  departure_id uuid references departure(id) on delete restrict,
  modality_id  uuid references product_modality(id) on delete set null,
  seller_id    uuid references seller(id) on delete set null,
  partner_id   uuid references organizations(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  checked_in_by uuid references auth.users(id) on delete set null,
  travel_date  timestamptz,
  adults   integer not null default 0 check (adults   >= 0),
  children integer not null default 0 check (children >= 0),
  infants  integer not null default 0 check (infants  >= 0),
  pax_total integer not null default 1 check (pax_total >= 1),
  gross_amount    numeric(14,2) not null default 0 check (gross_amount   >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_amount      numeric(14,2) not null default 0 check (tax_amount     >= 0),
  total_amount    numeric(14,2) not null default 0 check (total_amount   >= 0),
  paid_amount     numeric(14,2) not null default 0,
  balance_amount  numeric(14,2) not null default 0,
  cost_amount     numeric(14,2) not null default 0,
  margin_amount   numeric(14,2) not null default 0,
  currency     currency not null default 'usd',
  price_snapshot jsonb,     -- immutable capture (never re-priced)
  channel      sales_channel,
  capacity_override boolean not null default false,
  status       text not null default 'pending_payment' check (status in
                 ('draft','pending','pending_payment','confirmed','partially_paid','paid',
                  'checked_in','completed','no_show','cancelled','refunded','partially_refunded')),
  checkin_status text not null default 'pending' check (checkin_status in ('pending','done','no_show')),
  cancelled_at timestamptz,
  cancel_reason text,
  refund_amount numeric(14,2),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (organization_id, booking_number)
);
create index booking_org_idx       on booking (organization_id, status, created_at desc);
create index booking_order_idx     on booking (order_id);
create index booking_departure_idx on booking (departure_id);
create index booking_customer_idx  on booking (organization_id, customer_id);
create index booking_partner_idx   on booking (organization_id, partner_id);
create trigger booking_touch before update on booking for each row execute function app.touch_updated_at();

-- ── participant ─────────────────────────────────────────────────────────────
create table participant (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  booking_id  uuid not null references booking(id) on delete cascade,
  first_name  text,
  last_name   text,
  category    text,   -- adult | child | infant
  document_id text,
  checkin_status text not null default 'pending' check (checkin_status in ('pending','done','no_show')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index participant_booking_idx on participant (booking_id);
create trigger participant_touch before update on participant for each row execute function app.touch_updated_at();

-- ── voucher (ticket credential) ─────────────────────────────────────────────
create table voucher (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  booking_id  uuid not null references booking(id) on delete cascade,
  order_id    uuid references sales_order(id) on delete cascade,
  code        text not null,
  qr_data     text,
  status      text not null default 'valid' check (status in ('valid','used','cancelled','expired')),
  expires_at  timestamptz,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index voucher_booking_idx on voucher (booking_id);
create trigger voucher_touch before update on voucher for each row execute function app.touch_updated_at();
