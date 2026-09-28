-- 0099 · parte 2 de 4 — coger la plaza con cerrojo
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

-- ── la retención ───────────────────────────────────────────────────────────
create or replace function public.reserve_departure_capacity(
  p_departure_id uuid,
  p_pax integer,
  p_override boolean default false
) returns boolean
  language plpgsql security definer set search_path = public, app
as $$
declare
  d record;
  v_retenidas integer;
  -- Sin JWT (conexión directa del servidor / ETL) el llamante es de confianza.
  v_role text := coalesce(auth.jwt() ->> 'role', 'service_role');
  -- Dos minutos: de sobra para que la venta escriba sus filas, y poco para que
  -- una venta muerta no bloquee la plaza más que un rato.
  RETENCION constant interval := interval '2 minutes';
begin
  if p_pax is null or p_pax < 1 then
    raise exception 'pax must be >= 1 (got %)', p_pax using errcode = 'check_violation';
  end if;

  -- Cerrojo de fila: aquí se serializan las ventas de la MISMA salida. Las de
  -- salidas distintas no se estorban.
  select id, organization_id, capacity, booked_pax, pending_pax, status, hold_pax, hold_until
    into d from departure where id = p_departure_id for update;

  if not found then
    raise exception 'departure % not found', p_departure_id using errcode = 'no_data_found';
  end if;

  -- FALLA CERRADA (0017): quien no sea service_role tiene que traer org_id y
  -- tiene que coincidir.
  if v_role <> 'service_role'
     and (app.current_org_id() is null or d.organization_id <> app.current_org_id()) then
    raise exception 'departure % is outside your organization', p_departure_id
      using errcode = 'insufficient_privilege';
  end if;

  if d.status in ('cancelled','closed','completed') then
    raise exception 'departure % is % and cannot take bookings', p_departure_id, d.status
      using errcode = 'check_violation';
  end if;

  -- Una retención caducada no ocupa. Se evalúa aquí y no con un barrido: así
  -- no depende de que ningún cron esté vivo.
  v_retenidas := case
    when d.hold_until is null or d.hold_until <= now() then 0
    else coalesce(d.hold_pax, 0) end;

  if d.capacity > 0 and not p_override
     and (d.booked_pax + d.pending_pax + v_retenidas + p_pax) > d.capacity then
    return false;
  end if;

  update departure
     set hold_pax   = v_retenidas + p_pax,
         hold_until = now() + RETENCION,
         updated_at = now()
   where id = p_departure_id;

  return true;
end;
$$;
