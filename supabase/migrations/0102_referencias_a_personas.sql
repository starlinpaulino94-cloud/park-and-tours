-- ═══════════════════════════════════════════════════════════════════════════
-- 0102 — LAS REFERENCIAS A UNA PERSONA SE COMPRUEBAN SIEMPRE (DB-001)
--
-- ───────────────────────────────────────────────────────────────────────────
-- QUÉ ES DB-001, Y QUÉ NO SE ARREGLA AQUÍ
--
-- Ninguna clave foránea de este esquema es compuesta `(organization_id, id)`,
-- así que la base no impide que una fila de la empresa A apunte a una fila de
-- la B. Con RLS puesta, una sesión normal no puede hacerlo —no ve la fila
-- ajena—; lo que queda expuesto es la escritura con la LLAVE DE SERVICIO, que
-- es la que usa toda la aplicación por detrás.
--
-- Hacer compuestas las claves de un esquema de 115 tablas en producción no es
-- una migración, es un proyecto. La mitigación que este repositorio eligió es
-- `app.enforce_same_tenant_refs`: un disparador que comprueba, fila a fila, que
-- lo referenciado sea de la misma empresa.
--
-- Medido: 141 referencias entre tablas de inquilino sin ninguna comprobación.
--
-- ───────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTAS 36 Y NO LAS 141
--
-- Cada referencia comprobada cuesta una lectura por fila insertada, así que
-- cubrirlas todas no es gratis y el techo de `tenant_refs.test.sql` admite que
-- queden huecos. Hacía falta un criterio escrito en vez de un gusto, y es éste:
--
--   **Se comprueba toda referencia a una PERSONA —cliente, vendedor,
--   proveedor— o a un DOCUMENTO SOBRE UNA PERSONA —reserva, venta—.**
--
-- El motivo es que en esas dos familias una referencia cruzada no es un dato
-- raro: es el expediente de alguien colgando de la empresa equivocada. Un caso
-- de atención al cliente, una encuesta, una tarea o una entrada en lista de
-- espera apuntando al cliente de otra operadora mezcla a dos personas que no se
-- conocen, y lo hace en tablas que se expanden en pantallas.
--
-- Las que quedan fuera —almacén, mantenimiento, turnos, activos— refieren cosas
-- y no personas: un movimiento de stock mal apuntado es un número que cuadrar,
-- no la ficha de un tercero.
--
-- ───────────────────────────────────────────────────────────────────────────
-- LA MÁS CARA DE LA LISTA, Y NO ES DE DINERO
--
-- `supplier_response_token.supplier_id`. Ese token es LA LLAVE del portal del
-- proveedor: el enlace de un solo uso con el que alguien acepta o rechaza un
-- servicio sin tener cuenta. Apuntando a un proveedor de otra empresa, ese
-- enlace abre el portal de otro. Es autenticación, no contabilidad.
--
-- ───────────────────────────────────────────────────────────────────────────
-- LA TRAMPA DEL NOMBRE, QUE ESTA MIGRACIÓN PISÓ
--
-- El disparador no se configura por tabla: se configura por NOMBRE, y todas las
-- migraciones de aquí usan la misma convención `<tabla>_same_tenant_refs` con
-- un `drop trigger if exists` delante. Así que registrar una tabla que YA tenía
-- disparador no añade referencias: las SUSTITUYE.
--
-- `pickup` ya lo tenía desde 0018 con `booking_id`, `hotel_id` y `route_id`.
-- Registrarlo aquí con `supplier_id` a secas costó tres comprobaciones para
-- ganar una, y lo cazó el techo de `tenant_refs.test.sql` al dar 108 donde
-- esperaba 105. Abajo se repiten las tres de 0018; la verificación del final
-- las exige por su nombre, y `ui-contracts.test.ts` comprueba que ninguna
-- migración futura pueda encoger un disparador anterior.
--
-- ───────────────────────────────────────────────────────────────────────────
-- NOTA SOBRE EL COSTE
--
-- Son tablas de volumen bajo —tareas, incidencias, encuestas, lista de espera,
-- compras— y no el camino de la venta, que ya estaba cubierto y medido en 0097
-- (0,66 ms de disparadores por reserva). Aquí se paga una lectura por alta, en
-- altas que un humano hace de una en una.
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists approval_request_same_tenant_refs on approval_request;
create trigger approval_request_same_tenant_refs
before insert or update of organization_id, booking_id, order_id on approval_request
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'order_id', 'sales_order'
);

drop trigger if exists asset_same_tenant_refs on asset;
create trigger asset_same_tenant_refs
before insert or update of organization_id, supplier_id on asset
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

drop trigger if exists crm_activity_same_tenant_refs on crm_activity;
create trigger crm_activity_same_tenant_refs
before insert or update of organization_id, customer_id on crm_activity
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer'
);

drop trigger if exists customer_same_tenant_refs on customer;
create trigger customer_same_tenant_refs
before insert or update of organization_id, assigned_seller_id on customer
for each row execute function app.enforce_same_tenant_refs(
  'assigned_seller_id', 'seller'
);

drop trigger if exists departure_resource_same_tenant_refs on departure_resource;
create trigger departure_resource_same_tenant_refs
before insert or update of organization_id, supplier_id on departure_resource
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

drop trigger if exists expense_same_tenant_refs on expense;
create trigger expense_same_tenant_refs
before insert or update of organization_id, supplier_id on expense
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

drop trigger if exists guest_case_same_tenant_refs on guest_case;
create trigger guest_case_same_tenant_refs
before insert or update of organization_id, booking_id, customer_id, order_id on guest_case
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'customer_id', 'customer',
  'order_id', 'sales_order'
);

drop trigger if exists guest_survey_same_tenant_refs on guest_survey;
create trigger guest_survey_same_tenant_refs
before insert or update of organization_id, booking_id, customer_id on guest_survey
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'customer_id', 'customer'
);

drop trigger if exists incident_same_tenant_refs on incident;
create trigger incident_same_tenant_refs
before insert or update of organization_id, booking_id, customer_id on incident
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'customer_id', 'customer'
);

drop trigger if exists inventory_item_same_tenant_refs on inventory_item;
create trigger inventory_item_same_tenant_refs
before insert or update of organization_id, supplier_id on inventory_item
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

drop trigger if exists lead_same_tenant_refs on lead;
create trigger lead_same_tenant_refs
before insert or update of organization_id, customer_id, seller_id on lead
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer',
  'seller_id', 'seller'
);

drop trigger if exists membership_same_tenant_refs on membership;
create trigger membership_same_tenant_refs
before insert or update of organization_id, customer_id, order_id on membership
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer',
  'order_id', 'sales_order'
);

drop trigger if exists pickup_route_same_tenant_refs on pickup_route;
create trigger pickup_route_same_tenant_refs
before insert or update of organization_id, supplier_id on pickup_route
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

-- `pickup` YA TENÍA disparador desde 0018, con tres referencias. Como el nombre
-- es el mismo, registrar sólo `supplier_id` lo habría SUSTITUIDO y habría dejado
-- sin comprobar la reserva, el hotel y la ruta: tres referencias perdidas a
-- cambio de una ganada. Se repiten aquí las tres de 0018 y se añade la cuarta.
drop trigger if exists pickup_same_tenant_refs on pickup;
create trigger pickup_same_tenant_refs
before insert or update of organization_id, booking_id, hotel_id, route_id, supplier_id on pickup
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'hotel_id', 'hotel',
  'route_id', 'pickup_route',
  'supplier_id', 'supplier'
);

drop trigger if exists price_rule_same_tenant_refs on price_rule;
create trigger price_rule_same_tenant_refs
before insert or update of organization_id, seller_id on price_rule
for each row execute function app.enforce_same_tenant_refs(
  'seller_id', 'seller'
);

drop trigger if exists product_cost_same_tenant_refs on product_cost;
create trigger product_cost_same_tenant_refs
before insert or update of organization_id, supplier_id on product_cost
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

drop trigger if exists purchase_order_same_tenant_refs on purchase_order;
create trigger purchase_order_same_tenant_refs
before insert or update of organization_id, supplier_id on purchase_order
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

drop trigger if exists seller_same_tenant_refs on seller;
create trigger seller_same_tenant_refs
before insert or update of organization_id, supervisor_id on seller
for each row execute function app.enforce_same_tenant_refs(
  'supervisor_id', 'seller'
);

drop trigger if exists staff_same_tenant_refs on staff;
create trigger staff_same_tenant_refs
before insert or update of organization_id, supplier_id on staff
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

drop trigger if exists stock_movement_same_tenant_refs on stock_movement;
create trigger stock_movement_same_tenant_refs
before insert or update of organization_id, order_id on stock_movement
for each row execute function app.enforce_same_tenant_refs(
  'order_id', 'sales_order'
);

drop trigger if exists supplier_response_token_same_tenant_refs on supplier_response_token;
create trigger supplier_response_token_same_tenant_refs
before insert or update of organization_id, supplier_id on supplier_response_token
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

drop trigger if exists task_same_tenant_refs on task;
create trigger task_same_tenant_refs
before insert or update of organization_id, booking_id, customer_id, order_id on task
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'customer_id', 'customer',
  'order_id', 'sales_order'
);

drop trigger if exists vehicle_same_tenant_refs on vehicle;
create trigger vehicle_same_tenant_refs
before insert or update of organization_id, supplier_id on vehicle
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

drop trigger if exists waitlist_entry_same_tenant_refs on waitlist_entry;
create trigger waitlist_entry_same_tenant_refs
before insert or update of organization_id, booking_id, customer_id, seller_id on waitlist_entry
for each row execute function app.enforce_same_tenant_refs(
  'booking_id', 'booking',
  'customer_id', 'customer',
  'seller_id', 'seller'
);

drop trigger if exists work_order_same_tenant_refs on work_order;
create trigger work_order_same_tenant_refs
before insert or update of organization_id, supplier_id on work_order
for each row execute function app.enforce_same_tenant_refs(
  'supplier_id', 'supplier'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
--
-- Lo que se comprueba no es «se aplicó la migración» sino «quedaron puestas las
-- comprobaciones»: un `create trigger` puede correr sin error y dejar menos de
-- lo que había, porque el disparador se identifica por NOMBRE y el nombre se
-- reutiliza. Pasó con `pickup` y por eso se comprueba aquí por su nombre.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  faltan text[];
  ESPERADO constant text[] := array[
    'approval_request', 'asset', 'crm_activity', 'customer', 'departure_resource',
    'expense', 'guest_case', 'guest_survey', 'incident', 'inventory_item',
    'lead', 'membership', 'pickup', 'pickup_route', 'price_rule',
    'product_cost', 'purchase_order', 'seller', 'staff', 'stock_movement',
    'supplier_response_token', 'task', 'vehicle', 'waitlist_entry', 'work_order'
  ];
begin
  select array_agg(e.tabla order by e.tabla) into faltan
    from unnest(ESPERADO) as e(tabla)
   where not exists (
     select 1 from pg_trigger t
      where t.tgname = e.tabla || '_same_tenant_refs'
        and t.tgrelid = e.tabla::regclass
        and not t.tgisinternal
   );

  if faltan is not null then
    raise exception '0102: sin disparador de inquilino: %', array_to_string(faltan, ', ');
  end if;
  raise notice '0102: 25 tablas con disparador de inquilino';
end $$;

do $$
declare
  v_cols text[];
begin
  -- `pickup` ES el caso: ya tenía disparador desde 0018 con tres referencias, y
  -- registrarlo de nuevo con una sola lo habría sustituido. Se exige que las
  -- cuatro estén, por su nombre, porque un recuento que no cuadra por tres es
  -- una pista y no un diagnóstico.
  select array_agg(a.attname order by a.attname) into v_cols
    from pg_trigger t
    join lateral unnest(t.tgattr) as col(attnum) on true
    join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
   where t.tgname = 'pickup_same_tenant_refs'
     and t.tgrelid = 'pickup'::regclass
     and not t.tgisinternal;

  if v_cols is null then
    raise exception '0102: pickup_same_tenant_refs no existe';
  end if;
  if not (v_cols @> array['booking_id', 'hotel_id', 'organization_id', 'route_id', 'supplier_id']) then
    raise exception '0102: pickup_same_tenant_refs perdió columnas de 0018: quedó en %',
      array_to_string(v_cols, ', ');
  end if;
  raise notice '0102: pickup conserva las tres referencias de 0018 y suma el proveedor';
end $$;
