-- 0085 · parte 1 de 2 — La columna de proveedor y quien la rellena.
--
-- Pégalo entero en el editor SQL de Supabase y ejecútalo. Luego la parte 2.
--
-- QUÉ HACE
--  · `supplier_id` en `departure_resource` y `pickup_route`. El vínculo ya
--    existía, pero de LADO: el recurso apunta al vehículo o a la persona, y son
--    ellos los que cuelgan del proveedor. Para acotar habría que filtrar por
--    columna de una tabla unida, y la capa de consulta no sabe hacerlo — un
--    filtro sobre una columna que no existe NO da error: devuelve la empresa
--    entera.
--  · Un disparador que la rellena sola, para que no se quede vieja el día que
--    alguien cambie el vehículo desde otra pantalla.
--  · Y el relleno de lo que ya existe, copiando lo que el vínculo de lado ya
--    dice hoy. Sin él, el primer proveedor que entre verá su portal vacío
--    aunque lleve seis meses conduciendo.
--
-- MANDA EL VEHÍCULO, Y CUANDO NO HAY, LA PERSONA. Con un autobús de A y un
-- chofer de B, la ruta queda de A y el chofer de B no la ve: enseñar de menos
-- en una pantalla llena de datos de clientes se arregla con una llamada;
-- enseñar de más, no.
--
-- NO borra ninguna fila. Las actualiza para ponerles su proveedor.

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

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Cuántas filas quedaron con proveedor y cuántas sin él (sin él = de la
-- operadora, que es lo normal en la mayoría).
select 'departure_resource' as tabla,
       count(*) filter (where supplier_id is not null) as con_proveedor,
       count(*) filter (where supplier_id is null)     as de_la_operadora
  from departure_resource
union all
select 'pickup_route',
       count(*) filter (where supplier_id is not null),
       count(*) filter (where supplier_id is null)
  from pickup_route;
