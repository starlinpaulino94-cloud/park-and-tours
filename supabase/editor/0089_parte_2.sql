-- 0089 · parte 2 de 2 — Las politicas, acumuladas.
--
-- Ejecuta la parte 1 ANTES que esta.
--
-- QUE HACE
--  · Pone `settlement` y `booking_cost` en el ambito del proveedor.
--  · La de `settlement` ya filtraba por socio desde 0007: aqui se le AÑADE la
--    del proveedor sin quitarle la del socio. Reescribirla con solo la nueva
--    habria abierto a cada tour center las liquidaciones de los demas.
--  · `payable` NO entra, y es deliberado: es el libro de la operadora y el
--    proveedor no tiene nada que hacer leyendolo.
--
-- NO borra ni cambia ninguna fila.

drop policy if exists tenant_select on public.settlement;
create policy tenant_select on public.settlement for select
  using (organization_id = app.current_org_id()
     and app.can_read_partner(partner_id)
     and app.can_read_supplier(supplier_id));

drop policy if exists tenant_select on public.booking_cost;
create policy tenant_select on public.booking_cost for select
  using (organization_id = app.current_org_id()
     and app.can_read_supplier(supplier_id));

-- ── VERIFICACION ───────────────────────────────────────────────────────────
-- La de `settlement` tiene que nombrar a los DOS: socio y proveedor.
select tablename,
       qual like '%can_read_partner%'  as filtra_por_socio,
       qual like '%can_read_supplier%' as filtra_por_proveedor
  from pg_policies
 where schemaname = 'public'
   and tablename in ('settlement','booking_cost')
   and policyname = 'tenant_select'
 order by tablename;
