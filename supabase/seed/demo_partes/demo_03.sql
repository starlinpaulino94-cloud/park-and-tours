-- SEMBRADOR DEMO - TROZO 03 de 08. Ejecutar EN ORDEN, del 01 al 08.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

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
