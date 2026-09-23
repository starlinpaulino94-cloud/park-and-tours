-- MEDIR ANTES DE ACTIVAR. NO CAMBIA NADA — solo cuenta.
--
-- Sin número a propósito: no acompaña a ninguna migración, y los ficheros
-- numerados de esta carpeta son copias de una. Se ejecuta una vez, antes de
-- desplegar el arreglo del recuento.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTO SE EJECUTA **ANTES** DE DESPLEGAR, NO DESPUÉS
--
-- El recuento de usuarios del plan miraba solo la organización raíz, y la
-- membresía de un usuario de tour center cuelga de la organización del SOCIO.
-- Los usuarios de portal, por tanto, nunca contaron: una operadora con cinco
-- empleados y cuarenta personas repartidas en sus tour centers figuraba con
-- cinco.
--
-- El arreglo los cuenta. Eso significa que hay operadoras que el día del
-- despliegue pasan de «dentro de su plan» a «por encima», sin haber hecho nada
-- — y lo descubrirán al intentar dar de alta a alguien y recibir un 402.
--
-- Esta consulta dice exactamente cuáles y por cuánto, para poder hablar con
-- ellas antes. No es opcional: es la diferencia entre subir un precio avisando
-- y que a alguien le deje de funcionar el sistema un martes.
select
  o.name                                                   as operadora,
  p.name                                                   as plan,
  p.max_users                                              as tope,
  count(*) filter (where m.organization_id = o.id)         as usuarios_contados_antes,
  count(*)                                                 as usuarios_contados_ahora,
  case
    when p.max_users is null                    then 'sin tope declarado'
    when count(*) <= p.max_users                then 'OK — sigue dentro'
    when count(*) filter (where m.organization_id = o.id) > p.max_users
                                                then 'ya estaba por encima'
    else 'SE PASA AL DESPLEGAR — hablar con esta operadora antes'
  end                                                      as efecto
from organizations o
-- `or hijas.id = o.id` no es redundante: la raíz apunta a sí misma, pero lo
-- hace con un UPDATE posterior a su propia creación, así que una fila a la que
-- ese paso le falló se quedaría fuera de su propio recuento — que es la mitad
-- que ya se contaba y la que haría parecer que nadie se pasa.
join organizations hijas on hijas.tenant_org_id = o.id or hijas.id = o.id
join organization_memberships m
  on m.organization_id = hijas.id
 and m.status in ('active','pending')
left join plan p on p.id = o.plan_id
where o.kind = 'tenant'
group by o.id, o.name, p.name, p.max_users
order by
  case when p.max_users is not null and count(*) > p.max_users then 0 else 1 end,
  count(*) desc;
