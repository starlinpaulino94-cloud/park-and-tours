-- VÍNCULO VENDEDOR↔CUENTA · PASO 3 — quién sigue sin cuenta, y cuántas ventas deja de ver.
--
-- Después de vincular lo que se pueda, esto dice qué fichas quedan sueltas.
-- Una ficha sin cuenta NO es un problema por sí misma: hay vendedores que no
-- entran al sistema (los de la calle, los del hotel que solo mandan gente). Lo
-- que importa es al revés — una CUENTA con rol de vendedor sin ficha, que es
-- quien entra y no ve nada. Eso lo dice `0069_parte_3_quien_no_esta_vinculado.sql`.
select
  trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) as vendedor,
  s.code                                          as codigo,
  coalesce(s.email, '(sin correo)')               as correo,
  (select count(*) from sales_order so
    where so.organization_id = s.organization_id and so.seller_id = s.id) as ventas_atribuidas,
  case when s.user_id is null then 'SIN CUENTA' else 'vinculada' end as acceso
from seller s
where s.organization_id = (select organization_id from seller limit 1)  -- ← ajusta si tienes varias
  and s.status = 'active'
order by (s.user_id is null) desc, ventas_atribuidas desc;
