-- 0069 · PARTE 4 — vincular la cuenta de vendedor de la DEMOSTRACIÓN.
--
-- Solo hace falta si ya sembraste la empresa de demostración antes de este
-- cambio. El sembrador (`npm run seed:demo-presentation`) ya lo hace solo.
--
-- Toca ÚNICAMENTE cuentas `demo.ventas@…demo.local`, que son las que crea el
-- sembrador y no existen fuera de la demostración. Elige la ficha con más
-- ventas para que la demostración tenga cuerpo, y no pisa un vínculo existente.
with cuenta as (
  select m.organization_id, m.user_id
  from organization_memberships m
  join auth.users u on u.id = m.user_id
  where m.role = 'seller' and m.status = 'active'
    and u.email like 'demo.ventas@%.demo.local'
    -- Si ya tiene ficha, no se toca.
    and not exists (
      select 1 from seller s
      where s.organization_id = m.organization_id and s.user_id = m.user_id
    )
),
elegida as (
  select distinct on (c.organization_id)
         c.organization_id, c.user_id, s.id as seller_id
  from cuenta c
  join seller s on s.organization_id = c.organization_id
               and s.status = 'active' and s.user_id is null
  order by c.organization_id,
           (select count(*) from sales_order so
             where so.organization_id = c.organization_id and so.seller_id = s.id) desc,
           s.id
)
update seller t
   set user_id = e.user_id
  from elegida e
 where t.id = e.seller_id;

-- Y la comprobación, con filas legibles.
select
  o.name                                                     as empresa,
  u.email                                                    as cuenta,
  coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '') as ficha,
  (select count(*) from sales_order so
    where so.organization_id = s.organization_id and so.seller_id = s.id) as ventas_que_vera
from seller s
join organizations o on o.id = s.organization_id
join auth.users u on u.id = s.user_id
where u.email like 'demo.ventas@%.demo.local'
order by o.name;
