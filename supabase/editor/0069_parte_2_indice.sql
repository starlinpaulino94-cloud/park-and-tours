-- 0069 · PARTE 2 — el índice, y la comprobación de que quedó puesto.
--
-- Ejecutar solo si la PARTE 1 devolvió 0 filas.
create unique index if not exists seller_user_unique_idx
  on seller (organization_id, user_id)
  where user_id is not null;

-- La comprobación devuelve filas legibles a propósito: «Success. No rows
-- returned» no dice nada sobre si el índice existe.
select
  'índice único cuenta→ficha'                        as comprobacion,
  case when count(*) = 1 then 'OK — creado' else 'FALTA' end as resultado
from pg_indexes
where schemaname = 'public' and indexname = 'seller_user_unique_idx'

union all

select
  'vendedores con cuenta vinculada',
  count(*)::text || ' de ' || (select count(*) from seller)::text || ' fichas'
from seller
where user_id is not null;
