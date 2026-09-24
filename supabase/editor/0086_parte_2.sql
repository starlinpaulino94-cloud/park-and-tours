-- 0086 · parte 2 de 2 — Que se rellene sola y se mueva con la salida.
--
-- Ejecuta la parte 1 ANTES que esta.
--
-- QUÉ HACE
--  · Rellena la fecha al escribir el recurso o la ruta.
--  · Y la MUEVE cuando la salida se reprograma. Las dos mitades hacen falta:
--    con solo la primera, reprogramar deja a los recursos con la fecha vieja y
--    el proveedor ve el servicio el día que no es — o deja de verlo en
--    «próximos» estando todavía por delante.
--  · Y rellena lo que ya existe. Sin eso, el portal del proveedor nace vacío.
--
-- NO borra ninguna fila. Actualiza las existentes para ponerles su fecha.

create or replace function app.fill_service_date_from_departure()
returns trigger language plpgsql as $fn$
begin
  if new.departure_id is null then
    new.service_date := null;
  else
    select d.departure_at into new.service_date
      from departure d where d.id = new.departure_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists departure_resource_service_date on departure_resource;
create trigger departure_resource_service_date
before insert or update of departure_id on departure_resource
for each row execute function app.fill_service_date_from_departure();

drop trigger if exists pickup_route_service_date on pickup_route;
create trigger pickup_route_service_date
before insert or update of departure_id on pickup_route
for each row execute function app.fill_service_date_from_departure();

-- Y la otra mitad: cuando la salida se mueve, se llevan sus hijos con ella.
create or replace function app.sync_service_date_to_children()
returns trigger language plpgsql as $fn2$
begin
  update departure_resource
     set service_date = new.departure_at
   where departure_id = new.id
     and service_date is distinct from new.departure_at;

  update pickup_route
     set service_date = new.departure_at
   where departure_id = new.id
     and service_date is distinct from new.departure_at;

  return null;
end;
$fn2$;

drop trigger if exists departure_service_date_sync on departure;
create trigger departure_service_date_sync
after update of departure_at on departure
for each row execute function app.sync_service_date_to_children();

update departure_resource dr
   set service_date = d.departure_at
  from departure d
 where d.id = dr.departure_id
   and dr.service_date is null;

update pickup_route pr
   set service_date = d.departure_at
  from departure d
 where d.id = pr.departure_id
   and pr.service_date is null;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- No debería quedar ninguna fila CON salida y SIN fecha.
select 'departure_resource' as tabla,
       count(*) filter (where service_date is not null) as con_fecha,
       count(*) filter (where service_date is null and departure_id is not null) as sin_fecha_con_salida
  from departure_resource
union all
select 'pickup_route',
       count(*) filter (where service_date is not null),
       count(*) filter (where service_date is null and departure_id is not null)
  from pickup_route;
