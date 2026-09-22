-- ============================================================================
-- 0068 — LA EMPRESA ACTIVA VIAJA EN EL TOKEN, NO SOLO EN UNA COOKIE
--
-- QUÉ ESTABA ROTO
--
-- El selector de empresa (0014) guardaba la elección en una cookie y volvía a
-- resolver la membresía en cada petición. Eso alcanza a lo que lee con la LLAVE
-- DE SERVICIO y filtro explícito por empresa (`tenantQuery`), pero NO a lo que
-- lee con la sesión y RLS: el panel llama a `dashboard_summary`, que compara la
-- empresa pedida contra `app.current_org_id()` —y esa función lee el `org_id`
-- del JWT, que se fija en el LOGIN a partir de la membresía principal—. Resultado:
-- al cambiar de empresa con el selector, el panel seguía viendo la principal y
-- saltaba «dashboard organization is outside your tenant», y todo lo que filtra
-- por RLS salía vacío.
--
-- QUÉ HACE ESTA MIGRACIÓN
--
-- Guarda la empresa activa de cada persona en una tabla, y el enganche del token
-- la PREFIERE sobre la principal —pero solo si la persona sigue teniendo una
-- membresía activa ahí—. Así, al cambiar de empresa y refrescar el token, el
-- `org_id` del JWT pasa a ser la empresa elegida, y RLS y el panel la respetan
-- sin cerrar sesión. Sin empresa activa elegida, todo sigue igual que antes:
-- se aterriza en la principal.
-- ============================================================================

create table if not exists user_active_workspace (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  updated_at      timestamptz not null default now()
);

alter table user_active_workspace enable row level security;
alter table user_active_workspace force row level security;

-- Cada quien ve y toca solo su propia fila. Las escrituras de verdad las hace la
-- ruta de cambio de empresa con la llave de servicio; esta política es el
-- cinturón por si algún día se lee desde la sesión.
drop policy if exists active_workspace_self_select on user_active_workspace;
create policy active_workspace_self_select on user_active_workspace
  for select using (user_id = auth.uid());
drop policy if exists active_workspace_self_write on user_active_workspace;
create policy active_workspace_self_write on user_active_workspace
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists user_active_workspace_touch on user_active_workspace;
create trigger user_active_workspace_touch before update on user_active_workspace
  for each row execute function app.touch_updated_at();

-- ── el enganche, ahora consciente de la empresa activa ──────────────────────
create or replace function app.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  -- Los dos atributos que 0063 tuvo que devolver. Van SIEMPRE: sin ellos el
  -- enganche corre con la RLS puesta, llama a auth.uid() —esquema al que su rol
  -- no accede— y GoTrue devuelve 500. No se tocan.
  security definer
  set search_path = public, app
as $$
declare
  claims  jsonb := coalesce(event->'claims', '{}'::jsonb);
  uid     uuid  := (event->>'user_id')::uuid;
  m       record;
begin
  -- 1) La empresa ACTIVA elegida en el selector, si la persona sigue teniendo
  --    una membresía activa ahí. La comprobación de membresía es lo que impide
  --    que una fila vieja o manipulada dé acceso a una empresa ajena.
  select mem.role, mem.status, mem.branch_id, org.id as org_id, org.kind, org.tenant_org_id
    into m
    from user_active_workspace uaw
    join organization_memberships mem
      on mem.user_id = uaw.user_id and mem.organization_id = uaw.organization_id
    join organizations org on org.id = mem.organization_id
   where uaw.user_id = uid
     and mem.status = 'active'
   limit 1;

  -- 2) Si no hay empresa activa elegida (o dejó de valer), la PRINCIPAL, igual
  --    que siempre.
  if m.org_id is null then
    select mem.role, mem.status, mem.branch_id, org.id as org_id, org.kind, org.tenant_org_id
      into m
      from organization_memberships mem
      join organizations org on org.id = mem.organization_id
     where mem.user_id = uid
       and mem.status = 'active'
     order by mem.is_primary desc, mem.created_at asc
     limit 1;
  end if;

  if m.org_id is not null then
    claims := claims
      || jsonb_build_object('org_id', coalesce(m.tenant_org_id, m.org_id))
      || jsonb_build_object('app_role', m.role)
      || jsonb_build_object('status', m.status)
      || jsonb_build_object('partner_id',
           case when m.kind = 'partner' then m.org_id else null end)
      || jsonb_build_object('branch_id', m.branch_id);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema app to supabase_auth_admin;
revoke all on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin, service_role;

-- ── que la migración compruebe lo que vino a arreglar ──────────────────────
do $$
declare definer boolean;
begin
  select p.prosecdef into definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'custom_access_token_hook';
  if not coalesce(definer, false) then
    raise exception '0068 dejó el enganche sin SECURITY DEFINER: correría con la RLS puesta';
  end if;
end $$;
