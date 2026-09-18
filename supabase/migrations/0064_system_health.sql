-- ═══════════════════════════════════════════════════════════════════════════
-- 0064 — QUE EL SISTEMA AVISE CUANDO SE ROMPE
--
-- LO QUE ACABA DE PASAR, Y QUE ES LA RAZÓN DE ESTA MIGRACIÓN
--
-- El enganche que emite la sesión estuvo roto horas. Durante ese rato NADIE
-- podía entrar al sistema. ¿Quién se enteró? Un job de integración continua.
-- No la operadora: la operadora se habría enterado por un vendedor en el
-- mostrador con un cliente delante.
--
-- Ese es el hueco, y no es de ese fallo en concreto: es que el sistema no tiene
-- ninguna forma de decir «me he roto». Hay 102 `console.error` repartidos por el
-- código que escriben en un registro que nadie lee después, y cinco trabajos
-- nocturnos —avisos de cobro, mensajes a clientes, caducidad de aprobaciones,
-- certificaciones, liberación de cupo— que corren a las tres de la mañana y no
-- dejan ningún rastro. Si `dispatch-messages` deja de funcionar, se sabe cuando
-- un cliente dice que nunca le llegó su voucher.
--
-- LAS DOS TABLAS
--
-- `job_run` — qué corrió, cuándo, cuánto tardó y qué hizo. Con esto, «¿salieron
-- los recordatorios de cobro anoche?» es una pregunta con respuesta.
--
-- `system_incident` — los errores que hoy se pierden, AGRUPADOS POR HUELLA. Sin
-- agrupar no sirve: un fallo que ocurre mil veces produciría mil filas y la
-- pantalla sería ilegible justo el día que hay que leerla. Se guarda uno por
-- huella con un contador, la primera vez y la última.
--
-- POR QUÉ `organization_id` ES NULO A VECES
--
-- Un cron recorre TODAS las empresas: su ejecución global no es de nadie en
-- particular. Pero lo que hizo para cada una sí le importa a esa empresa. Así
-- que la misma tabla guarda las dos cosas: fila con `organization_id` nulo = la
-- ejecución entera (solo la ve la plataforma); fila con empresa = lo que se hizo
-- para ella, que es lo que esa empresa puede leer.
--
-- Lo mismo para los incidentes: un fallo al arrancar no es de ninguna empresa;
-- uno al guardar una reserva sí.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── qué corrió y qué hizo ──────────────────────────────────────────────────
create table if not exists job_run (
  id   uuid primary key default gen_random_uuid(),

  -- Nulo = la ejecución completa, que es de la plataforma. Con empresa = la
  -- porción que le tocó a esa empresa, que es lo que ella puede ver.
  organization_id uuid references organizations(id) on delete cascade,

  -- El nombre del trabajo tal cual se invoca: 'collections', 'dispatch-messages'…
  job text not null,

  -- DE DÓNDE VINO. El mismo endpoint lo llama el programador de tareas y lo
  -- llama una persona a mano cuando algo no salió. Sin distinguirlos, «corrió a
  -- las 03:00» no dice si corrió solo o si alguien lo empujó — y esa diferencia
  -- es justo la que importa cuando se investiga por qué algo no se envió.
  trigger text not null default 'cron'
    check (trigger in ('cron', 'manual', 'webhook')),

  started_at  timestamptz not null default now(),
  finished_at timestamptz,

  -- 'running' mientras va, y luego 'ok' | 'failed'. Que exista 'running' importa:
  -- un trabajo que se queda colgado deja su fila en 'running' para siempre, y eso
  -- es precisamente la señal de que se colgó. Si solo se escribiera al terminar,
  -- un trabajo que nunca termina no dejaría rastro ninguno.
  status text not null default 'running'
    check (status in ('running', 'ok', 'failed')),

  -- Qué hizo, en números: {"mensajes_enviados": 12, "omitidos": 3}. Es jsonb
  -- porque cada trabajo cuenta cosas distintas y forzarlos a un esquema común
  -- haría que ninguno contase lo suyo.
  summary jsonb not null default '{}'::jsonb,

  -- El motivo del fallo, en texto plano y para leerlo una persona.
  error text,

  created_at timestamptz not null default now()
);

-- La pregunta que se le hace a esta tabla es siempre la misma: «¿cuándo corrió
-- esto por última vez?». El índice es ese orden.
create index if not exists job_run_job_idx on job_run (job, started_at desc);
create index if not exists job_run_org_idx on job_run (organization_id, started_at desc)
  where organization_id is not null;

-- Un trabajo colgado se busca por su estado, y son pocos: índice parcial.
create index if not exists job_run_running_idx on job_run (started_at)
  where status = 'running';

-- ── los errores que hoy se pierden ─────────────────────────────────────────
create table if not exists system_incident (
  id uuid primary key default gen_random_uuid(),

  -- Nulo cuando el fallo no es de ninguna empresa (arranque, cron global).
  organization_id uuid references organizations(id) on delete cascade,

  -- LA HUELLA: lo que decide si dos errores son EL MISMO. Se calcula del sitio
  -- y del tipo de fallo, nunca del mensaje completo — un mensaje suele llevar el
  -- identificador de la fila, y entonces cada ocurrencia sería un incidente
  -- distinto y la agrupación no agruparía nada.
  fingerprint text not null,

  -- Dónde pasó: la ruta o el trabajo.
  source text not null,

  -- Qué pasó, para leerlo una persona. El último mensaje visto.
  message text not null,

  -- 'error' | 'warning'. Un aviso no despierta a nadie; un error sí.
  level text not null default 'error' check (level in ('error', 'warning')),

  -- CUÁNTAS VECES. Es el número que decide si algo es una anécdota o una caída.
  occurrences integer not null default 1 check (occurrences > 0),

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  -- 'open' | 'acknowledged' | 'resolved'. Reconocido no es resuelto: es «ya lo
  -- vi», que es lo que impide que el mismo aviso siga gritando mientras alguien
  -- lo está arreglando.
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved')),

  -- Contexto sin datos personales: método, código de estado, identificador de
  -- la petición. Nunca el cuerpo, que llevaría datos del cliente.
  context jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- LA CLAVE DE LA AGRUPACIÓN. Una huella por empresa: el mismo fallo en dos
-- empresas son dos incidentes, porque a cada una le pasa lo suyo.
--
-- `coalesce` sobre el nulo: en Postgres dos nulos no son iguales, así que sin
-- esto los incidentes de plataforma —los que no son de ninguna empresa— se
-- duplicarían sin tope, que es justo lo contrario de agrupar.
create unique index if not exists system_incident_fingerprint_key
  on system_incident (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), fingerprint);

create index if not exists system_incident_open_idx
  on system_incident (last_seen_at desc)
  where status <> 'resolved';

-- ── el reloj de «última vez» se lleva solo ─────────────────────────────────
--
-- Va en un disparador y no en el código que escribe porque hay más de un camino
-- de escritura —la API, un cron, el propio servidor— y basta que uno se olvide
-- para que un incidente activo parezca viejo y se ignore.
create or replace function app.system_incident_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists system_incident_touch on system_incident;
create trigger system_incident_touch
  before update on system_incident
  for each row execute function app.system_incident_touch();

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Las dos tablas llevan filas SIN empresa, y ahí está el cuidado: la política
-- de inquilino compara con `app.current_org_id()`, y una fila con nulo no
-- coincide con ninguna empresa. O sea que las filas de plataforma quedan
-- invisibles para los inquilinos, que es exactamente lo que se quiere:
-- `service_role` —el único que corre los crons y la salud— las ve porque
-- bypassa RLS.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'job_run' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.job_run');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'system_incident' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.system_incident');
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- LA SONDA: PREGUNTARLE A LA BASE SI LO QUE NO SE VE ESTÁ BIEN
--
-- Hay cosas que solo se pueden comprobar desde dentro de Postgres, y son justo
-- las que se rompen en silencio. La de hoy es el ejemplo: el enganche que emite
-- la sesión perdió `security definer` y nadie podía entrar — y desde fuera de la
-- base no hay forma de mirar ese atributo.
--
-- PostgREST solo publica el esquema `public`, así que la función vive aquí
-- aunque todo lo demás de fontanería viva en `app`.
--
-- Es SECURITY DEFINER porque lee catálogos del sistema, y por eso mismo se le
-- quita el permiso a todo el mundo salvo al servicio en la línea siguiente: 0017
-- comprueba que ninguna función definer sea ejecutable por `anon`, y tiene razón.
-- El revoke va pegado a la definición y no en otra migración: entre una y otra
-- habría una ventana en la que cualquiera puede invocarla.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.health_probe()
returns jsonb
language plpgsql
stable
security definer
-- El mismo atributo que se perdió en 0046. Aquí también hace falta: sin
-- search_path fijo, lo que resuelva cada nombre depende de quién llame.
set search_path = public, app, pg_catalog
as $$
declare
  hook_definer boolean;
  hook_config  text[];
  sin_rls      integer;
begin
  select p.prosecdef, p.proconfig into hook_definer, hook_config
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'custom_access_token_hook';

  -- Una tabla de negocio sin RLS es una fuga entre empresas esperando a que
  -- alguien consulte por el camino equivocado. Se cuenta, no se listan: el
  -- número basta para encender la luz, y la lista se mira ya en la base.
  select count(*) into sin_rls
    from pg_tables t
   where t.schemaname = 'public'
     and t.tablename not in ('schema_migrations')
     and not exists (
       select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t.tablename and c.relrowsecurity
     );

  return jsonb_build_object(
    'auth_hook', jsonb_build_object(
      'exists', hook_definer is not null,
      -- Sin esto, GoTrue responde 500 a toda emisión de sesión: nadie entra.
      'security_definer', coalesce(hook_definer, false),
      'has_search_path', coalesce(
        exists (select 1 from unnest(coalesce(hook_config, '{}'::text[])) c where c like 'search\_path=%'),
        false
      )
    ),
    'tables_without_rls', sin_rls,
    'checked_at', now()
  );
end;
$$;

revoke all on function public.health_probe() from public, anon, authenticated;
grant execute on function public.health_probe() to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- APUNTAR UN INCIDENTE SIN PERDER LA CUENTA
--
-- La agrupación vive en un índice ÚNICO POR EXPRESIÓN —`coalesce(organization_id,
-- …), fingerprint`—, y PostgREST no sabe apuntar a uno de esos: su `upsert` pide
-- nombres de columna. Hacerlo desde el cliente obligaría a leer, decidir y
-- escribir en tres viajes, y entre el primero y el tercero cabe otra petición:
-- dos ocurrencias simultáneas del mismo fallo se contarían como una, o chocarían
-- contra el índice.
--
-- Y justo cuando un fallo se repite en avalancha es cuando el contador importa:
-- es el número que distingue una anécdota de una caída.
--
-- Aquí es una sola instrucción, y el `on conflict` puede nombrar la expresión.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.report_incident(
  p_organization_id uuid,
  p_fingerprint     text,
  p_source          text,
  p_message         text,
  p_level           text default 'error',
  p_context         jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_catalog
as $$
declare
  incidente uuid;
begin
  insert into system_incident (organization_id, fingerprint, source, message, level, context)
  values (p_organization_id, p_fingerprint, p_source, p_message, coalesce(p_level, 'error'), coalesce(p_context, '{}'::jsonb))
  on conflict (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), fingerprint)
  do update set
    occurrences  = system_incident.occurrences + 1,
    last_seen_at = now(),
    -- El último mensaje y contexto ganan: al investigar se mira la ocurrencia
    -- más reciente, no la primera.
    message      = excluded.message,
    context      = excluded.context,
    -- REABRIR LO RESUELTO. Un fallo que vuelve después de darse por arreglado es
    -- una noticia, no una repetición: si se quedara en 'resolved' desaparecería
    -- de la pantalla justo cuando hay que volver a mirarlo.
    status       = case when system_incident.status = 'resolved' then 'open' else system_incident.status end
  returning id into incidente;

  return incidente;
end;
$$;

revoke all on function public.report_incident(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.report_incident(uuid, text, text, text, text, jsonb) to service_role;
