-- ═══════════════════════════════════════════════════════════════════════════
-- 0054 — QUE EL CUPO DEL SOCIO ACOTE ALGO
--
-- POR QUÉ
--
-- `allotment` existe desde 0010 con todo lo que hace falta —plazas contratadas,
-- plazas usadas, plazas liberadas, días de liberación, tipo de cupo, días de la
-- semana— y NADIE la leía nunca. Era una pantalla de alta que guardaba filas
-- que no acotaban nada.
--
-- Lo que pasaba de verdad en una operadora con agencias: se le prometían 10
-- plazas garantizadas a una agencia por contrato, y el sistema le dejaba vender
-- las 40 de la salida o ninguna, según la suerte. El cupo se llevaba en un
-- Excel y se revisaba por WhatsApp la mañana de la salida.
--
-- Y el otro lado del mismo problema: `release_days` —«te guardo 10 plazas hasta
-- 3 días antes, lo que no vendas vuelve a venta libre»— no liberaba nunca. Un
-- cupo garantizado que el socio no usa se quedaba bloqueado hasta la salida, y
-- esas plazas se perdían.
--
-- QUÉ AÑADE
--
-- El rastro que falta para que consumir y devolver plazas sea reversible, y
-- nada más. Las reglas de qué cupo aplica y cuándo se libera viven en
-- `src/lib/allotments.ts`, que es puro y se prueba entero.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── qué cupo consumió cada reserva ─────────────────────────────────────────
--
-- Sin este enlace, cancelar una reserva no puede devolverle la plaza a SU cupo:
-- habría que adivinar cuál era, y si el contrato cambió de temporada entre la
-- venta y la cancelación se le devolvería al equivocado.
alter table booking
  add column if not exists allotment_id uuid references allotment(id) on delete set null,
  -- Cuántas plazas de ese cupo consumió. Se congela: si el cupo se renegocia,
  -- la devolución tiene que ser de lo que se tomó, no de lo que dice hoy.
  add column if not exists allotment_seats integer check (allotment_seats is null or allotment_seats >= 0);

create index if not exists booking_allotment_idx
  on booking (organization_id, allotment_id) where allotment_id is not null;

-- ── el rastro de la liberación ─────────────────────────────────────────────
alter table allotment
  add column if not exists released_at timestamptz,
  -- Cuántas veces se ha barrido este cupo. Un cupo que se libera dos veces por
  -- un reintento del cron devolvería plazas que ya estaban en venta libre.
  add column if not exists release_runs integer not null default 0,
  -- El comercial necesita saber quién cerró un cupo y cuándo, porque la
  -- siguiente llamada es de la agencia preguntando por qué no puede vender.
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references auth.users(id) on delete set null;

create index if not exists allotment_release_idx
  on allotment (organization_id, allotment_type, released_at)
  where allotment_type = 'guaranteed';

create index if not exists allotment_departure_idx on allotment (departure_id)
  where departure_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'allotment_release_runs_check') then
    alter table allotment add constraint allotment_release_runs_check check (release_runs >= 0);
  end if;
end $$;

drop trigger if exists booking_allotment_same_tenant on booking;
create trigger booking_allotment_same_tenant
before insert or update of organization_id, allotment_id on booking
for each row execute function app.enforce_same_tenant_refs('allotment_id', 'allotment');
