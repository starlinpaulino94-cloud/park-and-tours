-- 0084 · parte 1 de 3 — La ficha del proveedor y su rol.
--
-- Pégalo entero en el editor SQL de Supabase y ejecútalo. Luego la parte 2.
--
-- QUÉ HACE
--  · `supplier.user_id`: la cuenta con la que el proveedor entra a su portal.
--    Mismo patrón que `seller.user_id` — una persona, una ficha, con su índice
--    único parcial para que dos fichas no se peleen por el mismo usuario.
--  · Añade el rol `supplier` a los permitidos, POR DEBAJO de todos: un
--    proveedor ve menos que nadie, y su rango bajo es lo que hace que ninguna
--    ruta interna le conteste por descuido.
--
-- NO borra ni cambia ninguna fila.

alter table supplier
  add column if not exists user_id uuid references auth.users(id) on delete set null;

comment on column supplier.user_id is
  'La cuenta con la que este proveedor entra a su portal (0084). Mismo patrón '
  'que `seller.user_id`: una persona, una ficha. Los choferes NO usan esta '
  'cuenta — cuelgan del proveedor por `staff.supplier_id`.';

-- ─────────────────────────────────────────────────────────────────────────────
-- UNA CUENTA, UNA FICHA
--
-- Sin esto, dos fichas de proveedor con el mismo usuario dejan al sistema
-- eligiendo una de las dos —la que devuelva la consulta— y esa elección decide
-- qué servicios ve y a quién se le paga. Es el mismo índice que 0069 puso sobre
-- el vendedor, y por el mismo motivo.
--
-- PARCIAL: `user_id` nulo es lo normal —un proveedor sin portal— y dos nulos no
-- pueden chocar. Declararlo parcial lo dice en voz alta y ahorra entradas.
create unique index if not exists supplier_user_once_idx
  on supplier (organization_id, user_id)
  where user_id is not null;

create index if not exists supplier_user_lookup_idx
  on supplier (user_id) where user_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- EL ROL, POR DEBAJO DE TODOS
--
-- El proveedor ve menos que nadie: un tour center vende y cobra; un
-- transportista opera un servicio que ya se vendió. Su rango bajo es lo que
-- hace que ninguna ruta interna le conteste por descuido — incluidas las
-- veintiuna que hoy exigen rango `seller`, que el plan pedía auditar antes de
-- crear este rol.
--
-- Pero el rango NO es el aislamiento: eso lo decide el identificador. El rango
-- solo dice hasta dónde llega el permiso.

alter table organization_memberships
  drop constraint if exists organization_memberships_role_check;
alter table organization_memberships
  add constraint organization_memberships_role_check
  check (role in ('superadmin','owner','admin','manager','operations','cashier','seller','partner','supplier'));

-- ─────────────────────────────────────────────────────────────────────────────
-- EL IDENTIFICADOR EN EL TOKEN, Y SU AYUDA PARA LA RLS

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- La columna, el índice, y que el rol nuevo esté admitido.
select 'columna user_id' as que, count(*)::text as valor
  from information_schema.columns
 where table_schema='public' and table_name='supplier' and column_name='user_id'
union all
select 'indice una cuenta una ficha', count(*)::text
  from pg_indexes where tablename='supplier' and indexname='supplier_user_once_idx'
union all
select 'rol supplier admitido',
       (pg_get_constraintdef(oid) ilike '%supplier%')::text
  from pg_constraint where conname='organization_memberships_role_check';
