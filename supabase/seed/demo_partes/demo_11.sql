-- SEMBRADOR DEMO - TROZO 11 de 13. Ejecutar EN ORDEN del 01 al 13.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

insert into cash_count (id, organization_id, cash_session_id, currency, kind, counted_total, expected_total, difference, counted_at) values
  (md5('demo:' || ('cc:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('csess:1'))::uuid, 'usd', 'open', 200, 200, 0, now() - interval '2 days'),
  (md5('demo:' || ('cc:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('csess:1'))::uuid, 'usd', 'close', 1850, 1850, 0, now() - interval '2 days' + interval '9 hours'),
  (md5('demo:' || ('cc:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('csess:2'))::uuid, 'usd', 'open', 200, 200, 0, date_trunc('day', now()) + interval '7 hours');
insert into settlement (id, organization_id, code, beneficiary_type, supplier_id, seller_id, period_from, period_to,
    base_total, commission_total, services_total, paid_total, pending_total, currency, status, beneficiary_name) values
  (md5('demo:' || ('setl:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'LIQ-0001', 'supplier', md5('demo:' || ('sup:1'))::uuid, null,
    (current_date - 14)::date, current_date, 3200, 0, 3200, 0, 3200, 'usd', 'pending', 'Transporte del Este SRL'),
  (md5('demo:' || ('setl:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'LIQ-0002', 'seller', null, md5('demo:' || ('seller:1'))::uuid,
    (current_date - 30)::date, current_date, 25000, 2000, 0, 2000, 0, 'usd', 'paid', 'Génesis Mora');
insert into payable (id, organization_id, settlement_id, supplier_id, concept, amount, balance, currency, status, issue_date, due_date) values
  (md5('demo:' || ('pay1:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('setl:1'))::uuid, md5('demo:' || ('sup:1'))::uuid, 'Liquidación semanal de transporte', 3200, 3200, 'usd', 'pending', current_date, (current_date + 7)::date);
insert into payroll_run (id, organization_id, code, period_start, period_end, period_type, status, currency,
    gross_amount, deductions_amount, net_amount, staff_count) values
  (md5('demo:' || ('pr:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'NOM-' || to_char(current_date, 'YYYY-MM'),
    date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date,
    'monthly', 'approved', 'usd', 190000, 21000, 169000, 6);
insert into payroll_line (id, organization_id, payroll_run_id, staff_id, staff_name, gross_amount, deductions_amount, net_amount, currency)
select md5('demo:' || ('pl:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('pr:1'))::uuid, md5('demo:' || ('staff:' || n))::uuid,
    (array['Carlos Medina','Yohan Peña','Rafael Guzmán','Miguel Santana','Laura Objío','Denny Castro'])[n],
    (array[32000,34000,28000,28000,28000,40000])[n], round((array[32000,34000,28000,28000,28000,40000])[n] * 0.11), 
    round((array[32000,34000,28000,28000,28000,40000])[n] * 0.89), 'usd'
from generate_series(1, 6) as n;
insert into asset (id, organization_id, name, code, asset_type, operational_status, criticality, status, zone_id, vehicle_id) values
  (md5('demo:' || ('ast:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Catamarán Sirena', 'AST-CAT', 'boat', 'in_service', 'high', 'active', md5('demo:' || ('zone:1'))::uuid, md5('demo:' || ('veh:3'))::uuid),
  (md5('demo:' || ('ast:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Flota de buggies', 'AST-BUG', 'buggy', 'in_service', 'medium', 'active', md5('demo:' || ('zone:1'))::uuid, md5('demo:' || ('veh:5'))::uuid),
  (md5('demo:' || ('ast:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Tirolesa Anamuya', 'AST-ZIP', 'ride', 'maintenance', 'high', 'active', md5('demo:' || ('zone:1'))::uuid, null),
  (md5('demo:' || ('ast:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Bus Mercedes 45', 'AST-BUS', 'vehicle', 'in_service', 'medium', 'active', null, md5('demo:' || ('veh:1'))::uuid),
  (md5('demo:' || ('ast:5'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Generador eléctrico', 'AST-GEN', 'facility', 'in_service', 'low', 'active', null, null);
insert into maintenance_plan (id, organization_id, name, trigger_type, interval_days, status, asset_id, next_due_at) values
  (md5('demo:' || ('mplan:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Servicio de motor catamarán', 'calendar', 30, 'active', md5('demo:' || ('ast:1'))::uuid, now() + interval '12 days'),
  (md5('demo:' || ('mplan:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Revisión de buggies', 'meter_hours', 15, 'active', md5('demo:' || ('ast:2'))::uuid, now() + interval '5 days'),
  (md5('demo:' || ('mplan:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Inspección de tirolesa', 'calendar', 7, 'active', md5('demo:' || ('ast:3'))::uuid, now() + interval '2 days');
insert into attendance (id, organization_id, attendance_date, clock_in, clock_out, status, method, staff_id)
select md5('demo:' || ('att:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), (current_date - (n % 7))::date,
    (date_trunc('day', now()) - ((n % 7) || ' days')::interval + interval '7 hours'),
    (date_trunc('day', now()) - ((n % 7) || ' days')::interval + interval '16 hours'),
    (array['present','present','late','present','present','excused'])[1 + (n % 6)], 'qr',
    md5('demo:' || ('staff:' || (1 + ((n - 1) % 6))))::uuid
from generate_series(1, 18) as n;
insert into certification (id, organization_id, name, cert_type, issuer, issued_at, expires_at, status, staff_id) values
  (md5('demo:' || ('cert:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Primeros auxilios', 'first_aid', 'Cruz Roja', current_date - 200, current_date + 165, 'valid', md5('demo:' || ('staff:1'))::uuid),
  (md5('demo:' || ('cert:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Salvavidas', 'lifeguard', 'Marina de Guerra', current_date - 100, current_date + 265, 'valid', md5('demo:' || ('staff:2'))::uuid),
  (md5('demo:' || ('cert:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Licencia de conducir categoría 3', 'driving_license', 'INTRANT', current_date - 300, current_date + 30, 'expiring', md5('demo:' || ('staff:3'))::uuid),
  (md5('demo:' || ('cert:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Manejo de montacargas', 'forklift', 'INFOTEP', current_date - 400, current_date - 5, 'expired', md5('demo:' || ('staff:4'))::uuid);
