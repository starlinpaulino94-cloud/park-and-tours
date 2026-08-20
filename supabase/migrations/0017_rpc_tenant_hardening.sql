-- ============================================================================
-- 0017 — SEC-002 / DB-002: cerrar la ejecución por `anon` de las RPC de cupo.
--
-- PROBLEMA (verificado con exploit reproducible)
--   0001 hizo `alter default privileges ... grant execute on functions to
--   authenticated, anon, service_role`, de modo que las funciones SECURITY
--   DEFINER de 0008 quedaron invocables SIN AUTENTICAR. Y su comprobación de
--   tenant era:
--
--       if app.current_org_id() is not null and d.organization_id <> ...
--
--   Para `anon` no hay JWT, así que `current_org_id()` es NULL y la
--   comprobación se saltaba ENTERA. Un usuario autenticado de otro tenant sí
--   quedaba bloqueado; el no autenticado, no.
--
--   Reproducción (Postgres 16 local, migraciones 0001-0016):
--       set role anon;
--       select reserve_departure_capacity('<uuid de otra org>', 8);  --> true
--       -- booked_pax pasó de 0 a 8 y status a 'almost_full'
--       select release_departure_capacity('<uuid de otra org>', 8);  --> ok
--
--   Impacto: agotar o liberar el cupo de salidas de cualquier tenant sin
--   credenciales, sólo con el UUID de la salida.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. Retira EXECUTE a `anon` y `public` sobre ambas funciones.
--   2. Cambia la comprobación a FALLAR CERRADA: sólo `service_role` —que pasa
--      el scope explícitamente desde el servidor— queda exento.
--   3. Añade comprobación de tenant a `release_departure_capacity`, que no
--      tenía ninguna.
--
-- NOTA: la RLS de las tablas de negocio YA estaba correctamente activada por
-- 0007 y 0015 (155 llamadas a app.enable_tenant_rls, 83/83 tablas con RLS,
-- aislamiento verificado con pruebas de lectura/escritura/borrado cruzadas).
-- Esta migración NO toca RLS.
--
-- IDEMPOTENTE.
-- ============================================================================

-- ── 1. Retirar la ejecución a `anon` ────────────────────────────────────────
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema app    revoke execute on functions from anon;

revoke execute on function public.reserve_departure_capacity(uuid, integer, boolean) from anon, public;
revoke execute on function public.release_departure_capacity(uuid, integer)          from anon, public;

-- ── 2. Comprobación de tenant que falla CERRADA ─────────────────────────────
create or replace function public.reserve_departure_capacity(
  p_departure_id uuid,
  p_pax integer,
  p_override boolean default false
) returns boolean
  language plpgsql security definer set search_path = public, app
as $$
declare
  d record;
  -- Sin JWT (conexión directa del servidor / ETL) el llamante es de confianza.
  -- Con JWT, el claim `role` distingue service_role de authenticated/anon.
  v_role text := coalesce(auth.jwt() ->> 'role', 'service_role');
begin
  if p_pax is null or p_pax < 1 then
    raise exception 'pax must be >= 1 (got %)', p_pax using errcode = 'check_violation';
  end if;

  select id, organization_id, capacity, booked_pax, pending_pax, status
    into d from departure where id = p_departure_id for update;

  if not found then
    raise exception 'departure % not found', p_departure_id using errcode = 'no_data_found';
  end if;

  -- FALLA CERRADA: cualquier llamante que no sea service_role debe traer un
  -- org_id y debe coincidir. Antes, un org_id ausente se saltaba el control.
  if v_role <> 'service_role'
     and (app.current_org_id() is null or d.organization_id <> app.current_org_id()) then
    raise exception 'departure % is outside your organization', p_departure_id
      using errcode = 'insufficient_privilege';
  end if;

  if d.status in ('cancelled','closed','completed') then
    raise exception 'departure % is % and cannot take bookings', p_departure_id, d.status
      using errcode = 'check_violation';
  end if;

  if d.capacity > 0 and not p_override
     and (d.booked_pax + d.pending_pax + p_pax) > d.capacity then
    return false;
  end if;

  update departure
     set booked_pax = booked_pax + p_pax,
         status = case
           when capacity > 0 and (booked_pax + p_pax + pending_pax) >= capacity then 'full'
           when capacity > 0 and (booked_pax + p_pax + pending_pax) >= capacity * 0.8 then 'almost_full'
           else status end,
         updated_at = now()
   where id = p_departure_id;

  return true;
end;
$$;

-- ── 3. `release_departure_capacity` no tenía NINGUNA comprobación ───────────
create or replace function public.release_departure_capacity(
  p_departure_id uuid,
  p_pax integer
) returns void
  language plpgsql security definer set search_path = public, app
as $$
declare
  d record;
  v_role text := coalesce(auth.jwt() ->> 'role', 'service_role');
begin
  if p_pax is null or p_pax < 1 then
    raise exception 'pax must be >= 1 (got %)', p_pax using errcode = 'check_violation';
  end if;

  select id, organization_id into d from departure where id = p_departure_id for update;

  if not found then
    raise exception 'departure % not found', p_departure_id using errcode = 'no_data_found';
  end if;

  if v_role <> 'service_role'
     and (app.current_org_id() is null or d.organization_id <> app.current_org_id()) then
    raise exception 'departure % is outside your organization', p_departure_id
      using errcode = 'insufficient_privilege';
  end if;

  update departure
     set booked_pax = greatest(0, booked_pax - p_pax),
         status = case when status = 'full' then 'available' else status end,
         updated_at = now()
   where id = p_departure_id;
end;
$$;

-- `create or replace function` restablece los privilegios por defecto: revocar
-- de nuevo DESPUÉS de redefinirlas.
revoke execute on function public.reserve_departure_capacity(uuid, integer, boolean) from anon, public;
revoke execute on function public.release_departure_capacity(uuid, integer)          from anon, public;
grant  execute on function public.reserve_departure_capacity(uuid, integer, boolean) to authenticated, service_role;
grant  execute on function public.release_departure_capacity(uuid, integer)          to authenticated, service_role;

-- ── 4. Aserción: `anon` no puede ejecutar ninguna SECURITY DEFINER ──────────
do $$
declare n integer;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname in ('public','app') and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n > 0 then
    raise exception 'Quedan % funciones SECURITY DEFINER ejecutables por anon', n;
  end if;
end $$;
