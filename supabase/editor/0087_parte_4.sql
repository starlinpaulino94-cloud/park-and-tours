-- 0087 · parte 4 de 5 — Asignar es preguntar, y reasignar es revocar.
--
-- Ejecuta las partes 1, 2 y 3 ANTES que esta.
--
-- QUÉ HACE
--  · El estado de aceptación lo pone la BASE en cuanto la fila cambia de
--    proveedor, no la pantalla que asigna. Dejarlo en manos de quien escribe
--    significa que el día que se asigne desde otro sitio el servicio saldría
--    sin que nadie lo hubiera pedido.
--  · Revoca los enlaces vivos al reasignar. Si el servicio pasa de A a B y el
--    enlace de A sigue valiendo, A acepta un servicio que ya no es suyo.
--  · Y rellena lo que ya está asignado y todavía no ha pasado.
--
-- AVISO: después de esto, cada proveedor verá DE GOLPE todos sus servicios
-- futuros esperando respuesta. No es un fallo, es el arranque de la función.
-- Conviene avisarles antes de ejecutarlo.

create or replace function app.set_acceptance_on_assign()
returns trigger language plpgsql as $fn$
declare
  v_horas    integer;
  v_deadline timestamptz;
begin
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id then
    return new;
  end if;

  new.responded_at        := null;
  new.responded_by        := null;
  new.response_note       := null;
  new.responded_via       := null;
  new.confirmation_number := null;

  if new.supplier_id is null then
    -- Vuelve a ser de la casa: no hay a quién preguntarle.
    new.acceptance          := 'not_required';
    new.acceptance_deadline := null;
    return new;
  end if;

  select acceptance_window_hours into v_horas from supplier where id = new.supplier_id;
  -- Veinticuatro horas por defecto, y el mismo número está escrito en el
  -- dominio para que la pantalla pueda decir el plazo antes de guardar nada.
  v_deadline := now() + make_interval(hours => coalesce(v_horas, 24));

  -- EL PLAZO NUNCA PASA DE LA SALIDA. Un plazo que vence después de que el
  -- servicio ocurra no es un plazo: es un recordatorio para después del
  -- entierro. Y un servicio asignado con la salida encima nace con el plazo ya
  -- vencido, que es la verdad — no hay tiempo de contestar.
  if new.service_date is not null and new.service_date < v_deadline then
    v_deadline := new.service_date;
  end if;

  new.acceptance          := 'pending';
  new.acceptance_deadline := v_deadline;
  return new;
end;
$fn$;

drop trigger if exists departure_resource_supplier_acceptance on departure_resource;
create trigger departure_resource_supplier_acceptance
before insert or update on departure_resource
for each row execute function app.set_acceptance_on_assign();

drop trigger if exists pickup_route_supplier_acceptance on pickup_route;
create trigger pickup_route_supplier_acceptance
before insert or update on pickup_route
for each row execute function app.set_acceptance_on_assign();

do $orden$
declare
  t text;
begin
  foreach t in array array['departure_resource', 'pickup_route'] loop
    if (t || '_supplier_acceptance') <= (t || '_supplier') then
      raise exception 'El disparador de aceptación de % ordena ANTES que el que calcula el proveedor', t;
    end if;
    if not exists (
      select 1 from pg_trigger
       where tgrelid = t::regclass and tgname = t || '_supplier_acceptance'
    ) then
      raise exception 'Falta el disparador de aceptación en %', t;
    end if;
  end loop;
end $orden$;

create or replace function app.revoke_supplier_tokens()
returns trigger language plpgsql as $fn2$
begin
  if tg_op = 'DELETE' then
    delete from supplier_response_token
     where resource_kind = tg_table_name and resource_id = old.id;
    return null;
  end if;

  update supplier_response_token
     set revoked_at = now(),
         revoked_reason = 'reasignado'
   where resource_kind = tg_table_name
     and resource_id = new.id
     and used_at is null
     and revoked_at is null;
  return null;
end;
$fn2$;

drop trigger if exists departure_resource_token_revoke on departure_resource;
create trigger departure_resource_token_revoke
after update on departure_resource
for each row when (new.supplier_id is distinct from old.supplier_id)
execute function app.revoke_supplier_tokens();

drop trigger if exists pickup_route_token_revoke on pickup_route;
create trigger pickup_route_token_revoke
after update on pickup_route
for each row when (new.supplier_id is distinct from old.supplier_id)
execute function app.revoke_supplier_tokens();

drop trigger if exists departure_resource_token_cleanup on departure_resource;
create trigger departure_resource_token_cleanup
after delete on departure_resource
for each row execute function app.revoke_supplier_tokens();

drop trigger if exists pickup_route_token_cleanup on pickup_route;
create trigger pickup_route_token_cleanup
after delete on pickup_route
for each row execute function app.revoke_supplier_tokens();

update departure_resource dr
   set acceptance = 'pending',
       acceptance_deadline = least(dr.service_date,
                                  now() + make_interval(hours => coalesce(s.acceptance_window_hours, 24)))
  from supplier s
 where s.id = dr.supplier_id
   and dr.acceptance = 'not_required'
   and dr.service_date is not null
   and dr.service_date > now()
   and dr.status in ('planned', 'confirmed');

update pickup_route pr
   set acceptance = 'pending',
       acceptance_deadline = least(pr.service_date,
                                  now() + make_interval(hours => coalesce(s.acceptance_window_hours, 24)))
  from supplier s
 where s.id = pr.supplier_id
   and pr.acceptance = 'not_required'
   and pr.service_date is not null
   and pr.service_date > now()
   and pr.status in ('planned', 'confirmed');

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Los dos de aceptación tienen que salir DESPUÉS de los de proveedor: Postgres
-- dispara los `before` por orden alfabético, y este necesita el proveedor ya
-- calculado.
select tgrelid::regclass::text as tabla, tgname as disparador
  from pg_trigger
 where tgrelid in ('departure_resource'::regclass, 'pickup_route'::regclass)
   and not tgisinternal
 order by tabla, disparador;
