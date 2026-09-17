-- ═══════════════════════════════════════════════════════════════════════════
-- 0059 — QUE LA COMISIÓN SE PUEDA EXPLICAR Y CORREGIR
--
-- TRES COSAS, Y LA PRIMERA ES UN FALLO QUE YA ESTÁ PAGANDO DINERO DE MÁS
--
-- ── 1. `net_rate` y `markup` se cobran como si fueran un porcentaje ────────
--
-- El enum `calc_type` declara seis tipos desde 0003 y la pantalla de comisiones
-- los ofrece los seis. `computeAmount` implementa CUATRO: `net_rate` y `markup`
-- caen al `return` final y se calculan como PORCENTAJE.
--
-- Lo que eso significa en una operadora real: alguien configura una regla de
-- «Tarifa neta 45» —queriendo decir «la agencia me deja 45 dólares netos por
-- pasajero»— y el sistema le paga el 45 % de la venta. En un tour de 120
-- dólares eso son 54 en vez de los 75 que le tocaban… o 54 en vez de nada,
-- según cómo se interpretara. Nadie lo ha reportado porque una comisión mal
-- calculada no da error: da una cifra.
--
-- Esta migración no arregla eso —lo arregla `commission-engine.ts`— pero sí
-- añade lo que hace falta para que se NOTE: el desglose en lenguaje humano.
--
-- ── 2. Una comisión pagada no se anula: se ajusta ─────────────────────────
--
-- Hoy, cancelar una reserva pone sus comisiones `pending` y `approved` en
-- `cancelled`, y a las `settled` y `paid` NO LAS TOCA. O sea: el dinero salió,
-- la venta se cayó, y en el sistema no queda ni rastro de que haya que
-- recuperarlo. La liquidación del mes siguiente cuadra con una venta que no
-- existe.
--
-- `commission_adjustment` guarda movimientos CON SIGNO. Cancelar una venta ya
-- comisionada deja las dos cifras a la vista —lo que se pagó y lo que se
-- descuenta— en vez de reescribir la primera. Es la misma regla que el resto
-- del sistema: nunca borrar, siempre anotar.
--
-- ── 3. Escalones por pasajeros, y no solo por importe ─────────────────────
--
-- Nuestros escalones miran el IMPORTE de la venta. El acuerdo que de verdad se
-- firma con un touroperador mira los PASAJEROS: «de 1 a 10 pax, 10 %; de 11 en
-- adelante, 15 %». Con escalones por importe, un grupo de 20 personas en un
-- tour barato cobra menos que una pareja en uno caro, que es justo lo contrario
-- de lo que el acuerdo dice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── los tipos de cálculo por pasajero ──────────────────────────────────────
--
-- `ADD VALUE IF NOT EXISTS` es idempotente y no reescribe la tabla. Los tres
-- nuevos cubren el acuerdo más común de una operadora de excursiones: «te pago
-- X por cada adulto que me traigas».
alter type calc_type add value if not exists 'per_pax';
alter type calc_type add value if not exists 'per_adult';
alter type calc_type add value if not exists 'per_child';

-- ── la regla ───────────────────────────────────────────────────────────────
alter table commission_rule
  -- Contra qué se miden los escalones. 'amount' es lo que hacía hasta ahora, y
  -- es el defecto para no cambiarle el cálculo a ninguna regla ya guardada.
  add column if not exists tier_basis text not null default 'amount',
  -- Vigencia por FECHA DE VENTA, que no es lo mismo que la temporada.
  --
  -- `season_from`/`season_to` acotan por fecha de VIAJE: «en temporada alta se
  -- comisiona distinto». Esto acota por fecha de VENTA: «esta campaña de
  -- comisiones vale para lo que se venda en octubre, viajen cuando viajen».
  -- Son dos acuerdos distintos y hasta ahora solo se podía expresar uno.
  add column if not exists effective_from date,
  add column if not exists effective_to   date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'commission_rule_tier_basis_check') then
    alter table commission_rule add constraint commission_rule_tier_basis_check
      check (tier_basis in ('amount', 'pax'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'commission_rule_effective_range_check') then
    alter table commission_rule add constraint commission_rule_effective_range_check
      check (effective_from is null or effective_to is null or effective_to >= effective_from);
  end if;
end $$;

-- ── la comisión ────────────────────────────────────────────────────────────
alter table commission
  -- La frase que explica la cifra sin abrir el código: «3 adultos × US$10 =
  -- US$30». El snapshot ya guarda los datos, pero un JSON no se le enseña a un
  -- conserje que discute su liquidación por WhatsApp.
  add column if not exists breakdown text,
  -- Cuántos pasajeros comisionó, congelado. Sin esto, recalcular un «por
  -- adulto» de hace tres meses tendría que ir a buscar la reserva — que puede
  -- haberse reprogramado con otra gente.
  add column if not exists pax_adults   integer,
  add column if not exists pax_children integer,
  -- Suma de los ajustes firmados, y lo que queda por pagar de verdad.
  -- Se mantienen desde el servicio, igual que los totales de una venta: un
  -- disparador que agregue aquí sería un segundo sitio donde se decide dinero.
  add column if not exists adjustment_total numeric(14,2) not null default 0,
  add column if not exists net_amount       numeric(14,2);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'commission_pax_check') then
    alter table commission add constraint commission_pax_check
      check ((pax_adults is null or pax_adults >= 0) and (pax_children is null or pax_children >= 0));
  end if;
  -- El neto nunca baja de cero: una comisión no se convierte en una deuda del
  -- vendedor. Si los ajustes se comen más que el importe, el resto se persigue
  -- por otra vía, no dejando un número negativo en la liquidación.
  if not exists (select 1 from pg_constraint where conname = 'commission_net_amount_check') then
    alter table commission add constraint commission_net_amount_check
      check (net_amount is null or net_amount >= 0);
  end if;
end $$;

-- `net_amount` arranca igual al importe: sin ajustes, el neto ES el importe.
-- Dejarlo nulo haría que la liquidación leyera cero para esas comisiones.
update commission set net_amount = amount where net_amount is null;

-- Y lo mismo para las que nazcan después.
--
-- No basta con el UPDATE de arriba ni con que `booking-service` lo escriba: una
-- comisión también entra por el importador, por la API de socios y por el CRUD
-- genérico, y cualquiera de esos caminos la dejaría con el neto en nulo. La
-- liquidación la leería como cero y el vendedor cobraría de menos, en silencio.
--
-- Esto NO es el cálculo del neto —ese vive en `commission-adjust-service.ts`,
-- que suma los ajustes y es el único sitio donde se decide—: es solo el valor
-- inicial de una columna que se deriva de otra de la misma fila, que es
-- exactamente lo que un `default` haría si Postgres admitiera uno así.
create or replace function app.commission_net_defaults_to_amount()
returns trigger
language plpgsql
as $$
begin
  if new.net_amount is null then
    new.net_amount := coalesce(new.amount, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists commission_net_default on commission;
create trigger commission_net_default
before insert on commission
for each row execute function app.commission_net_defaults_to_amount();

-- ── los ajustes con signo ──────────────────────────────────────────────────
create table if not exists commission_adjustment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  commission_id   uuid not null references commission(id) on delete cascade,
  -- CON SIGNO: negativo descuenta, positivo añade. Una cancelación es negativa;
  -- un premio pactado fuera de la regla es positivo.
  amount     numeric(14,2) not null,
  currency   currency not null default 'usd',
  -- Obligatorio y no vacío: un movimiento de dinero sin motivo es exactamente
  -- lo que hace imposible defender una liquidación seis semanas después.
  reason     text not null,
  -- 'cancellation' | 'refund' | 'correction' | 'bonus' | 'clawback' | 'other'.
  reason_code text not null default 'correction',
  booking_id    uuid references booking(id) on delete set null,
  settlement_id uuid references settlement(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'commission_adjustment_reason_check') then
    alter table commission_adjustment add constraint commission_adjustment_reason_check
      check (length(btrim(reason)) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'commission_adjustment_code_check') then
    alter table commission_adjustment add constraint commission_adjustment_code_check
      check (reason_code in ('cancellation','refund','correction','bonus','clawback','other'));
  end if;
  -- Un ajuste de cero no ajusta nada y ensucia el expediente.
  if not exists (select 1 from pg_constraint where conname = 'commission_adjustment_nonzero_check') then
    alter table commission_adjustment add constraint commission_adjustment_nonzero_check
      check (amount <> 0);
  end if;
end $$;

create index if not exists commission_adjustment_commission_idx
  on commission_adjustment (commission_id);
create index if not exists commission_adjustment_org_idx
  on commission_adjustment (organization_id, created_at desc);
create index if not exists commission_adjustment_settlement_idx
  on commission_adjustment (settlement_id) where settlement_id is not null;

drop trigger if exists commission_adjustment_same_tenant on commission_adjustment;
create trigger commission_adjustment_same_tenant
before insert or update of organization_id, commission_id, booking_id, settlement_id
on commission_adjustment
for each row execute function app.enforce_same_tenant_refs(
  'commission_id', 'commission',
  'booking_id', 'booking',
  'settlement_id', 'settlement'
);

-- ── el ajuste tampoco se edita ─────────────────────────────────────────────
--
-- Un ajuste es la corrección: corregir la corrección editándola deja el
-- histórico diciendo que siempre fue así. Lo que procede es OTRO ajuste, que es
-- justo lo que esta tabla hace barato.
--
-- La única excepción es engancharlo a la liquidación que lo paga, porque eso
-- pasa después y no cambia ni el importe ni el motivo.
create or replace function app.commission_adjustment_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'commission_adjustment es un movimiento contable: no se borra (id=%)', old.id
      using errcode = '23514';
  end if;

  if old.organization_id is distinct from new.organization_id
     or old.commission_id is distinct from new.commission_id
     or old.amount        is distinct from new.amount
     or old.currency      is distinct from new.currency
     or old.reason        is distinct from new.reason
     or old.reason_code   is distinct from new.reason_code
     or old.booking_id    is distinct from new.booking_id
     or old.created_by    is distinct from new.created_by
     or old.created_at    is distinct from new.created_at then
    raise exception 'commission_adjustment: solo se puede enganchar a una liquidación; lo demás se corrige con otro ajuste (id=%)', old.id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists commission_adjustment_append_only on commission_adjustment;
create trigger commission_adjustment_append_only
before update or delete on commission_adjustment
for each row execute function app.commission_adjustment_append_only();

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'commission_adjustment' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.commission_adjustment');
  end if;
end $$;
