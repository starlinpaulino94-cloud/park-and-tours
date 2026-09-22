-- ============================================================================
-- SEMBRADOR DE DEMOSTRACIÓN — PARTE 3 DE 3.  Almacén, CRM, plataforma y recuento.
--
-- Se ejecuta en el editor SQL de Supabase. Pégalo ENTERO (Ctrl+A, Run).
-- El archivo se partió en tres porque el editor trunca los pegados grandes.
-- EJECÚTALOS EN ORDEN: 1, luego 2, luego 3. Cada uno recrea lo que necesita.
-- Todo cuelga de la empresa `havelgo-demo-presentaciones` y es idempotente.
-- ============================================================================

-- Identificador determinista: md5 de un texto → uuid estable.
create or replace function pg_temp.d(text) returns uuid
  language sql immutable as $$ select md5('demo:' || $1)::uuid $$;

-- La empresa demo, creada si falta. Su slug es fijo.
insert into organizations (kind, name, slug, legal_name, company_type,
    subscription_status, modules_enabled, status, currency, timezone, country, metadata)
select 'tenant', 'Havelgo Demo Tours', 'havelgo-demo-presentaciones',
    'Havelgo Demo Tours SRL', 'mixed_operator', 'active',
    array['bookings','crm','commissions','settlements','payments','cash_pos','transport',
          'pickups','operations','b2b_portal','accounting','reports','audit'],
    'active', 'usd', 'America/Santo_Domingo', 'República Dominicana',
    jsonb_build_object('demo', true, 'purpose', 'client_presentations')
where not exists (select 1 from organizations where slug = 'havelgo-demo-presentaciones');

update organizations set tenant_org_id = id
 where slug = 'havelgo-demo-presentaciones' and tenant_org_id is null;

-- El id de la empresa demo, para no repetir la subconsulta.
create or replace function pg_temp.org() returns uuid
  language sql stable as $$
    select id from organizations where slug = 'havelgo-demo-presentaciones'
  $$;

-- Limpieza dirigida (solo lo de esta parte; salta tablas que aún no existan).
do $$
declare t text; orden text[] := array['audit_log', 'guest_case', 'integration', 'notification', 'message', 'message_template', 'document', 'task', 'quote', 'promotion', 'crm_activity', 'lead', 'stock_movement', 'purchase_order_line', 'purchase_order', 'stock_level', 'gift_card', 'inventory_item'];
begin
  foreach t in array orden loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from %I where organization_id = pg_temp.org()', t);
    end if;
  end loop;
end $$;

-- ── ALMACÉN ─────────────────────────────────────────────────────────────────
insert into inventory_item (id, organization_id, name, sku, item_type, unit, cost, price, currency,
    min_stock, reorder_point, is_sellable, supplier_id, status) values
  (pg_temp.d('inv:1'), pg_temp.org(), 'Agua embotellada 500ml', 'AGUA-500', 'beverage', 'unit', 0.3, 1, 'usd', 200, 300, true, pg_temp.d('sup:4'), 'active'),
  (pg_temp.d('inv:2'), pg_temp.org(), 'Ron Brugal (litro)', 'RON-1L', 'beverage', 'bottle', 8, 0, 'usd', 20, 30, false, pg_temp.d('sup:4'), 'active'),
  (pg_temp.d('inv:3'), pg_temp.org(), 'Chaleco salvavidas', 'CHAL-01', 'spare_part', 'unit', 12, 0, 'usd', 40, 50, false, pg_temp.d('sup:2'), 'active'),
  (pg_temp.d('inv:4'), pg_temp.org(), 'Camiseta souvenir', 'CAM-01', 'retail', 'unit', 4, 15, 'usd', 50, 80, true, pg_temp.d('sup:4'), 'active'),
  (pg_temp.d('inv:5'), pg_temp.org(), 'Diésel (galón)', 'DIESEL', 'fuel', 'unit', 3.2, 0, 'usd', 100, 150, false, pg_temp.d('sup:1'), 'active');

insert into stock_level (id, organization_id, warehouse_id, inventory_item_id, quantity)
select pg_temp.d('stk:' || n), pg_temp.org(), pg_temp.d('wh:1'), pg_temp.d('inv:' || n),
    (array[420,45,60,120,240])[n]
from generate_series(1, 5) as n;

insert into purchase_order (id, organization_id, code, status, ordered_at, subtotal, tax, total, currency,
    exchange_rate, supplier_id, warehouse_id) values
  (pg_temp.d('po:1'), pg_temp.org(), 'OC-0001', 'received',  (now() - interval '10 days'), 300, 54, 354, 'usd', 1, pg_temp.d('sup:4'), pg_temp.d('wh:1')),
  (pg_temp.d('po:2'), pg_temp.org(), 'OC-0002', 'approved',  (now() - interval '2 days'),  480, 86, 566, 'usd', 1, pg_temp.d('sup:1'), pg_temp.d('wh:1'));

insert into purchase_order_line (id, organization_id, purchase_order_id, inventory_item_id, description, quantity, unit_cost, line_total) values
  (pg_temp.d('pol:1'), pg_temp.org(), pg_temp.d('po:1'), pg_temp.d('inv:1'), 'Agua 500ml', 500, 0.3, 150),
  (pg_temp.d('pol:2'), pg_temp.org(), pg_temp.d('po:1'), pg_temp.d('inv:4'), 'Camiseta souvenir', 40, 4, 160),
  (pg_temp.d('pol:3'), pg_temp.org(), pg_temp.d('po:2'), pg_temp.d('inv:5'), 'Diésel', 150, 3.2, 480);

insert into stock_movement (id, organization_id, warehouse_id, inventory_item_id, movement_type, quantity, moved_at)
select pg_temp.d('smov:' || n), pg_temp.org(), pg_temp.d('wh:1'), pg_temp.d('inv:' || n),
    'receipt', (array[500,0,0,40,150])[n], (now() - interval '10 days')
from generate_series(1, 5) as n where (array[500,0,0,40,150])[n] > 0;

insert into gift_card (id, organization_id, code, status, initial_amount, balance, currency, issued_at,
    expires_at, recipient_name, delivery_channel) values
  (pg_temp.d('gc:1'), pg_temp.org(), 'GIFT-0001', 'active', 100, 100, 'usd', now() - interval '20 days', now() + interval '345 days', 'Sr. Pérez', 'email'),
  (pg_temp.d('gc:2'), pg_temp.org(), 'GIFT-0002', 'partially_used', 200, 75, 'usd', now() - interval '40 days', now() + interval '325 days', 'Familia López', 'print');

-- ── CRM ─────────────────────────────────────────────────────────────────────
insert into lead (id, organization_id, seller_id, product_id, name, email, phone, source, status,
    estimated_value, currency, pax, travel_date, next_action_at)
select pg_temp.d('lead:' || n), pg_temp.org(), pg_temp.d('seller:' || (1 + (n % 4))),
    pg_temp.d('product:' || (1 + (n % 8))),
    'Prospecto ' || n, 'prospecto' || n || '@ejemplo-demo.com', '+1 809 720 ' || lpad((5000 + n)::text, 4, '0'),
    (array['web','whatsapp','referral','agency','phone'])[1 + (n % 5)],
    (array['new','contacted','interested','quoted','follow_up','lost'])[1 + (n % 6)],
    (200 + n * 15), 'usd'::currency, 2 + (n % 4), (current_date + (n % 20))::date,
    (now() + ((n % 5) || ' days')::interval)
from generate_series(1, 15) as n;

insert into crm_activity (id, organization_id, lead_id, activity_type, subject, status, due_at)
select pg_temp.d('act:' || n), pg_temp.org(), pg_temp.d('lead:' || n),
    (array['call','whatsapp','email','note','meeting'])[1 + (n % 5)],
    'Seguimiento prospecto ' || n,
    case when n % 3 = 0 then 'done' else 'pending' end,
    (now() + ((n % 4) || ' days')::interval)
from generate_series(1, 15) as n;

insert into promotion (id, organization_id, name, code, discount_type, value, valid_from, valid_to,
    max_uses, used_count, min_amount, channels, status) values
  (pg_temp.d('promo:1'), pg_temp.org(), 'Verano -15%', 'VERANO15', 'percentage', 15, current_date - 10, current_date + 50, 200, 34, 100, array['web','ota'], 'active'),
  (pg_temp.d('promo:2'), pg_temp.org(), 'Reserva anticipada USD 20', 'EARLY20', 'fixed', 20, current_date - 30, current_date + 20, 100, 58, 150, array['web'], 'active');

insert into quote (id, organization_id, code, status, quote_type, issued_at, valid_until, pax,
    subtotal, discount, tax, total, currency, customer_id, seller_id) values
  (pg_temp.d('quote:1'), pg_temp.org(), 'COT-0001', 'sent', 'group', now() - interval '3 days', now() + interval '11 days', 24, 2136, 200, 0, 1936, 'usd', pg_temp.d('cust:1'), pg_temp.d('seller:1')),
  (pg_temp.d('quote:2'), pg_temp.org(), 'COT-0002', 'accepted', 'wedding', now() - interval '8 days', now() + interval '6 days', 60, 6600, 600, 0, 6000, 'usd', pg_temp.d('cust:2'), pg_temp.d('seller:2'));

-- ── PLATAFORMA Y OPERACIÓN DIARIA ───────────────────────────────────────────
insert into task (id, organization_id, title, task_type, status, due_at)
select pg_temp.d('task:' || n), pg_temp.org(),
    (array['Confirmar guía Isla Saona','Llamar prospecto boda','Revisar caja Marina',
           'Cargar combustible flota','Cerrar liquidación viernes','Renovar seguro van'])[1 + ((n - 1) % 6)],
    (array['operational','sales','finance','maintenance','finance','operational'])[1 + ((n - 1) % 6)],
    case when n % 3 = 0 then 'done' else 'todo' end,
    (now() + ((n % 5) || ' days')::interval)
from generate_series(1, 12) as n;

insert into notification (id, organization_id, title, message, notification_type, link, read_status)
select pg_temp.d('notif:' || n), pg_temp.org(),
    (array['Nueva reserva','Pago recibido','Salida casi llena','Caja pendiente de aprobación','Encuesta respondida'])[1 + ((n - 1) % 5)],
    'Detalle de la notificación ' || n, (array['booking','payment','operation','settlement','info'])[1 + ((n - 1) % 5)],
    '/dashboard', (n % 2 = 0)
from generate_series(1, 10) as n;

insert into message_template (id, organization_id, key, channel, body, status) values
  (pg_temp.d('mt:1'), pg_temp.org(), 'booking_confirmation', 'email', 'Hola {{nombre}}, aquí está tu voucher para {{tour}}.', 'active'),
  (pg_temp.d('mt:2'), pg_temp.org(), 'pre_tour_reminder', 'whatsapp', 'Te esperamos mañana para {{tour}}. Recogida {{hora}}.', 'active');

insert into message (id, organization_id, channel, to_address, body, status, created_at)
select pg_temp.d('msg:' || n), pg_temp.org(), (array['email','whatsapp']::text[])[1 + (n % 2)],
    'cliente' || n || '@ejemplo-demo.com', 'Confirmación de reserva RES-' || lpad(n::text, 4, '0'),
    (array['sent','sent','queued','failed'])[1 + (n % 4)], (now() - (n || ' hours')::interval)
from generate_series(1, 12) as n;

insert into document (id, organization_id, title, doc_type, status) values
  (pg_temp.d('doc:1'), pg_temp.org(), 'Protocolo de seguridad en catamarán', 'sop', 'published'),
  (pg_temp.d('doc:2'), pg_temp.org(), 'Póliza de responsabilidad civil', 'insurance', 'published'),
  (pg_temp.d('doc:3'), pg_temp.org(), 'Lista de precios 2026', 'price_list', 'published');

insert into integration (id, organization_id, name, provider, category, status, direction) values
  (pg_temp.d('int:1'), pg_temp.org(), 'Viator', 'viator', 'distribution', 'connected', 'inbound'),
  (pg_temp.d('int:2'), pg_temp.org(), 'Stripe', 'stripe', 'payments', 'connected', 'bidirectional'),
  (pg_temp.d('int:3'), pg_temp.org(), 'WhatsApp Business', 'whatsapp', 'messaging', 'sandbox', 'outbound');

-- Casos de huésped y encuestas post-tour para las salidas pasadas.
insert into guest_case (id, organization_id, code, case_type, status, priority, channel, opened_at,
    subject, customer_id, booking_id) values
  (pg_temp.d('case:1'), pg_temp.org(), 'CASO-0001', 'complaint', 'resolved', 'medium', 'whatsapp', now() - interval '5 days', 'Retraso en la recogida', pg_temp.d('cust:3'), pg_temp.d('book:3')),
  (pg_temp.d('case:2'), pg_temp.org(), 'CASO-0002', 'compliment', 'closed', 'low', 'email', now() - interval '9 days', 'Felicitación al guía Carlos', pg_temp.d('cust:5'), pg_temp.d('book:5'));



insert into audit_log (organization_id, action, entity_type, description, occurred_at)
select pg_temp.org(),
    (array['booking.create','payment.record','cash.close','invoice.issue','settlement.generate'])[1 + (n % 5)],
    (array['booking','payment','cash_session','invoice','settlement'])[1 + (n % 5)],
    'Evento de auditoría de demostración ' || n, (now() - (n || ' hours')::interval)
from generate_series(1, 20) as n;

-- ── RECUENTO ─────────────────────────────────────────────────────────────
-- Cuenta tolerante: 0 si la tabla no existe (base por detrás de migraciones),
-- en vez de romper el recuento con «relation ... does not exist».
create or replace function pg_temp.cnt(tbl text) returns bigint
  language plpgsql stable as $fn$
declare n bigint;
begin
  if to_regclass('public.' || tbl) is null then return 0; end if;
  execute format('select count(*) from %I where organization_id = pg_temp.org()', tbl) into n;
  return n;
end $fn$;

-- Lo que quedó cargado, por módulo. Es lo que se ve en pantalla al entrar.
select modulo, filas from (values
  ('catálogo (productos)',   pg_temp.cnt('product')),
  ('modalidades',            pg_temp.cnt('product_modality')),
  ('clientes',               pg_temp.cnt('customer')),
  ('proveedores',            pg_temp.cnt('supplier')),
  ('vendedores',             pg_temp.cnt('seller')),
  ('salidas',                pg_temp.cnt('departure')),
  ('reservas',               pg_temp.cnt('booking')),
  ('pagos',                  pg_temp.cnt('payment')),
  ('facturas (NCF)',         pg_temp.cnt('invoice')),
  ('cuentas por cobrar',     pg_temp.cnt('receivable')),
  ('comisiones',             pg_temp.cnt('commission')),
  ('costes de proveedor',    pg_temp.cnt('booking_cost')),
  ('gastos (606)',           pg_temp.cnt('expense')),
  ('leads',                  pg_temp.cnt('lead')),
  ('cotizaciones',           pg_temp.cnt('quote')),
  ('encuestas',              pg_temp.cnt('guest_survey')),
  ('tareas',                 pg_temp.cnt('task')),
  ('artículos de almacén',   pg_temp.cnt('inventory_item'))
) as t(modulo, filas)
order by modulo;
