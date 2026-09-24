-- 0086 — La fecha del servicio, donde se consulta.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA MISMA HISTORIA QUE EL PROVEEDOR, Y QUE LA COMISIÓN
--
-- Un recurso de salida y una ruta de recogida no saben CUÁNDO son: la fecha
-- vive en `departure.departure_at`, una tabla unida, y la capa de consulta de
-- esta aplicación no sabe filtrar ni ordenar por ahí. Es exactamente lo que
-- obligó a copiar la fecha de servicio a `commission` en 0070 y el
-- identificador de proveedor a estas dos tablas en 0085.
--
-- Lo que se hace hoy sin esta columna está en `asset-impact.ts`: pedir
-- quinientas filas y filtrar por fecha EN MEMORIA. Funciona hasta la fila
-- quinientos uno, que desaparece sin que nada avise — y en el portal del
-- proveedor esa fila es un servicio que alguien tiene que ir a prestar.
alter table departure_resource
  add column if not exists service_date timestamptz;
alter table pickup_route
  add column if not exists service_date timestamptz;

comment on column departure_resource.service_date is
  'Cuándo es este servicio, copiado de `departure.departure_at` (0086). Vive '
  'aquí porque es donde se filtra y se ordena; la capa de consulta no sabe '
  'hacerlo por columna de una tabla unida.';

create index if not exists departure_resource_service_date_idx
  on departure_resource (organization_id, supplier_id, service_date desc);
create index if not exists pickup_route_service_date_idx
  on pickup_route (organization_id, supplier_id, service_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- SE RELLENA SOLA, Y SE MUEVE CUANDO LA SALIDA SE MUEVE
--
-- Las dos mitades hacen falta. Con solo la primera, reprogramar una salida deja
-- a sus recursos con la fecha vieja: el proveedor vería el servicio el día que
-- no es, o dejaría de verlo en «próximos» estando todavía por delante.
--
-- Y es la diferencia con la fecha de la comisión (0070), que se copia UNA vez y
-- NO se mueve a propósito: allí reprogramar cambiaría el período de liquidación
-- de un dinero ya devengado. Aquí no hay dinero devengado, hay una guagua que
-- tiene que estar en un sitio a una hora.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- EL RELLENO DE LO QUE YA EXISTE
--
-- Sin esto, todo lo anterior a esta migración se queda sin fecha y no sale ni
-- en «próximos» ni en «pasados»: el portal del proveedor nacería vacío.
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
