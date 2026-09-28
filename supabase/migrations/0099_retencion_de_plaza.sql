-- ═══════════════════════════════════════════════════════════════════════════
-- 0099 — LA PLAZA SE RETIENE ANTES DE VENDERLA (F-001, sobreventa por carrera)
--
-- ───────────────────────────────────────────────────────────────────────────
-- LO MEDIDO
--
-- Treinta ventas simultáneas de una plaza contra una salida de capacidad 10,
-- por el camino que usa la aplicación —`departure_pax_totals` para leer,
-- decidir en el cliente, insertar después—: **19 reservas vendidas**. Nueve
-- pasajeros con asiento que no existe, y el mostrador enterándose el día de la
-- excursión.
--
-- No es una sorpresa del planificador: es comprobar-y-actuar sin nada que
-- serialice. Entre la lectura y la inserción caben todas las ventas que quepan
-- en ese milisegundo.
--
-- ───────────────────────────────────────────────────────────────────────────
-- LO QUE YA EXISTÍA
--
-- `reserve_departure_capacity` está en 0008, escrita literalmente para cerrar
-- esto, con su `for update` y todo; endurecida en 0017 y 0019; citada como
-- precedente por 0083 y 0091. La misma carrera contra ella da **exactamente
-- 10**. Lo único que le faltaba era que alguien la llamara.
--
-- ───────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO BASTABA CON LLAMARLA
--
-- Porque hay DOS autoridades sobre el mismo número. `reserve_...` incrementa
-- `booked_pax`, y `recalculateDeparture` lo REESCRIBE contando las reservas
-- vivas. Entre que una venta reserva y escribe su fila, cualquier recálculo de
-- otra venta le borraba la reserva — y la carrera volvía por la puerta de al
-- lado.
--
-- Así que la reserva deja de ser un incremento del contador y pasa a ser lo que
-- de verdad es: una RETENCIÓN con caducidad, en su propia columna.
--
--   · `hold_pax`   — plazas retenidas y todavía sin fila de reserva.
--   · `hold_until` — cuándo dejan de valer. Pasada esa hora, `hold_pax` es cero
--                    aunque nadie lo haya limpiado: un proceso que muere a
--                    mitad de venta no puede dejar una salida cerrada para
--                    siempre.
--
-- El reconciliador cuenta reservas y no toca la retención; la retención se
-- suelta en cuanto la fila existe (o si la venta se cae). Lo que ocupa una
-- plaza es «reservas + retenciones vivas», y las dos mitades las escribe quien
-- sabe de ellas.
--
-- El sesgo, cuando hay duda, es a RECHAZAR: una retención que sobra deja una
-- plaza sin vender durante dos minutos; una que falta vende una plaza que no
-- existe. Lo primero se arregla solo; lo segundo se arregla en el aeropuerto.
-- ═══════════════════════════════════════════════════════════════════════════

alter table departure
  add column if not exists hold_pax   integer     not null default 0,
  add column if not exists hold_until timestamptz;

comment on column departure.hold_pax is
  'Plazas RETENIDAS por una venta en curso que todavia no escribio su reserva. Ocupan sitio mientras `hold_until` no haya pasado. El reconciliador NO las toca: las escribe reserve_departure_capacity y las suelta release_departure_capacity.';
comment on column departure.hold_until is
  'Cuando caducan las retenciones de `hold_pax`. Pasada esta hora cuentan como cero aunque nadie las haya limpiado: una venta que muere a medias no puede cerrar la salida para siempre.';

-- ── la retención ───────────────────────────────────────────────────────────
create or replace function public.reserve_departure_capacity(
  p_departure_id uuid,
  p_pax integer,
  p_override boolean default false
) returns boolean
  language plpgsql security definer set search_path = public, app
as $$
declare
  d record;
  v_retenidas integer;
  -- Sin JWT (conexión directa del servidor / ETL) el llamante es de confianza.
  v_role text := coalesce(auth.jwt() ->> 'role', 'service_role');
  -- Dos minutos: de sobra para que la venta escriba sus filas, y poco para que
  -- una venta muerta no bloquee la plaza más que un rato.
  RETENCION constant interval := interval '2 minutes';
begin
  if p_pax is null or p_pax < 1 then
    raise exception 'pax must be >= 1 (got %)', p_pax using errcode = 'check_violation';
  end if;

  -- Cerrojo de fila: aquí se serializan las ventas de la MISMA salida. Las de
  -- salidas distintas no se estorban.
  select id, organization_id, capacity, booked_pax, pending_pax, status, hold_pax, hold_until
    into d from departure where id = p_departure_id for update;

  if not found then
    raise exception 'departure % not found', p_departure_id using errcode = 'no_data_found';
  end if;

  -- FALLA CERRADA (0017): quien no sea service_role tiene que traer org_id y
  -- tiene que coincidir.
  if v_role <> 'service_role'
     and (app.current_org_id() is null or d.organization_id <> app.current_org_id()) then
    raise exception 'departure % is outside your organization', p_departure_id
      using errcode = 'insufficient_privilege';
  end if;

  if d.status in ('cancelled','closed','completed') then
    raise exception 'departure % is % and cannot take bookings', p_departure_id, d.status
      using errcode = 'check_violation';
  end if;

  -- Una retención caducada no ocupa. Se evalúa aquí y no con un barrido: así
  -- no depende de que ningún cron esté vivo.
  v_retenidas := case
    when d.hold_until is null or d.hold_until <= now() then 0
    else coalesce(d.hold_pax, 0) end;

  if d.capacity > 0 and not p_override
     and (d.booked_pax + d.pending_pax + v_retenidas + p_pax) > d.capacity then
    return false;
  end if;

  update departure
     set hold_pax   = v_retenidas + p_pax,
         hold_until = now() + RETENCION,
         updated_at = now()
   where id = p_departure_id;

  return true;
end;
$$;

-- ── soltarla ───────────────────────────────────────────────────────────────
--
-- Se suelta en dos momentos: cuando la reserva ya está escrita —y entonces la
-- cuenta el reconciliador— y cuando la venta se cae. No hacerlo no rompe nada,
-- solo deja la plaza cogida hasta que caduque; hacerlo devuelve la plaza al
-- instante, que es lo que el siguiente cliente en el mostrador merece.
create or replace function public.release_departure_capacity(
  p_departure_id uuid,
  p_pax integer
) returns void
  language plpgsql security definer set search_path = public, app
as $$
declare
  d record;
  v_retenidas integer;
  v_role text := coalesce(auth.jwt() ->> 'role', 'service_role');
begin
  if p_pax is null or p_pax < 1 then
    raise exception 'pax must be >= 1 (got %)', p_pax using errcode = 'check_violation';
  end if;

  select id, organization_id, hold_pax, hold_until
    into d from departure where id = p_departure_id for update;

  if not found then
    raise exception 'departure % not found', p_departure_id using errcode = 'no_data_found';
  end if;

  if v_role <> 'service_role'
     and (app.current_org_id() is null or d.organization_id <> app.current_org_id()) then
    raise exception 'departure % is outside your organization', p_departure_id
      using errcode = 'insufficient_privilege';
  end if;

  v_retenidas := case
    when d.hold_until is null or d.hold_until <= now() then 0
    else coalesce(d.hold_pax, 0) end;

  update departure
     set hold_pax = greatest(0, v_retenidas - p_pax),
         updated_at = now()
   where id = p_departure_id;
end;
$$;

-- `create or replace` restablece los privilegios por defecto: revocar DESPUÉS.
revoke execute on function public.reserve_departure_capacity(uuid, integer, boolean) from anon, public;
revoke execute on function public.release_departure_capacity(uuid, integer)          from anon, public;
grant  execute on function public.reserve_departure_capacity(uuid, integer, boolean) to authenticated, service_role;
grant  execute on function public.release_departure_capacity(uuid, integer)          to authenticated, service_role;

-- ── el recuento le suma la retención viva ──────────────────────────────────
--
-- `departure_pax_totals` (0094) es lo que la aplicación usa para saber cuánto
-- queda. Si no contara las retenciones, la pantalla ofrecería una plaza que la
-- reserva atómica va a rechazar, y el vendedor vería «quedan 2» y un error al
-- pulsar. Se devuelve aparte, no sumada a `booked`: son cosas distintas y el
-- despacho necesita distinguirlas.
create or replace function public.departure_pax_totals(
  p_org uuid,
  p_departure uuid,
  p_confirmed text[],
  p_pending text[]
) returns jsonb
  language sql
  stable
  security definer
  set search_path = public, app
as $$
  -- `coalesce` con el objeto de «no existe»: una salida ausente tiene que
  -- decir `found: false` y NO ceros —ceros querrían decir «caben todos» sobre
  -- algo que no está—, y tampoco nulo, que obligaría a cada llamante a
  -- distinguir «no hay fila» de «no se pudo consultar». Es el contrato de 0094
  -- y aquí solo se le añade `held`.
  select coalesce((
  select jsonb_build_object(
    'found',    true,
    'capacity', coalesce(d.capacity, 0),
    'booked',   coalesce((select sum(coalesce(b.pax_total, 0)) from booking b
                           where b.departure_id = d.id
                             and b.organization_id = p_org
                             and b.status = any(p_confirmed)), 0),
    'pending',  coalesce((select sum(coalesce(b.pax_total, 0)) from booking b
                           where b.departure_id = d.id
                             and b.organization_id = p_org
                             and b.status = any(p_pending)), 0),
    'held',     case when d.hold_until is null or d.hold_until <= now()
                     then 0 else coalesce(d.hold_pax, 0) end
  )
    from departure d
   where d.id = p_departure and d.organization_id = p_org
  ), jsonb_build_object('found', false));
$$;

revoke execute on function public.departure_pax_totals(uuid, uuid, text[], text[]) from anon, public;
grant  execute on function public.departure_pax_totals(uuid, uuid, text[], text[]) to service_role;

do $$
declare
  v_src text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'departure'
                    and column_name = 'hold_pax') then
    raise exception '0099: falta departure.hold_pax: la retención no tendría dónde vivir';
  end if;

  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reserve_departure_capacity';

  if v_src is null then
    raise exception '0099: reserve_departure_capacity no existe';
  end if;
  if position('for update' in v_src) = 0 then
    raise exception '0099: reserve_departure_capacity perdió su cerrojo de fila: la carrera vuelve';
  end if;
  if position('hold_pax' in v_src) = 0 then
    raise exception '0099: reserve_departure_capacity sigue incrementando booked_pax: el reconciliador se lo borraría';
  end if;

  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'departure_pax_totals';
  if position('held' in v_src) = 0 then
    raise exception '0099: departure_pax_totals no informa de las retenciones: la pantalla ofrecería plazas que la reserva va a rechazar';
  end if;

  raise notice '0099: la plaza se retiene antes de venderla';
end $$;
