-- ═══════════════════════════════════════════════════════════════════════════
-- LIMPIEZA · PARTE 2 de 3 — BORRAR `e2e-tenant`
--
-- Pegar y darle a Run DESPUÉS de haber leído la parte 1. Luego la parte 3.
--
-- ───────────────────────────────────────────────────────────────────────────
-- LOS CUATRO CERROJOS DE ESTE BORRADO
--
--  1. `slug = 'e2e-tenant'` — la empresa del E2E y ninguna otra.
--  2. `metadata->>'purpose' = 'e2e'` — la marca que le puso el arranque del
--     E2E al crearla. Una empresa de verdad que por accidente se llamara igual
--     no la lleva.
--  3. Los `not exists` — si alguien llegó a crear una llave de API, una relación
--     con otra empresa o un usuario de Membego ahí dentro, esto NO borra: esas
--     tablas van en CASCADE y se irían sin avisar. Mejor que no borre nada y
--     tengas que preguntar.
--  4. Las 101 tablas en RESTRICT — reservas, órdenes, facturas, pagos… Si la
--     empresa tuviera cualquiera de ellas, Postgres bloquea el borrado con un
--     error de clave ajena. Esa es la red que impide tirar datos de negocio.
--
-- Si devuelve 0 filas borradas, NO es un fallo: es que algún cerrojo saltó.
-- La parte 3 dice cuál.
-- ═══════════════════════════════════════════════════════════════════════════

delete from organizations o
 where o.slug = 'e2e-tenant'
   and o.metadata->>'purpose' = 'e2e'
   and not exists (select 1 from api_key                   x where x.organization_id = o.id)
   and not exists (select 1 from organization_relationships x where x.from_org_id = o.id or x.to_org_id = o.id)
   and not exists (select 1 from membego_user              x where x.organization_id = o.id)
   and not exists (select 1 from membego_customer          x where x.organization_id = o.id)
   and not exists (select 1 from allotment                 x where x.partner_id = o.id)
   and not exists (select 1 from commission_rule           x where x.partner_id = o.id)
   and not exists (select 1 from price_rule                x where x.partner_id = o.id);
