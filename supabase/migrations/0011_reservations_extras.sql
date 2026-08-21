-- ============================================================================
-- 0011 — Reservations extras: membership_plan, membership, access_ticket,
-- gift_card, gift_card_movement, pickup_route, pickup.
-- ============================================================================

create table membership_plan (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  code        text,
  plan_type   text check (plan_type in ('annual_pass','season_pass','monthly','corporate','family','vip')),
  price       numeric(14,2) not null default 0 check (price >= 0),
  currency    currency,
  duration_days   integer check (duration_days   >= 0),
  visits_included integer check (visits_included >= 0),
  guest_passes    integer check (guest_passes    >= 0),
  discount_percent numeric(6,3),
  benefits    text,
  blackout_dates jsonb not null default '[]',
  auto_renew  boolean not null default false,
  image_url   text,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index membership_plan_org_idx on membership_plan (organization_id, status);
create trigger membership_plan_touch before update on membership_plan for each row execute function app.touch_updated_at();

create table membership (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text not null,
  status      text not null default 'pending' check (status in ('active','pending','suspended','expired','cancelled')),
  starts_at   timestamptz,
  ends_at     timestamptz,
  visits_used       integer not null default 0 check (visits_used       >= 0),
  guest_passes_used integer not null default 0 check (guest_passes_used >= 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  currency    currency,
  auto_renew  boolean not null default false,
  photo       text,
  last_visit_at timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  membership_plan_id uuid references membership_plan(id) on delete set null,
  customer_id uuid references customer(id) on delete set null,
  order_id    uuid references sales_order(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index membership_org_idx      on membership (organization_id, status);
create index membership_customer_idx on membership (organization_id, customer_id);
create trigger membership_touch before update on membership for each row execute function app.touch_updated_at();

create table access_ticket (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text not null,
  ticket_type text check (ticket_type in
                ('day_pass','single_use','multi_day','season_pass','annual','wristband','locker','parking')),
  status      text not null default 'issued' check (status in
                ('issued','active','redeemed','partially_used','expired','void','transferred')),
  valid_from  timestamptz,
  valid_to    timestamptz,
  entries_allowed integer check (entries_allowed >= 0),
  entries_used    integer not null default 0 check (entries_used >= 0),
  issued_at   timestamptz,
  redeemed_at timestamptz,
  qr_payload  text,
  wristband_code text,
  holder_name text,
  price       numeric(14,2) check (price >= 0),
  currency    currency,
  notes       text,
  booking_id  uuid references booking(id) on delete set null,
  participant_id uuid references participant(id) on delete set null,
  customer_id uuid references customer(id) on delete set null,
  product_id  uuid references product(id) on delete set null,
  order_id    uuid references sales_order(id) on delete set null,
  membership_id uuid references membership(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index access_ticket_org_idx     on access_ticket (organization_id, status);
create index access_ticket_booking_idx on access_ticket (booking_id);
create trigger access_ticket_touch before update on access_ticket for each row execute function app.touch_updated_at();

create table gift_card (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text not null,
  status      text not null default 'active' check (status in ('active','redeemed','partially_used','expired','void')),
  initial_amount numeric(14,2) not null default 0 check (initial_amount >= 0),
  balance     numeric(14,2) not null default 0 check (balance >= 0),
  currency    currency not null default 'usd',
  issued_at   timestamptz,
  expires_at  timestamptz,
  recipient_name  text,
  recipient_email text,
  message     text,
  delivery_channel text check (delivery_channel in ('email','print','physical','whatsapp')),
  customer_id uuid references customer(id) on delete set null,
  order_id    uuid references sales_order(id) on delete set null,
  product_id  uuid references product(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index gift_card_org_idx on gift_card (organization_id, status);
create trigger gift_card_touch before update on gift_card for each row execute function app.touch_updated_at();

create table gift_card_movement (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  movement_type text check (movement_type in ('issue','redeem','refund','adjustment','expire')),
  amount        numeric(14,2) not null default 0,
  balance_after numeric(14,2) not null default 0,
  moved_at      timestamptz not null default now(),
  notes         text,
  gift_card_id uuid not null references gift_card(id) on delete cascade,
  order_id     uuid references sales_order(id) on delete set null,
  user_id      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index gift_card_movement_org_idx  on gift_card_movement (organization_id, moved_at desc);
create index gift_card_movement_card_idx on gift_card_movement (gift_card_id);
create trigger gift_card_movement_touch before update on gift_card_movement for each row execute function app.touch_updated_at();

create table pickup_route (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  departure_id uuid references departure(id) on delete cascade,
  zone_id     uuid references zone(id) on delete set null,
  vehicle_id  uuid,   -- FK added at end of 0014
  driver_id   uuid references staff(id) on delete set null,
  guide_id    uuid references staff(id) on delete set null,
  name        text,
  start_time  text,
  pax_total   integer not null default 0 check (pax_total   >= 0),
  stops_count integer not null default 0 check (stops_count >= 0),
  status      text not null default 'planned' check (status in
                ('planned','confirmed','in_progress','completed','cancelled')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index pickup_route_org_idx       on pickup_route (organization_id, status);
create index pickup_route_departure_idx on pickup_route (departure_id);
create trigger pickup_route_touch before update on pickup_route for each row execute function app.touch_updated_at();

create table pickup (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  booking_id  uuid references booking(id) on delete cascade,
  hotel_id    uuid references hotel(id) on delete set null,
  route_id    uuid references pickup_route(id) on delete set null,
  pickup_time text,
  location    text,
  room        text,
  pax         integer check (pax >= 0),
  status      text not null default 'pending' check (status in
                ('pending','confirmed','picked_up','no_show','cancelled')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index pickup_org_idx     on pickup (organization_id, status);
create index pickup_route_idx   on pickup (route_id);
create index pickup_booking_idx on pickup (booking_id);
create trigger pickup_touch before update on pickup for each row execute function app.touch_updated_at();
