-- ============================================================================
-- 0013 — Inventory: warehouse, inventory_item, stock_level, purchase_order,
-- stock_movement, purchase_order_line.
-- Ends by wiring approval_request.purchase_order_id (deferred from 0009).
-- ============================================================================

create table warehouse (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  code        text,
  warehouse_type text check (warehouse_type in ('main','kitchen','bar','shop','maintenance','uniforms','transit')),
  location    text,
  allows_negative boolean not null default false,
  status      text not null default 'active' check (status in ('active','inactive')),
  notes       text,
  branch_id   uuid references branch(id) on delete set null,
  zone_id     uuid references zone(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index warehouse_org_idx on warehouse (organization_id, status);
create trigger warehouse_touch before update on warehouse for each row execute function app.touch_updated_at();

create table inventory_item (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name        text not null,
  sku         text,
  barcode     text,
  item_type   text check (item_type in
                ('food','beverage','retail','souvenir','uniform','spare_part','consumable','fuel','chemical','packaging')),
  unit        text check (unit in ('unit','kg','g','l','ml','box','pack','bottle','case')),
  cost        numeric(14,2) check (cost  >= 0),
  price       numeric(14,2) check (price >= 0),
  currency    currency,
  tax_rate    numeric(6,3),
  min_stock   numeric(14,3),
  max_stock   numeric(14,3),
  reorder_point numeric(14,3),
  reorder_qty numeric(14,3),
  shelf_life_days integer check (shelf_life_days >= 0),
  is_sellable boolean not null default false,
  tracks_lots boolean not null default false,
  image_url   text,
  status      text not null default 'active' check (status in ('active','inactive')),
  product_category_id uuid references product_category(id) on delete set null,
  supplier_id uuid references supplier(id) on delete set null,
  product_id  uuid references product(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, sku)
);
create index inventory_item_org_idx on inventory_item (organization_id, status);
create trigger inventory_item_touch before update on inventory_item for each row execute function app.touch_updated_at();

create table stock_level (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  warehouse_id      uuid not null references warehouse(id) on delete cascade,
  inventory_item_id uuid not null references inventory_item(id) on delete cascade,
  quantity    numeric(14,3) not null default 0,
  reserved    numeric(14,3) not null default 0,
  available   numeric(14,3) not null default 0,
  avg_cost    numeric(14,2) not null default 0,
  last_movement_at timestamptz,
  last_counted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, warehouse_id, inventory_item_id)
);
create index stock_level_org_idx  on stock_level (organization_id);
create index stock_level_item_idx on stock_level (inventory_item_id);
create trigger stock_level_touch before update on stock_level for each row execute function app.touch_updated_at();

create table purchase_order (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  code        text not null,
  status      text not null default 'draft' check (status in
                ('draft','pending_approval','approved','sent','partially_received','received',
                 'invoiced','cancelled','rejected')),
  ordered_at  timestamptz,
  expected_at timestamptz,
  received_at timestamptz,
  subtotal    numeric(14,2) not null default 0,
  tax         numeric(14,2) not null default 0,
  total       numeric(14,2) not null default 0,
  currency    currency not null default 'usd',
  exchange_rate numeric(14,6) not null default 1 check (exchange_rate > 0),
  payment_terms text,
  notes       text,
  approval_notes text,
  supplier_id uuid references supplier(id) on delete set null,
  warehouse_id uuid references warehouse(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by  uuid references auth.users(id) on delete set null,
  payable_id  uuid references payable(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (organization_id, code)
);
create index purchase_order_org_idx      on purchase_order (organization_id, status);
create index purchase_order_supplier_idx on purchase_order (organization_id, supplier_id);
create trigger purchase_order_touch before update on purchase_order for each row execute function app.touch_updated_at();

create table stock_movement (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  reference   text,
  movement_type text check (movement_type in
                ('receipt','sale','consumption','transfer_out','transfer_in','waste','adjustment','return','count')),
  quantity    numeric(14,3) not null default 0,
  unit_cost   numeric(14,2),
  total_cost  numeric(14,2),
  currency    currency,
  moved_at    timestamptz not null default now(),
  balance_after numeric(14,3),
  reason      text,
  lot_code    text,
  expires_at  timestamptz,
  warehouse_id    uuid references warehouse(id) on delete set null,
  to_warehouse_id uuid references warehouse(id) on delete set null,
  inventory_item_id uuid references inventory_item(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  purchase_order_id uuid references purchase_order(id) on delete set null,
  order_id    uuid references "order"(id) on delete set null,
  work_order_id uuid,   -- FK added at end of 0014
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index stock_movement_org_idx  on stock_movement (organization_id, moved_at desc);
create index stock_movement_item_idx on stock_movement (inventory_item_id);
create trigger stock_movement_touch before update on stock_movement for each row execute function app.touch_updated_at();

create table purchase_order_line (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  description text,
  quantity    numeric(14,3) not null default 0 check (quantity >= 0),
  quantity_received numeric(14,3) not null default 0 check (quantity_received >= 0),
  unit_cost   numeric(14,2) not null default 0 check (unit_cost >= 0),
  tax_rate    numeric(6,3),
  line_total  numeric(14,2) not null default 0,
  purchase_order_id uuid not null references purchase_order(id) on delete cascade,
  inventory_item_id uuid references inventory_item(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index purchase_order_line_po_idx on purchase_order_line (purchase_order_id);
create trigger purchase_order_line_touch before update on purchase_order_line for each row execute function app.touch_updated_at();

-- deferred FK: approval_request.purchase_order_id (declared in 0009)
alter table approval_request
  add constraint approval_request_purchase_order_fk
  foreign key (purchase_order_id) references purchase_order(id) on delete set null;
create index approval_request_po_idx on approval_request (purchase_order_id);
