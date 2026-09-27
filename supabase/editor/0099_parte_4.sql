-- 0099 · parte 4 de 4 — el recuento informa de las retenciones
--
-- QUÉ ARREGLA. Treinta ventas simultáneas de una plaza contra una salida de
-- capacidad 10, por el camino que usaba la aplicación: 19 reservas. Nueve
-- pasajeros con asiento que no existe. La venta leía el cupo, decidía fuera y
-- escribía después, sin nada que serializara.
--
-- Ahora la plaza se COGE con cerrojo de fila antes de venderla, y la retención
-- caduca sola a los dos minutos para que una venta muerta no cierre la salida.
--
-- Las partes van EN ORDEN. Aplicar solo la 1 no rompe nada (la columna es
-- aditiva); parar antes de la 4 deja la pantalla sin saber de las retenciones.

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
