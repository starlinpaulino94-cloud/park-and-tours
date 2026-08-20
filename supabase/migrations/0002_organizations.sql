-- ============================================================================
-- 0002 — Organizations, memberships, relationships + access-token hook
-- The tenancy backbone. Replaces Totalum's flat `company` + `user.company_id`.
-- ============================================================================

-- ── organizations ──────────────────────────────────────────────────────────
-- One row per tenant (kind='tenant'), partner (kind='partner') or physical
-- location (kind='branch'). tenant_org_id points every node at its tenant root,
-- which is the value used for row scoping across all business tables.
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('tenant','partner','branch')),
  parent_org_id uuid references organizations(id) on delete restrict,
  tenant_org_id uuid references organizations(id) on delete restrict,
  name          text not null,
  slug          citext,
  legal_name    text,
  tax_id        text,
  email         text,
  phone         text,
  country       text,
  timezone      text,
  currency      text default 'usd',
  -- tenant-only SaaS attributes (null for partner/branch nodes)
  company_type        text,
  subscription_status text,
  plan_id             uuid,
  modules_enabled     text[] default '{}',
  stripe_customer_id     text,
  stripe_subscription_id text,
  -- partner-only attributes live on organization_relationships, not here
  status        text not null default 'active' check (status in ('active','inactive','suspended','blocked','pending')),
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A tenant slug is the subdomain: globally unique. Partner/branch slugs are not.
create unique index organizations_tenant_slug_key
  on organizations (slug) where kind = 'tenant' and slug is not null;
create index organizations_tenant_idx  on organizations (tenant_org_id);
create index organizations_parent_idx  on organizations (parent_org_id);
create index organizations_kind_idx    on organizations (tenant_org_id, kind);

create trigger organizations_touch before update on organizations
  for each row execute function app.touch_updated_at();

-- ── organization_memberships (user ↔ org ↔ role) ───────────────────────────
create table organization_memberships (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  role            text not null check (role in
                    ('superadmin','owner','admin','manager','operations','cashier','seller','partner')),
  status          text not null default 'active' check (status in ('active','inactive','suspended','pending')),
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, organization_id)
);
create index memberships_user_idx on organization_memberships (user_id) where status = 'active';
create index memberships_org_idx  on organization_memberships (organization_id);
-- At most one primary membership per user.
create unique index memberships_one_primary
  on organization_memberships (user_id) where is_primary;

create trigger memberships_touch before update on organization_memberships
  for each row execute function app.touch_updated_at();

-- ── organization_relationships (principal ↔ partners, M:N with attributes) ──
create table organization_relationships (
  id                uuid primary key default gen_random_uuid(),
  from_org_id       uuid not null references organizations(id) on delete cascade,  -- tenant/principal
  to_org_id         uuid not null references organizations(id) on delete cascade,  -- partner/subagency
  relationship_type text not null check (relationship_type in
                      ('distributor','subagency','tour_operator','reseller','hotel','agency','tour_center')),
  default_commission_pct numeric(6,3),
  credit_limit      numeric(14,2),
  credit_days       integer,
  currency          text default 'usd',
  contract_from     date,
  contract_to       date,
  status            text not null default 'active' check (status in ('active','inactive','suspended')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (from_org_id, to_org_id, relationship_type)
);
create index org_rel_from_idx on organization_relationships (from_org_id);
create index org_rel_to_idx   on organization_relationships (to_org_id);

create trigger org_rel_touch before update on organization_relationships
  for each row execute function app.touch_updated_at();

-- ── Access-token hook (wired in M3) ─────────────────────────────────────────
-- Supabase Auth calls this to enrich the JWT. It picks the user's primary active
-- membership and injects org_id (tenant root), app_role, partner_id and status.
-- An inactive/absent membership yields no org_id → RLS denies everything, which
-- is how "deactivated user loses access immediately" (AUD-S02) is enforced.
create or replace function app.custom_access_token_hook(event jsonb)
  returns jsonb language plpgsql stable as $$
declare
  claims  jsonb := coalesce(event->'claims', '{}'::jsonb);
  uid     uuid  := (event->>'user_id')::uuid;
  m       record;
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

-- RLS on the tenancy tables themselves.
alter table organizations enable row level security;
alter table organizations force row level security;
create policy org_read on organizations for select
  using (id = app.current_org_id() or tenant_org_id = app.current_org_id());

alter table organization_memberships enable row level security;
alter table organization_memberships force row level security;
create policy mem_read on organization_memberships for select
  using (organization_id = app.current_org_id()
      or organization_id in (select id from organizations where tenant_org_id = app.current_org_id())
      or user_id = auth.uid());

alter table organization_relationships enable row level security;
alter table organization_relationships force row level security;
create policy rel_read on organization_relationships for select
  using (from_org_id = app.current_org_id() or to_org_id = app.current_partner_id());

-- Writes to tenancy tables go through service_role (onboarding/team), which
-- bypasses RLS. No permissive write policy is defined on purpose.
