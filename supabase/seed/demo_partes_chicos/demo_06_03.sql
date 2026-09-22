-- demo_06 · trozo 3 de 3. EJECUTAR EN ORDEN.
-- Pegar ENTERO (Ctrl+A en el archivo, Ctrl+V aquí) y darle a Run.
-- Si sale «syntax error at end of input», el editor lo cortó: repite el pegado.

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
