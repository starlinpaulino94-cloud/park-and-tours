-- ═══════════════════════════════════════════════════════════════════════════
-- 0102 · LAS REFERENCIAS A UNA PERSONA SE COMPRUEBAN SIEMPRE — PARTE 2 DE 3
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
