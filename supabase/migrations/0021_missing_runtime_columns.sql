-- ============================================================================
-- 0021 — Runtime columns expected by the app
--
-- These fields existed in the application contract and are used by dashboards,
-- reports, POS/catalog sorting and booking creation. They were missing from the
-- initial Supabase schema, causing runtime PostgREST errors such as:
--   column booking.booking_date does not exist
--   column product.sort_order does not exist
-- ============================================================================

alter table booking
  add column if not exists booking_date timestamptz;

update booking
   set booking_date = coalesce(created_at, updated_at, now())
 where booking_date is null;

alter table booking
  alter column booking_date set default now();

create index if not exists booking_org_booking_date_idx
  on booking (organization_id, booking_date desc);

alter table product
  add column if not exists sort_order integer;

update product p
   set sort_order = ranked.rn
  from (
    select id,
           row_number() over (partition by organization_id order by created_at asc, name asc, id asc) as rn
      from product
     where sort_order is null
  ) ranked
 where p.id = ranked.id;

create index if not exists product_org_sort_order_idx
  on product (organization_id, sort_order, name);

-- Keep product modality sorting consistent for databases created before the
-- modality sort column was added by app writes.
alter table product_modality
  add column if not exists sort_order integer;

update product_modality pm
   set sort_order = ranked.rn
  from (
    select id,
           row_number() over (partition by product_id order by created_at asc, name asc, id asc) as rn
      from product_modality
     where sort_order is null
  ) ranked
 where pm.id = ranked.id;

create index if not exists modality_product_sort_order_idx
  on product_modality (product_id, sort_order, name);
