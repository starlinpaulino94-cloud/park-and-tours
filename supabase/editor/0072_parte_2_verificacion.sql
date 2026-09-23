-- 0072 · PARTE 2 — la comprobación, con filas legibles.
select
  'la función ya no mira el nombre del rol'                     as comprobacion,
  case when pg_get_functiondef(p.oid) like '%current_app_role%'
       then 'FALTA — sigue mirando el rol'
       else 'OK — mira el identificador' end                    as resultado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'app' and p.proname = 'can_read_partner'

union all

select
  'políticas que la usan (cambian todas a la vez)',
  count(*)::text || ' tabla(s)'
from pg_policies
where schemaname = 'public' and qual like '%can_read_partner%';
