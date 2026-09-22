-- SEMBRADOR DEMO - TROZO 09 de 13. Ejecutar EN ORDEN del 01 al 13.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

insert into integration (id, organization_id, name, provider, category, status, direction) values
  (md5('demo:' || ('int:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Viator', 'viator', 'distribution', 'connected', 'inbound'),
  (md5('demo:' || ('int:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Stripe', 'stripe', 'payments', 'connected', 'bidirectional'),
  (md5('demo:' || ('int:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'WhatsApp Business', 'whatsapp', 'messaging', 'sandbox', 'outbound');
insert into guest_case (id, organization_id, code, case_type, status, priority, channel, opened_at,
    subject, customer_id, booking_id) values
  (md5('demo:' || ('case:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'CASO-0001', 'complaint', 'resolved', 'medium', 'whatsapp', now() - interval '5 days', 'Retraso en la recogida', md5('demo:' || ('cust:3'))::uuid, md5('demo:' || ('book:3'))::uuid),
  (md5('demo:' || ('case:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'CASO-0002', 'compliment', 'closed', 'low', 'email', now() - interval '9 days', 'Felicitación al guía Carlos', md5('demo:' || ('cust:5'))::uuid, md5('demo:' || ('book:5'))::uuid);
insert into audit_log (organization_id, action, entity_type, description, occurred_at)
select (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    (array['booking.create','payment.record','cash.close','invoice.issue','settlement.generate'])[1 + (n % 5)],
    (array['booking','payment','cash_session','invoice','settlement'])[1 + (n % 5)],
    'Evento de auditoría de demostración ' || n, (now() - (n || ' hours')::interval)
from generate_series(1, 20) as n;
insert into currency_rate (id, organization_id, currency_from, currency_to, rate, rate_date) values
  (md5('demo:' || ('fx:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'usd', 'dop', 59.5, current_date);
insert into ledger_account (id, organization_id, code, name, account_type, normal_side, is_postable, currency, status) values
  (md5('demo:' || ('la:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), '1100', 'Caja y bancos', 'asset', 'debit', true, 'usd', 'active'),
  (md5('demo:' || ('la:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), '1200', 'Cuentas por cobrar', 'asset', 'debit', true, 'usd', 'active'),
  (md5('demo:' || ('la:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), '2100', 'Cuentas por pagar', 'liability', 'credit', true, 'usd', 'active'),
  (md5('demo:' || ('la:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), '2200', 'ITBIS por pagar', 'liability', 'credit', true, 'usd', 'active'),
  (md5('demo:' || ('la:5'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), '4100', 'Ingresos por excursiones', 'revenue', 'credit', true, 'usd', 'active'),
  (md5('demo:' || ('la:6'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), '5100', 'Costo de operación', 'expense', 'debit', true, 'usd', 'active'),
  (md5('demo:' || ('la:7'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), '5200', 'Comisiones de venta', 'expense', 'debit', true, 'usd', 'active'),
  (md5('demo:' || ('la:8'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), '5300', 'Nómina', 'expense', 'debit', true, 'usd', 'active');
insert into accounting_period (id, organization_id, period, status) values
  (md5('demo:' || ('ap:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), to_char(current_date, 'YYYY-MM'), 'open'),
  (md5('demo:' || ('ap:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), to_char(current_date - interval '1 month', 'YYYY-MM'), 'closed');
insert into ledger_entry (id, organization_id, entry_code, line_no, posted_at, period, ledger_account_id, debit, credit, currency, source_type, memo)
select md5('demo:' || ('le:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'AS-' || lpad(n::text, 4, '0'), 1, (current_date - (n % 20))::timestamptz,
    to_char(current_date, 'YYYY-MM'),
    case when n % 2 = 0 then md5('demo:' || ('la:1'))::uuid else md5('demo:' || ('la:5'))::uuid end,
    case when n % 2 = 0 then (500 + n * 7) else 0 end,
    case when n % 2 = 0 then 0 else (500 + n * 7) end,
    'usd', 'sale', 'Asiento de demostración ' || n
from generate_series(1, 20) as n;
insert into product_cost (id, organization_id, product_id, supplier_id, concept, cost_type, amount, currency, status)
select md5('demo:' || ('pcost:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:' || n))::uuid, md5('demo:' || ('sup:1'))::uuid,
    'Costo operativo', 'per_person', (array[38,32,54,28,40,22,44,49,20,34,60,36])[n], 'usd', 'active'
from generate_series(1, 12) as n;
insert into product_bundle_item (id, organization_id, bundle_id, product_id, sort_order) values
  (md5('demo:' || ('pbi:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:1'))::uuid, md5('demo:' || ('product:2'))::uuid, 1),
  (md5('demo:' || ('pbi:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:1'))::uuid, md5('demo:' || ('product:7'))::uuid, 2);
insert into waiver_template (id, organization_id, name, version, language, body, status) values
  (md5('demo:' || ('wt:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Exención tirolesa y aventura', 1, 'es', 'El participante declara estar en condiciones físicas...', 'active'),
  (md5('demo:' || ('wt:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Exención actividades acuáticas', 1, 'es', 'El participante reconoce los riesgos del mar...', 'active');
insert into inspection_template (id, organization_id, name, code, category, checklist, status) values
  (md5('demo:' || ('it:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Inspección diaria de buggy', 'INS-BUGGY', 'safety', '["frenos","luces","cinturones","llantas"]'::jsonb, 'active'),
  (md5('demo:' || ('it:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Inspección de catamarán', 'INS-CATA', 'safety', '["chalecos","motor","radio","botiquín"]'::jsonb, 'active');
insert into membership_plan (id, organization_id, name, code, plan_type, price, currency, duration_days, visits_included, status) values
  (md5('demo:' || ('mp:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Pase Anual Aventura', 'PASE-ANUAL', 'annual_pass', 299, 'usd', 365, 12, 'active'),
  (md5('demo:' || ('mp:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Pase Familiar Temporada', 'PASE-FAM', 'family', 499, 'usd', 180, 30, 'active');
insert into membership (id, organization_id, code, status, starts_at, ends_at, amount_paid, currency, membership_plan_id, customer_id)
select md5('demo:' || ('mem:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'MEM-' || lpad(n::text, 4, '0'), 'active',
    (now() - (n * 5 || ' days')::interval), (now() + interval '300 days'),
    case when n % 2 = 0 then 499 else 299 end, 'usd',
    case when n % 2 = 0 then md5('demo:' || ('mp:2'))::uuid else md5('demo:' || ('mp:1'))::uuid end, md5('demo:' || ('cust:' || n))::uuid
from generate_series(1, 6) as n;
