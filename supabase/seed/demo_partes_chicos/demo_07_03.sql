-- demo_07 · trozo 3 de 3. EJECUTAR EN ORDEN.
-- Pegar ENTERO (Ctrl+A en el archivo, Ctrl+V aquí) y darle a Run.
-- Si sale «syntax error at end of input», el editor lo cortó: repite el pegado.

insert into inventory_item (id, organization_id, name, sku, item_type, unit, cost, price, currency,
    min_stock, reorder_point, is_sellable, supplier_id, status) values
  (md5('demo:' || ('inv:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Agua embotellada 500ml', 'AGUA-500', 'beverage', 'unit', 0.3, 1, 'usd', 200, 300, true, md5('demo:' || ('sup:4'))::uuid, 'active'),
  (md5('demo:' || ('inv:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Ron Brugal (litro)', 'RON-1L', 'beverage', 'bottle', 8, 0, 'usd', 20, 30, false, md5('demo:' || ('sup:4'))::uuid, 'active'),
  (md5('demo:' || ('inv:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Chaleco salvavidas', 'CHAL-01', 'spare_part', 'unit', 12, 0, 'usd', 40, 50, false, md5('demo:' || ('sup:2'))::uuid, 'active'),
  (md5('demo:' || ('inv:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Camiseta souvenir', 'CAM-01', 'retail', 'unit', 4, 15, 'usd', 50, 80, true, md5('demo:' || ('sup:4'))::uuid, 'active'),
  (md5('demo:' || ('inv:5'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Diésel (galón)', 'DIESEL', 'fuel', 'unit', 3.2, 0, 'usd', 100, 150, false, md5('demo:' || ('sup:1'))::uuid, 'active');

insert into stock_level (id, organization_id, warehouse_id, inventory_item_id, quantity)
select md5('demo:' || ('stk:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('wh:1'))::uuid, md5('demo:' || ('inv:' || n))::uuid,
    (array[420,45,60,120,240])[n]
from generate_series(1, 5) as n;
