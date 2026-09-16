-- ═══════════════════════════════════════════════════════════════════════════
-- 0053 — EL PERIODO CONTABLE SE CIERRA
--
-- POR QUÉ
--
-- El mayor lleva desde 0021 aceptando cualquier asiento con cualquier fecha.
-- El 607 se envía a la DGII el día 20 y, a partir de ahí, nada impide que
-- alguien registre un pago con fecha del mes anterior: lo declarado y los
-- libros empiezan a decir cosas distintas, y la diferencia solo aparece cuando
-- la DGII cruza los comprobantes —meses después, con recargo—.
--
-- TRES ESTADOS Y NO DOS
--
--   open    el mes corriente; se contabiliza con normalidad
--   closed  el contador lo revisó y lo dio por bueno; se puede REABRIR
--   locked  ya se declaró a la DGII; NO se reabre desde el sistema
--
-- La diferencia entre los dos últimos es lo que hace que esto sirva. Un cierre
-- que siempre se puede deshacer no protege nada, y uno que nunca se puede
-- deshacer obliga a saltárselo el primer día que el contador se equivoca.
-- Corregir un mes declarado es una rectificativa ante la DGII, que es una
-- conversación con el contador, no un botón.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists accounting_period (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  -- 'AAAA-MM'. Texto y no fecha a propósito: un periodo no es un día, y
  -- guardarlo como fecha invita a compararlo con `now()` por accidente.
  period          text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status          text not null default 'open'
                    check (status in ('open','closed','locked')),

  closed_at       timestamptz,
  closed_by       uuid references auth.users(id) on delete set null,
  locked_at       timestamptz,
  locked_by       uuid references auth.users(id) on delete set null,
  reopened_at     timestamptz,
  reopened_by     uuid references auth.users(id) on delete set null,

  -- Lo que decían los libros EN EL MOMENTO de cerrar. Si después se reabre y se
  -- toca algo, la diferencia con estas cifras es la pregunta que hay que
  -- responderle al contador.
  total_debit     numeric(16,2),
  total_credit    numeric(16,2),
  net_income      numeric(16,2),

  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists accounting_period_idx
  on accounting_period (organization_id, period);
create index if not exists accounting_period_status_idx
  on accounting_period (organization_id, status);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'accounting_period_touch') then
    create trigger accounting_period_touch before update on accounting_period
      for each row execute function app.touch_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'accounting_period' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.accounting_period');
  end if;
end $$;

-- ── el asiento de cierre del ejercicio ─────────────────────────────────────
--
-- `3201 Resultados acumulados` está en el plan de cuentas desde 0021 y nada
-- escribía nunca en él. Sin el asiento de cierre, los ingresos y los gastos de
-- un año siguen ahí el año siguiente: el estado de resultados del segundo
-- ejercicio incluye el primero y el balance general no cuadra jamás.
alter table ledger_entry
  -- Marca el asiento que salda las cuentas de resultado, para poder excluirlo
  -- del estado de resultados del ejercicio que cierra —si no, lo dejaría en
  -- cero— y para no generarlo dos veces.
  add column if not exists is_closing boolean not null default false,
  -- El ejercicio que este asiento cierra: 'AAAA'.
  add column if not exists closes_year text;

create index if not exists ledger_entry_closing_idx
  on ledger_entry (organization_id, closes_year)
  where is_closing = true;

-- ── la anulación fiscal, para el 608 ───────────────────────────────────────
--
-- El sistema ya anula facturas y emite su nota de crédito, pero no guardaba
-- POR QUÉ se anuló. El 608 exige uno de nueve códigos y la DGII rechaza el
-- archivo entero si llega otro, así que sin este campo la declaración de
-- anulaciones había que armarla a mano.
alter table invoice
  add column if not exists void_reason_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_void_reason_code_check') then
    alter table invoice add constraint invoice_void_reason_code_check
      check (void_reason_code is null or void_reason_code in
        ('01','02','03','04','05','06','07','08','09'));
  end if;
end $$;
