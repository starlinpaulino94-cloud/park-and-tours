-- ============================================================================
-- 0006 — Finance chain: cash, payment, commission_rule, commission,
-- settlement, payable, receivable. Order matters for FK resolution.
-- ============================================================================

-- ── cash_register / cash_session (minimal, for payment FK) ──────────────────
create table cash_register (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name text not null, code text, currency currency not null default 'usd',
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index cash_register_org_idx on cash_register (organization_id);

create table cash_session (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  cash_register_id uuid references cash_register(id) on delete set null,
  user_id      uuid references auth.users(id) on delete set null,
  opening_amount numeric(14,2) not null default 0 check (opening_amount >= 0),
  counted_cash   numeric(14,2),
  expected_cash  numeric(14,2) not null default 0,
  sales_total    numeric(14,2) not null default 0,
  status text not null default 'open' check (status in ('open','closed','reconciled')),
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index cash_session_org_idx on cash_session (organization_id, status);

-- ── commission_rule ─────────────────────────────────────────────────────────
create table commission_rule (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name text not null,
  beneficiary_type beneficiary_type not null default 'seller',
  calc_type       calc_type not null default 'percentage',
  value    numeric(14,3),
  tiers    jsonb default '[]',
  product_id  uuid references product(id) on delete cascade,
  partner_id  uuid references organizations(id) on delete cascade,
  seller_id   uuid references seller(id) on delete cascade,
  channel     sales_channel,
  priority    integer,
  season_from date, season_to date,
  min_sales   numeric(14,2), max_sales numeric(14,2),
  currency    currency,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index commission_rule_org_idx on commission_rule (organization_id, status);
create trigger commission_rule_touch before update on commission_rule for each row execute function app.touch_updated_at();

-- ── settlement (created before commission for the FK) ───────────────────────
create table settlement (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code text not null,
  beneficiary_type beneficiary_type not null,
  partner_id uuid references organizations(id) on delete set null,
  seller_id  uuid references seller(id) on delete set null,
  period_from date, period_to date,
  base_total       numeric(14,2) not null default 0,
  commission_total numeric(14,2) not null default 0,
  paid_total       numeric(14,2) not null default 0,
  pending_total    numeric(14,2) not null default 0,
  currency currency not null default 'usd',
  status text not null default 'pending' check (status in
           ('pending','approved','partially_paid','paid','held','disputed','void')),
  approved_by uuid references auth.users(id) on delete set null,
  issued_at  timestamptz not null default now(),
  paid_at    timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index settlement_org_idx on settlement (organization_id, status);
create index settlement_partner_idx on settlement (organization_id, partner_id);
create trigger settlement_touch before update on settlement for each row execute function app.touch_updated_at();

-- ── commission ──────────────────────────────────────────────────────────────
create table commission (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  booking_id  uuid references booking(id) on delete set null,
  order_id    uuid references "order"(id) on delete set null,
  rule_id     uuid references commission_rule(id) on delete set null,
  settlement_id uuid references settlement(id) on delete set null,
  seller_id   uuid references seller(id) on delete set null,
  partner_id  uuid references organizations(id) on delete set null,
  beneficiary_type beneficiary_type not null,
  calc_type   calc_type not null default 'percentage',
  base_amount numeric(14,2) not null default 0,
  percentage  numeric(14,3) not null default 0,
  amount      numeric(14,2) not null default 0,
  currency    currency not null default 'usd',
  snapshot    jsonb,     -- immutable: later rule edits never change history
  status      text not null default 'pending' check (status in
                ('pending','approved','settled','paid','cancelled','held','disputed')),
  created_at  timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index commission_org_idx        on commission (organization_id, status);
create index commission_booking_idx    on commission (booking_id);
create index commission_settlement_idx on commission (settlement_id);
create index commission_partner_idx    on commission (organization_id, partner_id);
create trigger commission_touch before update on commission for each row execute function app.touch_updated_at();

-- ── payment ─────────────────────────────────────────────────────────────────
create table payment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  order_id     uuid references "order"(id) on delete set null,
  booking_id   uuid references booking(id) on delete set null,
  customer_id  uuid references customer(id) on delete set null,
  partner_id   uuid references organizations(id) on delete set null,
  cash_session_id uuid references cash_session(id) on delete set null,
  user_id      uuid references auth.users(id) on delete set null,
  reference    text not null,
  payment_type payment_kind not null default 'payment',
  method       payment_method not null default 'cash',
  status       text not null default 'completed' check (status in
                 ('pending','authorized','completed','rejected','cancelled','refunded','partially_refunded')),
  amount        numeric(14,2) not null check (amount > 0),
  currency      currency not null default 'usd',
  exchange_rate numeric(14,6) not null default 1 check (exchange_rate > 0),
  base_amount   numeric(14,2),
  idempotency_key text,
  paid_at      timestamptz not null default now(),
  notes        text,
  created_at   timestamptz not null default now(), updated_at timestamptz not null default now(),
  -- AUD-F19: idempotency enforced at the DB (was best-effort in app).
  unique (organization_id, idempotency_key)
);
create index payment_org_idx      on payment (organization_id, created_at desc);
create index payment_order_idx    on payment (order_id);
create index payment_reference_idx on payment (organization_id, reference);
create trigger payment_touch before update on payment for each row execute function app.touch_updated_at();

-- ── receivable (B2B accounts receivable) ────────────────────────────────────
create table receivable (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  order_id    uuid references "order"(id) on delete cascade,
  partner_id  uuid references organizations(id) on delete set null,
  customer_id uuid references customer(id) on delete set null,
  document_number text,
  amount      numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  balance     numeric(14,2) not null default 0,
  currency    currency not null default 'usd',
  aging_bucket aging_bucket not null default 'current',
  status      text not null default 'pending' check (status in
                ('pending','partially_paid','paid','overdue','written_off')),
  issue_date  date, due_date date,
  created_at  timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index receivable_org_idx     on receivable (organization_id, status);
create index receivable_order_idx   on receivable (order_id);
create index receivable_partner_idx on receivable (organization_id, partner_id);
create trigger receivable_touch before update on receivable for each row execute function app.touch_updated_at();

-- ── payable (settlement obligation) ─────────────────────────────────────────
create table payable (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  settlement_id uuid references settlement(id) on delete cascade,
  partner_id  uuid references organizations(id) on delete set null,
  seller_id   uuid references seller(id) on delete set null,
  reference   text,
  category    text,
  amount      numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  balance     numeric(14,2) not null default 0,
  currency    currency not null default 'usd',
  status      text not null default 'pending' check (status in
                ('pending','partially_paid','paid','cancelled','written_off')),
  issue_date  date, due_date date,
  created_at  timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index payable_org_idx        on payable (organization_id, status);
create index payable_settlement_idx on payable (settlement_id);
create trigger payable_touch before update on payable for each row execute function app.touch_updated_at();
