-- SEMBRADOR DEMO - TROZO 06 de 08. Ejecutar EN ORDEN, del 01 al 08.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

insert into cash_movement (id, organization_id, cash_session_id, payment_id, movement_type, amount,
    currency, concept, movement_at)
select md5('demo:' || ('cmov:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('csess:1'))::uuid, md5('demo:' || ('pay:' || v.n))::uuid,
    'sale', v.paid, 'usd'::currency, 'Venta ' || v.n, (v.travel_date - 2)::timestamptz
from demo_seed_rows v where v.paid > 0 and (v.n % 5) not in (0, 1) and (v.n % 5) = 2;
insert into expense (id, organization_id, category_id, supplier_id, concept, amount, currency,
    expense_date, payment_method, status, ncf, ncf_type, supplier_rnc, itbis_amount, goods_service_type)
select md5('demo:' || ('exp:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    md5('demo:' || ('exc:' || (1 + (n % 3))))::uuid, md5('demo:' || ('sup:' || (1 + (n % 4))))::uuid,
    (array['Diésel flota','Repuestos van','Comisión OTA','Peajes','Lavado vehículos',
           'Aceite y filtros','Combustible catamarán','Cargo pasarela','Mantenimiento buggies',
           'Uniformes guías','Agua y hielo','Publicidad redes'])[1 + ((n - 1) % 12)],
    (array[1200,450,890,120,80,340,600,210,520,300,90,450])[1 + ((n - 1) % 12)],
    'usd'::currency, (current_date - (n * 2))::date,
    (array['cash','transfer','card']::payment_method[])[1 + (n % 3)], 'approved',
    'B01' || lpad(n::text, 8, '0'), 'b01', '13' || lpad(n::text, 7, '0'),
    round((array[1200,450,890,120,80,340,600,210,520,300,90,450])[1 + ((n - 1) % 12)] * 0.18, 2), '09'
from generate_series(1, 12) as n;
insert into guest_survey (id, organization_id, booking_id, departure_id, product_id, customer_id,
  guide_staff_id, token, status, asked_at, answered_at, nps, rating_guide, rating_transport,
  rating_value, comment, language)
  select md5('demo:' || ('surv:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('book:' || v.n))::uuid, md5('demo:' || ('dep:' || v.n))::uuid,
  md5('demo:' || ('product:' || v.prod))::uuid, md5('demo:' || ('cust:' || v.cust))::uuid, md5('demo:' || ('staff:1'))::uuid,
  'TOK-' || lpad(v.n::text, 6, '0'),
  'answered', (v.travel_date + 1)::timestamptz, (v.travel_date + 1)::timestamptz,
  (array[10,9,8,10,7,9,10,6,9,8])[1 + (v.n % 10)],
  (array[5,5,4,5,4,5,5,3,4,5])[1 + (v.n % 10)],
  (array[5,4,4,5,3,5,4,3,5,4])[1 + (v.n % 10)],
  (array[5,4,5,5,4,4,5,3,4,5])[1 + (v.n % 10)],
  (array['¡Excelente día!','Muy recomendable','El guía fue genial','Repetiremos','Todo perfecto'])[1 + (v.n % 5)],
  'es'
  from demo_seed_rows v where v.travel_date < current_date and v.n % 2 = 0;
insert into guest_survey (id, organization_id, booking_id, departure_id, product_id, customer_id,
  token, status, asked_at, expires_at, language)
  select md5('demo:' || ('survp:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('book:' || v.n))::uuid, md5('demo:' || ('dep:' || v.n))::uuid,
  md5('demo:' || ('product:' || v.prod))::uuid, md5('demo:' || ('cust:' || v.cust))::uuid,
  'TOKP-' || lpad(v.n::text, 6, '0'), 'pending', now(), now() + interval '7 days', 'es'
  from demo_seed_rows v where v.travel_date >= current_date and v.n % 3 = 0;
drop table if exists demo_seed_rows;
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
insert into purchase_order (id, organization_id, code, status, ordered_at, subtotal, tax, total, currency,
    exchange_rate, supplier_id, warehouse_id) values
  (md5('demo:' || ('po:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'OC-0001', 'received',  (now() - interval '10 days'), 300, 54, 354, 'usd', 1, md5('demo:' || ('sup:4'))::uuid, md5('demo:' || ('wh:1'))::uuid),
  (md5('demo:' || ('po:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'OC-0002', 'approved',  (now() - interval '2 days'),  480, 86, 566, 'usd', 1, md5('demo:' || ('sup:1'))::uuid, md5('demo:' || ('wh:1'))::uuid);
insert into purchase_order_line (id, organization_id, purchase_order_id, inventory_item_id, description, quantity, unit_cost, line_total) values
  (md5('demo:' || ('pol:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('po:1'))::uuid, md5('demo:' || ('inv:1'))::uuid, 'Agua 500ml', 500, 0.3, 150),
  (md5('demo:' || ('pol:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('po:1'))::uuid, md5('demo:' || ('inv:4'))::uuid, 'Camiseta souvenir', 40, 4, 160),
  (md5('demo:' || ('pol:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('po:2'))::uuid, md5('demo:' || ('inv:5'))::uuid, 'Diésel', 150, 3.2, 480);
insert into stock_movement (id, organization_id, warehouse_id, inventory_item_id, movement_type, quantity, moved_at)
select md5('demo:' || ('smov:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('wh:1'))::uuid, md5('demo:' || ('inv:' || n))::uuid,
    'receipt', (array[500,0,0,40,150])[n], (now() - interval '10 days')
from generate_series(1, 5) as n where (array[500,0,0,40,150])[n] > 0;
insert into gift_card (id, organization_id, code, status, initial_amount, balance, currency, issued_at,
    expires_at, recipient_name, delivery_channel) values
  (md5('demo:' || ('gc:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'GIFT-0001', 'active', 100, 100, 'usd', now() - interval '20 days', now() + interval '345 days', 'Sr. Pérez', 'email'),
  (md5('demo:' || ('gc:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'GIFT-0002', 'partially_used', 200, 75, 'usd', now() - interval '40 days', now() + interval '325 days', 'Familia López', 'print');
