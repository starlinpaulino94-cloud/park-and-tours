-- demo_06 · trozo 1 de 3. EJECUTAR EN ORDEN.
-- Pegar ENTERO (Ctrl+A en el archivo, Ctrl+V aquí) y darle a Run.
-- Si sale «syntax error at end of input», el editor lo cortó: repite el pegado.

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
