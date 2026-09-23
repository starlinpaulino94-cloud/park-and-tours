-- 0073 · PARTE 2 — la comprobación, con filas legibles.
--
-- «Success. No rows returned» no dice nada. Esto devuelve una fila por
-- comprobación, con OK o FALTA escrito.
select
  'columnas de condiciones aceptadas'                          as comprobacion,
  case when count(*) = 4 then 'OK — las 4'
       else 'FALTAN — solo ' || count(*)::text end             as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'organization_relationships'
  and column_name in ('terms_version','terms_accepted_version','terms_accepted_at','terms_accepted_by')

union all

select
  'disparador del cerrojo del rol',
  case when count(*) = 1 then 'OK — instalado' else 'FALTA' end
from pg_trigger
where tgname = 'memberships_role_matches_org' and not tgisinternal

union all

select
  'la función cierra las DOS puertas',
  case when pg_get_functiondef(p.oid) like '%new.role <> ''partner''%'
        and pg_get_functiondef(p.oid) like '%new.role = ''partner''%'
       then 'OK — socio con rol interno, y rol de socio sin socio'
       else 'FALTA — solo cierra una' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'app' and p.proname = 'membership_role_matches_org'

union all

select
  'membresías que incumplen (ver parte 0)',
  count(*)::text || ' fila(s)'
from organization_memberships m
join organizations o on o.id = m.organization_id
where (o.kind = 'partner' and m.role <> 'partner')
   or (o.kind is distinct from 'partner' and m.role = 'partner');
