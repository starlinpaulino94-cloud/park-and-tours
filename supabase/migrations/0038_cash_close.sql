-- ============================================================================
-- 0038 — El arqueo deja de ser un número tecleado
--
-- El cierre de caja existía, pero cerraba con UN campo: "efectivo contado".
-- Eso no es un arqueo, es una declaración. Lo que falta para que sirva de
-- verdad en una empresa turística dominicana:
--
--   · CONTEO POR DENOMINACIÓN. El cajero cuenta billetes y monedas, no un
--     total. Sin el desglose, un faltante no se puede rastrear —¿faltó un
--     billete de 2000 o veinte de 100?— y el conteo no se puede re-verificar
--     al día siguiente. Ademas teclear el total invita a copiar el esperado,
--     que es exactamente lo que la pantalla hacía por defecto.
--
--   · MULTIMONEDA. Una caja en Bávaro recibe pesos y dólares el mismo turno.
--     `cash_session` tiene UNA moneda y `expected_cash` sumaba importes de
--     monedas distintas en un solo número: 100 USD y 100 DOP daban 200. El
--     arqueo pasa a ser POR MONEDA, y el conteo también.
--
--   · SUPERVISIÓN DE LA DIFERENCIA. Hoy el cajero cierra su propio faltante y
--     nadie lo revisa. El estado 'reconciled' existía en el check desde 0006 y
--     era inalcanzable: ninguna ruta lo escribía. Ahora un descuadre por
--     encima de la tolerancia de la caja deja la sesión en revisión hasta que
--     un supervisor la aprueba, con motivo.
--
--   · EL DESCUADRE CUESTA DINERO. Un faltante es una pérdida y un sobrante es
--     un ingreso; ninguno de los dos llegaba a la contabilidad. Se añaden las
--     cuentas y el enlace para asentarlo.
--
--   · EL LOTE DEL DATÁFONO. Lo cobrado con tarjeta se compara contra el cierre
--     del POS bancario; si no cuadra, el dinero no llega y nadie se entera
--     hasta la conciliación del banco.
-- ============================================================================

-- ── el conteo físico, por moneda y por denominación ────────────────────────
create table if not exists cash_count (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  cash_session_id uuid not null references cash_session(id) on delete cascade,
  currency        currency not null,
  -- 'open' es el conteo del fondo al abrir; 'close' el del cierre; 'spot' un
  -- arqueo sorpresa a mitad de turno, que no cierra nada.
  kind            text not null default 'close' check (kind in ('open','close','spot')),
  -- [{ "denomination": 2000, "quantity": 3 }, ...]. Se guarda el desglose y no
  -- solo el total: es lo que permite rastrear un faltante y repetir el conteo.
  breakdown       jsonb not null default '[]',
  counted_total   numeric(14,2) not null default 0 check (counted_total >= 0),
  expected_total  numeric(14,2) not null default 0,
  difference      numeric(14,2) not null default 0,
  counted_by      uuid references auth.users(id) on delete set null,
  counted_at      timestamptz not null default now(),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists cash_count_session_idx on cash_count (cash_session_id, currency);
-- Una sesión tiene un conteo de apertura y uno de cierre por moneda. Los
-- arqueos sorpresa sí pueden repetirse, por eso el índice es parcial.
create unique index if not exists cash_count_unique_idx
  on cash_count (cash_session_id, currency, kind) where kind in ('open','close');

drop trigger if exists cash_count_touch on cash_count;
create trigger cash_count_touch before update on cash_count
  for each row execute function app.touch_updated_at();

-- `app.enable_tenant_rls` crea las políticas sin `if not exists`, así que
-- relanzar la migración fallaría. Se comprueba antes.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'cash_count' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.cash_count');
  end if;
end $$;

-- Las referencias tienen que ser del mismo inquilino: una caja de otra empresa
-- no puede recibir un conteo.
drop trigger if exists cash_count_same_tenant_refs on cash_count;
create trigger cash_count_same_tenant_refs
before insert or update of organization_id, cash_session_id on cash_count
for each row execute function app.enforce_same_tenant_refs(
  'cash_session_id', 'cash_session'
);

-- ── el cierre: quién lo hizo, quién lo aprobó, y qué pasó por moneda ───────
alter table cash_session
  add column if not exists closed_by            uuid references auth.users(id) on delete set null,
  add column if not exists approved_by          uuid references auth.users(id) on delete set null,
  add column if not exists approved_at          timestamptz,
  add column if not exists approval_notes       text,
  add column if not exists difference_reason    text,
  add column if not exists requires_approval    boolean not null default false,
  -- Totales por moneda: { "dop": 12500.00, "usd": 340.00 }. El escalar
  -- `expected_cash` se conserva para la moneda principal de la caja y para no
  -- romper los RPC del panel, pero la verdad del arqueo vive aquí.
  add column if not exists expected_by_currency jsonb not null default '{}',
  add column if not exists counted_by_currency  jsonb not null default '{}',
  add column if not exists difference_by_currency jsonb not null default '{}',
  -- Conciliación del datáfono: lo que dice el cierre de lote del banco.
  add column if not exists card_batch_total     numeric(14,2),
  add column if not exists card_batch_reference text,
  -- A dónde fue el efectivo al cerrar (bóveda, depósito bancario).
  add column if not exists deposit_reference    text;

-- 'reconciled' estaba en el check desde 0006 pero nadie lo escribía. Se añade
-- 'pending_approval' para el cierre con descuadre que espera supervisor.
alter table cash_session drop constraint if exists cash_session_status_check;
alter table cash_session add constraint cash_session_status_check
  check (status in ('open','pending_approval','closed','reconciled'));

create index if not exists cash_session_approval_idx
  on cash_session (organization_id, status) where status = 'pending_approval';

-- ── tolerancia por caja ────────────────────────────────────────────────────
-- Hasta cuánto puede descuadrar un turno sin que lo tenga que mirar un
-- supervisor. Por defecto 0: cualquier diferencia se revisa.
alter table cash_register
  add column if not exists difference_tolerance numeric(14,2) not null default 0
    check (difference_tolerance >= 0);

-- ── el descuadre llega a la contabilidad ───────────────────────────────────
alter table ledger_entry
  add column if not exists cash_session_id uuid references cash_session(id) on delete set null;

create index if not exists ledger_entry_cash_session_idx on ledger_entry (cash_session_id);

alter table ledger_entry drop constraint if exists ledger_entry_source_type_check;
alter table ledger_entry add constraint ledger_entry_source_type_check
  check (source_type in
    ('sale','payment','refund','commission','settlement','expense','payable','purchase',
     'inventory','payroll','adjustment','opening','tax','gift_card','membership','cash_close'));

drop trigger if exists ledger_entry_cash_session_same_tenant on ledger_entry;
create trigger ledger_entry_cash_session_same_tenant
before insert or update of organization_id, cash_session_id on ledger_entry
for each row execute function app.enforce_same_tenant_refs(
  'cash_session_id', 'cash_session'
);
