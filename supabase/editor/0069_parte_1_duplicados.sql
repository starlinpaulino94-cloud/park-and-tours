-- 0069 · PARTE 1 — ¿hay alguna cuenta vinculada a dos fichas de vendedor?
--
-- Se mira ANTES de crear el índice único: si sale alguna fila, el índice fallará
-- y hay que decidir primero cuál de las fichas se queda con la cuenta.
--
-- Lo esperado es «0 filas». Pegar y ejecutar tal cual.
select
  o.name                                   as empresa,
  s.user_id                                as cuenta,
  count(*)                                 as fichas,
  string_agg(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, ''), ' | ') as nombres,
  string_agg(s.id::text, ' | ')            as ids_de_ficha
from seller s
join organizations o on o.id = s.organization_id
where s.user_id is not null
group by o.name, s.user_id
having count(*) > 1
order by fichas desc;
