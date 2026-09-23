-- 0070 · PARTE 2 — la comprobación, con filas legibles.
--
-- «Success. No rows returned» no dice nada sobre si la columna quedó puesta.
select
  'columna service_date'                                            as comprobacion,
  case when count(*) = 1 then 'OK — existe' else 'FALTA' end        as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'commission' and column_name = 'service_date'

union all

select
  'índice por vendedor y período',
  case when count(*) = 1 then 'OK — creado' else 'FALTA' end
from pg_indexes
where schemaname = 'public' and indexname = 'commission_seller_service_idx'

union all

select
  'comisiones con fecha de servicio',
  count(*) filter (where service_date is not null)::text || ' de ' || count(*)::text
from commission

union all

-- Las que quedan sin fecha NO son un fallo: una comisión cuya reserva no tiene
-- salida (una cabecera de paquete, un servicio sin fecha) no tiene fecha de
-- servicio que copiar. Esto solo dice cuántas son, para que el número no
-- sorprenda al mirar la pantalla del vendedor.
select
  'sin fecha porque su reserva no tiene salida',
  count(*)::text
from commission c
left join booking b on b.id = c.booking_id
where c.service_date is null
  and (b.id is null or (b.departure_id is null and b.travel_date is null));
