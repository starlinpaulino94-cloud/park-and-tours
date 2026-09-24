-- 0088 — La hoja de ruta: de quién es cada parada, y a qué hora se marcó.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE HABÍA, Y POR QUÉ NO SE PODÍA ABRIR AL CHOFER
--
-- `loadRunSheet(companyId, routeId)` ya existe y devuelve, por parada, el
-- nombre del cliente, su hotel, su habitación y su teléfono. Y no recibe ningún
-- actor: cualquiera con sesión en la empresa podía pedir CUALQUIER ruta.
--
-- Mientras los únicos con sesión eran empleados eso era un permiso que faltaba.
-- Desde 0084 hay proveedores con cuenta, así que es la lista de clientes de la
-- operadora a un identificador de distancia — el actor con más datos de
-- terceros a tiro, leyendo los de todos.
--
-- Acotarla exige saber de quién es cada parada, y eso hoy solo se sabe uniendo
-- `pickup -> pickup_route -> supplier_id`. La capa de consulta de esta
-- aplicación no sabe filtrar por columna de una tabla unida — cuarta vez que
-- aparece, después de la fecha de la comisión (0070), el proveedor en recursos
-- (0085) y la fecha de servicio (0086).
alter table pickup
  add column if not exists supplier_id  uuid references supplier(id) on delete set null,
  add column if not exists service_date timestamptz;

comment on column pickup.supplier_id is
  'De qué proveedor es esta parada, copiado de su ruta (0088). Vive aquí '
  'porque es donde se filtra: lo que hay al otro lado de esta fila es el '
  'nombre, el hotel, la habitación y el teléfono de un cliente.';

create index if not exists pickup_supplier_idx
  on pickup (organization_id, supplier_id, service_date desc)
  where supplier_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- RECOGIDO Y NO-SHOW, CON HORA Y CON NOMBRE
--
-- El estado ya distinguía `picked_up` de `no_show` desde 0011 y nadie escribía
-- ninguno de los dos. Lo que faltaba es lo que convierte esa palabra en algo
-- que se pueda discutir: CUÁNDO se marcó y QUIÉN lo marcó.
--
-- Un no-show es una acusación —«este cliente no bajó»— que acaba en una
-- reclamación y a veces en un reembolso que alguien no cobra. Sin hora, la
-- discusión es la palabra del chofer contra la del turista. Con la hora al lado
-- de `planned_time` se ve si se esperó o si se marcó desde la siguiente parada.
--
-- UNA sola marca de tiempo, no una por estado: la verdad es el estado actual, y
-- el historial de correcciones vive en la bitácora, que nadie puede reescribir
-- desde la aplicación.
alter table pickup
  add column if not exists marked_at  timestamptz,
  add column if not exists marked_by  uuid references auth.users(id) on delete set null,
  add column if not exists marked_via text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pickup_marked_via_ck') then
    alter table pickup add constraint pickup_marked_via_ck
      check (marked_via is null or marked_via in ('chofer','operacion'));
  end if;
end $$;

comment on column pickup.marked_at is
  'Cuándo se marcó el estado ACTUAL de esta parada (0088). Junto a '
  '`planned_time` es lo que dice si el chofer esperó antes de declarar un '
  'no-show; sin ella, esa discusión es la palabra de uno contra la del otro.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Y LO RELLENA UN DISPARADOR, COMO EN 0085 Y 0086
--
-- Copiado a mano se queda viejo el día que alguien mueva una parada de ruta
-- desde otra pantalla — y entonces el chofer de A seguiría viendo a un cliente
-- que ahora recoge B, o dejaría de ver al que sí le toca.
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

-- Y la otra mitad: cuando la RUTA cambia de proveedor o de fecha, sus paradas
-- se van con ella. Sin esto, reasignar una ruta deja al chofer anterior viendo
-- los clientes de un servicio que ya no es suyo.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- EL RELLENO DE LO QUE YA EXISTE
--
-- Sin esto, todas las paradas anteriores se quedan sin proveedor —es decir, «de
-- la operadora»— y el primer chofer que entre ve su hoja de ruta vacía.
update pickup p
   set supplier_id  = r.supplier_id,
       service_date = r.service_date
  from pickup_route r
 where r.id = p.route_id
   and p.supplier_id is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- LA POLÍTICA, EN LA MISMA ENTREGA
--
-- Con más motivo que en ninguna otra tabla de esta fase: lo que hay al otro
-- lado de una parada es una persona con su hotel, su habitación y su teléfono.
--
-- `can_read_supplier` (0084) devuelve cierto cuando quien consulta no es un
-- proveedor, así que el personal interno lo sigue viendo todo.
drop policy if exists tenant_select on public.pickup;
create policy tenant_select on public.pickup for select
  using (organization_id = app.current_org_id() and app.can_read_supplier(supplier_id));
