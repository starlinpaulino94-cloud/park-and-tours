-- 0076 · PARTE 2 — la comprobación, con filas legibles.
select
  'columnas de la disputa'                                     as comprobacion,
  case when count(*) = 4 then 'OK — las 4'
       else 'FALTAN — solo ' || count(*)::text end             as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'settlement'
  and column_name in ('dispute_reason','disputed_at','disputed_by','dispute_assignee')

union all

select
  'índice de las que están en disputa',
  case when count(*) = 1 then 'OK' else 'FALTA' end
from pg_indexes
where schemaname = 'public' and indexname = 'settlement_disputed_idx'

union all

-- Después de usarlo un tiempo: las disputas que nadie tiene asignadas son las
-- que se quedan sin contestar. Cero es lo deseable.
select
  'disputas abiertas SIN destinatario',
  case when count(*) = 0 then 'OK — ninguna'
       else count(*)::text || ' sin nadie asignado' end
from settlement
where status = 'disputed' and dispute_assignee is null;
