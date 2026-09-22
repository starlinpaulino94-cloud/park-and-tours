-- SEMBRADOR DEMO - TROZO 04 de 13. Ejecutar EN ORDEN del 01 al 13.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

-- Modalidades: adulto y niño por producto.
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
-- Reglas de precio de temporada alta para los tres primeros.
insert into price_rule (id, organization_id, product_id, name, status)
select md5('demo:' || ('pr:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:' || n))::uuid,
    'Temporada alta (dic-abr)', 'active'
from generate_series(1, 3) as n;
-- Extras vendibles.
insert into product_extra (id, organization_id, product_id, name, price_type, price, cost, currency,
    is_required, max_quantity, status, sort_order) values
  (md5('demo:' || ('extra:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:1'))::uuid, 'Barra libre premium', 'per_person', 15, 5, 'usd', false, 10, 'active', 1),
  (md5('demo:' || ('extra:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:3'))::uuid, 'Fotos y video del tour', 'per_booking', 25, 8, 'usd', false, 1, 'active', 1),
  (md5('demo:' || ('extra:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('product:7'))::uuid, 'Almuerzo buffet en la isla', 'per_person', 18, 9, 'usd', false, 20, 'active', 1);
-- ── PERSONAS Y TERCEROS ─────────────────────────────────────────────────────
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
-- Staff: guías, choferes, fotógrafo, coordinador.
insert into staff (id, organization_id, full_name, staff_type, languages, phone, daily_rate, currency,
    salary_type, base_salary, applies_social_security, hire_date, status) values
  (md5('demo:' || ('staff:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Carlos Medina',  'guide',        array['es','en'],        '+1 809 555 3101', 45, 'usd', 'monthly', 32000, true, date '2024-02-01', 'active'),
  (md5('demo:' || ('staff:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Yohan Peña',     'guide',        array['es','en','fr'],   '+1 809 555 3102', 45, 'usd', 'monthly', 34000, true, date '2023-11-15', 'active'),
  (md5('demo:' || ('staff:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Rafael Guzmán',  'driver',       array['es'],             '+1 809 555 3103', 40, 'usd', 'monthly', 28000, true, date '2024-05-20', 'active'),
  (md5('demo:' || ('staff:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Miguel Santana', 'driver',       array['es','en'],        '+1 809 555 3104', 40, 'usd', 'monthly', 28000, true, date '2025-01-10', 'active'),
  (md5('demo:' || ('staff:5'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Laura Objío',    'photographer', array['es','en'],        '+1 809 555 3105', 35, 'usd', 'daily',    NULL, false, date '2025-03-01', 'active'),
  (md5('demo:' || ('staff:6'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Denny Castro',   'coordinator',  array['es','en'],        '+1 809 555 3106', 50, 'usd', 'monthly', 40000, true, date '2023-06-01', 'active');
-- Tipos de vendedor y equipo comercial.
insert into seller_type (id, organization_id, name, description, status) values
  (md5('demo:' || ('stype:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Interno', 'Personal de oficina y kioscos', 'active'),
  (md5('demo:' || ('stype:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Concierge de hotel', 'Comisión por referido', 'active');
