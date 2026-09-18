-- ============================================================================
-- 0064 — La sonda de salud, el diario de trabajos y la agrupación de incidentes.
--
-- La prueba que de verdad importa es la primera: que la sonda DETECTE el fallo
-- que tumbó el inicio de sesión. Una sonda que siempre dice «bien» es peor que
-- no tener sonda, porque además da confianza.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/system_health.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

\set org '64640000-6464-6464-6464-646464646464'

insert into organizations (id, name, kind, currency) values
  (:'org', 'Operadora de salud', 'tenant', 'usd');

-- ─────────────────────────────────────────────────────────────────────────────
-- La sonda ve lo que desde fuera de la base no se puede mirar
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  r jsonb := public.health_probe();
begin
  if (r->'auth_hook'->>'exists')::boolean is not true then
    raise exception 'la sonda no encuentra el enganche del token: %', r;
  end if;

  -- LOS DOS ATRIBUTOS QUE SE PERDIERON EN 0046. Es exactamente lo que la sonda
  -- vino a vigilar.
  if (r->'auth_hook'->>'security_definer')::boolean is not true then
    raise exception 'la sonda debería ver el enganche como definer: %', r;
  end if;
  if (r->'auth_hook'->>'has_search_path')::boolean is not true then
    raise exception 'la sonda debería ver el search_path fijo: %', r;
  end if;

  if r->>'checked_at' is null then
    raise exception 'la sonda no fecha su respuesta: %', r;
  end if;

  raise notice 'health_probe: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Y LO CONTRARIO: con el enganche roto, la sonda tiene que DECIRLO
--
-- Sin esta mitad, la prueba de arriba solo demuestra que la función devuelve
-- algo. Aquí se rompe el enganche a propósito, se comprueba que la sonda se da
-- cuenta, y se deja como estaba.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  r jsonb;
begin
  -- Se reescribe omitiendo los atributos, que es literalmente lo que hizo 0046.
  execute $def$
    create or replace function app.custom_access_token_hook(event jsonb)
      returns jsonb language plpgsql stable as $body$
    begin return event; end;
    $body$;
  $def$;

  r := public.health_probe();

  if (r->'auth_hook'->>'security_definer')::boolean is not false then
    raise exception 'LA SONDA NO DETECTA EL FALLO QUE TUMBÓ EL LOGIN: %', r;
  end if;
  if (r->'auth_hook'->>'has_search_path')::boolean is not false then
    raise exception 'la sonda no detecta la pérdida del search_path: %', r;
  end if;

  raise notice 'health_probe detecta el enganche roto: TODAS LAS ASERCIONES PASARON';
end $$;

-- El rollback del final deshace el destrozo, pero no se deja al azar: si alguien
-- convierte esta prueba en no transaccional, esto la deja como estaba igual.
do $$ begin
  execute $def$
    create or replace function app.custom_access_token_hook(event jsonb)
      returns jsonb language plpgsql stable security definer
      set search_path = public, app
      as $body$
    declare
      claims jsonb := coalesce(event->'claims', '{}'::jsonb);
      uid uuid := (event->>'user_id')::uuid;
      m record;
    begin
      select mem.role, mem.status, mem.branch_id, org.id as org_id, org.kind, org.tenant_org_id
        into m from organization_memberships mem
        join organizations org on org.id = mem.organization_id
       where mem.user_id = uid and mem.status = 'active'
       order by mem.is_primary desc, mem.created_at asc limit 1;
      if m.org_id is not null then
        claims := claims
          || jsonb_build_object('org_id', coalesce(m.tenant_org_id, m.org_id))
          || jsonb_build_object('app_role', m.role)
          || jsonb_build_object('status', m.status)
          || jsonb_build_object('partner_id', case when m.kind = 'partner' then m.org_id else null end)
          || jsonb_build_object('branch_id', m.branch_id);
      end if;
      return jsonb_set(event, '{claims}', claims);
    end;
    $body$;
  $def$;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- La sonda no la puede llamar cualquiera
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  if has_function_privilege('anon', 'public.health_probe()', 'EXECUTE') then
    raise exception 'anon puede ejecutar una función SECURITY DEFINER';
  end if;
  if has_function_privilege('authenticated', 'public.health_probe()', 'EXECUTE') then
    raise exception 'un usuario cualquiera puede ejecutar la sonda';
  end if;
  if not has_function_privilege('service_role', 'public.health_probe()', 'EXECUTE') then
    raise exception 'el servicio no puede ejecutar la sonda';
  end if;
  raise notice 'permisos de health_probe: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- El diario de trabajos
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '64640000-6464-6464-6464-646464646464';
  corrida uuid;
begin
  -- Se abre AL EMPEZAR, no al terminar: una fila que se queda en 'running' es
  -- la única señal posible de un trabajo que se colgó.
  insert into job_run (job, trigger) values ('collections', 'cron') returning id into corrida;
  if (select status from job_run where id = corrida) <> 'running' then
    raise exception 'una ejecución no nace en marcha';
  end if;

  update job_run set status = 'ok', finished_at = now(),
         summary = '{"avisos_enviados": 12}'::jsonb
   where id = corrida;
  if (select summary->>'avisos_enviados' from job_run where id = corrida) <> '12' then
    raise exception 'el resumen no se guardó';
  end if;

  -- El origen se acota: 'cron' | 'manual' | 'webhook'. Un valor libre haría que
  -- «corrió solo» y «lo empujó alguien» se escribieran de tres maneras.
  begin
    insert into job_run (job, trigger) values ('collections', 'a mano');
    raise exception 'se admitió un origen inventado';
  exception when check_violation then null;
  end;

  -- Y la porción de cada empresa cuelga de la misma tabla.
  insert into job_run (organization_id, job, status, summary)
  values (org, 'collections', 'ok', '{"avisos_enviados": 3}'::jsonb);

  raise notice 'job_run: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- La agrupación de incidentes, que es el motivo de que la pantalla sea legible
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '64640000-6464-6464-6464-646464646464';
begin
  insert into system_incident (organization_id, fingerprint, source, message)
  values (org, '/api/orders|no se pudo guardar', '/api/orders', 'no se pudo guardar');

  -- La misma huella en la misma empresa NO crea una fila nueva.
  begin
    insert into system_incident (organization_id, fingerprint, source, message)
    values (org, '/api/orders|no se pudo guardar', '/api/orders', 'no se pudo guardar');
    raise exception 'la misma huella creó dos incidentes: la pantalla sería ilegible';
  exception when unique_violation then null;
  end;

  -- LOS DE PLATAFORMA TAMBIÉN SE AGRUPAN. En Postgres dos nulos no son iguales,
  -- así que sin el `coalesce` del índice estos se duplicarían sin tope — que es
  -- justo lo contrario de agrupar.
  insert into system_incident (fingerprint, source, message)
  values ('arranque|sin conexión', 'arranque', 'sin conexión');
  begin
    insert into system_incident (fingerprint, source, message)
    values ('arranque|sin conexión', 'arranque', 'sin conexión');
    raise exception 'LOS INCIDENTES SIN EMPRESA SE DUPLICAN: el coalesce del índice no está haciendo su trabajo';
  exception when unique_violation then null;
  end;

  -- Pero el mismo fallo en dos empresas SON dos incidentes: a cada una le pasa
  -- lo suyo y cada una lo resuelve por su lado.
  insert into organizations (id, name, kind, currency)
  values ('64640000-0000-0000-0000-000000000002', 'Otra operadora', 'tenant', 'usd');
  insert into system_incident (organization_id, fingerprint, source, message)
  values ('64640000-0000-0000-0000-000000000002', '/api/orders|no se pudo guardar', '/api/orders', 'no se pudo guardar');

  -- El reloj de «última vez» lo lleva el disparador, no quien escribe: hay más
  -- de un camino de escritura y basta que uno se olvide para que un incidente
  -- activo parezca viejo.
  update system_incident set occurrences = 2
   where organization_id = org and fingerprint = '/api/orders|no se pudo guardar';

  raise notice 'system_incident: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Apuntar un incidente: contar, no duplicar, y reabrir lo que vuelve
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '64640000-6464-6464-6464-646464646464';
  a uuid; b uuid;
begin
  a := public.report_incident(org, 'huella|repetida', '/api/orders', 'primer intento');
  b := public.report_incident(org, 'huella|repetida', '/api/orders', 'segundo intento');

  if a <> b then
    raise exception 'la misma huella creó dos incidentes en vez de contar';
  end if;
  if (select occurrences from system_incident where id = a) <> 2 then
    raise exception 'el contador no subió: %', (select occurrences from system_incident where id = a);
  end if;

  -- Gana el mensaje MÁS RECIENTE: al investigar se mira la última ocurrencia.
  if (select message from system_incident where id = a) <> 'segundo intento' then
    raise exception 'se conservó el mensaje viejo';
  end if;

  -- REABRIR. Un fallo que vuelve después de darse por arreglado es una noticia.
  update system_incident set status = 'resolved' where id = a;
  perform public.report_incident(org, 'huella|repetida', '/api/orders', 'volvió');
  if (select status from system_incident where id = a) <> 'open' then
    raise exception 'un incidente resuelto que vuelve a ocurrir no se reabrió';
  end if;
  if (select occurrences from system_incident where id = a) <> 3 then
    raise exception 'la reapertura perdió la cuenta';
  end if;

  -- Los de plataforma (sin empresa) también se agrupan, por el coalesce.
  a := public.report_incident(null, 'arranque|sin conexion', 'arranque', 'x');
  b := public.report_incident(null, 'arranque|sin conexion', 'arranque', 'y');
  if a <> b then
    raise exception 'los incidentes sin empresa se duplican';
  end if;

  raise notice 'report_incident: TODAS LAS ASERCIONES PASARON';
end $$;

do $$ begin
  if has_function_privilege('anon', 'public.report_incident(uuid,text,text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'anon puede apuntar incidentes';
  end if;
  raise notice 'permisos de report_incident: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
