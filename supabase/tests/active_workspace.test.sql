-- ============================================================================
-- 0068 — EL ENGANCHE PREFIERE LA EMPRESA ACTIVA, PERO SOLO SI SIGUE VALIENDO.
--
-- Es la prueba que faltaba en 0014: el selector cambiaba una cookie pero no el
-- token, así que el panel (que compara contra el org_id del JWT) seguía en la
-- empresa vieja. Aquí se comprueba, llamando al enganche COMO LO LLAMA GOTRUE,
-- que el org_id del token pasa a ser la empresa activa —y que una fila que dejó
-- de tener membresía no da acceso a nada—.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/active_workspace.test.sql
-- Transaccional: hace rollback, no deja datos.
-- ============================================================================
begin;

\set user '68680000-0000-0000-0000-000000000001'
\set orgA '68680000-6363-6363-6363-00000000000a'
\set orgB '68680000-6363-6363-6363-00000000000b'

insert into auth.users (id, email) values (:'user', 'switch@ejemplo.do');
insert into organizations (id, name, kind, currency, tenant_org_id) values
  (:'orgA', 'Empresa Principal', 'tenant', 'usd', :'orgA'),
  (:'orgB', 'Empresa Demostracion', 'tenant', 'usd', :'orgB');
insert into organization_memberships (user_id, organization_id, role, status, is_primary) values
  (:'user', :'orgA', 'owner', 'active', true),
  (:'user', :'orgB', 'owner', 'active', false);

-- Helper local: el org_id que el enganche pondría en el token.
create or replace function pg_temp.org_del_token() returns uuid language sql as $$
  select (app.custom_access_token_hook(
    jsonb_build_object('user_id', '68680000-0000-0000-0000-000000000001', 'claims', '{}'::jsonb)
  ) -> 'claims' ->> 'org_id')::uuid
$$;

do $$
begin
  -- 1) Sin empresa activa elegida: aterriza en la PRINCIPAL (A).
  if pg_temp.org_del_token() <> '68680000-6363-6363-6363-00000000000a' then
    raise exception 'sin seleccion, el token deberia llevar la empresa principal';
  end if;

  -- 2) Elige la B en el selector: el token pasa a la B.
  insert into user_active_workspace (user_id, organization_id)
    values ('68680000-0000-0000-0000-000000000001', '68680000-6363-6363-6363-00000000000b');
  if pg_temp.org_del_token() <> '68680000-6363-6363-6363-00000000000b' then
    raise exception 'con la B elegida, el token deberia llevar la B';
  end if;

  -- 3) Si pierde la membresia en B (se desactiva), la fila activa deja de valer
  --    y el token vuelve a la principal. Es la garantia de seguridad.
  update organization_memberships set status = 'inactive'
    where user_id = '68680000-0000-0000-0000-000000000001'
      and organization_id = '68680000-6363-6363-6363-00000000000b';
  if pg_temp.org_del_token() <> '68680000-6363-6363-6363-00000000000a' then
    raise exception 'sin membresia activa en B, el token no puede quedarse en B';
  end if;

  -- 4) Reactivar B y volver a la principal borrando la fila activa: token = A.
  update organization_memberships set status = 'active'
    where user_id = '68680000-0000-0000-0000-000000000001'
      and organization_id = '68680000-6363-6363-6363-00000000000b';
  delete from user_active_workspace where user_id = '68680000-0000-0000-0000-000000000001';
  if pg_temp.org_del_token() <> '68680000-6363-6363-6363-00000000000a' then
    raise exception 'tras borrar la seleccion, el token deberia volver a la principal';
  end if;

  raise notice 'empresa activa en el token: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
