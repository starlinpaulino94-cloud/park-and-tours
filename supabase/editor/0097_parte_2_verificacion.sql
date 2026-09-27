-- 0097 · parte 2 de 2 — verificación.
--
-- Cinco filas. Cada una dice qué pasa si NO está bien.

with def as (
  select pg_get_functiondef(p.oid) as src, p.prosecdef,
         array_to_string(coalesce(p.proconfig, '{}'), ',') as cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enforce_same_tenant_refs'
)
select 'la función existe' as comprobacion,
       case when (select count(*) from def) = 1 then 'sí'
            else 'FALTA app.enforce_same_tenant_refs' end as resultado
union all
select 'ya no pregunta dos veces por la fila padre',
       case when (select src from def) like '%exists(select 1 from%'
            then 'SIGUE AHÍ la consulta doble — no se aplicó 0097' else 'sí' end
union all
select 'sigue resolviendo tenant_org_id (0095)',
       case when (select src from def) like '%tenant_org_id%' then 'sí'
            else 'NO se resuelve: la caja de un socio volvería a romperse' end
union all
select 'sigue siendo security definer',
       case when (select prosecdef from def) then 'sí'
            else 'NO — un cruce de inquilinos se leería como fila inexistente' end
union all
select 'los disparadores de 0095 siguen colgados',
       case when (select count(*) from pg_trigger t
                    where not t.tgisinternal
                      and t.tgfoid = 'app.enforce_same_tenant_refs'::regproc) >= 17
            then 'sí'
            else format('solo hay %s: FALTAN disparadores de 0095',
                        (select count(*) from pg_trigger t
                           where not t.tgisinternal
                             and t.tgfoid = 'app.enforce_same_tenant_refs'::regproc)) end;
