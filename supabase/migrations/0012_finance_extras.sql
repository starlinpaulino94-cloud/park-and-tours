-- ============================================================================
-- 0012 — Finance extras: expense_category, expense, cash_movement,
-- ledger_account, ledger_entry, currency_rate, tax_profile, invoice.
-- ============================================================================

create table expense_category (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  description text,
  color       text,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index expense_category_org_idx on expense_category (organization_id, status);
create trigger expense_category_touch before update on expense_category for each row execute function app.touch_updated_at();

create table expense (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  category_id uuid references expense_category(id) on delete set null,
  branch_id   uuid references branch(id) on delete set null,
  supplier_id uuid references supplier(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  cash_session_id uuid references cash_session(id) on delete set null,
  concept     text,
  amount      numeric(14,2) not null default 0 check (amount >= 0),
  currency    currency not null default 'usd',
  exchange_rate numeric(14,6) not null default 1 check (exchange_rate > 0),
  expense_date date,
  payment_method payment_method,
  status      text not null default 'pending' check (status in ('pending','approved','paid','rejected')),
  receipt_file text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index expense_org_idx      on expense (organization_id, status);
create index expense_category_idx on expense (organization_id, category_id);
create trigger expense_touch before update on expense for each row execute function app.touch_updated_at();

create table cash_movement (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  cash_session_id uuid references cash_session(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  payment_id  uuid references payment(id) on delete set null,
  movement_type text check (movement_type in
                ('sale','refund','expense','withdrawal','deposit','adjustment','opening','closing')),
  amount      numeric(14,2) not null default 0,
  currency    currency not null default 'usd',
  concept     text,
  reference   text,
  movement_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index cash_movement_org_idx     on cash_movement (organization_id, movement_at desc);
create index cash_movement_session_idx on cash_movement (cash_session_id);
create trigger cash_movement_touch before update on cash_movement for each row execute function app.touch_updated_at();

create table ledger_account (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text not null,
  name        text,
  account_type text check (account_type in ('asset','liability','equity','revenue','expense','contra')),
  subledger   text,
  normal_side text check (normal_side in ('debit','credit')),
  is_postable boolean not null default false,
  balance     numeric(14,2) not null default 0,
  currency    currency,
  status      text not null default 'active' check (status in ('active','inactive')),
  parent_id   uuid references ledger_account(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index ledger_account_org_idx    on ledger_account (organization_id, status);
create index ledger_account_parent_idx on ledger_account (parent_id);
create trigger ledger_account_touch before update on ledger_account for each row execute function app.touch_updated_at();

create table ledger_entry (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  entry_code  text,
  line_no     integer,
  posted_at   timestamptz,
  period      text,
  ledger_account_id uuid references ledger_account(id) on delete restrict,
  debit       numeric(14,2) not null default 0,
  credit      numeric(14,2) not null default 0,
  currency    currency,
  exchange_rate numeric(14,6),
  amount_base numeric(14,2),
  memo        text,
  source_type text check (source_type in
                ('sale','payment','refund','commission','settlement','expense','payable','purchase',
                 'inventory','payroll','adjustment','opening','tax','gift_card','membership')),
  reversed    boolean not null default false,
  reversal_of text,
  user_id     uuid references auth.users(id) on delete set null,
  order_id    uuid references "order"(id) on delete set null,
  payment_id  uuid references payment(id) on delete set null,
  settlement_id uuid references settlement(id) on delete set null,
  expense_id  uuid references expense(id) on delete set null,
  payable_id  uuid references payable(id) on delete set null,
  receivable_id uuid references receivable(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index ledger_entry_org_idx     on ledger_entry (organization_id, posted_at);
create index ledger_entry_code_idx    on ledger_entry (organization_id, entry_code);
create index ledger_entry_account_idx on ledger_entry (ledger_account_id);
create trigger ledger_entry_touch before update on ledger_entry for each row execute function app.touch_updated_at();

create table currency_rate (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  currency_from currency not null,
  currency_to   currency not null,
  rate        numeric(18,8) not null check (rate > 0),
  rate_date   date,
  source      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, currency_from, currency_to, rate_date)
);
create index currency_rate_org_idx on currency_rate (organization_id, rate_date desc);
create trigger currency_rate_touch before update on currency_rate for each row execute function app.touch_updated_at();

create table tax_profile (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  country     text check (country in ('do','mx','co','cr','pa','us','es','other')),
  tax_name    text,
  tax_rate    numeric(6,3),
  included_in_price boolean not null default false,
  tourism_tax_rate   numeric(6,3),
  service_charge_rate numeric(6,3),
  tax_id_label text,
  ncf_series  text,
  ncf_next    integer check (ncf_next >= 0),
  ncf_expires date,
  efac_enabled boolean not null default false,
  rounding    text,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index tax_profile_org_idx on tax_profile (organization_id, status);
create trigger tax_profile_touch before update on tax_profile for each row execute function app.touch_updated_at();

create table invoice (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  number      text not null,
  series      text,
  ncf         text,
  ncf_type    text check (ncf_type in ('b01','b02','b04','b14','b15','e31','e32','e34','e44','e45')),
  invoice_type text check (invoice_type in ('sale','credit_note','debit_note','proforma')),
  status      text not null default 'draft' check (status in
                ('draft','issued','sent','paid','partially_paid','overdue','cancelled','voided')),
  issued_at   timestamptz,
  due_date    date,
  subtotal    numeric(14,2) not null default 0,
  tax         numeric(14,2) not null default 0,
  tax_rate    numeric(6,3),
  discount    numeric(14,2) not null default 0,
  total       numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  currency    currency not null default 'usd',
  exchange_rate numeric(14,6) not null default 1 check (exchange_rate > 0),
  customer_name    text,
  customer_tax_id  text,
  customer_address text,
  notes       text,
  pdf_url     text,
  efac_status text check (efac_status in ('pending','sent','accepted','rejected','not_applicable')),
  efac_track_id text,
  voided_at   timestamptz,
  void_reason text,
  customer_id uuid references customer(id) on delete set null,
  order_id    uuid references "order"(id) on delete set null,
  partner_id  uuid references organizations(id) on delete set null,
  settlement_id uuid references settlement(id) on delete set null,
  tax_profile_id uuid references tax_profile(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, number)
);
create index invoice_org_idx      on invoice (organization_id, status);
create index invoice_customer_idx on invoice (organization_id, customer_id);
create index invoice_order_idx    on invoice (order_id);
create trigger invoice_touch before update on invoice for each row execute function app.touch_updated_at();
