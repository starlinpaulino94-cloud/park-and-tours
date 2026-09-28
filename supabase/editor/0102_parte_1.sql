-- ═══════════════════════════════════════════════════════════════════════════
-- 0102 · LAS REFERENCIAS A UNA PERSONA SE COMPRUEBAN SIEMPRE — PARTE 1 DE 3
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
