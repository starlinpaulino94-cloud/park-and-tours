-- ═══════════════════════════════════════════════════════════════════════════
-- 0057 — CANJEAR UN BENEFICIO DE MEMBEGO EN EL PUNTO DE VENTA
--
-- POR QUÉ, Y QUÉ SE DECIDIÓ HACE DOS OLAS
--
-- La integración con MembeGo (0041) trajo el SSO y los webhooks: sabemos quién
-- es el cliente, qué plan tiene y hasta cuándo. Lo que deliberadamente NO se
-- copió fue la ELEGIBILIDAD, y está escrito en aquella migración:
--
--   «La ELEGIBILIDAD no se copia a propósito: el contrato lo prohíbe porque
--    decide dinero y una copia desfasada regala un beneficio ya consumido.»
--
-- Esa decisión se mantiene entera. El canje NO consulta ninguna tabla local
-- para saber si el cliente tiene derecho: pregunta a MembeGo en el momento
-- (`POST /benefits/evaluate`) y consume contra MembeGo (`POST /redemptions`),
-- que es quien decide. Un cliente que gastó su beneficio en el car wash de la
-- esquina hace diez minutos tiene que encontrarse aquí con un «ya no queda».
--
-- QUÉ SE GUARDA ENTONCES, Y POR QUÉ HACE FALTA
--
-- El RECIBO del canje. No la elegibilidad: lo que pasó.
--
-- Sin esta tabla, una venta con beneficio aplicado sería una venta con un
-- descuento del que nadie sabe de dónde salió. Tres cosas quedan sin respuesta:
--
--  1. El arqueo. El cajero cuadra 1 200 y el sistema dice 1 500: la diferencia
--     es un beneficio que se aplicó, y hay que poder señalarlo.
--  2. La reversa. Si la venta se anula, el beneficio tiene que volver al
--     cliente — y para revertirlo en MembeGo hace falta el identificador que
--     MembeGo devolvió.
--  3. La conciliación con MembeGo. «Este mes canjeaste 84 beneficios» se
--     contesta con esta tabla, no llamando ochenta y cuatro veces a su API.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists membego_redemption (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- ── a qué venta se aplicó ───────────────────────────────────────────────
  -- La venta ya existe cuando se canjea: el beneficio se consume contra una
  -- operación real, no contra un carrito que puede abandonarse.
  order_id        uuid references sales_order(id) on delete set null,
  booking_id      uuid references booking(id) on delete set null,
  customer_id     uuid references customer(id) on delete set null,

  -- ── quién es en MembeGo ─────────────────────────────────────────────────
  membego_cliente_id text not null,
  membego_company_id text,

  -- ── qué se canjeó ───────────────────────────────────────────────────────
  benefit_type    text not null check (benefit_type in ('MEMBERSHIP', 'PROMOTION')),
  benefit_id      text not null,
  benefit_name    text,

  -- ── lo que contestó MembeGo ─────────────────────────────────────────────
  -- `redemption_id` es lo que hace posible la reversa. Sin él, anular la venta
  -- dejaría el beneficio consumido para siempre y el cliente perdería un uso
  -- por una venta que no llegó a existir.
  redemption_id   text,
  visit_id        text,
  ticket_numero   text,
  codigo          text,
  uses_left       integer,
  unlimited       boolean not null default false,

  -- ── el efecto en el dinero ──────────────────────────────────────────────
  effect_kind     text check (effect_kind in ('FREE', 'PERCENT', 'AMOUNT', 'NONE')),
  effect_label    text,
  amount_discounted numeric(14,2) not null default 0,
  currency        text,

  -- ── el estado del recibo ────────────────────────────────────────────────
  status          text not null default 'applied'
                    check (status in ('applied', 'reversed', 'failed')),
  reversed_at     timestamptz,
  reverse_reason  text,
  error_code      text,
  error_message   text,

  -- ── quién lo hizo ───────────────────────────────────────────────────────
  redeemed_by     uuid references auth.users(id) on delete set null,
  request_id      text,

  -- La clave con la que se pidió el canje a MembeGo. Es única por empresa
  -- porque ESA es la idempotencia: un doble clic del cajero, o un reintento de
  -- red, tienen que encontrarse con la misma fila en vez de consumir el
  -- beneficio dos veces. MembeGo también la exige por su lado; esto cierra el
  -- hueco antes de salir de aquí.
  idempotency_key text not null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (organization_id, idempotency_key)
);

create index if not exists membego_redemption_order_idx
  on membego_redemption (organization_id, order_id);
create index if not exists membego_redemption_cliente_idx
  on membego_redemption (organization_id, membego_cliente_id, created_at desc);
create index if not exists membego_redemption_status_idx
  on membego_redemption (organization_id, status, created_at desc);

drop trigger if exists membego_redemption_touch on membego_redemption;
create trigger membego_redemption_touch before update on membego_redemption
  for each row execute function app.touch_updated_at();

-- Las referencias tienen que ser de la MISMA empresa: un canje que apunte a la
-- venta de otro inquilino sería una fuga de datos con forma de descuento.
drop trigger if exists membego_redemption_same_tenant_refs on membego_redemption;
create trigger membego_redemption_same_tenant_refs
before insert or update of organization_id, order_id, booking_id, customer_id on membego_redemption
for each row execute function app.enforce_same_tenant_refs(
  'order_id', 'sales_order',
  'booking_id', 'booking',
  'customer_id', 'customer'
);

-- RLS con la misma ayuda que el resto de las tablas de inquilino: una política
-- escrita a mano aquí sería la que se quedaría atrás el día que cambie la forma
-- de resolver la organización de la sesión.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'membego_redemption' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.membego_redemption');
  end if;
end $$;

-- ── la marca en la reserva ─────────────────────────────────────────────────
-- El descuento del beneficio baja el importe de UNA línea de la venta, y hay
-- que poder decir cuál. Sin esto, la línea aparece rebajada y el motivo vive en
-- otra tabla que nadie mira desde la ficha de la reserva.
alter table booking
  add column if not exists membego_benefit text,
  add column if not exists membego_discount numeric(14,2);
