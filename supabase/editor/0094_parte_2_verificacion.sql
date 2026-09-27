-- ════════════════════════════════════════════════════════════════════════
-- 0094 · PARTE 2 — Verificación
--
-- Cinco filas. Las cinco tienen que decir OK.
--
-- La tercera es la importante: una función que existe pero corre como
-- invocador NO falla. Devuelve cero pasajeros —porque sin sesión la RLS no le
-- deja ver ninguna reserva— y la aplicación entiende «la salida está vacía,
-- caben todos». Es exactamente la sobreventa que esta migración vino a cerrar,
-- reabierta por un permiso mal puesto.
-- ════════════════════════════════════════════════════════════════════════

select 1 as orden, '1 · la función existe' as comprueba,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'departure_pax_totals'
  ) then 'OK' else 'REVISAR' end as resultado,
  'si FALTA, la aplicación no puede vender: falla al contar los pasajeros' as por_que

union all
select 2, '2 · recibe las dos listas de estados',
  case when (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'departure_pax_totals'
       and pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text[], text[]'
  ) = 1 then 'OK' else 'REVISAR' end,
  'qué cuenta como confirmada lo decide la aplicación, y viaja como argumento: dos copias de esa regla no'

union all
select 3, '3 · security definer con search_path fijado',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'departure_pax_totals'
       and p.prosecdef
       and array_to_string(coalesce(p.proconfig, '{}'), ',') like '%search_path%'
  ) then 'OK' else 'REVISAR' end,
  'si NO se creó como definer devuelve CERO pasajeros y la venta pasa siempre: la sobreventa, otra vez'

union all
select 4, '4 · anon no la puede ejecutar',
  case when not has_function_privilege('anon',
    'public.departure_pax_totals(uuid, uuid, text[], text[])', 'execute')
  then 'OK' else 'REVISAR' end,
  'se salta la RLS: un desconocido podría censar los pasajeros de cualquier salida de cualquier empresa'

union all
select 5, '5 · el rol de servicio sí',
  case when has_function_privilege('service_role',
    'public.departure_pax_totals(uuid, uuid, text[], text[])', 'execute')
  then 'OK' else 'REVISAR' end,
  'es quien la llama: el punto de venta, el motor público y la API del socio no tienen sesión'

order by orden;
