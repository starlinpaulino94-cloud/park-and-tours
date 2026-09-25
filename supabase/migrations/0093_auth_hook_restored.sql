-- 0093 — El enganche del token, entero otra vez.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ PASÓ
--
-- 0084 reescribió `app.custom_access_token_hook` para añadir `supplier_id`, y
-- lo hizo partiendo de la versión de 0063 en vez de la que había. Entre 0063 y
-- 0084 el enganche había crecido dos veces, y las dos se perdieron sin que
-- nada se rompiera de forma visible:
--
--   · **La empresa activa** (0068). El selector de empresa escribe en
--     `user_active_workspace` y el enganche miraba esa fila ANTES que la
--     membresía principal. Desde 0084 no la mira: el selector sigue guardando
--     la elección, la pantalla sigue enseñándola, y el token sigue llevando la
--     empresa principal. Quien administra dos operadoras cambia de empresa, ve
--     que la interfaz le hace caso y trabaja sobre la otra.
--
--   · **La sucursal** (0046). `branch_id` dejó de viajar en el token, así que
--     `ctx.branchId` es nulo para todo el mundo desde entonces.
--
-- Las dos las detectan `supabase/tests/auth_hook.test.sql` y
-- `active_workspace.test.sql`, que corren en CI. Estaban en rojo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTA MIGRACIÓN NO «AÑADE» NADA
--
-- Reescribe el enganche ENTERO con las cuatro cosas juntas, y esa es la
-- lección: este objeto se ha reescrito cinco veces (0002, 0020, 0046, 0063,
-- 0068, 0084) y cada reescritura parte de la anterior de memoria. La forma de
-- que no vuelva a pasar no es tener más cuidado — es que la prueba que lo
-- comprueba corra y se mire, que es lo que no pasó.
--
-- `security definer` y `search_path` van pegados a la definición, como desde
-- 0063: sin ellos el enganche corre con la RLS puesta, llama a `auth.uid()` —un
-- esquema al que su rol no accede— y GoTrue devuelve 500 a TODO EL MUNDO. Es el
-- fallo que dejó a la operadora entera sin poder entrar.

create or replace function app.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public, app
as $hook$
declare
  claims     jsonb := coalesce(event->'claims', '{}'::jsonb);
  uid        uuid  := (event->>'user_id')::uuid;
  m          record;
  v_supplier uuid;
begin
  -- 1) La empresa ACTIVA elegida en el selector (0068), si la persona sigue
  --    teniendo una membresía activa ahí. La comprobación de membresía es lo
  --    que impide que una fila vieja o manipulada dé acceso a una empresa ajena.
  select mem.role, mem.status, mem.branch_id, org.id as org_id, org.kind, org.tenant_org_id
    into m
    from user_active_workspace uaw
    join organization_memberships mem
      on mem.user_id = uaw.user_id and mem.organization_id = uaw.organization_id
    join organizations org on org.id = mem.organization_id
   where uaw.user_id = uid
     and mem.status = 'active'
   limit 1;

  -- 2) Si no hay empresa activa elegida (o dejó de valer), la PRINCIPAL.
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
    -- 3) La ficha de proveedor (0084), acotada a la empresa de la membresía:
    --    sin ese filtro, una ficha de otra operadora con el mismo usuario
    --    metería en el token un proveedor que no es de esta empresa.
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
      || jsonb_build_object('supplier_id', v_supplier)
      -- 4) La sucursal (0046). Se perdió en 0084 y con ella `ctx.branchId`.
      || jsonb_build_object('branch_id', m.branch_id);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$hook$;

-- El permiso va pegado a la definición, no en una migración posterior: entre
-- una y otra habría una ventana en la que cualquiera puede invocarla.
revoke all on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin, service_role;

-- ── Y que la migración compruebe lo que vino a arreglar ─────────────────────
--
-- Los dos atributos que 0063 tuvo que devolver, comprobados aquí y no confiados
-- a que nadie los quite: sin ellos nadie puede iniciar sesión.
do $$
declare definer boolean; camino text;
begin
  select p.prosecdef, array_to_string(coalesce(p.proconfig, '{}'), ',')
    into definer, camino
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'custom_access_token_hook';

  if not coalesce(definer, false) then
    raise exception '0093: el enganche quedó sin security definer; nadie podría iniciar sesión';
  end if;
  if camino not like '%search_path%' then
    raise exception '0093: el enganche quedó sin search_path fijo';
  end if;
end $$;
