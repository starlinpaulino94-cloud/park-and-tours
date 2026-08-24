-- ============================================================================
-- 0019 — Harden function EXECUTE privileges for anon/public
--
-- 0001 originally granted EXECUTE on future app.* functions to anon so RLS helper
-- functions could be evaluated. 0017 revoked future defaults, but existing app
-- functions still need explicit cleanup. Anonymous callers should not be able to
-- invoke app-owned helpers directly; authenticated users may execute only the
-- read/path helpers that RLS policies depend on.
-- ============================================================================

-- Keep future functions closed by default for anonymous callers.
alter default privileges in schema app revoke execute on functions from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;

-- JWT/RLS read helpers: used by policies for authenticated sessions.
revoke execute on function app.current_org_id() from anon, public;
revoke execute on function app.current_app_role() from anon, public;
revoke execute on function app.current_partner_id() from anon, public;
revoke execute on function app.can_read_partner(uuid) from anon, public;

grant execute on function app.current_org_id() to authenticated, service_role;
grant execute on function app.current_app_role() to authenticated, service_role;
grant execute on function app.current_partner_id() to authenticated, service_role;
grant execute on function app.can_read_partner(uuid) to authenticated, service_role;

-- Migration/setup helper: never callable by anon/authenticated at runtime.
revoke execute on function app.enable_tenant_rls(regclass, boolean) from anon, public, authenticated;
grant execute on function app.enable_tenant_rls(regclass, boolean) to service_role;

-- Trigger helpers: not directly callable by clients.
revoke execute on function app.touch_updated_at() from anon, public, authenticated;
revoke execute on function app.enforce_same_tenant_refs() from anon, public, authenticated;
grant execute on function app.touch_updated_at() to service_role;
grant execute on function app.enforce_same_tenant_refs() to service_role;

-- Storage policy helpers: authenticated sessions need them through policies;
-- anon can read public-assets through storage policies without direct EXECUTE.
revoke execute on function app.storage_org_ok(text) from anon, public;
revoke execute on function app.storage_partner_ok(text) from anon, public;
revoke execute on function app.storage_can_write(text) from anon, public;

grant execute on function app.storage_org_ok(text) to authenticated, service_role;
grant execute on function app.storage_partner_ok(text) to authenticated, service_role;
grant execute on function app.storage_can_write(text) to authenticated, service_role;

-- Auth hook: Supabase Auth must be able to execute it, but anon/public must not.
revoke execute on function app.custom_access_token_hook(jsonb) from anon, public;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin, service_role;

-- Capacity RPCs were hardened in 0017; keep the revocation here as defense in
-- depth in case this migration is applied to a partially patched database.
revoke execute on function public.reserve_departure_capacity(uuid, integer, boolean) from anon, public;
revoke execute on function public.release_departure_capacity(uuid, integer) from anon, public;
grant execute on function public.reserve_departure_capacity(uuid, integer, boolean) to authenticated, service_role;
grant execute on function public.release_departure_capacity(uuid, integer) to authenticated, service_role;

-- Assertion: no app-owned SECURITY DEFINER function may be executable by anon.
do $$
declare n integer;
begin
  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'app'
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  if n > 0 then
    raise exception 'Quedan % funciones app SECURITY DEFINER ejecutables por anon', n;
  end if;
end $$;
