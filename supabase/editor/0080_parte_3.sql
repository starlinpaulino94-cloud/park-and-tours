-- 0080 · parte 3 de 3 — La política de lectura del monedero.
--
-- Ejecuta las partes 1 y 2 ANTES que esta.
--
-- QUÉ HACE
--  · Activa RLS en `partner_wallet_movement` con ámbito de socio: cada tour
--    center ve SUS movimientos y no los de la agencia de enfrente —que dirían
--    cuánto ingresa y cuánto vende—, y el personal interno los ve todos.
--
-- NO borra ni cambia ninguna fila.

select app.enable_tenant_rls('public.partner_wallet_movement', true);

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Tiene que salir `tenant_select` con `can_read_partner` dentro.
select polname,
       pg_get_expr(polqual, polrelid) as condicion
  from pg_policy
 where polrelid = 'public.partner_wallet_movement'::regclass
 order by polname;
