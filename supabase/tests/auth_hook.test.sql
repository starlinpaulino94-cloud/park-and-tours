-- ============================================================================
-- 0063 — El enganche que emite la sesión, llamado COMO LO LLAMA GOTRUE.
--
-- Esta prueba existe porque la que faltaba habría ahorrado una caída entera.
--
-- Había una comprobación de que `supabase_auth_admin` PUEDE ejecutar la función
-- (0020). Decía que sí, y era verdad: puede ejecutarla. Lo que nadie comprobaba
-- es qué pasa cuando la ejecuta — y lo que pasaba era una excepción, un 500 de
-- GoTrue y nadie capaz de iniciar sesión.
--
-- La diferencia entre las dos comprobaciones es la diferencia entre «tiene la
-- llave» y «la puerta abre».
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/auth_hook.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

\set org  '63630000-6363-6363-6363-636363636363'
\set user '63630000-0000-0000-0000-000000000001'

insert into auth.users (id, email) values (:'user', 'hook@ejemplo.do');

insert into organizations (id, name, kind, currency, tenant_org_id)
values (:'org', 'Operadora del enganche', 'tenant', 'usd', :'org');

insert into organization_memberships (user_id, organization_id, role, status, is_primary)
values (:'user', :'org', 'owner', 'active', true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Los atributos, que son la causa exacta de la caída
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  definer boolean;
  config  text[];
begin
  select p.prosecdef, p.proconfig into definer, config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'custom_access_token_hook';

  -- `create or replace function` no conserva lo que no se repite: una migración
  -- futura que reescriba el enganche y omita esta línea lo vuelve a romper.
  if not coalesce(definer, false) then
    raise exception 'el enganche no es SECURITY DEFINER: correrá con la RLS puesta';
  end if;

  if config is null or not exists (select 1 from unnest(config) c where c like 'search\_path=%') then
    raise exception 'el enganche no tiene search_path fijo';
  end if;

  raise notice 'atributos del enganche: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Y AHORA LA QUE IMPORTA: ejecutarlo con el rol de GoTrue
--
-- `supabase_auth_admin` no tiene acceso al esquema `auth`. Si el enganche deja
-- de ser SECURITY DEFINER, la RLS de `organization_memberships` se le aplica, su
-- política llama a `auth.uid()` y esto revienta con «permission denied for
-- schema auth» — que es, palabra por palabra, lo que rompió el inicio de sesión.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  salida jsonb;
  claims jsonb;
begin
  set local role supabase_auth_admin;

  salida := app.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '63630000-0000-0000-0000-000000000001',
      'claims', '{}'::jsonb
    )
  );

  reset role;

  claims := salida->'claims';

  -- Sin `org_id` el token no sirve de nada: la aplicación no sabe de qué empresa
  -- es quien entra y el layout lo devuelve a /login. Un enganche que no falla
  -- pero tampoco rellena esto deja al usuario fuera igual.
  if claims->>'org_id' is distinct from '63630000-6363-6363-6363-636363636363' then
    raise exception 'el enganche no puso org_id en el token: %', claims;
  end if;

  if claims->>'app_role' <> 'owner' then
    raise exception 'el enganche no puso el rol: %', claims;
  end if;

  -- 0046 añadió la sucursal, y es lo que aquella migración vino a hacer: tiene
  -- que seguir viajando después de restaurar los atributos.
  if not (claims ? 'branch_id') then
    raise exception 'el enganche dejó de enviar branch_id: %', claims;
  end if;

  raise notice 'ejecución del enganche como supabase_auth_admin: TODAS LAS ASERCIONES PASARON';
exception when others then
  reset role;
  raise;
end $$;

rollback;
