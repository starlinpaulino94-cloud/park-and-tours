-- 0084 · parte 2 de 3 — Las ayudas de ámbito del proveedor.
--
-- Ejecuta la parte 1 ANTES que esta. Luego la parte 3.
--
-- QUÉ HACE
--  · `app.current_supplier_id()`: el proveedor de quien consulta, del token.
--  · `app.can_read_supplier()`: el ámbito por fila, con la misma forma que el
--    del socio — devuelve cierto cuando quien consulta NO es proveedor, así que
--    el personal interno lo sigue viendo todo.
--
-- Todavía no las usa ninguna política: eso llega con las tablas que se abran.
--
-- NO borra ni cambia ninguna fila.

create or replace function app.current_supplier_id() returns uuid
  language sql stable as $$
    select nullif(auth.jwt() ->> 'supplier_id', '')::uuid
  $$;

comment on function app.current_supplier_id() is
  'El proveedor de quien consulta (0084), o nulo para todos los demás. Mismo '
  'papel que `app.current_partner_id()`.';

-- Y el ámbito por fila, con la misma forma que el del socio. Devuelve cierto
-- cuando quien consulta NO es un proveedor, así que el personal interno sigue
-- viéndolo todo: sin esa rama, activar esta política en una tabla dejaría la
-- pantalla de la operadora vacía.
create or replace function app.can_read_supplier(row_supplier uuid) returns boolean
  language sql stable as $$
    select app.current_supplier_id() is null
        or row_supplier = app.current_supplier_id()
  $$;

comment on function app.can_read_supplier(uuid) is
  'Ámbito del proveedor por IDENTIFICADOR (0084): sin `supplier_id` en el '
  'token se ve todo; con él, solo las filas de ese proveedor.';

-- Una función `stable` que lee el token no la llama nadie de fuera. Mismo
-- tratamiento que sus hermanas desde 0019.
revoke execute on function app.current_supplier_id() from anon, public;
revoke execute on function app.can_read_supplier(uuid) from anon, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- EL CLAIM
--
-- `create or replace` NO conserva los atributos que no se repiten: `security
-- definer` y el `search_path` tienen que estar en TODA definición del enganche.
-- Sin `definer` corre como `supabase_auth_admin`, se le aplica la RLS, su
-- política llama a `auth.uid()` —esquema al que ese rol no accede— y GoTrue
-- devuelve 500: nadie obtiene sesión. Es lo que arregló 0063 y se repite aquí
-- palabra por palabra para no volver a perderlo.

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Las dos funciones, y SIN permiso para `anon`.
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as la_puede_llamar_anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='app' and p.proname in ('current_supplier_id','can_read_supplier')
 order by p.proname;
