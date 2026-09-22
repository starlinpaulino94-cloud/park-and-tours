-- ============================================================================
-- SEMBRADOR DE DEMOSTRACIÓN — para el editor SQL de Supabase.
--
-- ¿EL EDITOR CORTA EL PEGADO? («syntax error at end of input».) Este archivo es
-- grande; usa la versión en tres partes en esta misma carpeta:
--   demo_1_base.sql  ->  demo_2_ventas.sql  ->  demo_3_extras.sql
-- ejecutadas EN ESE ORDEN. Hacen exactamente lo mismo.
--
-- Carga una empresa de demostración COMPLETA: catálogo, clientes, ventas,
-- cobros, facturas, comisiones, operación, caja, almacén y plataforma. Sirve
-- para presentarle el producto a un cliente sin tocar ninguna operación real.
--
-- CÓMO SE USA
--   Pega este archivo entero en el editor SQL de Supabase y ejecútalo. Tarda
--   unos segundos. Al final imprime un recuento por módulo.
--
-- ES IDEMPOTENTE
--   Empieza borrando lo que sembró la vez anterior (solo de la empresa demo) y
--   vuelve a sembrar. Ejecutarlo dos veces deja el mismo resultado, no el doble.
--
-- NO TOCA TU OPERACIÓN REAL
--   Todo cuelga de una empresa aparte (`havelgo-demo-presentaciones`), con
--   `tenant_org_id` apuntándose a sí misma. La RLS la mantiene separada. Si esa
--   empresa no existe, la crea.
--
-- LOS IDENTIFICADORES SON DETERMINISTAS
--   Cada fila usa `md5('demo:'||algo)::uuid`, así una venta puede apuntar a su
--   cliente y su producto sin depender del orden de inserción, y volver a
--   sembrar reutiliza los mismos ids.
--
-- SE PRUEBA SOLO
--   `scripts/db-test.sh` lo ejecuta contra un Postgres con todas las
--   migraciones. Si una migración cambia una tabla que este archivo llena, el
--   CI se pone rojo en vez de fallar delante de un cliente.
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

-- ── LIMPIEZA ────────────────────────────────────────────────────────────────
-- En orden inverso de dependencia: los hijos antes que los padres. Solo de la
-- empresa demo; la RLS y el filtro por organization_id garantizan que no se
-- toca ninguna otra.
do $$
declare
  t text;
  faltan text[] := '{}';
  orden text[] := array[
    'audit_log','system_incident','job_run','integration','notification','message',
    'message_template','approval_request','task','document_ack','document','attraction_log',
    'guest_survey','guest_case','incident_action','incident','inspection','work_order',
    'payroll_line','payroll_run','ledger_entry','payable','seller_bonus','settlement',
    'commission_adjustment','commission','stock_movement','purchase_order_line','purchase_order',
    'expense','cash_count','cash_movement','cash_session','cash_register',
    'gift_card_movement','gift_card','ncf_sequence','invoice_line','invoice','receivable',
    'payment','payment_schedule','seller_attribution','waitlist_entry','pickup','waiver',
    'access_ticket','voucher','participant','booking_cost','booking_extra','booking','sales_order',
    'crm_activity','lead','quote_line','quote_option','quote','seller_goal','commission_rule','promotion',
    'stock_level','inventory_item','certification','attendance','shift','pickup_route',
    'departure_resource','departure','attraction','maintenance_plan','asset','vehicle',
    'seller_link','seller','seller_type','membership','customer','staff','hotel','supplier',
    'membership_plan','inspection_template','waiver_template','product_cost','product_bundle_item',
    'product_extra','price_rule','product_modality','product','cancellation_policy','product_category',
    'expense_category','warehouse','accounting_period','ledger_account','currency_rate','tax_profile',
    'zone','branch'
  ];
begin
  foreach t in array orden loop
    -- Una base por detrás de las migraciones no tiene todas las tablas. En vez
    -- de reventar con «relation ... does not exist», se salta la que falte y se
    -- reporta al final: es la señal de que hay migraciones pendientes.
    if to_regclass('public.' || t) is not null then
      execute format('delete from %I where organization_id = pg_temp.org()', t);
    else
      faltan := array_append(faltan, t);
    end if;
  end loop;
  if array_length(faltan, 1) > 0 then
    raise warning 'Tu base va por detrás de las migraciones. Estas tablas no existen y se OMITEN: %. Aplica las migraciones pendientes para que la demo (y la app) las tengan.', array_to_string(faltan, ', ');
  end if;
end $$;

-- ── CIMIENTOS ─────────────────────────────────────────────────────────────
insert into branch (id, organization_id, name, code, branch_type, city, phone, status) values
  (pg_temp.d('branch:1'), pg_temp.org(), 'Oficina Bávaro',      'BAV', 'office', 'Punta Cana', '+1 809 555 1001', 'active'),
  (pg_temp.d('branch:2'), pg_temp.org(), 'Kiosco Marina',       'MAR', 'pos',    'La Romana',  '+1 809 555 1002', 'active'),
  (pg_temp.d('branch:3'), pg_temp.org(), 'Oficina Santo Domingo','SDQ', 'office', 'Santo Domingo','+1 809 555 1003','active');

insert into zone (id, organization_id, name, description, status) values
  (pg_temp.d('zone:1'), pg_temp.org(), 'Bávaro / Punta Cana', 'Hoteles de la costa este', 'active'),
  (pg_temp.d('zone:2'), pg_temp.org(), 'Bayahíbe / La Romana', 'Zona sur-este', 'active'),
  (pg_temp.d('zone:3'), pg_temp.org(), 'Uvero Alto', 'Hoteles del norte de Bávaro', 'active');

insert into tax_profile (id, organization_id, name, country, tax_name, tax_rate, included_in_price, efac_enabled, status) values
  (pg_temp.d('tax:1'), pg_temp.org(), 'ITBIS 18%', 'do', 'ITBIS', 18, true, false, 'active');

insert into warehouse (id, organization_id, name, code, warehouse_type, allows_negative, status, branch_id) values
  (pg_temp.d('wh:1'), pg_temp.org(), 'Almacén Central', 'ALM', 'main', false, 'active', pg_temp.d('branch:1'));

insert into expense_category (id, organization_id, name, description, status) values
  (pg_temp.d('exc:1'), pg_temp.org(), 'Combustible', 'Diésel y gasolina de la flota', 'active'),
  (pg_temp.d('exc:2'), pg_temp.org(), 'Mantenimiento', 'Talleres y repuestos', 'active'),
  (pg_temp.d('exc:3'), pg_temp.org(), 'Comisiones OTA', 'Cargos de canales externos', 'active');

-- ── CATÁLOGO ─────────────────────────────────────────────────────────────
insert into product_category (id, organization_id, name, description, color, sort_order, status) values
  (pg_temp.d('cat:1'), pg_temp.org(), 'Excursiones en catamarán', 'Salidas al mar', '#0ea5e9', 1, 'active'),
  (pg_temp.d('cat:2'), pg_temp.org(), 'Aventura terrestre', 'Buggies, tirolesas, safaris', '#f97316', 2, 'active'),
  (pg_temp.d('cat:3'), pg_temp.org(), 'Tours culturales', 'Ciudad y naturaleza', '#22c55e', 3, 'active'),
  (pg_temp.d('cat:4'), pg_temp.org(), 'Traslados', 'Aeropuerto y hoteles', '#a855f7', 4, 'active');

insert into cancellation_policy (id, organization_id, name, description, no_show_refund_pct, status) values
  (pg_temp.d('canc:1'), pg_temp.org(), 'Flexible 24h', 'Reembolso total hasta 24h antes', 0, 'active'),
  (pg_temp.d('canc:2'), pg_temp.org(), 'Estricta 72h', 'Sin reembolso dentro de 72h', 0, 'active');

-- 12 productos repartidos en las categorías.
insert into product (id, organization_id, code, name, product_type, category_id, base_price, base_cost,
    currency, cancellation_policy_id, duration_hours, default_capacity, location, meeting_point,
    deposit_type, published, status, sort_order)
select
  pg_temp.d('product:' || n),
  pg_temp.org(),
  'TOUR-' || lpad(n::text, 3, '0'),
  (array['Catamarán Party Boat','Snorkel Isla Catalina','Buggies Doble Aventura','Zip Line Anamuya',
         'Safari Cultural Campo','City Tour Santo Domingo','Isla Saona Clásica','Hoyo Azul y Scape Park',
         'Traslado Aeropuerto PUJ','Catamarán Sunset','Buceo Bautismo','Cascada El Limón'])[n],
  'tour',
  (array[pg_temp.d('cat:1'),pg_temp.d('cat:1'),pg_temp.d('cat:2'),pg_temp.d('cat:2'),
         pg_temp.d('cat:3'),pg_temp.d('cat:3'),pg_temp.d('cat:1'),pg_temp.d('cat:2'),
         pg_temp.d('cat:4'),pg_temp.d('cat:1'),pg_temp.d('cat:1'),pg_temp.d('cat:3')])[n],
  (array[89,75,120,65,95,55,99,110,45,79,130,85])[n],
  (array[38,32,54,28,40,22,44,49,20,34,60,36])[n],
  'usd',
  case when n % 2 = 0 then pg_temp.d('canc:1') else pg_temp.d('canc:2') end,
  (array[5,6,4,3,8,7,10,5,1,4,3,9])[n],
  (array[40,35,16,24,30,45,120,30,8,40,12,25])[n],
  (array['Bávaro','Isla Catalina','Anamuya','Anamuya','El Seibo','Santo Domingo','Isla Saona',
         'Cap Cana','Aeropuerto PUJ','Bávaro','Bayahíbe','Samaná'])[n],
  'Recogida en el lobby del hotel',
  'none', true, 'active', n
from generate_series(1, 12) as n;

-- Modalidades: adulto y niño por producto.
insert into product_modality (id, organization_id, product_id, code, name, modality_type, price, cost,
    currency, min_pax, max_pax, age_from, age_to, status, sort_order)
select pg_temp.d('mod:' || n || ':ad'), pg_temp.org(), pg_temp.d('product:' || n),
    'AD-' || n, 'Adulto', 'per_pax', (array[89,75,120,65,95,55,99,110,45,79,130,85])[n],
    (array[38,32,54,28,40,22,44,49,20,34,60,36])[n], 'usd'::currency, 1, 40, 12, 99, 'active', 1
from generate_series(1, 12) as n
union all
select pg_temp.d('mod:' || n || ':ni'), pg_temp.org(), pg_temp.d('product:' || n),
    'NI-' || n, 'Niño', 'per_pax', round((array[89,75,120,65,95,55,99,110,45,79,130,85])[n] * 0.6),
    round((array[38,32,54,28,40,22,44,49,20,34,60,36])[n] * 0.6), 'usd'::currency, 0, 40, 3, 11, 'active', 2
from generate_series(1, 12) as n;

-- Reglas de precio de temporada alta para los tres primeros.
insert into price_rule (id, organization_id, product_id, name, status)
select pg_temp.d('pr:' || n), pg_temp.org(), pg_temp.d('product:' || n),
    'Temporada alta (dic-abr)', 'active'
from generate_series(1, 3) as n;

-- Extras vendibles.
insert into product_extra (id, organization_id, product_id, name, price_type, price, cost, currency,
    is_required, max_quantity, status, sort_order) values
  (pg_temp.d('extra:1'), pg_temp.org(), pg_temp.d('product:1'), 'Barra libre premium', 'per_person', 15, 5, 'usd', false, 10, 'active', 1),
  (pg_temp.d('extra:2'), pg_temp.org(), pg_temp.d('product:3'), 'Fotos y video del tour', 'per_booking', 25, 8, 'usd', false, 1, 'active', 1),
  (pg_temp.d('extra:3'), pg_temp.org(), pg_temp.d('product:7'), 'Almuerzo buffet en la isla', 'per_person', 18, 9, 'usd', false, 20, 'active', 1);

-- ── PERSONAS Y TERCEROS ─────────────────────────────────────────────────────
insert into supplier (id, organization_id, name, supplier_type, tax_id, contact_name, email, phone,
    currency, payment_terms_days, tax_regime, status) values
  (pg_temp.d('sup:1'), pg_temp.org(), 'Transporte del Este SRL', 'transport', '131111111', 'Manuel Reyes', 'ops@transporteste.do', '+1 809 555 2001', 'usd', 15, 'company', 'active'),
  (pg_temp.d('sup:2'), pg_temp.org(), 'Catamaranes Caribe',      'boat',      '131222222', 'Lucía Fermín', 'reservas@catcaribe.do', '+1 809 555 2002', 'usd', 30, 'company', 'active'),
  (pg_temp.d('sup:3'), pg_temp.org(), 'Parque Scape Cap Cana',   'park',      '131333333', 'Pedro Núñez', 'grupos@scapecapcana.do', '+1 809 555 2003', 'usd', 7, 'company', 'active'),
  (pg_temp.d('sup:4'), pg_temp.org(), 'Restaurante Isla Buffet', 'restaurant','131444444', 'Ana Belén', 'eventos@islabuffet.do', '+1 809 555 2004', 'usd', 15, 'company', 'active');

insert into hotel (id, organization_id, zone_id, name, category, pickup_point, pickup_offset_min, status) values
  (pg_temp.d('hotel:1'), pg_temp.org(), pg_temp.d('zone:1'), 'Meliá Punta Cana', '5_star', 'Lobby principal', 15, 'active'),
  (pg_temp.d('hotel:2'), pg_temp.org(), pg_temp.d('zone:1'), 'Riu Bambú', '5_star', 'Recepción', 20, 'active'),
  (pg_temp.d('hotel:3'), pg_temp.org(), pg_temp.d('zone:2'), 'Dreams La Romana', '5_star', 'Entrada lobby', 25, 'active'),
  (pg_temp.d('hotel:4'), pg_temp.org(), pg_temp.d('zone:3'), 'Excellence El Carmen', '5_star', 'Lobby', 20, 'active'),
  (pg_temp.d('hotel:5'), pg_temp.org(), pg_temp.d('zone:1'), 'Hard Rock Punta Cana', '5_star', 'Puerta A', 15, 'active');

-- Staff: guías, choferes, fotógrafo, coordinador.
insert into staff (id, organization_id, full_name, staff_type, languages, phone, daily_rate, currency,
    salary_type, base_salary, applies_social_security, hire_date, status) values
  (pg_temp.d('staff:1'), pg_temp.org(), 'Carlos Medina',  'guide',        array['es','en'],        '+1 809 555 3101', 45, 'usd', 'monthly', 32000, true, date '2024-02-01', 'active'),
  (pg_temp.d('staff:2'), pg_temp.org(), 'Yohan Peña',     'guide',        array['es','en','fr'],   '+1 809 555 3102', 45, 'usd', 'monthly', 34000, true, date '2023-11-15', 'active'),
  (pg_temp.d('staff:3'), pg_temp.org(), 'Rafael Guzmán',  'driver',       array['es'],             '+1 809 555 3103', 40, 'usd', 'monthly', 28000, true, date '2024-05-20', 'active'),
  (pg_temp.d('staff:4'), pg_temp.org(), 'Miguel Santana', 'driver',       array['es','en'],        '+1 809 555 3104', 40, 'usd', 'monthly', 28000, true, date '2025-01-10', 'active'),
  (pg_temp.d('staff:5'), pg_temp.org(), 'Laura Objío',    'photographer', array['es','en'],        '+1 809 555 3105', 35, 'usd', 'daily',    NULL, false, date '2025-03-01', 'active'),
  (pg_temp.d('staff:6'), pg_temp.org(), 'Denny Castro',   'coordinator',  array['es','en'],        '+1 809 555 3106', 50, 'usd', 'monthly', 40000, true, date '2023-06-01', 'active');

-- Tipos de vendedor y equipo comercial.
insert into seller_type (id, organization_id, name, description, status) values
  (pg_temp.d('stype:1'), pg_temp.org(), 'Interno', 'Personal de oficina y kioscos', 'active'),
  (pg_temp.d('stype:2'), pg_temp.org(), 'Concierge de hotel', 'Comisión por referido', 'active');

insert into seller (id, organization_id, code, first_name, last_name, seller_type_id, commission_pct,
    max_discount_pct, seller_role, monthly_goal, currency, hire_date, status) values
  (pg_temp.d('seller:1'), pg_temp.org(), 'V-001', 'Génesis', 'Mora',     pg_temp.d('stype:1'), 8,  10, 'seller', 25000, 'usd', date '2024-01-15', 'active'),
  (pg_temp.d('seller:2'), pg_temp.org(), 'V-002', 'Ariel',   'Peguero',  pg_temp.d('stype:1'), 8,  10, 'seller', 25000, 'usd', date '2024-03-01', 'active'),
  (pg_temp.d('seller:3'), pg_temp.org(), 'V-003', 'Wendy',   'Santos',   pg_temp.d('stype:1'), 6,  5,  'seller', 20000, 'usd', date '2024-07-10', 'active'),
  (pg_temp.d('seller:4'), pg_temp.org(), 'V-004', 'Frank',   'Almonte',  pg_temp.d('stype:2'), 12, 0,  'seller', 15000, 'usd', date '2025-02-01', 'active');

-- 40 clientes con nacionalidad, hotel y vendedor asignado.
insert into customer (id, organization_id, first_name, last_name, email, phone, nationality, country,
    hotel_id, assigned_seller_id, language, source, tags, status)
select
  pg_temp.d('cust:' || n),
  pg_temp.org(),
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
  pg_temp.d('hotel:' || (1 + (n % 5))),
  pg_temp.d('seller:' || (1 + (n % 4))),
  (array['en','en','en','de','fr','it','es','en','en','en'])[1 + (n % 10)],
  (array['web','walk_in','ota','referral','web','agency'])[1 + (n % 6)],
  array['demo'],
  'active'
from generate_series(1, 40) as n;

-- ── OPERACIÓN ───────────────────────────────────────────────────────────────
insert into vehicle (id, organization_id, supplier_id, name, plate, vehicle_type, capacity, status) values
  (pg_temp.d('veh:1'), pg_temp.org(), pg_temp.d('sup:1'), 'Bus Mercedes 45', 'A123456', 'bus',       45, 'available'),
  (pg_temp.d('veh:2'), pg_temp.org(), pg_temp.d('sup:1'), 'Minibús Sprinter', 'A234567', 'minibus',  19, 'available'),
  (pg_temp.d('veh:3'), pg_temp.org(), pg_temp.d('sup:2'), 'Catamarán Sirena', 'BOAT-01', 'catamaran',60, 'available'),
  (pg_temp.d('veh:4'), pg_temp.org(), pg_temp.d('sup:1'), 'Van Hiace',        'A345678', 'van',      14, 'available'),
  (pg_temp.d('veh:5'), pg_temp.org(), pg_temp.d('sup:1'), 'Flota Buggies (8)','BUGGY',   'buggy',    16, 'in_service');

insert into attraction (id, organization_id, name, code, zone_id, attraction_type, operational_status,
    capacity_hour, duration_min, status) values
  (pg_temp.d('attr:1'), pg_temp.org(), 'Hoyo Azul', 'HOYO', pg_temp.d('zone:1'), 'adventure', 'open', 120, 45, 'active'),
  (pg_temp.d('attr:2'), pg_temp.org(), 'Tirolesa Anamuya', 'ZIP', pg_temp.d('zone:1'), 'adventure', 'open', 60, 90, 'active');

-- 60 salidas repartidas entre -29 y +30 días, sobre los 8 primeros productos.
insert into departure (id, organization_id, product_id, departure_at, departure_time, capacity,
    booked_pax, cutoff_hours, meeting_point, status, branch_id)
select
  pg_temp.d('dep:' || n),
  pg_temp.org(),
  pg_temp.d('product:' || (1 + ((n - 1) % 8))),
  (date_trunc('day', now()) + ((n - 30) || ' days')::interval + (case when n % 2 = 0 then interval '8 hours' else interval '13 hours' end)),
  case when n % 2 = 0 then '08:00' else '13:00' end,
  (array[40,35,16,24,30,45,120,30])[1 + ((n - 1) % 8)],
  0,
  4,
  'Recogida en lobby',
  case when (n - 30) < 0 then 'completed' else 'available' end,
  pg_temp.d('branch:1')
from generate_series(1, 60) as n;

-- Un vehículo y un guía por salida.
insert into departure_resource (id, organization_id, departure_id, vehicle_id, staff_id, resource_role,
    pax_assigned, cost, currency, status)
select pg_temp.d('depres:' || n || ':v'), pg_temp.org(), pg_temp.d('dep:' || n),
    pg_temp.d('veh:' || (1 + (n % 5))), NULL, 'vehicle', 0,
    (array[180,180,320,140,160,180,420,160])[1 + ((n - 1) % 8)], 'usd'::currency,
    case when (n - 30) < 0 then 'confirmed' else 'planned' end
from generate_series(1, 60) as n
union all
select pg_temp.d('depres:' || n || ':g'), pg_temp.org(), pg_temp.d('dep:' || n),
    NULL, pg_temp.d('staff:' || (1 + (n % 2))), 'guide', 0, 45, 'usd'::currency,
    case when (n - 30) < 0 then 'confirmed' else 'planned' end
from generate_series(1, 60) as n;

-- Rutas de recogida para las salidas futuras próximas.
insert into pickup_route (id, organization_id, departure_id, zone_id, vehicle_id, guide_id, name,
    start_time, pax_total, stops_count, status)
select pg_temp.d('route:' || n), pg_temp.org(), pg_temp.d('dep:' || (30 + n)),
    pg_temp.d('zone:' || (1 + (n % 3))), pg_temp.d('veh:' || (1 + (n % 5))), pg_temp.d('staff:1'),
    'Ruta ' || to_char(now() + (n || ' days')::interval, 'DD/MM'),
    '06:30', 0, (2 + (n % 4)), 'planned'
from generate_series(1, 10) as n;

-- Turnos del personal para la semana.
insert into shift (id, organization_id, role_label, shift_date, starts_at, ends_at, status, staff_id,
    hourly_rate, currency)
select pg_temp.d('shift:' || n), pg_temp.org(),
    (array['Guía','Guía','Chofer','Chofer','Fotógrafo','Coordinador'])[1 + ((n - 1) % 6)],
    (current_date + ((n % 7) || ' days')::interval)::date,
    (date_trunc('day', now()) + (n % 7 || ' days')::interval + interval '7 hours'),
    (date_trunc('day', now()) + (n % 7 || ' days')::interval + interval '16 hours'),
    'published',
    pg_temp.d('staff:' || (1 + ((n - 1) % 6))),
    6, 'usd'::currency
from generate_series(1, 18) as n;

-- ── VENTA Y SU RASTRO ───────────────────────────────────────────────────────
-- Una tabla auxiliar con las 60 ventas ya calculadas. Todo lo que sigue —orden,
-- reserva, pagos, factura, comisión— sale de aquí, así que los importes cuadran
-- entre módulos en vez de inventarse en cada uno.
--
-- Es una tabla NORMAL, no temporal, a propósito: el editor SQL de Supabase usa
-- un pool de conexiones y NO conserva las tablas temporales entre sentencias
-- («relation "v" does not exist»). Una tabla normal sí persiste; se borra al
-- final. El nombre lleva prefijo para no chocar con nada.
drop table if exists demo_seed_rows;
create table demo_seed_rows as
with base as (
  select
    n,
    1 + ((n - 1) % 8) as prod,
    1 + ((n - 1) % 40) as cust,
    1 + ((n - 1) % 4) as seller,
    (date_trunc('day', now()) + ((n - 30) || ' days')::interval)::date as travel_date,
    2 + (n % 3) as adults,
    (n % 2) as children,
    (array[89,75,120,65,95,55,99,110])[1 + ((n - 1) % 8)]::numeric as price,
    (array[38,32,54,28,40,22,44,49])[1 + ((n - 1) % 8)]::numeric as unit_cost
  from generate_series(1, 60) as n
), calc as (
  select b.*,
    (b.adults + b.children) as pax_total,
    (b.price * b.adults + round(b.price * 0.6) * b.children) as gross,
    case when b.n % 4 = 0 then round((b.price * b.adults + round(b.price * 0.6) * b.children) * 0.10) else 0 end as discount,
    (b.unit_cost * (b.adults + b.children)) as cost_amount
  from base b
), money as (
  select c.*,
    (c.gross - c.discount) as total,
    case c.n % 5 when 0 then 0
                 when 1 then round((c.gross - c.discount) * 0.5)
                 else (c.gross - c.discount) end as paid
  from calc c
)
select
  m.*,
  (m.travel_date < current_date) as pasada,
  case
    when m.paid = 0 then 'pending_payment'
    when m.paid < m.total then 'partially_paid'
    when m.travel_date < current_date then 'completed'
    else 'paid'
  end as estado,
  (array['web','walk_in','ota','phone','agency','direct','whatsapp','tour_center'])[1 + (m.n % 8)] as canal
from money m;

insert into sales_order (id, organization_id, order_number, customer_id, seller_id, channel, status,
    currency, exchange_rate, subtotal, discount_total, tax_total, total, paid_total, balance, order_date)
select pg_temp.d('order:' || v.n), pg_temp.org(), 'ORD-' || lpad(v.n::text, 4, '0'),
    pg_temp.d('cust:' || v.cust), pg_temp.d('seller:' || v.seller), v.canal::sales_channel, v.estado,
    'usd'::currency, 1, v.gross, v.discount, 0, v.total, v.paid, v.total - v.paid,
    (v.travel_date - 3)::date
from demo_seed_rows v;

insert into booking (id, organization_id, booking_number, order_id, customer_id, product_id, departure_id,
    modality_id, seller_id, travel_date, adults, children, pax_total, gross_amount, discount_amount,
    tax_amount, total_amount, paid_amount, balance_amount, cost_amount, margin_amount, currency,
    channel, status, checkin_status, hotel_id, exchange_rate, unit_price, booking_date)
select pg_temp.d('book:' || v.n), pg_temp.org(), 'RES-' || lpad(v.n::text, 4, '0'),
    pg_temp.d('order:' || v.n), pg_temp.d('cust:' || v.cust), pg_temp.d('product:' || v.prod),
    pg_temp.d('dep:' || v.n), pg_temp.d('mod:' || v.prod || ':ad'), pg_temp.d('seller:' || v.seller),
    v.travel_date, v.adults, v.children, v.pax_total, v.gross, v.discount, 0, v.total, v.paid,
    v.total - v.paid, v.cost_amount, v.total - v.cost_amount, 'usd'::currency, v.canal::sales_channel,
    case when v.pasada then 'completed' when v.paid = 0 then 'pending_payment'
         when v.paid < v.total then 'partially_paid' else 'paid' end,
    case when v.pasada then 'done' else 'pending' end,
    pg_temp.d('hotel:' || (1 + (v.n % 5))), 1, v.price, (v.travel_date - 3)::date
from demo_seed_rows v;

-- Participantes: el titular por reserva, más un acompañante en la mitad.
insert into participant (id, organization_id, booking_id, full_name, checkin_status)
select pg_temp.d('part:' || v.n || ':1'), pg_temp.org(), pg_temp.d('book:' || v.n),
    'Titular reserva ' || v.n, case when v.pasada then 'done' else 'pending' end
from demo_seed_rows v
union all
select pg_temp.d('part:' || v.n || ':2'), pg_temp.org(), pg_temp.d('book:' || v.n),
    'Acompañante ' || v.n, case when v.pasada then 'done' else 'pending' end
from demo_seed_rows v where v.children > 0 or v.n % 2 = 0;

-- Un voucher por reserva.
insert into voucher (id, organization_id, booking_id, code, status)
select pg_temp.d('vou:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n),
    'VCH-' || lpad(v.n::text, 5, '0'),
    case when v.pasada then 'used' else 'valid' end
from demo_seed_rows v;

-- Recogidas de las reservas futuras confirmadas.
insert into pickup (id, organization_id, booking_id, hotel_id, status, pickup_time)
select pg_temp.d('pick:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n),
    pg_temp.d('hotel:' || (1 + (v.n % 5))),
    case when v.pasada then 'picked_up' else 'confirmed' end,
    '07:00'
from demo_seed_rows v where v.paid > 0;

-- ── DINERO ──────────────────────────────────────────────────────────────────
-- Un pago por cada venta con algo cobrado.
insert into payment (id, organization_id, order_id, customer_id, reference, payment_type, method, status,
    amount, currency, exchange_rate, paid_at)
select pg_temp.d('pay:' || v.n), pg_temp.org(), pg_temp.d('order:' || v.n), pg_temp.d('cust:' || v.cust),
    'PAY-' || lpad(v.n::text, 5, '0'), 'payment'::payment_kind,
    (array['cash','card','transfer','link','card']::payment_method[])[1 + (v.n % 5)], 'completed',
    v.paid, 'usd'::currency, 1, (v.travel_date - 2)::timestamptz
from demo_seed_rows v where v.paid > 0;

-- Cuenta por cobrar por cada venta con saldo.
insert into receivable (id, organization_id, order_id, customer_id, document_number, amount, paid_amount,
    balance, currency, status, issue_date, due_date)
select pg_temp.d('rec:' || v.n), pg_temp.org(), pg_temp.d('order:' || v.n), pg_temp.d('cust:' || v.cust),
    'CxC-' || lpad(v.n::text, 5, '0'), v.total, v.paid, v.total - v.paid, 'usd'::currency,
    case when v.travel_date < current_date then 'overdue' else 'pending' end,
    (v.travel_date - 3)::date, (v.travel_date + 7)::date
from demo_seed_rows v where v.total - v.paid > 0;

-- La secuencia de NCF de consumo.
insert into ncf_sequence (id, organization_id, ncf_type, status) values
  (pg_temp.d('ncfseq:b02'), pg_temp.org(), 'b02', 'active');

-- Factura emitida para cada venta pagada por completo.
insert into invoice (id, organization_id, number, ncf, ncf_type, invoice_type, status, issued_at,
    subtotal, tax, tax_rate, discount, total, paid_amount, currency, exchange_rate,
    customer_name, customer_tax_id, customer_id, order_id)
select pg_temp.d('inv:' || v.n), pg_temp.org(), 'FAC-' || lpad(v.n::text, 5, '0'),
    'B02' || lpad(v.n::text, 8, '0'), 'b02', 'sale', 'paid', (v.travel_date - 2)::timestamptz,
    round(v.total / 1.18, 2), round(v.total - v.total / 1.18, 2), 18, v.discount, v.total, v.total,
    'usd'::currency, 1, 'Cliente ' || v.cust, NULL, pg_temp.d('cust:' || v.cust), pg_temp.d('order:' || v.n)
from demo_seed_rows v where v.paid >= v.total and v.paid > 0;

insert into invoice_line (id, organization_id, invoice_id, description, quantity, unit_price, total)
select pg_temp.d('invl:' || v.n), pg_temp.org(), pg_temp.d('inv:' || v.n),
    'Excursión ' || v.prod || ' — ' || v.pax_total || ' pax', v.pax_total, v.price, v.total
from demo_seed_rows v where v.paid >= v.total and v.paid > 0;

-- Comisión del vendedor por cada reserva.
insert into commission (id, organization_id, booking_id, order_id, seller_id, beneficiary_type,
    calc_type, base_amount, percentage, amount, currency, status, beneficiary_name)
select pg_temp.d('com:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n), pg_temp.d('order:' || v.n),
    pg_temp.d('seller:' || v.seller), 'seller'::beneficiary_type, 'percentage'::calc_type,
    v.total, (array[8,8,6,12])[v.seller], round(v.total * (array[8,8,6,12])[v.seller] / 100.0, 2),
    'usd'::currency,
    case when v.travel_date < current_date then 'approved' else 'pending' end,
    'Vendedor ' || v.seller
from demo_seed_rows v;

-- Coste del proveedor de transporte por reserva (lo que se liquida los viernes).
insert into booking_cost (id, organization_id, booking_id, supplier_id, concept, cost_type, quantity,
    unit_cost, amount, currency, status)
select pg_temp.d('bcost:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n), pg_temp.d('sup:1'),
    'Transporte terrestre', 'per_group', 1, v.cost_amount, v.cost_amount, 'usd'::currency,
    case when v.travel_date < current_date then 'confirmed' else 'accrued' end
from demo_seed_rows v;

-- Caja: dos registradoras, sesiones y movimientos de los pagos en efectivo.
insert into cash_register (id, organization_id, name, code, currency, status, branch_id) values
  (pg_temp.d('reg:1'), pg_temp.org(), 'Caja Bávaro', 'CJ-BAV', 'usd', 'active', pg_temp.d('branch:1')),
  (pg_temp.d('reg:2'), pg_temp.org(), 'Caja Marina', 'CJ-MAR', 'usd', 'active', pg_temp.d('branch:2'));

insert into cash_session (id, organization_id, cash_register_id, opening_amount, sales_total, status,
    opened_at, closed_at, currency, exchange_rate) values
  (pg_temp.d('csess:1'), pg_temp.org(), pg_temp.d('reg:1'), 200, 0, 'closed',
     (now() - interval '2 days')::timestamptz, (now() - interval '2 days' + interval '9 hours')::timestamptz, 'usd', 1),
  (pg_temp.d('csess:2'), pg_temp.org(), pg_temp.d('reg:1'), 200, 0, 'open',
     date_trunc('day', now()) + interval '7 hours', NULL, 'usd', 1);

-- Cada pago en efectivo mueve la caja.
insert into cash_movement (id, organization_id, cash_session_id, payment_id, movement_type, amount,
    currency, concept, movement_at)
select pg_temp.d('cmov:' || v.n), pg_temp.org(), pg_temp.d('csess:1'), pg_temp.d('pay:' || v.n),
    'sale', v.paid, 'usd'::currency, 'Venta ' || v.n, (v.travel_date - 2)::timestamptz
from demo_seed_rows v where v.paid > 0 and (v.n % 5) not in (0, 1) and (v.n % 5) = 2;

-- Gastos del mes, algunos con NCF para el 606.
insert into expense (id, organization_id, category_id, supplier_id, concept, amount, currency,
    expense_date, payment_method, status, ncf, ncf_type, supplier_rnc, itbis_amount, goods_service_type)
select pg_temp.d('exp:' || n), pg_temp.org(),
    pg_temp.d('exc:' || (1 + (n % 3))), pg_temp.d('sup:' || (1 + (n % 4))),
    (array['Diésel flota','Repuestos van','Comisión OTA','Peajes','Lavado vehículos',
           'Aceite y filtros','Combustible catamarán','Cargo pasarela','Mantenimiento buggies',
           'Uniformes guías','Agua y hielo','Publicidad redes'])[1 + ((n - 1) % 12)],
    (array[1200,450,890,120,80,340,600,210,520,300,90,450])[1 + ((n - 1) % 12)],
    'usd'::currency, (current_date - (n * 2))::date,
    (array['cash','transfer','card']::payment_method[])[1 + (n % 3)], 'approved',
    'B01' || lpad(n::text, 8, '0'), 'b01', '13' || lpad(n::text, 7, '0'),
    round((array[1200,450,890,120,80,340,600,210,520,300,90,450])[1 + ((n - 1) % 12)] * 0.18, 2), '09'
from generate_series(1, 12) as n;

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

do $$
begin
  -- guest_survey es de la migración 0067; si la base va por detrás no existe,
  -- y el SQL estático dentro de un IF no tomado ni se planifica, así que no
  -- rompe el sembrado. Lo demás se carga igual.
  if to_regclass('public.guest_survey') is not null then
  -- Encuestas: respondidas para salidas pasadas (con NPS y notas), pendientes para las próximas.
  insert into guest_survey (id, organization_id, booking_id, departure_id, product_id, customer_id,
      guide_staff_id, token, status, asked_at, answered_at, nps, rating_guide, rating_transport,
      rating_value, comment, language)
  select pg_temp.d('surv:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n), pg_temp.d('dep:' || v.n),
      pg_temp.d('product:' || v.prod), pg_temp.d('cust:' || v.cust), pg_temp.d('staff:1'),
      'TOK-' || lpad(v.n::text, 6, '0'),
      'answered', (v.travel_date + 1)::timestamptz, (v.travel_date + 1)::timestamptz,
      (array[10,9,8,10,7,9,10,6,9,8])[1 + (v.n % 10)],
      (array[5,5,4,5,4,5,5,3,4,5])[1 + (v.n % 10)],
      (array[5,4,4,5,3,5,4,3,5,4])[1 + (v.n % 10)],
      (array[5,4,5,5,4,4,5,3,4,5])[1 + (v.n % 10)],
      (array['¡Excelente día!','Muy recomendable','El guía fue genial','Repetiremos','Todo perfecto'])[1 + (v.n % 5)],
      'es'
  from demo_seed_rows v where v.travel_date < current_date and v.n % 2 = 0;

  insert into guest_survey (id, organization_id, booking_id, departure_id, product_id, customer_id,
      token, status, asked_at, expires_at, language)
  select pg_temp.d('survp:' || v.n), pg_temp.org(), pg_temp.d('book:' || v.n), pg_temp.d('dep:' || v.n),
      pg_temp.d('product:' || v.prod), pg_temp.d('cust:' || v.cust),
      'TOKP-' || lpad(v.n::text, 6, '0'), 'pending', now(), now() + interval '7 days', 'es'
  from demo_seed_rows v where v.travel_date >= current_date and v.n % 3 = 0;
  else
    raise warning 'guest_survey no existe (falta la migración 0067): se omiten las encuestas.';
  end if;
end $$;

insert into audit_log (organization_id, action, entity_type, description, occurred_at)
select pg_temp.org(),
    (array['booking.create','payment.record','cash.close','invoice.issue','settlement.generate'])[1 + (n % 5)],
    (array['booking','payment','cash_session','invoice','settlement'])[1 + (n % 5)],
    'Evento de auditoría de demostración ' || n, (now() - (n || ' hours')::interval)
from generate_series(1, 20) as n;

-- La tabla temporal ya cumplió su función.
drop table if exists demo_seed_rows;

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
