-- ═══════════════════════════════════════════════════════════════════════════
-- LIMPIEZA · PARTE 3 de 3 — comprobar cómo quedó
--
-- Pegar y darle a Run. Devuelve una tabla que se lee de arriba abajo.
-- ═══════════════════════════════════════════════════════════════════════════

select '1 · la empresa e2e-tenant' as comprobacion,
       case when exists (select 1 from organizations where slug = 'e2e-tenant')
            then 'SIGUE AHÍ — algún cerrojo de la parte 2 saltó; mira la fila 2'
            else 'OK — borrada' end as resultado
union all
select '2 · por que no se borro (si sigue ahi)',
       coalesce(
         (select case
            when o.metadata->>'purpose' is distinct from 'e2e'
              then 'no lleva la marca purpose=e2e: comprueba que es la del E2E antes de forzar nada'
            when exists (select 1 from api_key x where x.organization_id = o.id)
              then 'tiene llaves de API: se irian en cascada, revisa antes'
            when exists (select 1 from organization_relationships x where x.from_org_id = o.id or x.to_org_id = o.id)
              then 'esta relacionada con otra empresa: revisa antes'
            when exists (select 1 from membego_user x where x.organization_id = o.id)
              then 'tiene usuarios de Membego: revisa antes'
            else 'los cerrojos pasan: si aun asi no se borro, Postgres devolvio un error de clave ajena — leelo, dice que tabla tiene datos'
          end
          from organizations o where o.slug = 'e2e-tenant'),
         'no aplica: ya no existe')
union all
select '3 · membresias huerfanas',
       case when exists (
              select 1 from organization_memberships m
               left join organizations o on o.id = m.organization_id
               where o.id is null)
            then 'HAY membresias sin empresa — avisa, no deberia pasar'
            else 'OK — ninguna' end
union all
select '4 · rastro de auditoria sin empresa',
       'informativo: ' || (select count(*)::text from audit_log where organization_id is null) ||
       ' fila(s). Las del E2E quedan aqui: audit_log va en SET NULL, no se borra'
union all
select '5 · tus empresas siguen intactas',
       'quedan ' || (select count(*)::text from organizations where kind = 'tenant') ||
       ' empresa(s) tenant: ' ||
       coalesce((select string_agg(name, ', ' order by name) from organizations where kind = 'tenant'), '(ninguna)');
