-- 0080 — El saldo prepago del tour center, y su libro de movimientos.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ FALTABA, Y QUÉ NO
--
-- El control de CRÉDITO existe desde 0031 y funciona: el socio vende ahora y
-- debe después, con un techo que `creditCheck` hace cumplir. Lo que no había es
-- lo contrario — el socio que ingresa dinero por adelantado y va gastando— y es
-- como trabaja media costa: transfieren el lunes y venden toda la semana contra
-- ese depósito.
--
-- Sin esto, a un socio prepago había que llevarle el saldo en una libreta y
-- mirarla antes de cada venta. Como el cupo antes de 6.4 y el contrato por
-- producto antes de 6.1: el acuerdo existía fuera del sistema.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL SALDO NO ES UNA COLUMNA
--
-- Es la suma de este libro. Una columna con el saldo es un número que puede
-- discrepar de sus movimientos, y cuando discrepa nadie sabe cuál de los dos es
-- el bueno: pasa el día que una escritura falla a mitad, o que alguien corrige
-- a mano. Un saldo derivado no se descuadra — se recalcula.
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

create trigger partner_wallet_touch before update on partner_wallet_movement
  for each row execute function app.touch_updated_at();

-- El mismo cerrojo que el resto: la fila tiene que ser de la misma empresa que
-- la orden a la que apunta.
drop trigger if exists partner_wallet_same_tenant on partner_wallet_movement;
create trigger partner_wallet_same_tenant
before insert or update of organization_id, order_id, booking_id on partner_wallet_movement
for each row execute function app.enforce_same_tenant_refs(
  'order_id', 'sales_order', 'booking_id', 'booking');

-- ─────────────────────────────────────────────────────────────────────────────
-- CÓMO PAGA ESTE SOCIO: declarado, como el modelo de precio de 0078
--
-- Va en la RELACIÓN porque es del contrato: la misma agencia puede trabajar a
-- crédito con una operadora y prepago con otra.
--
-- Y el valor por defecto es `credit` a propósito: es lo que hace hoy el sistema
-- con todos los socios. Nacer en `prepaid` les cortaría la venta a todos de
-- golpe en el despliegue, porque todos los monederos nacen con saldo cero. Es
-- el mismo apagón silencioso que evita la siembra de 0077.
alter table organization_relationships
  add column if not exists payment_mode text not null default 'credit'
    check (payment_mode in ('credit','prepaid'));

comment on column organization_relationships.payment_mode is
  'Cómo paga el socio (0080). `credit`: vende ahora y debe después, con el '
  'techo de `credit_limit`. `prepaid`: ingresa por adelantado y cada venta '
  'descuenta de su saldo, que es la suma de `partner_wallet_movement` — sin '
  'descubierto, porque un descubierto es un crédito que nadie pactó.';

-- ─────────────────────────────────────────────────────────────────────────────
-- LA POLÍTICA, EN LA MISMA ENTREGA
--
-- El riesgo transversal del plan: cada tabla que se abre a un actor nuevo
-- necesita su política aquí mismo. El socio ve SUS movimientos y no los de la
-- agencia de enfrente — que dirían cuánto ingresa y cuánto vende.
--
-- El segundo argumento en `true` es lo que añade `app.can_read_partner` a la
-- política de lectura. Aquí sirve tal cual —a diferencia de `notification` en
-- 0079, donde hubo que escribir las tres ramas a mano— porque estas filas
-- SIEMPRE llevan socio: la columna es `not null`. En `notification` los avisos
-- personales no lo llevan, y con `can_read_partner` el socio habría dejado de
-- ver los suyos.
select app.enable_tenant_rls('public.partner_wallet_movement', true);
