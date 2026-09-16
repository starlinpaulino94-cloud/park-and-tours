-- ============================================================================
-- Prueba de public.rate_limit_hit (0043).
--
-- Lo que se comprueba aquí no se puede comprobar sin base de datos: que la
-- ventana cuente, que se reinicie sola, que dos claves no se estorben y —lo
-- que motivó la migración— que el contador sea UNO SOLO para todas las
-- instancias. Si esta función se equivoca, el límite de intentos de contraseña
-- deja de existir sin que nada falle a la vista.
--
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

do $$
declare
  r record;
  fallos text[] := '{}';
begin
  -- ── cuenta dentro de la ventana ──────────────────────────────────────────
  select * into r from public.rate_limit_hit('prueba:a', 2, 60000);
  if not r.allowed or r.hits <> 1 then fallos := fallos || 'el primer intento debería pasar'; end if;

  select * into r from public.rate_limit_hit('prueba:a', 2, 60000);
  if not r.allowed or r.hits <> 2 then fallos := fallos || 'el segundo intento (el del tope) debería pasar'; end if;

  -- El tope es «hasta N», no «más de N»: el tercero con límite 2 se rechaza.
  select * into r from public.rate_limit_hit('prueba:a', 2, 60000);
  if r.allowed then fallos := fallos || 'el tercer intento pasó: el límite no frena nada'; end if;
  if r.retry_after < 1 then fallos := fallos || 'retry_after en 0 invita a reintentar al instante'; end if;
  if r.retry_after > 60 then fallos := fallos || 'retry_after mayor que la ventana'; end if;

  -- ── cada clave lleva su cuenta ───────────────────────────────────────────
  -- Sin esto, el intento fallido de una persona bloquearía a toda la empresa.
  select * into r from public.rate_limit_hit('prueba:b', 2, 60000);
  if not r.allowed or r.hits <> 1 then fallos := fallos || 'una clave distinta arrastró el contador de otra'; end if;

  -- ── la ventana se reinicia sola ──────────────────────────────────────────
  -- Se envejece la fila a mano en vez de esperar: la alternativa es una prueba
  -- que tarda un minuto, y una prueba lenta acaba sin ejecutarse.
  update app.rate_limit_bucket set reset_at = now() - interval '1 second' where key = 'prueba:a';
  select * into r from public.rate_limit_hit('prueba:a', 2, 60000);
  if not r.allowed or r.hits <> 1 then
    fallos := fallos || 'la ventana no se reinició: la clave quedaría bloqueada para siempre';
  end if;

  -- ── un límite de 1 rechaza el segundo ────────────────────────────────────
  perform public.rate_limit_hit('prueba:c', 1, 60000);
  select * into r from public.rate_limit_hit('prueba:c', 1, 60000);
  if r.allowed then fallos := fallos || 'con límite 1 pasó el segundo intento'; end if;

  -- ── una ventana diminuta no rompe la función ─────────────────────────────
  select * into r from public.rate_limit_hit('prueba:d', 5, 0);
  if not r.allowed then fallos := fallos || 'una ventana de 0 ms debería seguir dejando pasar el primero'; end if;

  if array_length(fallos, 1) is null then
    raise notice 'rate_limit: TODAS LAS ASERCIONES PASARON';
  else
    raise exception 'rate_limit: %', array_to_string(fallos, ' | ');
  end if;
end $$;

-- ── quién puede llamarla ────────────────────────────────────────────────────
-- Si la pudiera llamar el cliente, inflaría el contador de la clave de OTRA
-- persona hasta dejarla fuera del sistema.
do $$
begin
  if has_function_privilege('anon', 'public.rate_limit_hit(text, integer, integer)', 'execute') then
    raise exception 'rate_limit: anon puede ejecutar la función';
  end if;
  if has_function_privilege('authenticated', 'public.rate_limit_hit(text, integer, integer)', 'execute') then
    raise exception 'rate_limit: authenticated puede ejecutar la función';
  end if;
  if not has_function_privilege('service_role', 'public.rate_limit_hit(text, integer, integer)', 'execute') then
    raise exception 'rate_limit: el rol de servicio NO puede ejecutarla';
  end if;
  raise notice 'rate_limit: permisos de ejecución correctos';
end $$;

rollback;
