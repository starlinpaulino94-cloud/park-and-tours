-- SEMBRADOR DEMO - TROZO 05 de 13. Ejecutar EN ORDEN del 01 al 13.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

insert into seller (id, organization_id, code, first_name, last_name, seller_type_id, commission_pct,
    max_discount_pct, seller_role, monthly_goal, currency, hire_date, status) values
  (md5('demo:' || ('seller:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'V-001', 'Génesis', 'Mora',     md5('demo:' || ('stype:1'))::uuid, 8,  10, 'seller', 25000, 'usd', date '2024-01-15', 'active'),
  (md5('demo:' || ('seller:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'V-002', 'Ariel',   'Peguero',  md5('demo:' || ('stype:1'))::uuid, 8,  10, 'seller', 25000, 'usd', date '2024-03-01', 'active'),
  (md5('demo:' || ('seller:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'V-003', 'Wendy',   'Santos',   md5('demo:' || ('stype:1'))::uuid, 6,  5,  'seller', 20000, 'usd', date '2024-07-10', 'active'),
  (md5('demo:' || ('seller:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'V-004', 'Frank',   'Almonte',  md5('demo:' || ('stype:2'))::uuid, 12, 0,  'seller', 15000, 'usd', date '2025-02-01', 'active');
-- 40 clientes con nacionalidad, hotel y vendedor asignado.
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
-- ── OPERACIÓN ───────────────────────────────────────────────────────────────
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
-- 60 salidas repartidas entre -29 y +30 días, sobre los 8 primeros productos.
-- `available_pax` se rellena aquí a propósito. Dejarla nula hacía que el punto
-- de venta, el catálogo público y la API de las OTAs dieran TODAS las salidas
-- por agotadas: esa columna es una caché y quien inserta a mano tiene que
-- dejarla coherente. Ver src/lib/plazas.ts.
insert into departure (id, organization_id, product_id, departure_at, departure_time, capacity,
    booked_pax, available_pax, cutoff_hours, meeting_point, status, branch_id)
select
  md5('demo:' || ('dep:' || n))::uuid,
  (select id from organizations where slug = 'havelgo-demo-presentaciones'),
  md5('demo:' || ('product:' || (1 + ((n - 1) % 8))))::uuid,
  (date_trunc('day', now()) + ((n - 30) || ' days')::interval + (case when n % 2 = 0 then interval '8 hours' else interval '13 hours' end)),
  case when n % 2 = 0 then '08:00' else '13:00' end,
  (array[40,35,16,24,30,45,120,30])[1 + ((n - 1) % 8)],
  0,
  -- available_pax = cupo - vendidas; aquí booked_pax es 0, así que es el cupo.
  (array[40,35,16,24,30,45,120,30])[1 + ((n - 1) % 8)],
  4,
  'Recogida en lobby',
  case when (n - 30) < 0 then 'completed' else 'available' end,
  md5('demo:' || ('branch:1'))::uuid
from generate_series(1, 60) as n;
-- Un vehículo y un guía por salida.
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
-- Rutas de recogida para las salidas futuras próximas.
insert into pickup_route (id, organization_id, departure_id, zone_id, vehicle_id, guide_id, name,
    start_time, pax_total, stops_count, status)
select md5('demo:' || ('route:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('dep:' || (30 + n)))::uuid,
    md5('demo:' || ('zone:' || (1 + (n % 3))))::uuid, md5('demo:' || ('veh:' || (1 + (n % 5))))::uuid, md5('demo:' || ('staff:1'))::uuid,
    'Ruta ' || to_char(now() + (n || ' days')::interval, 'DD/MM'),
    '06:30', 0, (2 + (n % 4)), 'planned'
from generate_series(1, 10) as n;
-- Turnos del personal para la semana.
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
drop table if exists demo_seed_rows;
