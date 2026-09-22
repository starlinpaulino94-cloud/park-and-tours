-- demo_07 · trozo 2 de 3. EJECUTAR EN ORDEN.
-- Pegar ENTERO (Ctrl+A en el archivo, Ctrl+V aquí) y darle a Run.
-- Si sale «syntax error at end of input», el editor lo cortó: repite el pegado.

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
