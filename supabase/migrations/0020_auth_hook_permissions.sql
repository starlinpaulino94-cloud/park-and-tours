-- ============================================================================
-- 0020 — Fix Supabase Auth custom access token hook permissions
--
-- Supabase Auth invokes this function as `supabase_auth_admin` through:
--   pg-functions://postgres/app/custom_access_token_hook
--
-- The hook must be SECURITY DEFINER so it can read tenancy tables while RLS is
-- enabled/forced, and supabase_auth_admin must have USAGE on schema app plus
-- EXECUTE on the hook function.
-- ============================================================================

grant usage on schema app to supabase_auth_admin;

create or replace function app.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public, app
as $$
declare
  claims jsonb := coalesce(event->'claims', '{}'::jsonb);
  uid uuid := (event->>'user_id')::uuid;
  m record;
begin
  select mem.role, mem.status, org.id as org_id, org.kind, org.tenant_org_id
    into m
    from organization_memberships mem
    join organizations org on org.id = mem.organization_id
   where mem.user_id = uid
     and mem.status = 'active'
   order by mem.is_primary desc, mem.created_at asc
   limit 1;

  if m.org_id is not null then
    claims := claims
      || jsonb_build_object('org_id', coalesce(m.tenant_org_id, m.org_id))
      || jsonb_build_object('app_role', m.role)
      || jsonb_build_object('status', m.status)
      || jsonb_build_object('partner_id',
           case when m.kind = 'partner' then m.org_id else null end);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

revoke all on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin, service_role;

-- Verification: fail if Supabase Auth cannot see/execute the hook.
do $$
begin
  if not has_schema_privilege('supabase_auth_admin', 'app', 'USAGE') then
    raise exception 'supabase_auth_admin lacks USAGE on schema app';
  end if;

  if not has_function_privilege('supabase_auth_admin', 'app.custom_access_token_hook(jsonb)', 'EXECUTE') then
    raise exception 'supabase_auth_admin lacks EXECUTE on app.custom_access_token_hook(jsonb)';
  end if;
end $$;
