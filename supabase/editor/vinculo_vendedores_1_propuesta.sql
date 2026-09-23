-- VÍNCULO VENDEDOR↔CUENTA · PASO 1 — QUÉ CUENTAS PODRÍAN SER QUÉ VENDEDORES (solo propone).
--
-- No lleva número de migración a propósito: no es la copia de ninguna, es un
-- procedimiento que se corre una vez, a mano y mirando cada fila.
--
-- Esta consulta NO cambia nada. Empareja por correo las fichas de vendedor sin
-- cuenta con las cuentas del equipo que todavía no son de ningún vendedor.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUÉ SE PROPONE Y NO SE APLICA
--
-- `seller.user_id` decide de quién son las ventas y a quién se le paga. El
-- correo NO es identidad: se teclea a mano en dos sitios distintos, se
-- reutiliza (el correo de la oficina puesto en tres fichas), y cambia. Un
-- emparejamiento automático por correo que acierte el 95 % de las veces
-- significa que a una persona de cada veinte le aparecen las ventas —y la
-- comisión— de otra. Eso no se descubre leyendo un registro: se descubre el día
-- de pago.
--
-- Así que esto se revisa fila por fila y se aplica con el PASO 2, una por una.
select
  s.id                                            as ficha_id,
  trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) as vendedor,
  s.code                                          as codigo,
  s.email                                         as correo_de_la_ficha,
  u.id                                            as cuenta_id,
  u.email                                         as correo_de_la_cuenta,
  m.role                                          as rol_de_la_cuenta,
  (select count(*) from sales_order so
    where so.organization_id = s.organization_id and so.seller_id = s.id) as ventas_de_la_ficha,
  case
    when lower(s.email) = lower(u.email) then 'coincide exacto'
    else 'REVISAR'
  end                                             as confianza
from seller s
join organization_memberships m on m.organization_id = s.organization_id and m.status = 'active'
join auth.users u on u.id = m.user_id
where s.user_id is null
  and s.status = 'active'
  and s.email is not null
  and lower(s.email) = lower(u.email)
  -- Y que esa cuenta no sea ya de otra ficha: una cuenta, un vendedor.
  and not exists (
    select 1 from seller otra
    where otra.organization_id = s.organization_id and otra.user_id = u.id
  )
order by ventas_de_la_ficha desc, vendedor;
