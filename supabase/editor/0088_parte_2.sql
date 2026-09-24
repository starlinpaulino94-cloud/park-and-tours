-- 0088 · parte 2 de 2 — Que se rellene sola, y que la politica la cierre.
--
-- Ejecuta la parte 1 ANTES que esta.
--
-- QUE HACE
--  · Copia el proveedor y la fecha desde la ruta, al escribir la parada.
--  · Y los MUEVE cuando la ruta cambia de proveedor o de fecha. Las dos mitades
--    hacen falta: con solo la primera, reasignar una ruta deja al chofer
--    anterior viendo los clientes de un servicio que ya no es suyo.
--  · Rellena lo que ya existe, o el primer chofer que entre ve su hoja vacia.
--  · Y la politica por proveedor, en la misma entrega: lo que hay al otro lado
--    de una parada es una persona con su hotel, su habitacion y su telefono.

create or replace function app.fill_pickup_from_route()
returns trigger language plpgsql as $fn$
begin
  if new.route_id is null then
    new.supplier_id  := null;
    new.service_date := null;
  else
    select r.supplier_id, r.service_date
      into new.supplier_id, new.service_date
      from pickup_route r where r.id = new.route_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists pickup_supplier on pickup;
create trigger pickup_supplier
before insert or update of route_id on pickup
for each row execute function app.fill_pickup_from_route();

create or replace function app.sync_pickup_from_route()
returns trigger language plpgsql as $fn2$
begin
  update pickup
     set supplier_id  = new.supplier_id,
         service_date = new.service_date
   where route_id = new.id
     and (supplier_id is distinct from new.supplier_id
       or service_date is distinct from new.service_date);
  return null;
end;
$fn2$;

drop trigger if exists pickup_route_sync_pickups on pickup_route;
create trigger pickup_route_sync_pickups
after update on pickup_route
for each row when (new.supplier_id is distinct from old.supplier_id
                or new.service_date is distinct from old.service_date)
execute function app.sync_pickup_from_route();

update pickup p
   set supplier_id  = r.supplier_id,
       service_date = r.service_date
  from pickup_route r
 where r.id = p.route_id
   and p.supplier_id is null;

drop policy if exists tenant_select on public.pickup;
create policy tenant_select on public.pickup for select
  using (organization_id = app.current_org_id() and app.can_read_supplier(supplier_id));

-- ── VERIFICACION ───────────────────────────────────────────────────────────
-- No deberia quedar ninguna parada CON ruta y SIN proveedor, salvo las rutas
-- que son de la propia operadora (ahi el nulo es la respuesta correcta).
select count(*) filter (where supplier_id is not null)                          as con_proveedor,
       count(*) filter (where supplier_id is null and route_id is not null)      as sin_proveedor_con_ruta,
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'pickup'
           and qual like '%can_read_supplier%')                                  as politica_por_proveedor
  from pickup;
