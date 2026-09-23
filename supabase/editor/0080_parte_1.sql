-- 0080 · parte 1 de 3 — La tabla del monedero y sus índices.
--
-- Pégalo entero en el editor SQL de Supabase y ejecútalo. Luego la parte 2.
--
-- QUÉ HACE
--  · Crea `partner_wallet_movement`: el libro de movimientos del saldo prepago.
--  · NO hay columna de saldo: el saldo es la suma de este libro, y así no puede
--    discrepar de sus propios movimientos.
--  · `amount` tiene un `check (amount > 0)`: el signo lo pone el TIPO. Con
--    importes con signo, una recarga de −500 vacía el monedero y en el listado
--    se lee como una recarga.
--
-- NO borra ni cambia ninguna fila.
--
-- OJO: esta parte va SOLA. El editor de Supabase añade un
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` después de un `create table`, y
-- ese ALTER dentro de un bloque `$$` falla — es lo que partió 0080 en tres.

create table if not exists partner_wallet_movement (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  -- El tour center. Un socio es una fila de `organizations` con kind='partner'.
  partner_id      uuid not null references organizations(id) on delete restrict,

  movement_type   text not null check (movement_type in ('topup','consumption','refund','adjustment')),

  -- ── EL IMPORTE SIEMPRE ES POSITIVO ─────────────────────────────────────
  --
  -- El signo lo pone el TIPO, no el número. Con importes con signo, una recarga
  -- de −500 vacía el monedero sin que nada parezca raro: es «una recarga», y en
  -- el listado se lee como una recarga. Con este `check` no se puede ni
  -- escribir, y la regla vive en la base y no solo en la aplicación porque el
  -- día que alguien inserte por SQL la aplicación no está delante.
  amount          numeric(14,2) not null check (amount > 0),
  currency        text not null default 'usd',

  -- Qué venta lo gastó. `set null` y no `cascade`: borrar una orden no puede
  -- borrar el movimiento de dinero que provocó — el saldo del socio dejaría de
  -- cuadrar con lo que se le cobró.
  order_id        uuid references sales_order(id) on delete set null,
  booking_id      uuid references booking(id) on delete set null,

  -- El número de la transferencia, del recibo o del ajuste. Es lo que se mira
  -- cuando el socio dice «yo transferí el martes».
  reference       text,
  note            text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- La consulta del monedero: los movimientos de un socio, lo más nuevo arriba.
create index if not exists partner_wallet_partner_idx
  on partner_wallet_movement (organization_id, partner_id, created_at desc);
-- Y la de «¿esta venta ya descontó?», que es la que evita descontar dos veces.
create index if not exists partner_wallet_order_idx
  on partner_wallet_movement (organization_id, order_id)
  where order_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- UNA VENTA DESCUENTA UNA VEZ
--
-- Sin esto, un reintento —la saga que se compensa y vuelve a entrar, un cliente
-- que da dos veces al botón— descuenta dos veces la misma venta y el socio paga
-- el doble por una reserva. Es el mismo motivo por el que la clave de dedupe de
-- los avisos la hace cumplir un índice y no un `select` previo: dos instancias
-- a la vez ganan siempre a una comprobación en la aplicación.
--
-- Parcial y por tipo: las devoluciones de una misma orden pueden ser varias —
-- una por reserva cancelada— y los ajustes no tienen orden.
create unique index if not exists partner_wallet_consumption_once_idx
  on partner_wallet_movement (organization_id, order_id)
  where movement_type = 'consumption' and order_id is not null;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Tienen que salir las tres: la del importe positivo y los dos índices únicos
-- o parciales.
select 'check importe positivo' as que,
       count(*) as existe
  from pg_constraint
 where conrelid = 'public.partner_wallet_movement'::regclass
   and contype = 'c'
   and pg_get_constraintdef(oid) ilike '%amount > 0%'
union all
select 'indice una venta descuenta una vez', count(*)
  from pg_indexes
 where tablename = 'partner_wallet_movement'
   and indexname = 'partner_wallet_consumption_once_idx'
union all
select 'indice del listado', count(*)
  from pg_indexes
 where tablename = 'partner_wallet_movement'
   and indexname = 'partner_wallet_partner_idx';
