-- SEMBRADOR DEMO - TROZO 02 de 08. Ejecutar EN ORDEN, del 01 al 08.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

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
