-- SEMBRADOR DEMO - TROZO 06 de 13. Ejecutar EN ORDEN del 01 al 13.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

create table demo_seed_rows as
with base as (
  select
    n,
    1 + ((n - 1) % 8) as prod,
    1 + ((n - 1) % 40) as cust,
    1 + ((n - 1) % 4) as seller,
    (date_trunc('day', now()) + ((n - 30) || ' days')::interval)::date as travel_date,
    2 + (n % 3) as adults,
    (n % 2) as children,
    (array[89,75,120,65,95,55,99,110])[1 + ((n - 1) % 8)]::numeric as price,
    (array[38,32,54,28,40,22,44,49])[1 + ((n - 1) % 8)]::numeric as unit_cost
  from generate_series(1, 60) as n
), calc as (
  select b.*,
    (b.adults + b.children) as pax_total,
    (b.price * b.adults + round(b.price * 0.6) * b.children) as gross,
    case when b.n % 4 = 0 then round((b.price * b.adults + round(b.price * 0.6) * b.children) * 0.10) else 0 end as discount,
    (b.unit_cost * (b.adults + b.children)) as cost_amount
  from base b
), money as (
  select c.*,
    (c.gross - c.discount) as total,
    case c.n % 5 when 0 then 0
                 when 1 then round((c.gross - c.discount) * 0.5)
                 else (c.gross - c.discount) end as paid
  from calc c
)
select
  m.*,
  (m.travel_date < current_date) as pasada,
  case
    when m.paid = 0 then 'pending_payment'
    when m.paid < m.total then 'partially_paid'
    when m.travel_date < current_date then 'completed'
    else 'paid'
  end as estado,
  (array['web','walk_in','ota','phone','agency','direct','whatsapp','tour_center'])[1 + (m.n % 8)] as canal
from money m;
alter table demo_seed_rows enable row level security;
insert into sales_order (id, organization_id, order_number, customer_id, seller_id, channel, status,
    currency, exchange_rate, subtotal, discount_total, tax_total, total, paid_total, balance, order_date)
select md5('demo:' || ('order:' || v.n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'ORD-' || lpad(v.n::text, 4, '0'),
    md5('demo:' || ('cust:' || v.cust))::uuid, md5('demo:' || ('seller:' || v.seller))::uuid, v.canal::sales_channel, v.estado,
    'usd'::currency, 1, v.gross, v.discount, 0, v.total, v.paid, v.total - v.paid,
    (v.travel_date - 3)::date
from demo_seed_rows v;
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
