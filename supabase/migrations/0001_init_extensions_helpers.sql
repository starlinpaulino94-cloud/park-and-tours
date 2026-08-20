-- ============================================================================
-- 0001 — Extensions, helper schema, RLS helpers, shared triggers
-- Migration M1 (Totalum → Supabase). Greenfield schema; data arrives in M5 ETL.
-- ============================================================================

create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists citext;         -- case-insensitive email/slug

create schema if not exists app;

-- ── JWT claim accessors ────────────────────────────────────────────────────
-- Claims are injected by app.custom_access_token_hook (see 0002). We namespace
-- the business role as `app_role` because the top-level `role` claim is reserved
-- by PostgREST for the database role (authenticated / anon / service_role).

create or replace function app.current_org_id() returns uuid
  language sql stable as $$
    select nullif(auth.jwt() ->> 'org_id', '')::uuid
  $$;

create or replace function app.current_app_role() returns text
  language sql stable as $$
    select auth.jwt() ->> 'app_role'
  $$;

create or replace function app.current_partner_id() returns uuid
  language sql stable as $$
    select nullif(auth.jwt() ->> 'partner_id', '')::uuid
  $$;

-- Partner-role users only see rows belonging to their own partner org; every
-- other role sees all rows within the tenant (the org policy still applies).
create or replace function app.can_read_partner(row_partner uuid) returns boolean
  language sql stable as $$
    select app.current_app_role() is distinct from 'partner'
        or row_partner = app.current_partner_id()
  $$;

-- ── Reusable tenant RLS ─────────────────────────────────────────────────────
-- Applies the standard org-scoped policies to a business table. `partner_scoped`
-- adds the partner filter on SELECT for partner-role users. Writes are gated by
-- org match here AND by the application RBAC layer (requireAtLeast / writeRole);
-- superadmin cross-tenant flows run under service_role, which bypasses RLS.
create or replace function app.enable_tenant_rls(tbl regclass, partner_scoped boolean default false)
  returns void language plpgsql as $$
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('alter table %s force row level security', tbl);

  execute format(
    'create policy tenant_select on %s for select using (organization_id = app.current_org_id()%s)',
    tbl,
    case when partner_scoped then ' and app.can_read_partner(partner_id)' else '' end
  );
  execute format(
    'create policy tenant_insert on %s for insert with check (organization_id = app.current_org_id())',
    tbl
  );
  execute format(
    'create policy tenant_update on %s for update using (organization_id = app.current_org_id()) with check (organization_id = app.current_org_id())',
    tbl
  );
  execute format(
    'create policy tenant_delete on %s for delete using (organization_id = app.current_org_id())',
    tbl
  );
end;
$$;

-- ── Shared updated_at trigger ───────────────────────────────────────────────
create or replace function app.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
