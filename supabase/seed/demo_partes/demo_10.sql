-- SEMBRADOR DEMO - TROZO 10 de 13. Ejecutar EN ORDEN del 01 al 13.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

insert into seller_link (id, organization_id, seller_id, slug, name, channel, status)
select md5('demo:' || ('slink:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('seller:' || n))::uuid,
    'vende-' || n || '-' || substr(md5(n::text), 1, 6), 'Enlace de ' || (array['Génesis','Ariel','Wendy','Frank'])[n],
    (array['qr','link','whatsapp','qr'])[n], 'active'
from generate_series(1, 4) as n;
insert into seller_goal (id, organization_id, name, seller_id, period, period_from, period_to, target_bookings, target_sales, currency, status)
select md5('demo:' || ('goal:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Meta mensual', md5('demo:' || ('seller:' || n))::uuid,
    'monthly', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date,
    20, (array[25000,25000,20000,15000])[n], 'usd', 'active'
from generate_series(1, 4) as n;
insert into seller_bonus (id, organization_id, seller_id, goal_id, description, amount, currency, payout_kind, status, awarded_at)
select md5('demo:' || ('sbon:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('seller:' || n))::uuid, md5('demo:' || ('goal:' || n))::uuid,
    'Bono por meta de ' || to_char(current_date - interval '1 month', 'YYYY-MM'), (array[500,500,300,200])[n], 'usd',
    case when n = 4 then 'in_kind' else 'cash' end, case when n % 2 = 0 then 'paid' else 'approved' end,
    (now() - interval '5 days')
from generate_series(1, 4) as n;
insert into commission_rule (id, organization_id, name, beneficiary_type, calc_type, value, priority, currency, status) values
  (md5('demo:' || ('crule:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Vendedor interno 8%', 'seller', 'percentage', 8, 1, 'usd', 'active'),
  (md5('demo:' || ('crule:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Concierge de hotel 12%', 'seller', 'percentage', 12, 2, 'usd', 'active'),
  (md5('demo:' || ('crule:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Tour center 15%', 'partner', 'percentage', 15, 3, 'usd', 'active');
insert into quote_option (id, organization_id, quote_id, name, is_recommended, subtotal, total, created_at)
select md5('demo:' || ('qopt:' || q || ':' || o))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('quote:' || q))::uuid,
    (array['Opción estándar','Opción premium'])[o], o = 2, (array[2136,2560])[o], (array[1936,2360])[o], now()
from generate_series(1, 2) as q, generate_series(1, 2) as o;
insert into quote_line (id, organization_id, quote_id, option_id, description, quantity, unit_price, line_total, product_id, line_type, sort_order)
select md5('demo:' || ('qline:' || q || ':' || o))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('quote:' || q))::uuid, md5('demo:' || ('qopt:' || q || ':' || o))::uuid,
    'Excursión en grupo', 24, 89, 2136, md5('demo:' || ('product:1'))::uuid, 'service', 1
from generate_series(1, 2) as q, generate_series(1, 2) as o;
insert into booking_extra (id, organization_id, booking_id, extra_id, name, price_type, quantity, unit_price, total_amount, currency)
select md5('demo:' || ('bext:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('book:' || n))::uuid, md5('demo:' || ('extra:1'))::uuid,
    'Barra libre premium', 'per_person', 2, 15, 30, 'usd'
from generate_series(1, 20) as n;
insert into access_ticket (id, organization_id, code, ticket_type, status, valid_from, valid_to, entries_allowed,
    issued_at, holder_name, price, currency, booking_id, customer_id, product_id, order_id)
select md5('demo:' || ('tk:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'TK-' || lpad(n::text, 6, '0'), 'single_use',
    case when (date_trunc('day', now()) + ((n - 30) || ' days')::interval)::date < current_date then 'redeemed' else 'active' end,
    (date_trunc('day', now()) + ((n - 30) || ' days')::interval)::date,
    (date_trunc('day', now()) + ((n - 30) || ' days')::interval)::date, 1,
    (now() - (n || ' hours')::interval), 'Titular ' || n, (array[89,75,120,65,95,55,99,110])[1 + ((n - 1) % 8)], 'usd',
    md5('demo:' || ('book:' || n))::uuid, md5('demo:' || ('cust:' || (1 + ((n - 1) % 40))))::uuid, md5('demo:' || ('product:' || (1 + ((n - 1) % 8))))::uuid, md5('demo:' || ('order:' || n))::uuid
from generate_series(1, 60) as n;
insert into waiver (id, organization_id, signature_name, waiver_template_id, participant_id, customer_id, booking_id, signed_at, status, channel)
select md5('demo:' || ('wv:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Titular ' || n, md5('demo:' || ('wt:1'))::uuid,
    md5('demo:' || ('part:' || n || ':1'))::uuid, md5('demo:' || ('cust:' || (1 + ((n - 1) % 40))))::uuid, md5('demo:' || ('book:' || n))::uuid,
    (now() - (n || ' hours')::interval), 'signed', 'kiosk'
from generate_series(1, 20) as n;
insert into waitlist_entry (id, organization_id, departure_id, customer_id, contact_name, contact_phone, seller_id, pax, status, offered_at, offer_expires_at)
select md5('demo:' || ('wl:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('dep:' || (40 + n)))::uuid, md5('demo:' || ('cust:' || n))::uuid,
    'Interesado ' || n, '+1 809 555 90' || lpad(n::text, 2, '0'), md5('demo:' || ('seller:' || (1 + (n % 4))))::uuid,
    2, (array['waiting','waiting','offered','waiting','converted'])[1 + (n % 5)],
    case when n % 5 = 2 then now() else null end, case when n % 5 = 2 then now() + interval '1 day' else null end
from generate_series(1, 5) as n;
insert into payment_schedule (id, organization_id, order_id, sequence, kind, due_date, amount, currency, status)
select md5('demo:' || ('psch:' || n || ':1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('order:' || n))::uuid, 1, 'deposit',
    (date_trunc('day', now()) + ((n - 33) || ' days')::interval)::date, 50, 'usd'::currency, 'paid'
from generate_series(1, 60) as n
union all
select md5('demo:' || ('psch:' || n || ':2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('order:' || n))::uuid, 2, 'balance',
    (date_trunc('day', now()) + ((n - 30) || ' days')::interval)::date, 50, 'usd',
    case when (date_trunc('day', now()) + ((n - 30) || ' days')::interval)::date < current_date then 'paid' else 'pending' end
from generate_series(1, 60) as n;
insert into gift_card_movement (id, organization_id, gift_card_id, movement_type, amount, balance_after, moved_at) values
  (md5('demo:' || ('gcm:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('gc:1'))::uuid, 'issue', 100, 100, now() - interval '20 days'),
  (md5('demo:' || ('gcm:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('gc:2'))::uuid, 'issue', 200, 200, now() - interval '40 days'),
  (md5('demo:' || ('gcm:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('gc:2'))::uuid, 'redeem', -125, 75, now() - interval '10 days');
