-- SEMBRADOR DEMO - TROZO 04 de 08. Ejecutar EN ORDEN, del 01 al 08.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

insert into vehicle (id, organization_id, supplier_id, name, plate, vehicle_type, capacity, status) values
  (md5('demo:' || ('veh:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('sup:1'))::uuid, 'Bus Mercedes 45', 'A123456', 'bus',       45, 'available'),
  (md5('demo:' || ('veh:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('sup:1'))::uuid, 'Minibús Sprinter', 'A234567', 'minibus',  19, 'available'),
  (md5('demo:' || ('veh:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('sup:2'))::uuid, 'Catamarán Sirena', 'BOAT-01', 'catamaran',60, 'available'),
  (md5('demo:' || ('veh:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('sup:1'))::uuid, 'Van Hiace',        'A345678', 'van',      14, 'available'),
  (md5('demo:' || ('veh:5'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('sup:1'))::uuid, 'Flota Buggies (8)','BUGGY',   'buggy',    16, 'in_service');
insert into attraction (id, organization_id, name, code, zone_id, attraction_type, operational_status,
    capacity_hour, duration_min, status) values
  (md5('demo:' || ('attr:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Hoyo Azul', 'HOYO', md5('demo:' || ('zone:1'))::uuid, 'adventure', 'open', 120, 45, 'active'),
  (md5('demo:' || ('attr:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Tirolesa Anamuya', 'ZIP', md5('demo:' || ('zone:1'))::uuid, 'adventure', 'open', 60, 90, 'active');
insert into departure (id, organization_id, product_id, departure_at, departure_time, capacity,
    booked_pax, cutoff_hours, meeting_point, status, branch_id)
select
  md5('demo:' || ('dep:' || n))::uuid,
  (select id from organizations where slug = 'havelgo-demo-presentaciones'),
  md5('demo:' || ('product:' || (1 + ((n - 1) % 8))))::uuid,
  (date_trunc('day', now()) + ((n - 30) || ' days')::interval + (case when n % 2 = 0 then interval '8 hours' else interval '13 hours' end)),
  case when n % 2 = 0 then '08:00' else '13:00' end,
  (array[40,35,16,24,30,45,120,30])[1 + ((n - 1) % 8)],
  0,
  4,
  'Recogida en lobby',
  case when (n - 30) < 0 then 'completed' else 'available' end,
  md5('demo:' || ('branch:1'))::uuid
from generate_series(1, 60) as n;
insert into departure_resource (id, organization_id, departure_id, vehicle_id, staff_id, resource_role,
    pax_assigned, cost, currency, status)
select md5('demo:' || ('depres:' || n || ':v'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('dep:' || n))::uuid,
    md5('demo:' || ('veh:' || (1 + (n % 5))))::uuid, NULL, 'vehicle', 0,
    (array[180,180,320,140,160,180,420,160])[1 + ((n - 1) % 8)], 'usd'::currency,
    case when (n - 30) < 0 then 'confirmed' else 'planned' end
from generate_series(1, 60) as n
union all
select md5('demo:' || ('depres:' || n || ':g'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('dep:' || n))::uuid,
    NULL, md5('demo:' || ('staff:' || (1 + (n % 2))))::uuid, 'guide', 0, 45, 'usd'::currency,
    case when (n - 30) < 0 then 'confirmed' else 'planned' end
from generate_series(1, 60) as n;
insert into pickup_route (id, organization_id, departure_id, zone_id, vehicle_id, guide_id, name,
    start_time, pax_total, stops_count, status)
select md5('demo:' || ('route:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('dep:' || (30 + n)))::uuid,
    md5('demo:' || ('zone:' || (1 + (n % 3))))::uuid, md5('demo:' || ('veh:' || (1 + (n % 5))))::uuid, md5('demo:' || ('staff:1'))::uuid,
    'Ruta ' || to_char(now() + (n || ' days')::interval, 'DD/MM'),
    '06:30', 0, (2 + (n % 4)), 'planned'
from generate_series(1, 10) as n;
insert into shift (id, organization_id, role_label, shift_date, starts_at, ends_at, status, staff_id,
    hourly_rate, currency)
select md5('demo:' || ('shift:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    (array['Guía','Guía','Chofer','Chofer','Fotógrafo','Coordinador'])[1 + ((n - 1) % 6)],
    (current_date + ((n % 7) || ' days')::interval)::date,
    (date_trunc('day', now()) + (n % 7 || ' days')::interval + interval '7 hours'),
    (date_trunc('day', now()) + (n % 7 || ' days')::interval + interval '16 hours'),
    'published',
    md5('demo:' || ('staff:' || (1 + ((n - 1) % 6))))::uuid,
    6, 'usd'::currency
from generate_series(1, 18) as n;
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
