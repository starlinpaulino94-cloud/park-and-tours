-- SEMBRADOR DEMO - TROZO 07 de 08. Ejecutar EN ORDEN, del 01 al 08.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

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
