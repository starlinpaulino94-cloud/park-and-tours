-- 0099 · parte 5 de 5 — verificación.
--
-- Seis filas. Cada una dice qué pasa si NO está bien.

with fn as (
  select p.proname as nombre, pg_get_functiondef(p.oid) as src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('reserve_departure_capacity', 'departure_pax_totals')
)
select 'la salida tiene dónde apuntar la plaza cogida' as comprobacion,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'departure'
                     and column_name in ('hold_pax', 'hold_until')) = 2
            then 'sí' else 'FALTAN departure.hold_pax / hold_until — no se aplicó la parte 1' end as resultado
union all
select 'la reserva serializa con cerrojo de fila',
       case when (select src from fn where nombre = 'reserve_departure_capacity') like '%for update%'
            then 'sí' else 'NO hay cerrojo: dos ventas de la última plaza pasan las dos' end
union all
select 'la reserva apunta en la retención, no en booked_pax',
       case when (select src from fn where nombre = 'reserve_departure_capacity') like '%hold_pax%'
            then 'sí' else 'SIGUE tocando booked_pax: el recálculo se lo borraría' end
union all
select 'la retención caduca sola',
       case when (select src from fn where nombre = 'reserve_departure_capacity') like '%hold_until <= now()%'
            then 'sí' else 'NO caduca: una venta muerta cerraría la salida para siempre' end
union all
select 'el recuento informa de las retenciones',
       case when (select src from fn where nombre = 'departure_pax_totals') like '%held%'
            then 'sí' else 'NO las informa: la pantalla ofrecería plazas que la reserva rechaza' end
union all
select 'y sigue sin poder llamarla el usuario anónimo',
       case when has_function_privilege('anon',
              'public.reserve_departure_capacity(uuid,integer,boolean)', 'execute')
            then 'NO — anon puede reservar plazas' else 'sí' end;
