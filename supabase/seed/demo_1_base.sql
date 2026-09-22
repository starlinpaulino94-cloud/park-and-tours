-- SEMBRADOR DEMO (plano: sin do, sin funciones, sin temporales) - PARTE 1/3
-- Catalogo, personas y operacion. Ejecutar EN ORDEN 1,2,3. Pegar entero (Ctrl+A, Run). Requiere migracion 0067.

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

delete from participant where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from voucher where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from pickup where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from booking_cost where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from booking where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from sales_order where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from commission where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from payment where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from receivable where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from invoice_line where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from invoice where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from ncf_sequence where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from cash_movement where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from cash_session where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from cash_register where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from expense where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from guest_survey where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from departure_resource where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from pickup_route where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from shift where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from departure where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from attraction where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from vehicle where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from price_rule where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from product_extra where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from product_modality where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from product where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from cancellation_policy where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from product_category where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from seller where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from seller_type where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from staff where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from hotel where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from supplier where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from customer where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from expense_category where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from warehouse where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from tax_profile where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from zone where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from branch where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from audit_log where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from integration where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from message where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from message_template where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from notification where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from task where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from document where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from guest_case where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from quote where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from promotion where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from crm_activity where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from lead where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from stock_movement where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from purchase_order_line where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from purchase_order where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from stock_level where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from inventory_item where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from gift_card where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');

insert into branch (id, organization_id, name, code, branch_type, city, phone, status) values
  (md5('demo:' || ('branch:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Oficina Bávaro',      'BAV', 'office', 'Punta Cana', '+1 809 555 1001', 'active'),
  (md5('demo:' || ('branch:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Kiosco Marina',       'MAR', 'pos',    'La Romana',  '+1 809 555 1002', 'active'),
  (md5('demo:' || ('branch:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Oficina Santo Domingo','SDQ', 'office', 'Santo Domingo','+1 809 555 1003','active');
insert into zone (id, organization_id, name, description, status) values
  (md5('demo:' || ('zone:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Bávaro / Punta Cana', 'Hoteles de la costa este', 'active'),
  (md5('demo:' || ('zone:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Bayahíbe / La Romana', 'Zona sur-este', 'active'),
  (md5('demo:' || ('zone:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Uvero Alto', 'Hoteles del norte de Bávaro', 'active');
insert into tax_profile (id, organization_id, name, country, tax_name, tax_rate, included_in_price, efac_enabled, status) values
  (md5('demo:' || ('tax:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'ITBIS 18%', 'do', 'ITBIS', 18, true, false, 'active');
insert into warehouse (id, organization_id, name, code, warehouse_type, allows_negative, status, branch_id) values
  (md5('demo:' || ('wh:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Almacén Central', 'ALM', 'main', false, 'active', md5('demo:' || ('branch:1'))::uuid);
insert into expense_category (id, organization_id, name, description, status) values
  (md5('demo:' || ('exc:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Combustible', 'Diésel y gasolina de la flota', 'active'),
  (md5('demo:' || ('exc:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Mantenimiento', 'Talleres y repuestos', 'active'),
  (md5('demo:' || ('exc:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Comisiones OTA', 'Cargos de canales externos', 'active');
insert into product_category (id, organization_id, name, description, color, sort_order, status) values
  (md5('demo:' || ('cat:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Excursiones en catamarán', 'Salidas al mar', '#0ea5e9', 1, 'active'),
  (md5('demo:' || ('cat:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Aventura terrestre', 'Buggies, tirolesas, safaris', '#f97316', 2, 'active'),
  (md5('demo:' || ('cat:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Tours culturales', 'Ciudad y naturaleza', '#22c55e', 3, 'active'),
  (md5('demo:' || ('cat:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Traslados', 'Aeropuerto y hoteles', '#a855f7', 4, 'active');
insert into cancellation_policy (id, organization_id, name, description, no_show_refund_pct, status) values
  (md5('demo:' || ('canc:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Flexible 24h', 'Reembolso total hasta 24h antes', 0, 'active'),
  (md5('demo:' || ('canc:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Estricta 72h', 'Sin reembolso dentro de 72h', 0, 'active');
insert into product (id, organization_id, code, name, product_type, category_id, base_price, base_cost,
    currency, cancellation_policy_id, duration_hours, default_capacity, location, meeting_point,
    deposit_type, published, status, sort_order)
select
  md5('demo:' || ('product:' || n))::uuid,
  (select id from organizations where slug = 'havelgo-demo-presentaciones'),
  'TOUR-' || lpad(n::text, 3, '0'),
  (array['Catamarán Party Boat','Snorkel Isla Catalina','Buggies Doble Aventura','Zip Line Anamuya',
         'Safari Cultural Campo','City Tour Santo Domingo','Isla Saona Clásica','Hoyo Azul y Scape Park',
         'Traslado Aeropuerto PUJ','Catamarán Sunset','Buceo Bautismo','Cascada El Limón'])[n],
  'tour',
  (array[md5('demo:' || ('cat:1'))::uuid,md5('demo:' || ('cat:1'))::uuid,md5('demo:' || ('cat:2'))::uuid,md5('demo:' || ('cat:2'))::uuid,
         md5('demo:' || ('cat:3'))::uuid,md5('demo:' || ('cat:3'))::uuid,md5('demo:' || ('cat:1'))::uuid,md5('demo:' || ('cat:2'))::uuid,
         md5('demo:' || ('cat:4'))::uuid,md5('demo:' || ('cat:1'))::uuid,md5('demo:' || ('cat:1'))::uuid,md5('demo:' || ('cat:3'))::uuid])[n],
  (array[89,75,120,65,95,55,99,110,45,79,130,85])[n],
  (array[38,32,54,28,40,22,44,49,20,34,60,36])[n],
  'usd',
  case when n % 2 = 0 then md5('demo:' || ('canc:1'))::uuid else md5('demo:' || ('canc:2'))::uuid end,
  (array[5,6,4,3,8,7,10,5,1,4,3,9])[n],
  (array[40,35,16,24,30,45,120,30,8,40,12,25])[n],
  (array['Bávaro','Isla Catalina','Anamuya','Anamuya','El Seibo','Santo Domingo','Isla Saona',
         'Cap Cana','Aeropuerto PUJ','Bávaro','Bayahíbe','Samaná'])[n],
  'Recogida en el lobby del hotel',
  'none', true, 'active', n
from generate_series(1, 12) as n;
insert into product_modality (id, organization_id, product_id, code, name, modality_type, price, cost,
    currency, min_pax, max_pax, age_from, age_to, status, sort_order)
select md5('demo:' || ('mod:' || n || ':ad'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:' || n))::uuid,
    'AD-' || n, 'Adulto', 'per_pax', (array[89,75,120,65,95,55,99,110,45,79,130,85])[n],
    (array[38,32,54,28,40,22,44,49,20,34,60,36])[n], 'usd'::currency, 1, 40, 12, 99, 'active', 1
from generate_series(1, 12) as n
union all
select md5('demo:' || ('mod:' || n || ':ni'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:' || n))::uuid,
    'NI-' || n, 'Niño', 'per_pax', round((array[89,75,120,65,95,55,99,110,45,79,130,85])[n] * 0.6),
    round((array[38,32,54,28,40,22,44,49,20,34,60,36])[n] * 0.6), 'usd'::currency, 0, 40, 3, 11, 'active', 2
from generate_series(1, 12) as n;
insert into price_rule (id, organization_id, product_id, name, status)
select md5('demo:' || ('pr:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:' || n))::uuid,
    'Temporada alta (dic-abr)', 'active'
from generate_series(1, 3) as n;
insert into product_extra (id, organization_id, product_id, name, price_type, price, cost, currency,
    is_required, max_quantity, status, sort_order) values
  (md5('demo:' || ('extra:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:1'))::uuid, 'Barra libre premium', 'per_person', 15, 5, 'usd', false, 10, 'active', 1),
  (md5('demo:' || ('extra:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:3'))::uuid, 'Fotos y video del tour', 'per_booking', 25, 8, 'usd', false, 1, 'active', 1),
  (md5('demo:' || ('extra:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:7'))::uuid, 'Almuerzo buffet en la isla', 'per_person', 18, 9, 'usd', false, 20, 'active', 1);
insert into supplier (id, organization_id, name, supplier_type, tax_id, contact_name, email, phone,
    currency, payment_terms_days, tax_regime, status) values
  (md5('demo:' || ('sup:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Transporte del Este SRL', 'transport', '131111111', 'Manuel Reyes', 'ops@transporteste.do', '+1 809 555 2001', 'usd', 15, 'company', 'active'),
  (md5('demo:' || ('sup:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Catamaranes Caribe',      'boat',      '131222222', 'Lucía Fermín', 'reservas@catcaribe.do', '+1 809 555 2002', 'usd', 30, 'company', 'active'),
  (md5('demo:' || ('sup:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Parque Scape Cap Cana',   'park',      '131333333', 'Pedro Núñez', 'grupos@scapecapcana.do', '+1 809 555 2003', 'usd', 7, 'company', 'active'),
  (md5('demo:' || ('sup:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Restaurante Isla Buffet', 'restaurant','131444444', 'Ana Belén', 'eventos@islabuffet.do', '+1 809 555 2004', 'usd', 15, 'company', 'active');
insert into hotel (id, organization_id, zone_id, name, category, pickup_point, pickup_offset_min, status) values
  (md5('demo:' || ('hotel:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('zone:1'))::uuid, 'Meliá Punta Cana', '5_star', 'Lobby principal', 15, 'active'),
  (md5('demo:' || ('hotel:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('zone:1'))::uuid, 'Riu Bambú', '5_star', 'Recepción', 20, 'active'),
  (md5('demo:' || ('hotel:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('zone:2'))::uuid, 'Dreams La Romana', '5_star', 'Entrada lobby', 25, 'active'),
  (md5('demo:' || ('hotel:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('zone:3'))::uuid, 'Excellence El Carmen', '5_star', 'Lobby', 20, 'active'),
  (md5('demo:' || ('hotel:5'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('zone:1'))::uuid, 'Hard Rock Punta Cana', '5_star', 'Puerta A', 15, 'active');
insert into staff (id, organization_id, full_name, staff_type, languages, phone, daily_rate, currency,
    salary_type, base_salary, applies_social_security, hire_date, status) values
  (md5('demo:' || ('staff:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Carlos Medina',  'guide',        array['es','en'],        '+1 809 555 3101', 45, 'usd', 'monthly', 32000, true, date '2024-02-01', 'active'),
  (md5('demo:' || ('staff:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Yohan Peña',     'guide',        array['es','en','fr'],   '+1 809 555 3102', 45, 'usd', 'monthly', 34000, true, date '2023-11-15', 'active'),
  (md5('demo:' || ('staff:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Rafael Guzmán',  'driver',       array['es'],             '+1 809 555 3103', 40, 'usd', 'monthly', 28000, true, date '2024-05-20', 'active'),
  (md5('demo:' || ('staff:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Miguel Santana', 'driver',       array['es','en'],        '+1 809 555 3104', 40, 'usd', 'monthly', 28000, true, date '2025-01-10', 'active'),
  (md5('demo:' || ('staff:5'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Laura Objío',    'photographer', array['es','en'],        '+1 809 555 3105', 35, 'usd', 'daily',    NULL, false, date '2025-03-01', 'active'),
  (md5('demo:' || ('staff:6'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Denny Castro',   'coordinator',  array['es','en'],        '+1 809 555 3106', 50, 'usd', 'monthly', 40000, true, date '2023-06-01', 'active');
insert into seller_type (id, organization_id, name, description, status) values
  (md5('demo:' || ('stype:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Interno', 'Personal de oficina y kioscos', 'active'),
  (md5('demo:' || ('stype:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Concierge de hotel', 'Comisión por referido', 'active');
insert into seller (id, organization_id, code, first_name, last_name, seller_type_id, commission_pct,
    max_discount_pct, seller_role, monthly_goal, currency, hire_date, status) values
  (md5('demo:' || ('seller:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'V-001', 'Génesis', 'Mora',     md5('demo:' || ('stype:1'))::uuid, 8,  10, 'seller', 25000, 'usd', date '2024-01-15', 'active'),
  (md5('demo:' || ('seller:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'V-002', 'Ariel',   'Peguero',  md5('demo:' || ('stype:1'))::uuid, 8,  10, 'seller', 25000, 'usd', date '2024-03-01', 'active'),
  (md5('demo:' || ('seller:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'V-003', 'Wendy',   'Santos',   md5('demo:' || ('stype:1'))::uuid, 6,  5,  'seller', 20000, 'usd', date '2024-07-10', 'active'),
  (md5('demo:' || ('seller:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'V-004', 'Frank',   'Almonte',  md5('demo:' || ('stype:2'))::uuid, 12, 0,  'seller', 15000, 'usd', date '2025-02-01', 'active');
insert into customer (id, organization_id, first_name, last_name, email, phone, nationality, country,
    hotel_id, assigned_seller_id, language, source, tags, status)
select
  md5('demo:' || ('cust:' || n))::uuid,
  (select id from organizations where slug = 'havelgo-demo-presentaciones'),
  (array['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Barbara',
         'Hans','Petra','Luca','Giulia','Pierre','Marie','Sofia','Mateo','Emma','Liam',
         'Noah','Olivia','Lucas','Mia','Ethan','Ava','Diego','Valentina','Thomas','Anna',
         'Klaus','Ingrid','Marco','Chiara','Jean','Camille','Pedro','Lucía','Andrés','Carla'])[n],
  (array['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Moore',
         'Müller','Schmidt','Rossi','Bianchi','Dubois','Martin','Fernández','Gómez','Taylor','Anderson',
         'Thomas','Jackson','White','Harris','Martden','Clark','Ramírez','Torres','Meyer','Koch',
         'Weber','Wagner','Ricci','Conti','Bernard','Petit','Núñez','Reyes','Vargas','Castro'])[n],
  ('cliente' || n || '@ejemplo-demo.com')::citext,
  '+1 809 700 ' || lpad((4000 + n)::text, 4, '0'),
  (array['us','us','ca','de','fr','it','es','gb','us','ca'])[1 + (n % 10)],
  (array['us','us','ca','de','fr','it','es','gb','us','ca'])[1 + (n % 10)],
  md5('demo:' || ('hotel:' || (1 + (n % 5))))::uuid,
  md5('demo:' || ('seller:' || (1 + (n % 4))))::uuid,
  (array['en','en','en','de','fr','it','es','en','en','en'])[1 + (n % 10)],
  (array['web','walk_in','ota','referral','web','agency'])[1 + (n % 6)],
  array['demo'],
  'active'
from generate_series(1, 40) as n;
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
