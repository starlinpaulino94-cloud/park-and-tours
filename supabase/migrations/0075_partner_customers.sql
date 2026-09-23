-- 0075 — El tour center tiene su propia cartera de clientes.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE BLOQUEABA LA VENTA DESDE EL PORTAL
--
-- `POST /api/orders` acepta al socio desde hace tiempo y le fuerza su propio
-- `partner_id`. Lo que no puede es terminar una venta: exige `customer_id`, y
-- el socio no tenía forma de crear ni de buscar un cliente. `customer` no está
-- en su ámbito —lo vería ENTERO, que es la cartera de la operadora— y el CRUD
-- genérico le deniega toda escritura.
--
-- Así que la pieza que falta es una columna: de quién es cada cliente.
alter table customer
  add column if not exists partner_id uuid references organizations(id) on delete set null;

create index if not exists customer_partner_idx on customer (organization_id, partner_id);

comment on column customer.partner_id is
  'El tour center que dio de alta a este cliente, o null si es de la operadora '
  '(0075). El socio solo ve y escribe los suyos; la operadora los ve todos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Y LA POLÍTICA, EN LA MISMA ENTREGA
--
-- El riesgo transversal del plan lo dice con todas las letras: cada tabla que
-- se abre a un actor nuevo necesita su política en la misma fase. Aquí hay algo
-- más fuerte que eso — sin la política, la aplicación filtraría por socio y la
-- BASE seguiría diciendo que ese socio puede leer la cartera entera. Una
-- política que contradice a la aplicación es la que alguien cita el día que se
-- discute qué pasó.
--
-- `seller` va en el mismo saco, y es una deuda de la entrega anterior: 5.1 la
-- abrió al socio como tabla propia en la aplicación y la política se quedó como
-- estaba. Se cierra aquí.
--
-- `app.can_read_partner` devuelve cierto cuando quien consulta no tiene
-- identificador de socio, así que el personal interno las sigue viendo enteras.
do $$
declare
  t text;
begin
  foreach t in array array['customer', 'seller'] loop
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format(
      'create policy tenant_select on public.%I for select '
      'using (organization_id = app.current_org_id() and app.can_read_partner(partner_id))',
      t
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- EL RELLENO, Y POR QUÉ NO HACERLO SERÍA QUITAR ALGO
--
-- Sin esto, la política de arriba le esconde al socio los clientes de sus
-- PROPIAS reservas: hoy ve el nombre en cada una, y mañana vería un hueco.
--
-- Se rellena solo cuando no hay ambigüedad: el cliente tiene al menos una orden
-- y TODAS sus órdenes son del mismo socio. Un cliente que ha comprado por dos
-- tour centers distintos, o directamente a la operadora, se queda sin asignar
-- —de la operadora—, que es la respuesta prudente: el socio deja de verlo en la
-- ficha pero lo sigue viendo en su reserva, y nadie gana acceso a nada nuevo.
--
-- Y no quita nada a la operadora: `can_read_partner` la deja ver todo.
with unico as (
  select o.customer_id,
         min(o.partner_id::text)::uuid as partner_id
    from sales_order o
   where o.customer_id is not null
   -- OJO: no se filtran aquí las órdenes sin socio. Filtrarlas sacaría del
   -- grupo justo las que hacen ambiguo el caso —un cliente con una compra por
   -- el tour center y otra directa— y el `having` de abajo las daría por
   -- inexistentes. Se agrupan TODAS y se exige que ninguna sea directa.
   group by o.customer_id
  having count(distinct o.partner_id) = 1
     and count(*) filter (where o.partner_id is null) = 0
)
update customer c
   set partner_id = u.partner_id
  from unico u
 where c.id = u.customer_id
   and c.partner_id is null;
