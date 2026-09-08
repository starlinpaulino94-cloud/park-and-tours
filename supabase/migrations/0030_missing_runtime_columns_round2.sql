-- ============================================================================
-- 0030 — Columnas de ejecución que faltaban (segunda ronda)
--
-- 0021 añadió tres columnas que el esquema inicial no trajo, cada una
-- descubierta cuando un error de PostgREST la delató en producción. Este
-- archivo hace el barrido completo en lugar de esperar al siguiente error:
-- se cruzaron TODAS las columnas que la aplicación escribe —las listas
-- `writable` de `src/lib/resources.ts` y los payloads literales de cada
-- `tenantCreate`/`tenantUpdate`— contra las columnas reales de estas
-- migraciones. Faltaban 93 en 18 tablas, y cada una rompía su escritura
-- completa, porque PostgREST rechaza el INSERT/UPDATE entero cuando una sola
-- columna no existe:
--
--   · booking            → crear una reserva (booking-service.ts escribe 10)
--   · participant        → guardar acompañantes con nombre y edad
--   · departure          → generar salidas y recalcular cupo disponible
--   · cash_session       → abrir, recalcular y cerrar caja
--   · settlement/payable → generar y pagar liquidaciones
--   · product/modality   → la ficha de catálogo completa
--   · seller, zone, customer, voucher, commission, receivable, price_rule…
--
-- Todo es aditivo y con `if not exists`, así que sobre una base que ya tenga
-- estas columnas la migración no hace nada.
--
-- Sobre los `check`: solo se restringen los cuatro campos cuyo dominio ya está
-- definido por un diccionario de la UI (`ZONE_TYPE`, `YES_NO`, `SELLER_ROLE`);
-- `src/lib/domain-values.test.ts` los mantiene alineados. El resto queda sin
-- restricción para no inventar un dominio que la aplicación no declara.
-- ============================================================================

-- ── booking ────────────────────────────────────────────────────────────────
alter table booking
  add column if not exists unit_price      numeric(14,2),
  add column if not exists hotel_id        uuid references hotel(id) on delete set null,
  add column if not exists pickup_time     text,
  add column if not exists pickup_location text,
  add column if not exists room_number     text,
  add column if not exists voucher_code    text,
  add column if not exists checked_in_at   timestamptz,
  add column if not exists checked_in_pax  integer,
  add column if not exists override_reason text,
  add column if not exists notes           text,
  add column if not exists internal_notes  text;

create index if not exists booking_voucher_code_idx on booking (organization_id, voucher_code);

-- ── participant ────────────────────────────────────────────────────────────
alter table participant
  add column if not exists full_name            text,
  add column if not exists age                  integer,
  add column if not exists nationality          text,
  add column if not exists special_requirements text,
  add column if not exists notes                text;

-- Los nombres ya guardados en first_name/last_name alimentan el campo nuevo,
-- que es el que la UI muestra y busca.
update participant
   set full_name = nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
 where full_name is null;

-- ── voucher ────────────────────────────────────────────────────────────────
alter table voucher
  add column if not exists issued_at timestamptz,
  add column if not exists notes     text;

update voucher set issued_at = created_at where issued_at is null;

-- ── departure ──────────────────────────────────────────────────────────────
alter table departure
  add column if not exists branch_id      uuid references branch(id) on delete set null,
  add column if not exists departure_time text,
  add column if not exists available_pax  integer,
  add column if not exists waitlist_pax   integer,
  add column if not exists meeting_point  text,
  add column if not exists notes          text;

-- `available_pax` es el cupo que la UI muestra y que `availability.ts`
-- recalcula; se siembra con lo que ya implica capacity − booked − pending.
update departure
   set available_pax = greatest(0, coalesce(capacity, 0) - coalesce(booked_pax, 0) - coalesce(pending_pax, 0))
 where available_pax is null;
update departure set waitlist_pax = 0 where waitlist_pax is null;

-- ── sales_order ────────────────────────────────────────────────────────────
alter table sales_order
  add column if not exists promotion_id uuid references promotion(id) on delete set null;

-- ── customer ───────────────────────────────────────────────────────────────
alter table customer
  add column if not exists hotel_id           uuid references hotel(id) on delete set null,
  add column if not exists assigned_seller_id uuid references seller(id) on delete set null,
  add column if not exists whatsapp    text,
  add column if not exists language    text,
  add column if not exists room        text,
  add column if not exists address     text,
  add column if not exists preferences text;

-- ── seller ─────────────────────────────────────────────────────────────────
alter table seller
  add column if not exists branch_id    uuid references branch(id) on delete set null,
  add column if not exists email        citext,
  add column if not exists phone        text,
  add column if not exists whatsapp     text,
  add column if not exists seller_role  text,
  add column if not exists monthly_goal numeric(14,2),
  add column if not exists currency     currency,
  add column if not exists photo_url    text,
  add column if not exists hire_date    date,
  add column if not exists notes        text;

alter table seller drop constraint if exists seller_seller_role_check;
alter table seller add constraint seller_seller_role_check
  check (seller_role is null or seller_role in ('seller','supervisor','manager','promoter','agent'));

-- ── product ────────────────────────────────────────────────────────────────
alter table product
  add column if not exists category_id       uuid references product_category(id) on delete set null,
  add column if not exists short_description text,
  add column if not exists cover_image_url   text,
  add column if not exists video_url         text,
  add column if not exists location          text,
  add column if not exists meeting_point     text,
  add column if not exists duration_hours    numeric(6,2),
  add column if not exists languages         text[] default '{}',
  add column if not exists min_age           integer,
  add column if not exists default_capacity  integer,
  add column if not exists restrictions      text,
  add column if not exists recommendations   text,
  add column if not exists inclusions        text,
  add column if not exists exclusions        text,
  add column if not exists terms             text,
  add column if not exists instructions      text,
  add column if not exists base_cost         numeric(14,2),
  add column if not exists featured          text;

alter table product drop constraint if exists product_featured_check;
alter table product add constraint product_featured_check
  check (featured is null or featured in ('yes','no'));

create index if not exists product_category_idx on product (organization_id, category_id);

-- ── product_modality ───────────────────────────────────────────────────────
alter table product_modality
  add column if not exists cost            numeric(14,2),
  add column if not exists age_from        integer,
  add column if not exists age_to          integer,
  add column if not exists capacity_weight numeric(6,2);

-- ── price_rule ─────────────────────────────────────────────────────────────
-- Franja horaria como texto 'HH:MM': es lo que manda y lee el input de la UI,
-- y `time` devolvería 'HH:MM:SS' rompiendo el ida y vuelta del formulario.
alter table price_rule
  add column if not exists time_from text,
  add column if not exists time_to   text;

-- ── zone ───────────────────────────────────────────────────────────────────
alter table zone
  add column if not exists zone_type          text,
  add column if not exists max_capacity       integer,
  add column if not exists current_occupancy  integer,
  add column if not exists requires_wristband text;

update zone set current_occupancy = 0 where current_occupancy is null;

alter table zone drop constraint if exists zone_zone_type_check;
alter table zone add constraint zone_zone_type_check
  check (zone_type is null or zone_type in
    ('attraction_area','pool','beach','restaurant','shop','parking','backstage','entrance','trail'));

alter table zone drop constraint if exists zone_requires_wristband_check;
alter table zone add constraint zone_requires_wristband_check
  check (requires_wristband is null or requires_wristband in ('yes','no'));

-- ── cash_register / cash_session ───────────────────────────────────────────
alter table cash_register
  add column if not exists branch_id uuid references branch(id) on delete set null,
  add column if not exists terminal  text;

alter table cash_session
  add column if not exists branch_id         uuid references branch(id) on delete set null,
  add column if not exists code              text,
  add column if not exists difference        numeric(14,2),
  add column if not exists card_total        numeric(14,2) not null default 0,
  add column if not exists transfer_total    numeric(14,2) not null default 0,
  add column if not exists expenses_total    numeric(14,2) not null default 0,
  add column if not exists withdrawals_total numeric(14,2) not null default 0,
  add column if not exists notes             text;

create index if not exists cash_session_code_idx on cash_session (organization_id, code);

-- ── commission / commission_rule / settlement ──────────────────────────────
alter table commission
  add column if not exists beneficiary_name text,
  add column if not exists generated_at     timestamptz,
  add column if not exists notes            text;

update commission set generated_at = created_at where generated_at is null;

alter table commission_rule
  add column if not exists category_id uuid references product_category(id) on delete set null,
  add column if not exists description text;

alter table settlement
  add column if not exists sales_total         numeric(14,2) not null default 0,
  add column if not exists cancellations_total numeric(14,2) not null default 0,
  add column if not exists notes               text;

-- ── receivable / payable ───────────────────────────────────────────────────
alter table receivable
  add column if not exists notes text;

alter table payable
  add column if not exists supplier_id uuid references supplier(id) on delete set null,
  add column if not exists concept     text,
  add column if not exists paid_at     timestamptz,
  add column if not exists notes       text;

-- ── integridad de referencias entre inquilinos ─────────────────────────────
-- 0018 protege con un trigger cada referencia de estas tablas para que nadie
-- apunte a una fila de otra organización. Las columnas de referencia nuevas
-- tienen que entrar en esa misma lista: un `hotel_id` sin comprobar sería un
-- agujero nuevo en una tabla que por lo demás está cerrada.
drop trigger if exists booking_same_tenant_refs on booking;
create trigger booking_same_tenant_refs
before insert or update of organization_id, order_id, customer_id, product_id, departure_id, modality_id, seller_id, hotel_id on booking
for each row execute function app.enforce_same_tenant_refs(
  'order_id', 'sales_order',
  'customer_id', 'customer',
  'product_id', 'product',
  'departure_id', 'departure',
  'modality_id', 'product_modality',
  'seller_id', 'seller',
  'hotel_id', 'hotel'
);

drop trigger if exists sales_order_same_tenant_refs on sales_order;
create trigger sales_order_same_tenant_refs
before insert or update of organization_id, customer_id, seller_id, promotion_id on sales_order
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer',
  'seller_id', 'seller',
  'promotion_id', 'promotion'
);

drop trigger if exists payable_same_tenant_refs on payable;
create trigger payable_same_tenant_refs
before insert or update of organization_id, settlement_id, seller_id, supplier_id on payable
for each row execute function app.enforce_same_tenant_refs(
  'settlement_id', 'settlement',
  'seller_id', 'seller',
  'supplier_id', 'supplier'
);
