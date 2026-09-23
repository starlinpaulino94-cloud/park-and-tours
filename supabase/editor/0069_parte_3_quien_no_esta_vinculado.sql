-- 0069 · PARTE 3 — ¿quién entra con rol de vendedor, y tiene ficha vinculada?
--
-- Desde este cambio, lo que un vendedor ve depende de `seller.user_id`. Quien
-- salga aquí como «SIN FICHA» solo verá las ventas que no tienen vendedor
-- asignado. El remedio está en la pantalla: Vendedores → abrir la ficha →
-- «Cuenta de acceso».
--
-- Esta consulta NO cambia nada: solo informa.
select
  o.name                                        as empresa,
  u.email                                       as cuenta,
  coalesce(u.raw_user_meta_data->>'name', '—')  as nombre_de_la_cuenta,
  case
    when s.id is null then '⚠ SIN FICHA — solo verá ventas sin vendedor'
    else 'OK → ' || coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')
  end                                           as ficha_vinculada,
  (select count(*) from sales_order so
    where so.organization_id = m.organization_id and so.seller_id = s.id) as ventas_que_vera
from organization_memberships m
join organizations o on o.id = m.organization_id
join auth.users u on u.id = m.user_id
left join seller s
       on s.organization_id = m.organization_id
      and s.user_id = m.user_id
      and s.status = 'active'
where m.role = 'seller' and m.status = 'active'
order by (s.id is null) desc, o.name, u.email;
