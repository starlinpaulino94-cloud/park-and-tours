-- ═══════════════════════════════════════════════════════════════════════════
-- 0063 — NADIE PODÍA INICIAR SESIÓN, Y LA CAUSA ERA UNA PALABRA QUE FALTABA
--
-- EL SÍNTOMA
--
-- Al pulsar «Entrar», GoTrue respondía 500 y el formulario mostraba:
--
--     Error running hook URI: pg-functions://postgres/app/custom_access_token_hook
--
-- No es un problema de credenciales: la contraseña se valida bien. Lo que falla
-- es el paso siguiente, el que mete `org_id` en el token. Y si ese paso falla,
-- no se emite sesión: no se entra.
--
-- LA CAUSA, QUE ES UNA TRAMPA DEL PROPIO POSTGRES
--
-- `create or replace function` NO conserva los atributos que no se repiten. Los
-- que se omiten vuelven a su valor por omisión, en silencio y sin aviso.
--
-- 0020 definió el enganche `security definer` y con `set search_path`, y explicó
-- por qué: tiene que leer las tablas de inquilinos con la RLS activa.
--
-- 0046 lo reescribió para añadir `branch_id` a las reclamaciones. Su comentario
-- decía «el resto de la función queda EXACTAMENTE igual que en 0002: se
-- reescribe entera porque `create or replace` lo exige». El cuerpo sí quedó
-- igual; la cabecera no. Al no repetirlos, se perdieron los dos atributos.
--
-- Desde entonces el enganche corre como `supabase_auth_admin`, o sea con la RLS
-- aplicándosele. Y la política `mem_read` de 0002 termina en `user_id =
-- auth.uid()`, que lee el esquema `auth` — al que ese rol no tiene acceso:
--
--     ERROR: permission denied for schema auth
--     QUERY: select nullif(auth.jwt() ->> 'sub', '')::uuid
--     CONTEXT: SQL function "uid" during inlining
--
-- Con `security definer` la función corría como su dueño, que salta la RLS, y la
-- política no llegaba a evaluarse nunca. Por eso el fallo no se vio el día que
-- se introdujo, sino el día que esa migración llegó a una base de verdad.
--
-- QUÉ SE HACE
--
-- Se vuelve a declarar el enganche con los dos atributos. El cuerpo es el de
-- 0046 sin tocar una coma: `branch_id` sigue viajando en el token.
--
-- Y al final hay una comprobación que falla la migración si los atributos no
-- quedaron puestos. Una migración que arregla esto y no comprueba que lo
-- arregló repetiría la historia entera.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  -- LOS DOS ATRIBUTOS QUE SE PERDIERON. Si alguna migración futura vuelve a
  -- reescribir esta función, tiene que repetirlos aquí: omitirlos no los
  -- conserva, los borra.
  security definer
  set search_path = public, app
as $$
declare
  claims  jsonb := coalesce(event->'claims', '{}'::jsonb);
  uid     uuid  := (event->>'user_id')::uuid;
  m       record;
begin
  select mem.role, mem.status, mem.branch_id, org.id as org_id, org.kind, org.tenant_org_id
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
           case when m.kind = 'partner' then m.org_id else null end)
      -- Nulo cuando la persona no tiene sucursal: entonces ve toda la empresa,
      -- que es el comportamiento de siempre.
      || jsonb_build_object('branch_id', m.branch_id);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- `create or replace` conserva los permisos, pero repetirlos no cuesta nada y
-- deja esta migración completa por sí sola: una base a la que le faltara 0020
-- —que es exactamente la clase de cosa que ya pasó— quedaría igual de bien.
grant usage on schema app to supabase_auth_admin;
revoke all on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin, service_role;

-- ── que la migración compruebe lo que vino a arreglar ──────────────────────
do $$
declare
  definer boolean;
  config  text[];
begin
  select p.prosecdef, p.proconfig
    into definer, config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'custom_access_token_hook';

  if definer is null then
    raise exception 'el enganche de token no existe';
  end if;

  -- Sin esto el enganche lee las tablas de inquilinos con la RLS puesta, y la
  -- política acaba llamando a auth.uid(): excepción, 500, y nadie entra.
  if not definer then
    raise exception 'app.custom_access_token_hook perdió SECURITY DEFINER';
  end if;

  -- Sin search_path fijo, lo que resuelva cada nombre depende del rol que lo
  -- llame. En una función que decide permisos eso no se deja al azar.
  if config is null or not exists (
    select 1 from unnest(config) c where c like 'search\_path=%'
  ) then
    raise exception 'app.custom_access_token_hook perdió su search_path fijo';
  end if;

  if not has_schema_privilege('supabase_auth_admin', 'app', 'USAGE') then
    raise exception 'supabase_auth_admin no puede usar el esquema app';
  end if;

  if not has_function_privilege('supabase_auth_admin', 'app.custom_access_token_hook(jsonb)', 'EXECUTE') then
    raise exception 'supabase_auth_admin no puede ejecutar el enganche';
  end if;
end $$;
