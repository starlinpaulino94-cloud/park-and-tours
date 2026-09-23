-- 0075 · PARTE 2 — la comprobación, con filas legibles.
select
  'columna customer.partner_id'                                as comprobacion,
  case when count(*) = 1 then 'OK' else 'FALTA' end            as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'customer' and column_name = 'partner_id'

union all

select
  'política por socio en customer y seller',
  case when count(*) = 2 then 'OK — las dos'
       else 'FALTAN — solo ' || count(*)::text end
from pg_policies
where schemaname = 'public'
  and tablename in ('customer','seller')
  and policyname = 'tenant_select'
  and qual like '%can_read_partner%'

union all

select
  'clientes asignados a un tour center',
  count(*)::text || ' de ' ||
  (select count(*)::text from customer) || ' clientes'
from customer where partner_id is not null

union all

-- La que importa después del relleno: cuántos clientes se quedaron sin asignar
-- AUNQUE todas sus compras fueran de un solo socio. Debería ser cero; si no lo
-- es, el relleno no llegó a correr.
select
  'clientes de un solo socio que quedaron sin asignar',
  count(*)::text || ' fila(s)'
from (
  select o.customer_id
    from sales_order o
    join customer c on c.id = o.customer_id
   where o.customer_id is not null and c.partner_id is null
   group by o.customer_id
  having count(distinct o.partner_id) = 1
     and count(*) filter (where o.partner_id is null) = 0
) pendientes;
