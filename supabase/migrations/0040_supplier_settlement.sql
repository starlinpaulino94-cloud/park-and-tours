-- ============================================================================
-- 0040 — Lo que se le debe al proveedor que operó el servicio
--
-- La liquidación de COMISIONES existía y estaba bien resuelta: agencias, tour
-- centers y vendedores cobran su porcentaje y el sistema lo agrupa por período.
-- La otra mitad del dinero no existía en ninguna parte.
--
-- Una operadora no opera nada: subcontrata. El transportista pone el autobús, el
-- restaurante el almuerzo, el parque la entrada, el guía freelance el día. Eso
-- es lo que de verdad se paga cada semana, y el sistema no sabía cuánto ni a
-- quién:
--
--   · `product_cost` guarda el costo POR PROVEEDOR ('almuerzo — Restaurante El
--     Mangú, 350 por persona'), pero `resolveCost` los sumaba todos en un solo
--     número y tiraba el proveedor a la basura. `booking.cost_amount` servía
--     para calcular el margen y para nada más: no se podía responder "¿cuánto
--     le debo a Transporte Bávaro esta semana?".
--
--   · `payable.supplier_id` existe desde 0030 y NADA lo escribía nunca. La
--     tabla de cuentas por pagar podía nombrar un proveedor y jamás lo hacía.
--
--   · `beneficiary_type` no admitía 'supplier', así que una liquidación de
--     proveedor no tenía forma de declararse como tal.
--
--   · Sin conciliación. El proveedor factura 40 pax y el manifiesto dice 37.
--     Esa diferencia es el trabajo de media mañana de un administrativo, y no
--     había dónde anotarla ni cómo discutirla.
--
--   · Sin retenciones. En la República Dominicana, contratar a una persona
--     física obliga a retener ISR por honorarios y una parte del ITBIS
--     facturado. Pagar el bruto es un problema con la DGII, no un descuido.
--
-- Esta migración trae el devengo por proveedor, su conciliación y su
-- liquidación con retenciones.
-- ============================================================================

-- 'supplier' como beneficiario de una liquidación.
--
-- `add value` es idempotente con `if not exists`. Va en su propia sentencia y
-- ninguna de esta migración USA el valor nuevo: en Postgres un valor de enum
-- recién añadido no se puede emplear dentro de la misma transacción, así que
-- mezclarlo con un insert que lo use rompería al aplicar el archivo de una vez.
alter type beneficiary_type add value if not exists 'supplier';

-- ── el devengo: lo que cada servicio operado le debe a su proveedor ────────
create table if not exists booking_cost (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  booking_id      uuid not null references booking(id) on delete cascade,
  departure_id    uuid references departure(id) on delete set null,
  supplier_id     uuid references supplier(id) on delete set null,
  -- De qué tarifa del catálogo salió, para poder rastrear un cambio de precio.
  product_cost_id uuid references product_cost(id) on delete set null,
  settlement_id   uuid references settlement(id) on delete set null,
  concept         text not null,
  cost_type       text not null default 'per_person'
                    check (cost_type in ('per_person','per_group','per_departure','per_vehicle','percentage','fixed')),
  quantity        numeric(14,2) not null default 1 check (quantity >= 0),
  unit_cost       numeric(14,2) not null default 0 check (unit_cost >= 0),
  -- Lo que le debemos según lo que se operó de verdad.
  amount          numeric(14,2) not null default 0 check (amount >= 0),
  -- Lo que el proveedor factura. Nulo mientras no haya facturado; distinto de
  -- `amount` es exactamente la conversación que hay que tener con él.
  confirmed_amount numeric(14,2) check (confirmed_amount is null or confirmed_amount >= 0),
  currency        currency not null default 'usd',
  status          text not null default 'accrued'
                    check (status in ('accrued','confirmed','disputed','settled','paid','cancelled','waived')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists booking_cost_booking_idx on booking_cost (booking_id);
create index if not exists booking_cost_supplier_idx
  on booking_cost (organization_id, supplier_id, status);
create index if not exists booking_cost_settlement_idx on booking_cost (settlement_id);
create index if not exists booking_cost_departure_idx on booking_cost (organization_id, departure_id);

drop trigger if exists booking_cost_touch on booking_cost;
create trigger booking_cost_touch before update on booking_cost
  for each row execute function app.touch_updated_at();

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'booking_cost' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.booking_cost');
  end if;
end $$;

drop trigger if exists booking_cost_same_tenant_refs on booking_cost;
create trigger booking_cost_same_tenant_refs
before insert or update of organization_id, booking_id, departure_id, supplier_id,
                           product_cost_id, settlement_id on booking_cost
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'departure_id', 'departure',
  'supplier_id', 'supplier',
  'product_cost_id', 'product_cost',
  'settlement_id', 'settlement'
);

-- ── la liquidación de un proveedor ────────────────────────────────────────
alter table settlement
  add column if not exists supplier_id        uuid references supplier(id) on delete set null,
  -- Lo devengado por el manifiesto frente a lo que el proveedor factura.
  add column if not exists services_total     numeric(14,2) not null default 0,
  add column if not exists confirmed_total    numeric(14,2) not null default 0,
  add column if not exists adjustments_total  numeric(14,2) not null default 0,
  -- Retenciones de la DGII. Se calculan sobre lo facturado, no sobre el neto.
  add column if not exists retention_isr      numeric(14,2) not null default 0,
  add column if not exists retention_itbis    numeric(14,2) not null default 0,
  add column if not exists retention_total    numeric(14,2) not null default 0,
  -- Lo que sale del banco: facturado − retenciones + ajustes.
  add column if not exists net_total          numeric(14,2) not null default 0,
  -- El comprobante del proveedor, que es lo que sostiene el gasto ante la DGII.
  add column if not exists supplier_invoice_number text,
  add column if not exists supplier_invoice_ncf    text,
  add column if not exists supplier_invoice_date   date,
  add column if not exists confirmed_at       timestamptz,
  add column if not exists confirmed_by       uuid references auth.users(id) on delete set null,
  add column if not exists dispute_reason     text,
  -- El nombre del beneficiario, congelado. `commission` ya lo guardaba desde
  -- 0030 y la liquidación no: un proveedor que se renombra o se da de baja
  -- dejaría un estado de cuenta antiguo sin decir de quién era.
  add column if not exists beneficiary_name   text;

create index if not exists settlement_supplier_idx on settlement (organization_id, supplier_id);

drop trigger if exists settlement_same_tenant_refs on settlement;
create trigger settlement_same_tenant_refs
before insert or update of organization_id, partner_id, seller_id, supplier_id on settlement
for each row execute function app.enforce_same_tenant_refs(
  'seller_id', 'seller',
  'supplier_id', 'supplier'
);

-- ── el régimen fiscal del proveedor decide sus retenciones ────────────────
alter table supplier
  -- Persona física, empresa, o informal (sin comprobante). Es lo que determina
  -- si hay que retener y cuánto.
  add column if not exists tax_regime text not null default 'company',
  add column if not exists retention_isr_pct   numeric(6,3)
                             check (retention_isr_pct is null or (retention_isr_pct >= 0 and retention_isr_pct <= 100)),
  add column if not exists retention_itbis_pct numeric(6,3)
                             check (retention_itbis_pct is null or (retention_itbis_pct >= 0 and retention_itbis_pct <= 100)),
  add column if not exists tax_rate numeric(6,3)
                             check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100)),
  add column if not exists bank_account text,
  add column if not exists bank_name    text;

alter table supplier drop constraint if exists supplier_tax_regime_check;
alter table supplier add constraint supplier_tax_regime_check
  check (tax_regime in ('company','individual','informal'));

-- ── la reserva sabe cuánto de su costo está devengado ─────────────────────
-- `cost_amount` se conserva: es lo que usan el margen y los informes. Esta
-- columna dice cuánto de ese costo tiene dueño y documento, que no es lo mismo:
-- un producto sin tarifas de proveedor tiene costo y no tiene nada que liquidar.
alter table booking
  add column if not exists accrued_cost numeric(14,2) not null default 0;

-- ── el pago a un proveedor puede ser parcial ───────────────────────────────
-- 'partially_paid' estaba en el check de `settlement` desde 0006 y era
-- inalcanzable: la ruta de pago solo escribía 'paid'. Un proveedor al que se le
-- abona la mitad de la semana no tenía cómo representarse.
alter table settlement
  add column if not exists last_payment_at timestamptz;
