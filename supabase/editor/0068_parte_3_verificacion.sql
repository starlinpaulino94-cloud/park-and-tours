-- ═══════════════════════════════════════════════════════════════════════════
-- 0068 · PARTE 3 de 3 — comprobar que quedó puesto
--
-- Pegar y darle a Run. DEVUELVE UNA TABLA de 8 filas: se leen una a una y
-- todas tienen que empezar por «OK».
--
-- Va como SELECT y no como bloque de comprobación a propósito: un bloque que
-- no falla deja «Success. No rows returned», que no dice si funcionó o si no
-- se comprobó nada. Una tabla que se lee sí lo dice.
-- ═══════════════════════════════════════════════════════════════════════════

with f as (
  select p.oid, p.prosecdef, p.prosrc, p.proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'custom_access_token_hook'
)
select '1 · tabla user_active_workspace' as comprobacion,
       case when to_regclass('public.user_active_workspace') is not null
            then 'OK — existe' else 'FALTA — repite la parte 1' end as resultado
union all
select '2 · RLS activada y forzada',
       case when (select relrowsecurity and relforcerowsecurity
                    from pg_class where oid = to_regclass('public.user_active_workspace'))
            then 'OK — activada y forzada'
            else 'FALTA — la tabla quedaría abierta' end
union all
select '3 · politicas de la tabla',
       coalesce((select 'OK — ' || count(*)::text || ' de 2'
                   from pg_policies
                  where schemaname = 'public' and tablename = 'user_active_workspace'
                    and policyname in ('active_workspace_self_select','active_workspace_self_write')
                 having count(*) = 2),
                'FALTA — repite la parte 1')
union all
select '4 · trigger de updated_at',
       coalesce((select 'OK — puesto'
                   from pg_trigger
                  where tgrelid = to_regclass('public.user_active_workspace')
                    and tgname = 'user_active_workspace_touch' and not tgisinternal),
                'FALTA — repite la parte 1')
union all
select '5 · el enganche es SECURITY DEFINER',
       case when (select prosecdef from f) then 'OK — definer'
            else 'FALTA — correria con la RLS puesta y GoTrue daria 500' end
union all
select '6 · search_path fijado',
       coalesce((select 'OK — ' || array_to_string(proconfig, ', ') from f),
                'FALTA — repite la parte 2')
union all
select '7 · el enganche LEE la empresa activa',
       case when (select prosrc like '%user_active_workspace%' from f)
            then 'OK — es la version 0068'
            else 'FALTA — sigue la version vieja: repite la parte 2' end
union all
select '8 · supabase_auth_admin puede ejecutarlo',
       case when (select has_function_privilege('supabase_auth_admin', oid, 'execute') from f)
            then 'OK — concedido'
            else 'FALTA — el login no podria firmar el token' end;
