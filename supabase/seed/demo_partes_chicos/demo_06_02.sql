-- demo_06 · trozo 2 de 3. EJECUTAR EN ORDEN.
-- Pegar ENTERO (Ctrl+A en el archivo, Ctrl+V aquí) y darle a Run.
-- Si sale «syntax error at end of input», el editor lo cortó: repite el pegado.

insert into booking (id, organization_id, booking_number, order_id, customer_id, product_id, departure_id,
    modality_id, seller_id, travel_date, adults, children, pax_total, gross_amount, discount_amount,
    tax_amount, total_amount, paid_amount, balance_amount, cost_amount, margin_amount, currency,
    channel, status, checkin_status, hotel_id, exchange_rate, unit_price, booking_date)
select md5('demo:' || ('book:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'RES-' || lpad(v.n::text, 4, '0'),
    md5('demo:' || ('order:' || v.n))::uuid, md5('demo:' || ('cust:' || v.cust))::uuid, md5('demo:' || ('product:' || v.prod))::uuid,
    md5('demo:' || ('dep:' || v.n))::uuid, md5('demo:' || ('mod:' || v.prod || ':ad'))::uuid, md5('demo:' || ('seller:' || v.seller))::uuid,
    v.travel_date, v.adults, v.children, v.pax_total, v.gross, v.discount, 0, v.total, v.paid,
    v.total - v.paid, v.cost_amount, v.total - v.cost_amount, 'usd'::currency, v.canal::sales_channel,
    case when v.pasada then 'completed' when v.paid = 0 then 'pending_payment'
         when v.paid < v.total then 'partially_paid' else 'paid' end,
    case when v.pasada then 'done' else 'pending' end,
    md5('demo:' || ('hotel:' || (1 + (v.n % 5))))::uuid, 1, v.price, (v.travel_date - 3)::date
from demo_seed_rows v;

insert into participant (id, organization_id, booking_id, full_name, checkin_status)
select md5('demo:' || ('part:' || v.n || ':1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('book:' || v.n))::uuid,
    'Titular reserva ' || v.n, case when v.pasada then 'done' else 'pending' end
from demo_seed_rows v
union all
select md5('demo:' || ('part:' || v.n || ':2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('book:' || v.n))::uuid,
    'Acompañante ' || v.n, case when v.pasada then 'done' else 'pending' end
from demo_seed_rows v where v.children > 0 or v.n % 2 = 0;

insert into voucher (id, organization_id, booking_id, code, status)
select md5('demo:' || ('vou:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('book:' || v.n))::uuid,
    'VCH-' || lpad(v.n::text, 5, '0'),
    case when v.pasada then 'used' else 'valid' end
from demo_seed_rows v;

insert into pickup (id, organization_id, booking_id, hotel_id, status, pickup_time)
select md5('demo:' || ('pick:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('book:' || v.n))::uuid,
    md5('demo:' || ('hotel:' || (1 + (v.n % 5))))::uuid,
    case when v.pasada then 'picked_up' else 'confirmed' end,
    '07:00'
from demo_seed_rows v where v.paid > 0;
