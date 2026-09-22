-- ═══════════════════════════════════════════════════════════════════════════
-- 0068 · PARTE 2 de 3 — el enganche del token
--
-- Pegar ENTERA y darle a Run, DESPUÉS de la parte 1. Luego la parte 3.
--
-- QUÉ ARREGLA
--
-- El selector de empresa guardaba la elección en una cookie. Eso alcanza a lo
-- que se lee con la llave de servicio, pero NO a lo que se lee con la sesión y
-- RLS: `app.current_org_id()` saca el `org_id` del JWT, y ese se fija en el
-- LOGIN a partir de la membresía principal. Por eso al cambiar de empresa el
-- panel seguía en la de siempre y saltaba «dashboard organization is outside
-- your tenant», con todos los módulos vacíos.
--
-- Ahora el enganche PREFIERE la empresa activa elegida —pero solo si la persona
-- sigue teniendo una membresía activa ahí—, así que al refrescar el token el
-- `org_id` pasa a ser la empresa elegida.
--
-- El cuerpo va con la etiqueta $hook$ en vez de $$ para que el editor no
-- confunda dónde empieza y dónde acaba.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  -- Los dos atributos que 0063 tuvo que devolver. Van SIEMPRE: sin ellos el
  -- enganche corre con la RLS puesta, llama a auth.uid() —esquema al que su rol
  -- no accede— y GoTrue devuelve 500. No se tocan.
  security definer
  set search_path = public, app
as $hook$
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
$hook$;

grant usage on schema app to supabase_auth_admin;
revoke all on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin, service_role;
