-- ============================================================================
-- SEMBRADOR DE DEMOSTRACIÓN — PARTE 1 DE 3.  Cimientos, catálogo, personas y operación.
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

