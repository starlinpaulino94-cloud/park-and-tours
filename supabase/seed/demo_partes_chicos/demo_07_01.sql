-- demo_07 · trozo 1 de 3. EJECUTAR EN ORDEN.
-- Pegar ENTERO (Ctrl+A en el archivo, Ctrl+V aquí) y darle a Run.
-- Si sale «syntax error at end of input», el editor lo cortó: repite el pegado.

-- SEMBRADOR DEMO - TROZO 07 de 13. Ejecutar EN ORDEN del 01 al 13.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

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
