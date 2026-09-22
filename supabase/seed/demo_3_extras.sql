-- SEMBRADOR DEMO (plano: sin do, sin funciones, sin temporales) - PARTE 3/3
-- Almacen, CRM, plataforma y recuento. Ejecutar EN ORDEN 1,2,3. Pegar entero (Ctrl+A, Run). Requiere migracion 0067.

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

delete from audit_log where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from guest_case where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from integration where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from notification where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from message where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from message_template where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from document where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from task where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from quote where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from promotion where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from crm_activity where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from lead where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from stock_movement where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from purchase_order_line where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from purchase_order where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from stock_level where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from gift_card where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from inventory_item where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');

insert into inventory_item (id, organization_id, name, sku, item_type, unit, cost, price, currency,
    min_stock, reorder_point, is_sellable, supplier_id, status) values
  (md5('demo:' || ('inv:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Agua embotellada 500ml', 'AGUA-500', 'beverage', 'unit', 0.3, 1, 'usd', 200, 300, true, md5('demo:' || ('sup:4'))::uuid, 'active'),
  (md5('demo:' || ('inv:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Ron Brugal (litro)', 'RON-1L', 'beverage', 'bottle', 8, 0, 'usd', 20, 30, false, md5('demo:' || ('sup:4'))::uuid, 'active'),
  (md5('demo:' || ('inv:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Chaleco salvavidas', 'CHAL-01', 'spare_part', 'unit', 12, 0, 'usd', 40, 50, false, md5('demo:' || ('sup:2'))::uuid, 'active'),
  (md5('demo:' || ('inv:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Camiseta souvenir', 'CAM-01', 'retail', 'unit', 4, 15, 'usd', 50, 80, true, md5('demo:' || ('sup:4'))::uuid, 'active'),
  (md5('demo:' || ('inv:5'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Diésel (galón)', 'DIESEL', 'fuel', 'unit', 3.2, 0, 'usd', 100, 150, false, md5('demo:' || ('sup:1'))::uuid, 'active');
insert into stock_level (id, organization_id, warehouse_id, inventory_item_id, quantity)
select md5('demo:' || ('stk:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('wh:1'))::uuid, md5('demo:' || ('inv:' || n))::uuid,
    (array[420,45,60,120,240])[n]
from generate_series(1, 5) as n;
insert into purchase_order (id, organization_id, code, status, ordered_at, subtotal, tax, total, currency,
    exchange_rate, supplier_id, warehouse_id) values
  (md5('demo:' || ('po:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'OC-0001', 'received',  (now() - interval '10 days'), 300, 54, 354, 'usd', 1, md5('demo:' || ('sup:4'))::uuid, md5('demo:' || ('wh:1'))::uuid),
  (md5('demo:' || ('po:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'OC-0002', 'approved',  (now() - interval '2 days'),  480, 86, 566, 'usd', 1, md5('demo:' || ('sup:1'))::uuid, md5('demo:' || ('wh:1'))::uuid);
insert into purchase_order_line (id, organization_id, purchase_order_id, inventory_item_id, description, quantity, unit_cost, line_total) values
  (md5('demo:' || ('pol:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('po:1'))::uuid, md5('demo:' || ('inv:1'))::uuid, 'Agua 500ml', 500, 0.3, 150),
  (md5('demo:' || ('pol:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('po:1'))::uuid, md5('demo:' || ('inv:4'))::uuid, 'Camiseta souvenir', 40, 4, 160),
  (md5('demo:' || ('pol:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('po:2'))::uuid, md5('demo:' || ('inv:5'))::uuid, 'Diésel', 150, 3.2, 480);
insert into stock_movement (id, organization_id, warehouse_id, inventory_item_id, movement_type, quantity, moved_at)
select md5('demo:' || ('smov:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('wh:1'))::uuid, md5('demo:' || ('inv:' || n))::uuid,
    'receipt', (array[500,0,0,40,150])[n], (now() - interval '10 days')
from generate_series(1, 5) as n where (array[500,0,0,40,150])[n] > 0;
insert into gift_card (id, organization_id, code, status, initial_amount, balance, currency, issued_at,
    expires_at, recipient_name, delivery_channel) values
  (md5('demo:' || ('gc:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'GIFT-0001', 'active', 100, 100, 'usd', now() - interval '20 days', now() + interval '345 days', 'Sr. Pérez', 'email'),
  (md5('demo:' || ('gc:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'GIFT-0002', 'partially_used', 200, 75, 'usd', now() - interval '40 days', now() + interval '325 days', 'Familia López', 'print');
insert into lead (id, organization_id, seller_id, product_id, name, email, phone, source, status,
    estimated_value, currency, pax, travel_date, next_action_at)
select md5('demo:' || ('lead:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('seller:' || (1 + (n % 4))))::uuid,
    md5('demo:' || ('product:' || (1 + (n % 8))))::uuid,
    'Prospecto ' || n, 'prospecto' || n || '@ejemplo-demo.com', '+1 809 720 ' || lpad((5000 + n)::text, 4, '0'),
    (array['web','whatsapp','referral','agency','phone'])[1 + (n % 5)],
    (array['new','contacted','interested','quoted','follow_up','lost'])[1 + (n % 6)],
    (200 + n * 15), 'usd'::currency, 2 + (n % 4), (current_date + (n % 20))::date,
    (now() + ((n % 5) || ' days')::interval)
from generate_series(1, 15) as n;
insert into crm_activity (id, organization_id, lead_id, activity_type, subject, status, due_at)
select md5('demo:' || ('act:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('lead:' || n))::uuid,
    (array['call','whatsapp','email','note','meeting'])[1 + (n % 5)],
    'Seguimiento prospecto ' || n,
    case when n % 3 = 0 then 'done' else 'pending' end,
    (now() + ((n % 4) || ' days')::interval)
from generate_series(1, 15) as n;
insert into promotion (id, organization_id, name, code, discount_type, value, valid_from, valid_to,
    max_uses, used_count, min_amount, channels, status) values
  (md5('demo:' || ('promo:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Verano -15%', 'VERANO15', 'percentage', 15, current_date - 10, current_date + 50, 200, 34, 100, array['web','ota'], 'active'),
  (md5('demo:' || ('promo:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Reserva anticipada USD 20', 'EARLY20', 'fixed', 20, current_date - 30, current_date + 20, 100, 58, 150, array['web'], 'active');
insert into quote (id, organization_id, code, status, quote_type, issued_at, valid_until, pax,
    subtotal, discount, tax, total, currency, customer_id, seller_id) values
  (md5('demo:' || ('quote:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'COT-0001', 'sent', 'group', now() - interval '3 days', now() + interval '11 days', 24, 2136, 200, 0, 1936, 'usd', md5('demo:' || ('cust:1'))::uuid, md5('demo:' || ('seller:1'))::uuid),
  (md5('demo:' || ('quote:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'COT-0002', 'accepted', 'wedding', now() - interval '8 days', now() + interval '6 days', 60, 6600, 600, 0, 6000, 'usd', md5('demo:' || ('cust:2'))::uuid, md5('demo:' || ('seller:2'))::uuid);
insert into task (id, organization_id, title, task_type, status, due_at)
select md5('demo:' || ('task:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    (array['Confirmar guía Isla Saona','Llamar prospecto boda','Revisar caja Marina',
           'Cargar combustible flota','Cerrar liquidación viernes','Renovar seguro van'])[1 + ((n - 1) % 6)],
    (array['operational','sales','finance','maintenance','finance','operational'])[1 + ((n - 1) % 6)],
    case when n % 3 = 0 then 'done' else 'todo' end,
    (now() + ((n % 5) || ' days')::interval)
from generate_series(1, 12) as n;
insert into notification (id, organization_id, title, message, notification_type, link, read_status)
select md5('demo:' || ('notif:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    (array['Nueva reserva','Pago recibido','Salida casi llena','Caja pendiente de aprobación','Encuesta respondida'])[1 + ((n - 1) % 5)],
    'Detalle de la notificación ' || n, (array['booking','payment','operation','settlement','info'])[1 + ((n - 1) % 5)],
    '/dashboard', (n % 2 = 0)
from generate_series(1, 10) as n;
insert into message_template (id, organization_id, key, channel, body, status) values
  (md5('demo:' || ('mt:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'booking_confirmation', 'email', 'Hola {{nombre}}, aquí está tu voucher para {{tour}}.', 'active'),
  (md5('demo:' || ('mt:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'pre_tour_reminder', 'whatsapp', 'Te esperamos mañana para {{tour}}. Recogida {{hora}}.', 'active');
insert into message (id, organization_id, channel, to_address, body, status, created_at)
select md5('demo:' || ('msg:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), (array['email','whatsapp']::text[])[1 + (n % 2)],
    'cliente' || n || '@ejemplo-demo.com', 'Confirmación de reserva RES-' || lpad(n::text, 4, '0'),
    (array['sent','sent','queued','failed'])[1 + (n % 4)], (now() - (n || ' hours')::interval)
from generate_series(1, 12) as n;
insert into document (id, organization_id, title, doc_type, status) values
  (md5('demo:' || ('doc:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Protocolo de seguridad en catamarán', 'sop', 'published'),
  (md5('demo:' || ('doc:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Póliza de responsabilidad civil', 'insurance', 'published'),
  (md5('demo:' || ('doc:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Lista de precios 2026', 'price_list', 'published');
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

select modulo, filas from (values
  ('productos', (select count(*) from product where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('clientes', (select count(*) from customer where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('salidas', (select count(*) from departure where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('reservas', (select count(*) from booking where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('pagos', (select count(*) from payment where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('facturas', (select count(*) from invoice where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('comisiones', (select count(*) from commission where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('encuestas', (select count(*) from guest_survey where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('leads', (select count(*) from lead where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('tareas', (select count(*) from task where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones'))),
  ('almacen', (select count(*) from inventory_item where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones')))
) as t(modulo, filas) order by modulo;
