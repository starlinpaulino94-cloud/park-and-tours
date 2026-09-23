-- 0084 — El proveedor entra al sistema.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL MISMO PATRÓN, POR TERCERA VEZ
--
-- El vendedor (fase 1) y el tour center (fase 4) ya pasaron por aquí. La forma
-- es la misma y conviene decirlo en voz alta, porque la tentación en el tercero
-- es inventarse una cuarta:
--
--   1. Un IDENTIFICADOR en el contexto, no un nombre de rol. El aislamiento por
--      nombre es la puerta trasera que cerró 4.2 — un empleado de un tour
--      center con otro rol pasaba de largo.
--   2. El identificador en el token, para que la RLS pueda acotarlo.
--   3. Y su estado consultado en CADA petición, para que desactivar a alguien
--      surta efecto ahora y no cuando su sesión se renueve.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ `supplier.user_id` Y NO UNA ORGANIZACIÓN
--
-- El tour center es una fila de `organizations` con `kind='partner'`, y por eso
-- su identificador sale de la membresía. El proveedor NO: `supplier` es su
-- propia tabla desde 0009, con su tipo, sus condiciones de pago y su saldo, y
-- media aplicación ya apunta ahí —`departure_resource`, `supplier_settlement`,
-- `staff.supplier_id`—. Convertirlo en organización sería migrar todo eso para
-- no ganar nada.
--
-- Así que la cuenta se vincula como la del vendedor: una columna `user_id` en
-- su propia ficha.
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
create or replace function app.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public, app
as $hook$
declare
  claims  jsonb := coalesce(event->'claims', '{}'::jsonb);
  uid     uuid  := (event->>'user_id')::uuid;
  m       record;
  v_supplier uuid;
begin
  select mem.role, mem.status, org.id as org_id, org.kind, org.tenant_org_id
    into m
    from organization_memberships mem
    join organizations org on org.id = mem.organization_id
   where mem.user_id = uid
     and mem.status = 'active'
   order by mem.is_primary desc, mem.created_at asc
   limit 1;

  if m.org_id is not null then
    -- La ficha de proveedor, acotada a la empresa de la membresía: sin ese
    -- filtro, una ficha de otra operadora con el mismo usuario metería en el
    -- token un proveedor que no es de esta empresa.
    select s.id into v_supplier
      from supplier s
     where s.user_id = uid
       and s.status = 'active'
       and s.organization_id = coalesce(m.tenant_org_id, m.org_id)
     limit 1;

    claims := claims
      || jsonb_build_object('org_id', coalesce(m.tenant_org_id, m.org_id))
      || jsonb_build_object('app_role', m.role)
      || jsonb_build_object('status', m.status)
      || jsonb_build_object('partner_id',
           case when m.kind = 'partner' then m.org_id else null end)
      || jsonb_build_object('supplier_id', v_supplier);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$hook$;

-- El permiso va pegado a la definición, no en una migración posterior: entre
-- una y otra habría una ventana en la que cualquiera puede invocarla.
revoke all on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin, service_role;
