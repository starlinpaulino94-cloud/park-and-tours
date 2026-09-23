-- 0075 · PARTE 1 — la cartera propia del tour center.
--
-- Pegar entero y ejecutar. Re-ejecutable.
--
-- Cambia la POLÍTICA de lectura de `customer` y `seller`: pasan a acotarse por
-- socio. El personal interno las sigue viendo enteras —`app.can_read_partner`
-- devuelve cierto cuando quien consulta no tiene identificador de socio—.

alter table customer
  add column if not exists partner_id uuid references organizations(id) on delete set null;

create index if not exists customer_partner_idx on customer (organization_id, partner_id);

comment on column customer.partner_id is
  'El tour center que dio de alta a este cliente, o null si es de la operadora '
  '(0075). El socio solo ve y escribe los suyos; la operadora los ve todos.';

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

-- El relleno: solo cuando no hay ambigüedad. Sin él, la política de arriba le
-- esconde al socio los clientes de sus PROPIAS reservas —hoy ve el nombre en
-- cada una, mañana vería un hueco—. Con un relleno ambicioso le regalaría
-- clientes que también compraron por otro canal.
with unico as (
  select o.customer_id,
         min(o.partner_id::text)::uuid as partner_id
    from sales_order o
   where o.customer_id is not null
   group by o.customer_id
  having count(distinct o.partner_id) = 1
     and count(*) filter (where o.partner_id is null) = 0
)
update customer c
   set partner_id = u.partner_id
  from unico u
 where c.id = u.customer_id
   and c.partner_id is null;
