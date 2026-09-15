-- ============================================================================
-- 0039 — El anticipo, el saldo y el plan de cuotas
--
-- Una operadora no cobra el total al reservar. Cobra un anticipo para bloquear
-- la plaza y el saldo antes de la salida; y en grupos, bodas o incentivos, en
-- varias cuotas. Hasta ahora el sistema no sabía nada de eso:
--
--   · La cotización SÍ negociaba el anticipo (0032: `deposit_type`,
--     `deposit_percent`, `deposit_due_date`, `balance_due_date`), pero al
--     convertirla en reserva esas condiciones se PERDÍAN. Lo pactado con el
--     cliente no llegaba a la venta.
--
--   · Solo existían `total`, `paid_total` y `balance`: un número redondo sin
--     fecha. El sistema no podía decir si un saldo estaba al día o vencido,
--     porque no sabía cuándo vencía.
--
--   · La plantilla de aviso `balance_due` se creó en 0034, se documentó y se
--     sembró… y nada la disparaba nunca. El sistema prometía recordar el saldo
--     y no recordaba ninguno.
--
--   · Una reserva sin pagar retenía la plaza indefinidamente. En temporada eso
--     es cupo muerto: ni cobrado ni vendible.
--
--   · `receivable.aging_bucket` se escribía 'current' al crear y no se tocaba
--     nunca más, y encima era editable a mano desde el CRUD. Una deuda de 120
--     días seguía diciendo "corriente".
--
-- Esta migración trae el calendario de cobro: quién debe qué, cuándo, y qué
-- pasa si no llega.
-- ============================================================================

-- ── el plan de pagos ───────────────────────────────────────────────────────
-- El anticipo NO es una columna aparte: es la cuota número uno, de tipo
-- 'deposit'. Así el saldo, el anticipo y las cuotas de un grupo se cobran, se
-- vencen y se recuerdan por el mismo camino, en vez de tener tres mecanismos
-- que hay que mantener de acuerdo entre sí.
create table if not exists payment_schedule (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  order_id        uuid not null references sales_order(id) on delete cascade,
  booking_id      uuid references booking(id) on delete set null,
  sequence        integer not null default 1,
  kind            text not null default 'installment'
                    check (kind in ('deposit','installment','balance')),
  due_date        date not null,
  amount          numeric(14,2) not null default 0 check (amount >= 0),
  paid_amount     numeric(14,2) not null default 0 check (paid_amount >= 0),
  balance         numeric(14,2) not null default 0,
  currency        currency not null default 'usd',
  status          text not null default 'pending'
                    check (status in ('pending','partially_paid','paid','overdue','waived','cancelled')),
  paid_at         timestamptz,
  -- Cuándo se le recordó por última vez. Sin esto, el cron le escribiría al
  -- cliente todos los días hasta que pague, que es la forma más rápida de que
  -- marque tus correos como spam.
  reminded_at     timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Dos cuotas con el mismo número son dos calendarios a la vez.
  unique (order_id, sequence)
);

create index if not exists payment_schedule_order_idx on payment_schedule (order_id, sequence);
create index if not exists payment_schedule_due_idx
  on payment_schedule (organization_id, due_date) where status in ('pending','partially_paid','overdue');

drop trigger if exists payment_schedule_touch on payment_schedule;
create trigger payment_schedule_touch before update on payment_schedule
  for each row execute function app.touch_updated_at();

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'payment_schedule' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.payment_schedule');
  end if;
end $$;

drop trigger if exists payment_schedule_same_tenant_refs on payment_schedule;
create trigger payment_schedule_same_tenant_refs
before insert or update of organization_id, order_id, booking_id on payment_schedule
for each row execute function app.enforce_same_tenant_refs(
  'order_id', 'sales_order',
  'booking_id', 'booking'
);

-- ── las condiciones de pago viajan a la venta ──────────────────────────────
-- Mismo vocabulario que la cotización ('none','percent','amount'), para que lo
-- pactado se copie sin traducir y sin perderse por el camino.
alter table sales_order
  add column if not exists deposit_type      text not null default 'none',
  add column if not exists deposit_percent   numeric(6,3)
                             check (deposit_percent is null or (deposit_percent >= 0 and deposit_percent <= 100)),
  add column if not exists deposit_amount    numeric(14,2) check (deposit_amount is null or deposit_amount >= 0),
  add column if not exists deposit_due_date  date,
  add column if not exists balance_due_date  date,
  add column if not exists payment_terms     text,
  -- Hasta cuándo se le guarda la plaza sin haber cobrado nada. Pasada esa
  -- hora, el cupo vuelve a la venta en vez de quedarse muerto.
  add column if not exists hold_until        timestamptz,
  -- Estado derivado del calendario, para poder filtrar sin recorrer las cuotas.
  add column if not exists collection_status text not null default 'none';

alter table sales_order drop constraint if exists sales_order_deposit_type_check;
alter table sales_order add constraint sales_order_deposit_type_check
  check (deposit_type in ('none','percent','amount'));

alter table sales_order drop constraint if exists sales_order_collection_status_check;
alter table sales_order add constraint sales_order_collection_status_check
  check (collection_status in ('none','on_track','due_soon','overdue','settled'));

create index if not exists sales_order_collection_idx
  on sales_order (organization_id, collection_status) where collection_status in ('due_soon','overdue');
create index if not exists sales_order_hold_idx
  on sales_order (organization_id, hold_until) where hold_until is not null;

-- ── la política de anticipo del producto ───────────────────────────────────
-- Lo que hace que el plan salga solo en vez de teclearse en cada venta: este
-- tour pide 30% al reservar y el saldo 15 días antes de la salida.
alter table product
  add column if not exists deposit_type      text not null default 'none',
  add column if not exists deposit_percent   numeric(6,3)
                             check (deposit_percent is null or (deposit_percent >= 0 and deposit_percent <= 100)),
  add column if not exists deposit_amount    numeric(14,2) check (deposit_amount is null or deposit_amount >= 0),
  add column if not exists balance_due_days  integer check (balance_due_days is null or balance_due_days >= 0);

alter table product drop constraint if exists product_deposit_type_check;
alter table product add constraint product_deposit_type_check
  check (deposit_type in ('none','percent','amount'));

-- ── la reserva sabe cuándo vence su saldo ──────────────────────────────────
-- Va en la reserva y no solo en la orden porque la fecha se deriva de LA
-- SALIDA: una orden con dos excursiones en fechas distintas tiene dos
-- vencimientos, y el recordatorio se manda por reserva.
alter table booking
  add column if not exists balance_due_date date;

create index if not exists booking_balance_due_idx
  on booking (organization_id, balance_due_date) where balance_due_date is not null;

-- ── el pago se imputa a una cuota ──────────────────────────────────────────
alter table payment
  add column if not exists schedule_id uuid references payment_schedule(id) on delete set null;

create index if not exists payment_schedule_ref_idx on payment (schedule_id);

drop trigger if exists payment_schedule_same_tenant on payment;
create trigger payment_schedule_same_tenant
before insert or update of organization_id, schedule_id on payment
for each row execute function app.enforce_same_tenant_refs(
  'schedule_id', 'payment_schedule'
);

-- ── cuánto se le guarda la plaza a quien no ha pagado ──────────────────────
-- Por defecto, nulo: nada expira y el comportamiento de siempre se mantiene.
-- Configurado, la cobranza diaria libera el cupo de las reservas sin un peso
-- cobrado pasado ese plazo. En temporada alta una reserva sin pagar que retiene
-- seis plazas indefinidamente es cupo muerto: ni cobrado ni vendible.
alter table organizations
  add column if not exists hold_hours integer check (hold_hours is null or hold_hours >= 0);

-- ── una sola forma de nombrar la antigüedad ────────────────────────────────
-- El enum decía '1_30' y la interfaz 'd1_30'. Con `aging_bucket` en los campos
-- escribibles del CRUD, guardar el tramo que la propia UI ofrece lo RECHAZABA
-- la base. No había saltado porque el único valor que se escribía en la
-- práctica era 'current', válido en los dos vocabularios; el informe de
-- antigüedad, que calcula el tramo por su cuenta desde `due_date`, tampoco
-- pasaba nunca por la columna.
--
-- Se renombran los valores del enum —es un cambio de metadatos, las filas
-- existentes conservan su tramo— para que la base y la pantalla digan lo mismo.
-- Cada renombrado va suelto y con su literal a la vista: escrito en un bucle
-- con `execute format` no hay forma de que una prueba lea el vocabulario real
-- del enum desde el SQL, y esa prueba es justo la que impide que vuelvan a
-- separarse.
do $$ begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
               where t.typname = 'aging_bucket' and e.enumlabel = '1_30') then
    alter type aging_bucket rename value '1_30' to 'd1_30';
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
               where t.typname = 'aging_bucket' and e.enumlabel = '31_60') then
    alter type aging_bucket rename value '31_60' to 'd31_60';
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
               where t.typname = 'aging_bucket' and e.enumlabel = '61_90') then
    alter type aging_bucket rename value '61_90' to 'd61_90';
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
               where t.typname = 'aging_bucket' and e.enumlabel = 'over_90') then
    alter type aging_bucket rename value 'over_90' to 'd90_plus';
  end if;
end $$;

-- ── la antigüedad de la deuda deja de ser un campo de texto ────────────────
-- `aging_bucket` lo sincroniza la cobranza diaria desde `due_date`. Se anota
-- aquí porque la columna ya existía y su valor era, literalmente, lo último
-- que alguien tecleó.
comment on column receivable.aging_bucket is
  'Derivada de due_date por la cobranza diaria. No editar a mano.';
