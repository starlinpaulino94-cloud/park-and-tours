-- ═══════════════════════════════════════════════════════════════════════════
-- 0102 · LAS REFERENCIAS A UNA PERSONA SE COMPRUEBAN SIEMPRE — PARTE 3 DE 3
--
-- Pega esta parte entera en el editor SQL de Supabase y dale a «Run». Las tres
-- partes son independientes y se pueden repetir sin daño: cada una empieza por
-- `drop trigger if exists`.
--
-- QUÉ HACE: registra el disparador `app.enforce_same_tenant_refs` —que ya
-- existe desde 0018— sobre las tablas que guardan referencias a una PERSONA
-- (cliente, vendedor, proveedor) o a un DOCUMENTO SOBRE UNA PERSONA (reserva,
-- venta). Sin él, la llave de servicio puede escribir una fila de tu empresa
-- apuntando a la ficha de otra.
--
-- CUIDADO SI LO EDITAS: el disparador se identifica por NOMBRE. Volver a
-- registrar una tabla con menos columnas de las que ya tenía no añade nada:
-- QUITA lo que había. Pasó con `pickup`, que desde 0018 ya comprobaba la
-- reserva, el hotel y la ruta.
--
-- Cuando termines las tres, corre `0102_parte_4_verificacion.sql`.
-- ═══════════════════════════════════════════════════════════════════════════

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
