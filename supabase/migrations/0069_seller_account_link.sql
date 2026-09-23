-- 0069 — El vínculo entre una cuenta y su ficha de vendedor.
--
-- No crea nada nuevo: `seller.user_id` existe desde 0005. Lo que cambia es que
-- ahora ese vínculo DECIDE lo que la persona ve (`src/lib/seller-scope.ts`), así
-- que se consulta en cada petición de quien entra con rol de vendedor.
--
-- DOS COSAS, EN UN SOLO ÍNDICE
--
--  1. VELOCIDAD. Con `seller_org_idx (organization_id, status)` esa consulta
--     recorría todas las fichas activas de la empresa para encontrar una.
--  2. UNA CUENTA, UNA FICHA. Sin unicidad, duplicar una ficha por error —lo
--     normal cuando alguien cambia de sucursal o de partner— dejaba dos
--     apuntando a la misma cuenta, y qué ventas vería esa persona dependía de
--     cuál devolviera la base primero. Un ámbito que cambia según el orden de
--     las filas no es un ámbito.
--
-- Es parcial porque la mayoría de las fichas no tienen cuenta: indexar los nulos
-- ocuparía sitio sin responder nunca a esta pregunta, y además dos fichas SIN
-- cuenta no son un duplicado —son dos vendedores que aún no entran al sistema—.
--
-- Si falla al aplicarse, hay fichas duplicadas que resolver antes:
--   select organization_id, user_id, count(*)
--     from seller where user_id is not null
--    group by 1, 2 having count(*) > 1;
create unique index if not exists seller_user_unique_idx
  on seller (organization_id, user_id)
  where user_id is not null;
