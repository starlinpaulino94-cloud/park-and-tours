-- 0085 · parte 2 de 2 — La política de lectura.
--
-- Ejecuta la parte 1 ANTES que esta.
--
-- QUÉ HACE
--  · Sustituye la política de lectura de las dos tablas para que un proveedor
--    solo vea sus filas. Aquí con más motivo que en ninguna otra: lo que hay al
--    otro lado de una ruta de recogida son los clientes con su hotel, su
--    habitación y su teléfono.
--
-- `can_read_supplier` (0084) devuelve cierto cuando quien consulta NO es un
-- proveedor, así que el personal interno lo sigue viendo todo.
--
-- NO borra ni cambia ninguna fila.

do $pol$
declare
  t text;
begin
  foreach t in array array['departure_resource', 'pickup_route'] loop
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format(
      'create policy tenant_select on public.%I for select '
      'using (organization_id = app.current_org_id() and app.can_read_supplier(supplier_id))',
      t
    );
  end loop;
end $pol$;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Tienen que salir las DOS, con `can_read_supplier` dentro.
select polrelid::regclass as tabla,
       pg_get_expr(polqual, polrelid) as condicion
  from pg_policy
 where polrelid in ('public.departure_resource'::regclass, 'public.pickup_route'::regclass)
   and polname = 'tenant_select'
 order by tabla;
