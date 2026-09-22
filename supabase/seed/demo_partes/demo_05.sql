-- SEMBRADOR DEMO - TROZO 05 de 08. Ejecutar EN ORDEN, del 01 al 08.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

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
insert into payment (id, organization_id, order_id, customer_id, reference, payment_type, method, status,
    amount, currency, exchange_rate, paid_at)
select md5('demo:' || ('pay:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('order:' || v.n))::uuid, md5('demo:' || ('cust:' || v.cust))::uuid,
    'PAY-' || lpad(v.n::text, 5, '0'), 'payment'::payment_kind,
    (array['cash','card','transfer','link','card']::payment_method[])[1 + (v.n % 5)], 'completed',
    v.paid, 'usd'::currency, 1, (v.travel_date - 2)::timestamptz
from demo_seed_rows v where v.paid > 0;
insert into receivable (id, organization_id, order_id, customer_id, document_number, amount, paid_amount,
    balance, currency, status, issue_date, due_date)
select md5('demo:' || ('rec:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('order:' || v.n))::uuid, md5('demo:' || ('cust:' || v.cust))::uuid,
    'CxC-' || lpad(v.n::text, 5, '0'), v.total, v.paid, v.total - v.paid, 'usd'::currency,
    case when v.travel_date < current_date then 'overdue' else 'pending' end,
    (v.travel_date - 3)::date, (v.travel_date + 7)::date
from demo_seed_rows v where v.total - v.paid > 0;
insert into ncf_sequence (id, organization_id, ncf_type, status) values
  (md5('demo:' || ('ncfseq:b02'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'b02', 'active');
insert into invoice (id, organization_id, number, ncf, ncf_type, invoice_type, status, issued_at,
    subtotal, tax, tax_rate, discount, total, paid_amount, currency, exchange_rate,
    customer_name, customer_tax_id, customer_id, order_id)
select md5('demo:' || ('inv:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'FAC-' || lpad(v.n::text, 5, '0'),
    'B02' || lpad(v.n::text, 8, '0'), 'b02', 'sale', 'paid', (v.travel_date - 2)::timestamptz,
    round(v.total / 1.18, 2), round(v.total - v.total / 1.18, 2), 18, v.discount, v.total, v.total,
    'usd'::currency, 1, 'Cliente ' || v.cust, NULL, md5('demo:' || ('cust:' || v.cust))::uuid, md5('demo:' || ('order:' || v.n))::uuid
from demo_seed_rows v where v.paid >= v.total and v.paid > 0;
insert into invoice_line (id, organization_id, invoice_id, description, quantity, unit_price, total)
select md5('demo:' || ('invl:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('inv:' || v.n))::uuid,
    'Excursión ' || v.prod || ' — ' || v.pax_total || ' pax', v.pax_total, v.price, v.total
from demo_seed_rows v where v.paid >= v.total and v.paid > 0;
insert into commission (id, organization_id, booking_id, order_id, seller_id, beneficiary_type,
    calc_type, base_amount, percentage, amount, currency, status, beneficiary_name)
select md5('demo:' || ('com:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('book:' || v.n))::uuid, md5('demo:' || ('order:' || v.n))::uuid,
    md5('demo:' || ('seller:' || v.seller))::uuid, 'seller'::beneficiary_type, 'percentage'::calc_type,
    v.total, (array[8,8,6,12])[v.seller], round(v.total * (array[8,8,6,12])[v.seller] / 100.0, 2),
    'usd'::currency,
    case when v.travel_date < current_date then 'approved' else 'pending' end,
    'Vendedor ' || v.seller
from demo_seed_rows v;
insert into booking_cost (id, organization_id, booking_id, supplier_id, concept, cost_type, quantity,
    unit_cost, amount, currency, status)
select md5('demo:' || ('bcost:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('book:' || v.n))::uuid, md5('demo:' || ('sup:1'))::uuid,
    'Transporte terrestre', 'per_group', 1, v.cost_amount, v.cost_amount, 'usd'::currency,
    case when v.travel_date < current_date then 'confirmed' else 'accrued' end
from demo_seed_rows v;
insert into cash_register (id, organization_id, name, code, currency, status, branch_id) values
  (md5('demo:' || ('reg:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Caja Bávaro', 'CJ-BAV', 'usd', 'active', md5('demo:' || ('branch:1'))::uuid),
  (md5('demo:' || ('reg:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Caja Marina', 'CJ-MAR', 'usd', 'active', md5('demo:' || ('branch:2'))::uuid);
insert into cash_session (id, organization_id, cash_register_id, opening_amount, sales_total, status,
    opened_at, closed_at, currency, exchange_rate) values
  (md5('demo:' || ('csess:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('reg:1'))::uuid, 200, 0, 'closed',
     (now() - interval '2 days')::timestamptz, (now() - interval '2 days' + interval '9 hours')::timestamptz, 'usd', 1),
  (md5('demo:' || ('csess:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('reg:1'))::uuid, 200, 0, 'open',
     date_trunc('day', now()) + interval '7 hours', NULL, 'usd', 1);
