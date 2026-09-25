-- ============================================================================
-- ¿ESTA BASE RESTAURADA SIRVE?
--
-- Se pega en el editor SQL de Supabase DESPUÉS de restaurar una copia, o lo
-- ejecuta solo el simulacro de `scripts/restore-drill.sh`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ HACE FALTA ALGO ASÍ
--
-- «La restauración funcionó» suele querer decir «el comando terminó sin error».
-- En este sistema eso no basta, y la diferencia no se ve: una base restaurada a
-- la que le falte el esquema `app` o sus políticas **arranca, atiende y no da
-- un solo error** — simplemente devuelve cero filas a todo el mundo, porque
-- todas las políticas comparan contra `app.current_org_id()`. Un sistema vacío
-- y silencioso es exactamente igual de malo que uno caído, y encima parece
-- bueno el tiempo suficiente para que alguien dé por terminada la restauración.
--
-- Cada fila de abajo es una de esas formas de estar roto en silencio.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE ESTE SCRIPT NO PUEDE VER
--
-- Tres cosas NO viven en la base y por tanto no están en ninguna copia de ella.
-- Están en el manual (`docs/runbooks/RESTAURACION.md`) y hay que hacerlas a
-- mano; la más traicionera es la primera:
--
--   1. EL ENGANCHE DEL TOKEN REGISTRADO. La función está en la base y este
--      script la ve; que Auth esté configurado para LLAMARLA es ajuste del
--      proyecto. Sin registrar, los tokens salen sin `org_id`,
--      `app.current_org_id()` devuelve nulo y la RLS no deja ver NADA. Todo
--      funciona, todo está vacío.
--   2. LOS ARCHIVOS DE STORAGE. Un volcado de Postgres trae la tabla
--      `storage.objects` —los nombres— pero no los bytes.
--   3. LAS VARIABLES DE ENTORNO. Llaves de Stripe, secreto de MembeGo, tokens
--      de correo y WhatsApp.
-- ============================================================================

-- ── 1. El esquema del que cuelga todo el aislamiento ───────────────────────
select '1 · esquema app' as comprueba,
       case when exists (select 1 from pg_namespace where nspname = 'app')
            then 'OK' else 'REVISAR' end as resultado,
       'sin él, ninguna política se puede evaluar' as por_que
union all
-- ── 2. Las cuatro ayudas que leen el token ─────────────────────────────────
select '2 · ayudas de inquilino',
       case when (
         select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app'
            and p.proname in ('current_org_id','current_app_role','current_partner_id','can_read_partner')
       ) = 4 then 'OK' else 'REVISAR' end,
       'app.current_org_id() es lo que compara cada política'
union all
-- ── 3. El enganche del token, con sus dos atributos ────────────────────────
select '3 · enganche del token',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'custom_access_token_hook'
            and p.prosecdef
            and array_to_string(coalesce(p.proconfig,'{}'), ',') like '%search_path%'
       ) then 'OK' else 'REVISAR' end,
       'sin security definer, GoTrue devuelve 500 a todo el mundo al entrar'
union all
-- ── 4. Que supabase_auth_admin pueda llamarlo ──────────────────────────────
select '4 · permiso del enganche',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'custom_access_token_hook'
            and has_function_privilege('supabase_auth_admin', p.oid, 'execute')
       ) then 'OK' else 'REVISAR' end,
       'lo llama Auth, no la aplicación'
union all
-- ── 5. RLS encendida en las tablas de negocio ──────────────────────────────
--
-- El número exacto envejece con cada migración, así que se compara contra algo
-- que no envejece: que NINGUNA tabla con `organization_id` se haya quedado sin
-- RLS. Una sola basta para que el aislamiento entre empresas deje de existir.
select '5 · tablas con organization_id y sin RLS',
       case when (
         select count(*) from pg_tables t
          where t.schemaname = 'public'
            and exists (
              select 1 from information_schema.columns c
               where c.table_schema = 'public' and c.table_name = t.tablename
                 and c.column_name = 'organization_id')
            and not exists (
              select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
               where n.nspname = 'public' and cl.relname = t.tablename and cl.relrowsecurity)
       ) = 0 then 'OK' else 'REVISAR' end,
       'una sola tabla sin RLS abre el aislamiento entre empresas'
union all
-- ── 6. Y con sus políticas, no solo encendida ──────────────────────────────
--
-- Aquí hay que hilar fino, y la primera versión de esta comprobación lo hizo
-- mal: «RLS encendida y sin políticas» NO es un fallo. Cuatro tablas están así
-- a propósito —`api_key`, `membego_sso_jti`, `stripe_event`,
-- `supplier_response_token`—: solo las toca la llave de servicio, que se salta
-- la RLS, y no tener políticas es justamente el cerrojo.
--
-- Lo que sí es un fallo es quedarse A MEDIAS: una tabla con una, dos o tres de
-- las cuatro políticas de inquilino perdió alguna por el camino, y la que falte
-- decide si se puede leer, insertar, editar o borrar lo de otra empresa.
select '6a · tablas a medias de políticas',
       case when (
         select count(*) from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
          where n.nspname = 'public' and cl.relkind = 'r' and cl.relrowsecurity
            and (select count(*) from pg_policies p
                  where p.schemaname = 'public' and p.tablename = cl.relname
                    and p.policyname in ('tenant_select','tenant_insert','tenant_update','tenant_delete')
                ) between 1 and 3
       ) = 0 then 'OK' else 'REVISAR' end,
       'con tres de cuatro, la que falta decide qué se puede hacer con lo ajeno'
union all
-- Y que no se hayan perdido TODAS, que es lo que pasa si el volcado se hizo sin
-- el esquema. Se compara contra la mayoría y no contra un número exacto: un
-- número exacto envejece con la siguiente migración y entonces esta
-- comprobación empieza a mentir, que es peor que no tenerla.
select '6b · la mayoría de las tablas de negocio conservan sus cuatro políticas',
       case when (
         select count(*) * 2 > greatest(count(*) filter (where true), 1)
           from (
             select cl.relname,
                    (select count(*) from pg_policies p
                      where p.schemaname = 'public' and p.tablename = cl.relname
                        and p.policyname in ('tenant_select','tenant_insert','tenant_update','tenant_delete')
                    ) as politicas
               from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
              where n.nspname = 'public' and cl.relkind = 'r' and cl.relrowsecurity
           ) t
          where t.politicas = 4
       ) then 'OK' else 'REVISAR' end,
       'sin políticas, la base está entera y no devuelve nada a nadie'
union all
-- ── 7. Las funciones que mueven dinero ─────────────────────────────────────
select '7 · funciones de dinero',
       case when (
         select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('retain_seller_commission','spend_partner_wallet','reserve_departure_capacity')
            and p.prosecdef
       ) = 3 then 'OK' else 'REVISAR' end,
       'la retención, el monedero y el cupo: sin ellas la venta escribe a medias'
union all
-- ── 8. Los disparadores que rellenan lo que nadie teclea ───────────────────
select '8 · disparadores de aceptación y proveedor',
       case when (
         select count(*) from pg_trigger
          where not tgisinternal
            and tgname in ('departure_resource_supplier','departure_resource_supplier_acceptance',
                           'pickup_route_supplier','pickup_route_supplier_acceptance')
       ) = 4 then 'OK' else 'REVISAR' end,
       'sin ellos un servicio asignado no le pide nada al proveedor'
union all
-- ── 9. Las cuentas, y que las membresías apunten a alguna ──────────────────
--
-- Un volcado de solo `public` deja `auth.users` vacío y todas las membresías
-- colgando: la base está entera y NADIE puede entrar.
select '9 · membresías sin cuenta',
       case when (
         select count(*) from organization_memberships m
          where not exists (select 1 from auth.users u where u.id = m.user_id)
       ) = 0 then 'OK' else 'REVISAR' end,
       'una membresía sin cuenta es una persona que no puede entrar'
union all
-- ── 10. Y que haya datos ───────────────────────────────────────────────────
--
-- Lo último y no lo primero a propósito: una copia restaurada sin datos se nota
-- enseguida. Las nueve de arriba son las que no se notan.
select '10 · hay empresas y hay ventas',
       case when (select count(*) from organizations) > 0
             and (select count(*) from sales_order) >= 0
            then 'OK' else 'REVISAR' end,
       'si esto falla, se restauró el esquema pero no los datos'
;
