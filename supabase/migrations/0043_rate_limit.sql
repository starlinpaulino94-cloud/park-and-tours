-- ═══════════════════════════════════════════════════════════════════════════
-- 0043 — EL LÍMITE DE PETICIONES, COMPARTIDO ENTRE INSTANCIAS
--
-- POR QUÉ
--
-- El limitador vivía en un `Map` dentro del proceso. En un servidor de siempre
-- eso funciona; sobre funciones sin estado —que es donde corre esto— cada
-- instancia tiene su propio mapa, así que el límite real es «lo configurado
-- MULTIPLICADO por el número de instancias», y ese número lo elige el
-- proveedor según la carga: cuanto más fuerte es el ataque, más instancias
-- levanta y más permisivo se vuelve el límite. Justo al revés de lo que hace
-- falta.
--
-- En la práctica significaba que «10 intentos de SSO por minuto» no frenaba a
-- quien prueba firmas contra `/sso/membego`, que «60 consultas de saldo por
-- minuto» no impedía enumerar códigos de gift card, y que «3 exportaciones
-- completas por hora» no impedía descargar la base entera en bucle.
--
-- CÓMO
--
-- Un contador en la base, incrementado en UNA sola sentencia. No hace falta
-- Redis ni un servicio nuevo: la ventana es un `upsert` atómico, y Postgres ya
-- está ahí. Leer, decidir y escribir desde la aplicación —que es la
-- alternativa sin función— deja la ventana por la que dos peticiones
-- simultáneas pasan las dos.
--
-- La tabla vive en `app` (que PostgREST no expone) y la función solo la puede
-- ejecutar el rol de servicio: si un cliente pudiera llamarla, inflaría el
-- contador de la clave de OTRO y lo dejaría fuera del sistema.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists app.rate_limit_bucket (
  key        text primary key,
  hits       integer not null default 0,
  reset_at   timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Para la limpieza: sin él, borrar lo vencido recorre la tabla entera.
create index if not exists rate_limit_bucket_reset_idx on app.rate_limit_bucket (reset_at);

-- ── el contador ────────────────────────────────────────────────────────────
--
-- Devuelve si la petición pasa, cuántas van en la ventana y cuántos segundos
-- faltan para que se abra de nuevo. `security definer` porque la tabla está en
-- `app` y quien llama es el rol de servicio: no hay RLS que aplicar aquí, esto
-- no son datos de ningún inquilino.
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_ms integer)
returns table (allowed boolean, hits integer, retry_after integer)
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_hits  integer;
  v_reset timestamptz;
  v_win   interval := make_interval(secs => greatest(p_window_ms, 1) / 1000.0);
begin
  -- Una sola sentencia: incrementa si la ventana sigue viva, o la reinicia si
  -- ya venció. Dos peticiones a la vez se serializan en el candado de la fila.
  insert into app.rate_limit_bucket as rb (key, hits, reset_at, updated_at)
       values (p_key, 1, now() + v_win, now())
  on conflict (key) do update
     set hits       = case when rb.reset_at <= now() then 1 else rb.hits + 1 end,
         reset_at   = case when rb.reset_at <= now() then now() + v_win else rb.reset_at end,
         updated_at = now()
  returning rb.hits, rb.reset_at into v_hits, v_reset;

  -- Limpieza de vez en cuando, en la propia petición: un cron para esto sería
  -- una pieza más que mantener, y la tabla solo crece con claves vencidas.
  if random() < 0.005 then
    delete from app.rate_limit_bucket where reset_at < now() - interval '1 hour';
  end if;

  return query
    select v_hits <= p_limit,
           v_hits,
           greatest(1, ceil(extract(epoch from (v_reset - now())))::integer);
end $$;

-- Nunca la llama el cliente: inflaría el contador de otra persona a voluntad.
revoke execute on function public.rate_limit_hit(text, integer, integer) from public;
revoke execute on function public.rate_limit_hit(text, integer, integer) from anon;
revoke execute on function public.rate_limit_hit(text, integer, integer) from authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- La tabla tampoco se lee desde fuera. RLS activa y sin políticas: el rol de
-- servicio la salta por definición, cualquier otro se queda sin nada.
alter table app.rate_limit_bucket enable row level security;
