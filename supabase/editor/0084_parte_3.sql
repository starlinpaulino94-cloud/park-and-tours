-- 0084 · parte 3 de 3 — El identificador de proveedor en el token.
--
-- Ejecuta las partes 1 y 2 ANTES que esta.
--
-- QUÉ HACE
--  · Reescribe el enganche que arma los claims para que incluya `supplier_id`.
--    La RLS lo necesita en el token para poder acotar por proveedor.
--
-- OJO: `create or replace` NO conserva los atributos que no se repiten.
-- `security definer` y el `search_path` van en TODA definición del enganche:
-- sin `definer` corre como `supabase_auth_admin`, se le aplica la RLS, su
-- política llama a `auth.uid()` —esquema al que ese rol no accede— y GoTrue
-- devuelve 500. NADIE OBTIENE SESIÓN. Es lo que arregló 0063; aquí va repetido
-- palabra por palabra para no volver a perderlo.
--
-- DESPUÉS DE EJECUTARLO, cierra sesión y vuelve a entrar: los tokens ya
-- emitidos no llevan el claim nuevo hasta que se renuevan.
--
-- NO borra ni cambia ninguna fila.

create or replace function app.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public, app
as $hook$
declare
  claims  jsonb := coalesce(event->'claims', '{}'::jsonb);
  uid     uuid  := (event->>'user_id')::uuid;
  m       record;
  v_supplier uuid;
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
    -- La ficha de proveedor, acotada a la empresa de la membresía: sin ese
    -- filtro, una ficha de otra operadora con el mismo usuario metería en el
    -- token un proveedor que no es de esta empresa.
    select s.id into v_supplier
      from supplier s
     where s.user_id = uid
       and s.status = 'active'
       and s.organization_id = coalesce(m.tenant_org_id, m.org_id)
     limit 1;

    claims := claims
      || jsonb_build_object('org_id', coalesce(m.tenant_org_id, m.org_id))
      || jsonb_build_object('app_role', m.role)
      || jsonb_build_object('status', m.status)
      || jsonb_build_object('partner_id',
           case when m.kind = 'partner' then m.org_id else null end)
      || jsonb_build_object('supplier_id', v_supplier);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$hook$;

-- El permiso va pegado a la definición, no en una migración posterior: entre
-- una y otra habría una ventana en la que cualquiera puede invocarla.
revoke all on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin, service_role;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Tiene que salir `security definer` = true. Si sale false, NO cierres sesión:
-- vuelve a ejecutar esta parte entera.
select p.proname, p.prosecdef as security_definer,
       has_function_privilege('supabase_auth_admin', p.oid, 'execute') as la_llama_gotrue
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='app' and p.proname='custom_access_token_hook';
