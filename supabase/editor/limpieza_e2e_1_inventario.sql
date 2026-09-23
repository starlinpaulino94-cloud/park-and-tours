-- ═══════════════════════════════════════════════════════════════════════════
-- LIMPIEZA · PARTE 1 de 3 — QUÉ HAY COLGANDO DE `e2e-tenant`
--
-- SOLO LEE. No borra nada. Pegar y darle a Run.
--
-- ───────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTA PARTE NO ES OPCIONAL
--
-- Al mirar el esquema, 101 tablas apuntan a `organizations` con RESTRICT: si la
-- empresa tuviera reservas, órdenes o facturas, el borrado se bloquearía solo.
-- Pero hay OTRAS 15 que van en CASCADE y desaparecen sin avisar:
--
--   api_key · organization_relationships · system_incident · job_run
--   organization_memberships · user_active_workspace · allotment
--   commission_rule · price_rule · membego_user · membego_customer
--   membego_event · membego_link · membego_redemption
--
-- Y `audit_log` va en SET NULL: sus filas NO se borran, pero pierden la empresa.
-- O sea, el rastro de auditoría del E2E se queda ahí, huérfano. Es inofensivo,
-- pero conviene saberlo antes y no descubrirlo después.
--
-- Así que esto se mira ANTES. Si sale algo que no esperas —una api_key, una
-- relación entre empresas—, para y pregunta en vez de borrar.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 · ¿Existe, y es de verdad la del E2E?
select 'la empresa' as que,
       o.id::text as detalle,
       o.name || ' [' || o.slug || ']' as nombre,
       coalesce(o.metadata->>'purpose', '(sin marca)') as proposito,
       o.created_at::date::text as creada
  from organizations o
 where o.slug = 'e2e-tenant';

-- 2 · Quién tiene membresía en ella. IMPORTANTE: apunta estos correos.
--     Al borrar la empresa, las membresías se van en cascada y ya no habrá
--     forma de saber qué cuenta estaba enganchada.
select 'membresias' as que, u.email, m.role, m.status, m.is_primary
  from organization_memberships m
  join auth.users u on u.id = m.user_id
 where m.organization_id = (select id from organizations where slug = 'e2e-tenant');

-- 3 · Todo lo que cuelga, tabla por tabla. Lo normal es ver solo
--     `organization_memberships` y quizá `audit_log`.
select t.table_name as tabla,
       (xpath('/row/c/text()', t.conteo))[1]::text::bigint as filas
  from (
    select c.table_name,
           query_to_xml(
             format('select count(*) as c from public.%I where organization_id = %L',
                    c.table_name,
                    (select id from organizations where slug = 'e2e-tenant')),
             false, true, '') as conteo
      from information_schema.columns c
      join information_schema.tables ta
        on ta.table_schema = c.table_schema and ta.table_name = c.table_name
     where c.table_schema = 'public'
       and c.column_name = 'organization_id'
       and ta.table_type = 'BASE TABLE'
  ) t
 where (xpath('/row/c/text()', t.conteo))[1]::text::bigint > 0
 order by 2 desc, 1;
