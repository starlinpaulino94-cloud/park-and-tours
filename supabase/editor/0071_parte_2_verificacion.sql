-- 0071 · PARTE 2 — la comprobación, con filas legibles.
select 'columna created_by' as comprobacion,
       case when count(*) = 1 then 'OK — existe' else 'FALTA' end as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'seller_link' and column_name = 'created_by'
union all
select 'columna hits',
       case when count(*) = 1 then 'OK — existe' else 'FALTA' end
from information_schema.columns
where table_schema = 'public' and table_name = 'seller_link' and column_name = 'hits'
union all
select 'disparador del techo de enlaces',
       case when count(*) = 1 then 'OK — activo' else 'FALTA' end
from pg_trigger where tgname = 'seller_link_quota' and not tgisinternal
union all
select 'enlaces activos por vendedor (máximo actual)',
       coalesce(max(activos)::text, '0')
from (
  select count(*) as activos from seller_link
  where status = 'active' group by organization_id, seller_id
) t;
