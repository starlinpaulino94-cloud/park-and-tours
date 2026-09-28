-- 0099 · parte 3 de 4 — soltarla, y los permisos
--
-- QUÉ ARREGLA. Treinta ventas simultáneas de una plaza contra una salida de
-- capacidad 10, por el camino que usaba la aplicación: 19 reservas. Nueve
-- pasajeros con asiento que no existe. La venta leía el cupo, decidía fuera y
-- escribía después, sin nada que serializara.
--
-- Ahora la plaza se COGE con cerrojo de fila antes de venderla, y la retención
-- caduca sola a los dos minutos para que una venta muerta no cierre la salida.
--
-- Las partes van EN ORDEN. Aplicar solo la 1 no rompe nada (la columna es
-- aditiva); parar antes de la 4 deja la pantalla sin saber de las retenciones.

-- ── soltarla ───────────────────────────────────────────────────────────────
--
-- Se suelta en dos momentos: cuando la reserva ya está escrita —y entonces la
-- cuenta el reconciliador— y cuando la venta se cae. No hacerlo no rompe nada,
-- solo deja la plaza cogida hasta que caduque; hacerlo devuelve la plaza al
-- instante, que es lo que el siguiente cliente en el mostrador merece.
create or replace function public.release_departure_capacity(
  p_departure_id uuid,
  p_pax integer
) returns void
  language plpgsql security definer set search_path = public, app
as $$
declare
  d record;
  v_retenidas integer;
  v_role text := coalesce(auth.jwt() ->> 'role', 'service_role');
begin
  if p_pax is null or p_pax < 1 then
    raise exception 'pax must be >= 1 (got %)', p_pax using errcode = 'check_violation';
  end if;

  select id, organization_id, hold_pax, hold_until
    into d from departure where id = p_departure_id for update;

  if not found then
    raise exception 'departure % not found', p_departure_id using errcode = 'no_data_found';
  end if;

  if v_role <> 'service_role'
     and (app.current_org_id() is null or d.organization_id <> app.current_org_id()) then
    raise exception 'departure % is outside your organization', p_departure_id
      using errcode = 'insufficient_privilege';
  end if;

  v_retenidas := case
    when d.hold_until is null or d.hold_until <= now() then 0
    else coalesce(d.hold_pax, 0) end;

  update departure
     set hold_pax = greatest(0, v_retenidas - p_pax),
         updated_at = now()
   where id = p_departure_id;
end;
$$;

-- `create or replace` restablece los privilegios por defecto: revocar DESPUÉS.
revoke execute on function public.reserve_departure_capacity(uuid, integer, boolean) from anon, public;
revoke execute on function public.release_departure_capacity(uuid, integer)          from anon, public;
grant  execute on function public.reserve_departure_capacity(uuid, integer, boolean) to authenticated, service_role;
grant  execute on function public.release_departure_capacity(uuid, integer)          to authenticated, service_role;
