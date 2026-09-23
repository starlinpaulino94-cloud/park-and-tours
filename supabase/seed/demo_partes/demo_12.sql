-- SEMBRADOR DEMO - TROZO 12 de 13. Ejecutar EN ORDEN del 01 al 13.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

insert into work_order (id, organization_id, code, title, order_type, priority, status, opened_at, asset_id, maintenance_plan_id) values
  (md5('demo:' || ('wo:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'OT-0001', 'Cambio de aceite catamarán', 'preventive', 'medium', 'done', now() - interval '6 days', md5('demo:' || ('ast:1'))::uuid, md5('demo:' || ('mplan:1'))::uuid),
  (md5('demo:' || ('wo:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'OT-0002', 'Reparar freno buggy #4', 'corrective', 'high', 'in_progress', now() - interval '2 days', md5('demo:' || ('ast:2'))::uuid, null),
  (md5('demo:' || ('wo:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'OT-0003', 'Inspección anual tirolesa', 'inspection_followup', 'urgent', 'open', now() - interval '1 day', md5('demo:' || ('ast:3'))::uuid, md5('demo:' || ('mplan:3'))::uuid),
  (md5('demo:' || ('wo:4'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'OT-0004', 'Mantenimiento generador', 'preventive', 'low', 'assigned', now(), md5('demo:' || ('ast:5'))::uuid, null);
insert into inspection (id, organization_id, signature_name, performed_at, result, score, inspection_template_id, asset_id) values
  (md5('demo:' || ('insp:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Denny Castro', now() - interval '1 day', 'pass', 98, md5('demo:' || ('it:2'))::uuid, md5('demo:' || ('ast:1'))::uuid),
  (md5('demo:' || ('insp:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Rafael Guzmán', now() - interval '2 days', 'pass_with_observations', 82, md5('demo:' || ('it:1'))::uuid, md5('demo:' || ('ast:2'))::uuid),
  (md5('demo:' || ('insp:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'Denny Castro', now() - interval '3 days', 'fail', 55, md5('demo:' || ('it:1'))::uuid, md5('demo:' || ('ast:3'))::uuid);
insert into incident (id, organization_id, code, occurred_at, reported_at, severity, incident_type, status, title, description, attraction_id) values
  (md5('demo:' || ('inc:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'INC-0001', now() - interval '4 days', now() - interval '4 days', 'minor', 'near_miss', 'resolved', 'Casi caída en muelle', 'Pasajero resbaló al abordar, sin lesión.', md5('demo:' || ('attr:1'))::uuid),
  (md5('demo:' || ('inc:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'INC-0002', now() - interval '9 days', now() - interval '9 days', 'moderate', 'illness', 'closed', 'Mareo en catamarán', 'Pasajera con mareo, atendida con botiquín.', null);
insert into incident_action (id, organization_id, incident_id, action, status, priority) values
  (md5('demo:' || ('inca:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('inc:1'))::uuid, 'Colocar cinta antideslizante en el muelle', 'done', 'high'),
  (md5('demo:' || ('inca:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('inc:2'))::uuid, 'Reponer pastillas de mareo en botiquín', 'done', 'medium');
insert into attraction_log (id, organization_id, attraction_id, event_type, from_status, to_status, reason, logged_at)
select md5('demo:' || ('alog:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('attr:' || (1 + (n % 2))))::uuid,
    'status_change', 'open', (array['paused','open','maintenance','open'])[1 + (n % 4)],
    'Registro operativo ' || n, (now() - (n || ' hours')::interval)
from generate_series(1, 8) as n;
insert into document_ack (id, organization_id, document_id, version_acked, acknowledged_at)
select md5('demo:' || ('dack:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), md5('demo:' || ('doc:' || (1 + (n % 3))))::uuid, 1, (now() - (n || ' days')::interval)
from generate_series(1, 6) as n;
insert into approval_request (id, organization_id, code, action_type, status, requested_at, amount, currency, reason) values
  (md5('demo:' || ('appr:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'APR-0001', 'discount_over_limit', 'pending', now() - interval '2 hours', 150, 'usd', 'Descuento de 15% a grupo de boda'),
  (md5('demo:' || ('appr:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'APR-0002', 'refund', 'approved', now() - interval '1 day', 89, 'usd', 'Reembolso por cancelación de cliente'),
  (md5('demo:' || ('appr:3'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'APR-0003', 'purchase_order', 'pending', now() - interval '5 hours', 566, 'usd', 'Compra de combustible');
insert into job_run (id, organization_id, job, trigger, started_at, finished_at, status, summary)
select md5('demo:' || ('job:' || n))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'),
    (array['expire-holds','sweep-surveys','settle-suppliers','send-reminders','close-cash'])[1 + ((n - 1) % 5)],
    'cron', (now() - (n || ' hours')::interval), (now() - (n || ' hours')::interval + interval '3 seconds'),
    case when n % 7 = 0 then 'failed' else 'ok' end, jsonb_build_object('mensaje','Procesado correctamente','filas', n)
from generate_series(1, 10) as n;
insert into system_incident (id, organization_id, fingerprint, source, message, level, occurrences, first_seen_at, last_seen_at, status) values
  (md5('demo:' || ('si:1'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'octo-timeout-001', 'octo-connector', 'Timeout al confirmar reserva OTA', 'warning', 3, now() - interval '2 days', now() - interval '5 hours', 'acknowledged'),
  (md5('demo:' || ('si:2'))::uuid, (select id from organizations where slug = 'havelgo-demo-presentaciones'), 'stripe-webhook-002', 'stripe', 'Webhook recibido sin firma válida', 'error', 1, now() - interval '1 day', now() - interval '1 day', 'open');
