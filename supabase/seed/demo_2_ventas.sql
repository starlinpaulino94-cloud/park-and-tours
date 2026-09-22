-- SEMBRADOR DEMO (plano: sin do, sin funciones, sin temporales) - PARTE 2/3
-- Ventas, cobros, facturas, comisiones, caja y encuestas. Ejecutar EN ORDEN 1,2,3. Pegar entero (Ctrl+A, Run). Requiere migracion 0067.

insert into organizations (kind, name, slug, legal_name, company_type,
    subscription_status, modules_enabled, status, currency, timezone, country, metadata)
select 'tenant', 'Havelgo Demo Tours', 'havelgo-demo-presentaciones',
    'Havelgo Demo Tours SRL', 'mixed_operator', 'active',
    array['bookings','crm','commissions','settlements','payments','cash_pos','transport',
          'pickups','operations','b2b_portal','accounting','reports','audit'],
    'active', 'usd', 'America/Santo_Domingo', 'Republica Dominicana',
    jsonb_build_object('demo', true, 'purpose', 'client_presentations')
where not exists (select 1 from organizations where slug = 'havelgo-demo-presentaciones');
update organizations set tenant_org_id = id
 where slug = 'havelgo-demo-presentaciones' and tenant_org_id is null;

delete from guest_survey where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from expense where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from cash_movement where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from cash_session where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from cash_register where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from invoice_line where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from invoice where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from ncf_sequence where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from receivable where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from payment where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from booking_cost where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from commission where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from pickup where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from voucher where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from participant where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from booking where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from sales_order where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');

drop table if exists demo_seed_rows;
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
