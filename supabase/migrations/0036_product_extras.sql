-- ============================================================================
-- 0036 — Los extras que se venden con la excursión
--
-- El catálogo sabía vender un tour y sus modalidades (adulto, niño, privado),
-- pero no lo que se vende JUNTO al tour: el almuerzo langosta, la foto del
-- salto, el traslado premium, el seguro opcional. En una operadora turística eso
-- no es un detalle — es donde está el margen, porque el tour compite por precio
-- y el extra no.
--
-- Sin modelarlo, el vendedor tenía dos salidas, las dos malas: crear un producto
-- suelto "Almuerzo langosta" que ensucia el catálogo y descuadra la ocupación de
-- las salidas (cada extra contaba como una reserva más), o cobrarlo aparte y
-- dejarlo fuera del sistema, donde no aparece en la rentabilidad del tour ni en
-- el voucher que el cliente enseña al guía.
--
-- `product_extra` es la oferta; `booking_extra` es lo contratado, con su precio
-- CONGELADO: si mañana sube el almuerzo, la reserva de ayer sigue valiendo lo
-- que el cliente pagó.
-- ============================================================================

create table if not exists product_extra (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  product_id  uuid references product(id) on delete cascade,
  name        text not null,
  description text,
  -- Cómo se cobra. 'per_person' multiplica por los pax que pagan; 'per_booking'
  -- es un importe único por reserva (un transfer privado, una tarta).
  price_type  text not null default 'per_person',
  price       numeric(14,2) not null default 0 check (price >= 0),
  cost        numeric(14,2) check (cost is null or cost >= 0),
  currency    currency not null default 'usd',
  -- Un extra obligatorio no es opcional: es una tasa que el cliente tiene que
  -- pagar (la entrada al parque nacional, el impuesto de muelle). Se añade solo.
  is_required boolean not null default false,
  max_quantity integer check (max_quantity is null or max_quantity >= 1),
  sort_order  integer not null default 0,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table product_extra drop constraint if exists product_extra_price_type_check;
alter table product_extra add constraint product_extra_price_type_check
  check (price_type in ('per_person','per_booking'));

alter table product_extra drop constraint if exists product_extra_status_check;
alter table product_extra add constraint product_extra_status_check
  check (status in ('active','inactive'));

create index if not exists product_extra_product_idx on product_extra (product_id, sort_order);
drop trigger if exists product_extra_touch on product_extra;
create trigger product_extra_touch before update on product_extra
  for each row execute function app.touch_updated_at();

-- `app.enable_tenant_rls` crea sus políticas sin `if not exists`, así que
-- volver a ejecutar esta migración fallaba ahí. Todo lo demás del archivo es
-- re-ejecutable; esto lo iguala, que es lo que hace segura una reaplicación
-- tras un fallo a mitad.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'product_extra' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.product_extra');
  end if;
end $$;

drop trigger if exists product_extra_same_tenant_refs on product_extra;
create trigger product_extra_same_tenant_refs
before insert or update of organization_id, product_id on product_extra
for each row execute function app.enforce_same_tenant_refs('product_id', 'product');

-- ── lo contratado ──────────────────────────────────────────────────────────
create table if not exists booking_extra (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  booking_id  uuid not null references booking(id) on delete cascade,
  extra_id    uuid references product_extra(id) on delete set null,
  -- El nombre se COPIA: si el extra se renombra o se retira del catálogo, el
  -- voucher de una reserva vieja tiene que seguir diciendo qué se compró.
  name        text not null,
  price_type  text not null default 'per_person',
  quantity    numeric(14,2) not null default 1 check (quantity >= 0),
  unit_price  numeric(14,2) not null default 0 check (unit_price >= 0),
  unit_cost   numeric(14,2) check (unit_cost is null or unit_cost >= 0),
  total_amount numeric(14,2) not null default 0,
  cost_amount  numeric(14,2) not null default 0,
  currency    currency not null default 'usd',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists booking_extra_booking_idx on booking_extra (booking_id);
drop trigger if exists booking_extra_touch on booking_extra;
create trigger booking_extra_touch before update on booking_extra
  for each row execute function app.touch_updated_at();

-- `app.enable_tenant_rls` crea sus políticas sin `if not exists`, así que
-- volver a ejecutar esta migración fallaba ahí. Todo lo demás del archivo es
-- re-ejecutable; esto lo iguala, que es lo que hace segura una reaplicación
-- tras un fallo a mitad.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'booking_extra' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.booking_extra');
  end if;
end $$;

drop trigger if exists booking_extra_same_tenant_refs on booking_extra;
create trigger booking_extra_same_tenant_refs
before insert or update of organization_id, booking_id, extra_id on booking_extra
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'extra_id', 'product_extra'
);

-- Lo que la reserva lleva en extras, para no recorrer la tabla hija en cada
-- informe de rentabilidad.
alter table booking
  add column if not exists extras_amount numeric(14,2) not null default 0,
  add column if not exists extras_cost   numeric(14,2) not null default 0;
