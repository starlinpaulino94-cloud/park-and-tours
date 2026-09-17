-- ═══════════════════════════════════════════════════════════════════════════
-- 0060 — METAS COMERCIALES Y BONOS
--
-- ── LA META QUE HABÍA ────────────────────────────────────────────────────
--
-- `seller.monthly_goal` es un número. Un solo número, sin unidad declarada
-- —¿pesos? ¿pasajeros? ¿ventas?— y sin periodo más que «el mes». La pantalla
-- lo pinta como dinero y nada lo obliga a serlo.
--
-- Lo que una operadora pone de verdad en una reunión de lunes:
--
--   «Este mes, el equipo de playa: 40 ventas y 150 pasajeros.»
--   «Los hoteles: 30 clientes nuevos captados, el resto me da igual.»
--   «Rafael, en la excursión a Saona, 20 reservas de aquí al 15.»
--
-- Ninguna de las tres cabe en un número. Y la tercera —una meta sobre UN
-- producto, en UN rango de fechas, para UNA persona— es la más común de todas
-- cuando hay que empujar una salida que no se llena.
--
-- ── EL BONO NO ES UNA COMISIÓN ───────────────────────────────────────────
--
-- Y por eso no vive en `commission`. Una comisión nace de una venta concreta,
-- se calcula con una regla y se puede rastrear hasta su reserva. Un bono nace
-- de HABER LLEGADO a algo —una meta, una temporada, un acuerdo verbal— y no
-- tiene reserva detrás. Meterlo en la misma tabla obligaría a inventarle una
-- venta, y esa venta falsa saldría en el informe de ventas.
--
-- Lo que sí comparten es la liquidación: al vendedor se le paga todo junto.
--
-- ── LO QUE NO ES DINERO NO SUMA A LA TRANSFERENCIA ───────────────────────
--
-- Un bono puede ser un premio en especie: dos pases para la excursión, una
-- noche de hotel. Eso tiene un valor y cuenta para el expediente, pero NO se
-- transfiere. Sumarlo al total a pagar haría que la operadora transfiriera
-- dinero por un pase que ya regaló.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── la meta ────────────────────────────────────────────────────────────────
create table if not exists seller_goal (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  name text,

  -- A QUIÉN se le pone. Los tres son opcionales y se combinan: sin ninguno, la
  -- meta es de toda la red comercial.
  seller_id      uuid references seller(id) on delete cascade,
  seller_type_id uuid references seller_type(id) on delete cascade,
  branch_id      uuid references branch(id) on delete cascade,

  -- SOBRE QUÉ. Igual: sin ninguno, sobre todo lo que venda.
  product_id  uuid references product(id) on delete cascade,
  category_id uuid references product_category(id) on delete cascade,

  -- CUÁNDO. 'daily' | 'weekly' | 'monthly' | 'range'.
  period      text not null default 'monthly',
  period_from date,
  period_to   date,

  -- CUÁNTO, en cinco dimensiones independientes.
  --
  -- Todas nulas a propósito: una meta de pasajeros no debe pintar una barra de
  -- ingresos en cero, porque esa barra no significa nada. Nulo es «esta meta no
  -- habla de eso», que no es lo mismo que cero.
  target_signups  integer,
  target_bookings integer,
  target_sales    integer,
  target_pax      integer,
  target_revenue  numeric(14,2),
  currency currency,

  -- Lo que la empresa le promete al vendedor si llega. Texto libre porque lo es:
  -- «un fin de semana en Samaná» no es un número.
  reward text,

  status     text not null default 'active' check (status in ('active','inactive','achieved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_goal_period_check') then
    alter table seller_goal add constraint seller_goal_period_check
      check (period in ('daily','weekly','monthly','range'));
  end if;
  -- Un rango que termina antes de empezar no se cumple nunca y parece vivo en
  -- el listado.
  if not exists (select 1 from pg_constraint where conname = 'seller_goal_range_check') then
    alter table seller_goal add constraint seller_goal_range_check
      check (period_from is null or period_to is null or period_to >= period_from);
  end if;
  -- Un periodo 'range' sin fechas no acota nada: sería una meta perpetua
  -- disfrazada de campaña.
  if not exists (select 1 from pg_constraint where conname = 'seller_goal_range_dates_check') then
    alter table seller_goal add constraint seller_goal_range_dates_check
      check (period <> 'range' or (period_from is not null and period_to is not null));
  end if;
  -- Los objetivos, si se declaran, son positivos. Una meta de cero ventas se
  -- cumple sola y ensucia el tablero.
  if not exists (select 1 from pg_constraint where conname = 'seller_goal_targets_check') then
    alter table seller_goal add constraint seller_goal_targets_check
      check ((target_signups  is null or target_signups  > 0)
         and (target_bookings is null or target_bookings > 0)
         and (target_sales    is null or target_sales    > 0)
         and (target_pax      is null or target_pax      > 0)
         and (target_revenue  is null or target_revenue  > 0));
  end if;
  -- Y al menos UNO tiene que estar. Una meta sin ninguna dimensión es una fila
  -- que no se puede cumplir ni incumplir.
  if not exists (select 1 from pg_constraint where conname = 'seller_goal_has_target_check') then
    alter table seller_goal add constraint seller_goal_has_target_check
      check (coalesce(target_signups, target_bookings, target_sales, target_pax) is not null
             or target_revenue is not null);
  end if;
end $$;

create index if not exists seller_goal_org_idx on seller_goal (organization_id, status);
create index if not exists seller_goal_seller_idx
  on seller_goal (organization_id, seller_id) where seller_id is not null;
create index if not exists seller_goal_type_idx
  on seller_goal (organization_id, seller_type_id) where seller_type_id is not null;

drop trigger if exists seller_goal_touch on seller_goal;
create trigger seller_goal_touch before update on seller_goal
for each row execute function app.touch_updated_at();

drop trigger if exists seller_goal_same_tenant on seller_goal;
create trigger seller_goal_same_tenant
before insert or update of organization_id, seller_id, seller_type_id, branch_id, product_id, category_id
on seller_goal
for each row execute function app.enforce_same_tenant_refs(
  'seller_id', 'seller',
  'seller_type_id', 'seller_type',
  'branch_id', 'branch',
  'product_id', 'product',
  'category_id', 'product_category'
);

-- ── el bono ────────────────────────────────────────────────────────────────
create table if not exists seller_bonus (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  seller_id uuid not null references seller(id) on delete cascade,
  -- La meta que lo otorgó, cuando salió de una. Un bono pactado a mano no la
  -- tiene, y eso es normal.
  goal_id   uuid references seller_goal(id) on delete set null,

  description text not null,
  -- LA CONDICIÓN QUE LO OTORGÓ, congelada: {"target_pax": 50, "reached": 63}.
  --
  -- Sin esto, dentro de seis meses «Bono de septiembre · 100 USD» no se puede
  -- defender ante nadie. La meta puede haberse editado o borrado; la condición
  -- que se cumplió aquel día, no.
  condition jsonb,

  amount   numeric(14,2) not null default 0 check (amount >= 0),
  currency currency not null default 'usd',

  -- 'cash' = se transfiere. 'in_kind' = un premio que no se transfiere.
  --
  -- La distinción decide dinero: un pase regalado tiene valor y cuenta para el
  -- expediente, pero sumarlo al total a pagar haría transferir dinero por algo
  -- que ya se entregó.
  payout_kind text not null default 'cash',

  status        text not null default 'pending',
  settlement_id uuid references settlement(id) on delete set null,
  awarded_at    timestamptz not null default now(),
  paid_at       timestamptz,
  approved_by   uuid references auth.users(id) on delete set null,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_bonus_payout_kind_check') then
    alter table seller_bonus add constraint seller_bonus_payout_kind_check
      check (payout_kind in ('cash','in_kind'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seller_bonus_status_check') then
    alter table seller_bonus add constraint seller_bonus_status_check
      check (status in ('pending','approved','settled','paid','cancelled'));
  end if;
  -- Un bono sin descripción no se puede explicar en una liquidación.
  if not exists (select 1 from pg_constraint where conname = 'seller_bonus_description_check') then
    alter table seller_bonus add constraint seller_bonus_description_check
      check (length(btrim(description)) > 0);
  end if;
end $$;

create index if not exists seller_bonus_org_idx on seller_bonus (organization_id, status);
create index if not exists seller_bonus_seller_idx
  on seller_bonus (organization_id, seller_id, status);
create index if not exists seller_bonus_settlement_idx
  on seller_bonus (settlement_id) where settlement_id is not null;

drop trigger if exists seller_bonus_touch on seller_bonus;
create trigger seller_bonus_touch before update on seller_bonus
for each row execute function app.touch_updated_at();

drop trigger if exists seller_bonus_same_tenant on seller_bonus;
create trigger seller_bonus_same_tenant
before insert or update of organization_id, seller_id, goal_id, settlement_id on seller_bonus
for each row execute function app.enforce_same_tenant_refs(
  'seller_id', 'seller',
  'goal_id', 'seller_goal',
  'settlement_id', 'settlement'
);

-- ── la liquidación separa lo que se transfiere de lo que no ────────────────
--
-- `commission_total` sigue siendo lo que era. Lo que faltaba es decir cuánto de
-- lo que aparece en el documento es dinero que sale del banco y cuánto es un
-- premio ya entregado: sin separarlos, la operadora transfiere de más.
alter table settlement
  add column if not exists bonus_total   numeric(14,2) not null default 0,
  add column if not exists in_kind_total numeric(14,2) not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settlement_bonus_totals_check') then
    alter table settlement add constraint settlement_bonus_totals_check
      check (bonus_total >= 0 and in_kind_total >= 0);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'seller_goal' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.seller_goal');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'seller_bonus' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.seller_bonus');
  end if;
end $$;
