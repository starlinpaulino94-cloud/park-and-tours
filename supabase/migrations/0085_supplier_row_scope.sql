-- 0085 — El proveedor solo ve lo suyo, y se filtra por COLUMNA.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ DESNORMALIZADO, Y NO POR UNIÓN
--
-- El vínculo con el proveedor existe, pero de lado: un recurso de salida
-- apunta a un vehículo o a una persona, y son ELLOS los que cuelgan del
-- proveedor (`vehicle.supplier_id`, `staff.supplier_id`). Para acotar habría
-- que filtrar por una columna de una tabla unida, y la capa de consulta de esta
-- aplicación no sabe hacerlo — es la misma razón por la que la fecha de
-- servicio tuvo que copiarse a `commission` en 0070.
--
-- El riesgo de no hacerlo es peor que la incomodidad: un filtro sobre una
-- columna que no existe NO da error, devuelve la empresa entera. Es el «fallo
-- silencioso» que el plan marca como riesgo transversal, y aquí lo que se
-- devolvería son los nombres, los teléfonos y las habitaciones de los clientes
-- de otro proveedor.
alter table departure_resource
  add column if not exists supplier_id uuid references supplier(id) on delete set null;
alter table pickup_route
  add column if not exists supplier_id uuid references supplier(id) on delete set null;

create index if not exists departure_resource_supplier_idx
  on departure_resource (organization_id, supplier_id)
  where supplier_id is not null;
create index if not exists pickup_route_supplier_idx
  on pickup_route (organization_id, supplier_id)
  where supplier_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Y LO RELLENA UN DISPARADOR, NO QUIEN ESCRIBE
--
-- Un dato desnormalizado que se copia a mano es un dato que se queda viejo: el
-- día que alguien cambie el vehículo de una ruta desde otra pantalla, el
-- proveedor seguiría viendo un servicio que ya no es suyo — o dejaría de ver el
-- que sí. Y en esta tabla «ver» significa leer datos personales de terceros.
--
-- MANDA EL VEHÍCULO, Y CUANDO NO HAY, LA PERSONA.
--
-- Una ruta puede llevar un autobús alquilado a A y un chofer de la casa, o al
-- revés. Lo que se compra en un servicio de transporte es el vehículo, así que
-- decide él; sin vehículo —un guía, un coordinador— decide la persona.
--
-- Cuando el autobús es de A y el chofer de B, la ruta queda de A y el chofer de
-- B no la ve en su portal. Es deliberado: enseñar de menos en una pantalla
-- llena de datos de clientes se arregla con una llamada; enseñar de más, no.
create or replace function app.fill_supplier_from_resource()
returns trigger language plpgsql as $fn$
declare
  v_supplier uuid;
  -- Por `to_jsonb` y no por `new.vehicle_id`: el mismo disparador sirve a las
  -- dos tablas, y una nombra al chofer `staff_id` y la otra `driver_id`.
  -- Escribirlo dos veces sería tener dos reglas que hay que acordarse de
  -- cambiar juntas.
  v_vehicle  uuid := nullif(to_jsonb(new) ->> 'vehicle_id', '')::uuid;
  v_staff    uuid := nullif(
                       coalesce(to_jsonb(new) ->> 'staff_id', to_jsonb(new) ->> 'driver_id'),
                     '')::uuid;
begin
  if v_vehicle is not null then
    select supplier_id into v_supplier from vehicle where id = v_vehicle;
  end if;

  if v_supplier is null and v_staff is not null then
    select supplier_id into v_supplier from staff where id = v_staff;
  end if;

  new.supplier_id := v_supplier;
  return new;
end;
$fn$;

drop trigger if exists departure_resource_supplier on departure_resource;
create trigger departure_resource_supplier
before insert or update of vehicle_id, staff_id on departure_resource
for each row execute function app.fill_supplier_from_resource();

drop trigger if exists pickup_route_supplier on pickup_route;
create trigger pickup_route_supplier
before insert or update of vehicle_id, driver_id on pickup_route
for each row execute function app.fill_supplier_from_resource();

-- ─────────────────────────────────────────────────────────────────────────────
-- EL RELLENO DE LO QUE YA EXISTE
--
-- No inventa nada: copia lo que el vínculo de lado ya dice hoy. Sin esto, todas
-- las filas anteriores se quedan con la columna nula —o sea, «de la
-- operadora»— y el primer proveedor que entre verá su portal vacío aunque
-- lleve seis meses conduciendo.
-- En dos pasadas, que además deja escrito cuál gana. El vehículo primero:
update departure_resource dr
   set supplier_id = v.supplier_id
  from vehicle v
 where v.id = dr.vehicle_id
   and v.supplier_id is not null
   and dr.supplier_id is null;

update pickup_route pr
   set supplier_id = v.supplier_id
  from vehicle v
 where v.id = pr.vehicle_id
   and v.supplier_id is not null
   and pr.supplier_id is null;

-- Y la persona, solo donde el vehículo no dijo nada:
update departure_resource dr
   set supplier_id = s.supplier_id
  from staff s
 where s.id = dr.staff_id
   and s.supplier_id is not null
   and dr.supplier_id is null;

update pickup_route pr
   set supplier_id = s.supplier_id
  from staff s
 where s.id = pr.driver_id
   and s.supplier_id is not null
   and pr.supplier_id is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- LA POLÍTICA, EN LA MISMA ENTREGA
--
-- El riesgo transversal del plan, y aquí con más motivo que en ninguna otra
-- tabla: lo que hay al otro lado de una ruta de recogida son los clientes con
-- su hotel, su habitación y su teléfono.
--
-- `can_read_supplier` (0084) devuelve cierto cuando quien consulta no es un
-- proveedor, así que el personal interno lo sigue viendo todo.
do $pol$
declare
  t text;
begin
  foreach t in array array['departure_resource', 'pickup_route'] loop
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format(
      'create policy tenant_select on public.%I for select '
      'using (organization_id = app.current_org_id() and app.can_read_supplier(supplier_id))',
      t
    );
  end loop;
end $pol$;
