-- 0074 · PARTE 2 — la comprobación, con filas legibles.
select
  'columna partner_role'                                       as comprobacion,
  case when count(*) = 1 then 'OK' else 'FALTA' end            as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'organization_memberships'
  and column_name = 'partner_role'

union all

select
  'el disparador escucha también esa columna',
  case when pg_get_triggerdef(t.oid) like '%partner_role%' then 'OK' else 'FALTA' end
from pg_trigger t
where t.tgname = 'memberships_role_matches_org' and not t.tgisinternal

union all

select
  'tour centers sin nadie que los administre',
  case when count(*) = 0 then 'OK — ninguno'
       else count(*)::text || ' socio(s) SIN administrador — no podrán gestionar su equipo' end
from organizations o
where o.kind = 'partner'
  and not exists (
    select 1 from organization_memberships m
     where m.organization_id = o.id and m.partner_role = 'admin' and m.status = 'active'
  )
  -- Un socio sin NINGUNA membresía no cuenta: no es que le falte administrador,
  -- es que todavía no tiene a nadie.
  and exists (select 1 from organization_memberships m where m.organization_id = o.id)

union all

select
  'jerarquía de socio colgando de la operadora',
  case when count(*) = 0 then 'OK — ninguna' else count(*)::text || ' fila(s)' end
from organization_memberships m
join organizations o on o.id = m.organization_id
where o.kind is distinct from 'partner' and m.partner_role is not null;
