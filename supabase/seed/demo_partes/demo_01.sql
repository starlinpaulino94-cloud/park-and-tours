-- SEMBRADOR DEMO - TROZO 01 de 13. Ejecutar EN ORDEN del 01 al 13.
-- Pegar entero (Ctrl+A, Run). Requiere la migracion 0067 aplicada.

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
delete from system_incident where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from job_run where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from approval_request where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from document_ack where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from attraction_log where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from incident_action where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from incident where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from inspection where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from work_order where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from payroll_line where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from payroll_run where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from payable where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from settlement where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from cash_count where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from gift_card_movement where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from payment_schedule where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from waitlist_entry where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from waiver where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from access_ticket where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from booking_extra where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from quote_line where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from quote_option where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from commission_rule where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from seller_bonus where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from seller_goal where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from seller_link where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from certification where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from attendance where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from maintenance_plan where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from asset where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from membership where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from membership_plan where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from inspection_template where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from waiver_template where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from product_bundle_item where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from product_cost where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from ledger_entry where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from accounting_period where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from ledger_account where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from currency_rate where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from audit_log where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from system_incident where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from job_run where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from integration where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from notification where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from message where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from message_template where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from approval_request where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from task where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from document_ack where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from document where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from attraction_log where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from guest_survey where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from guest_case where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from incident_action where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from incident where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from inspection where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
delete from work_order where organization_id = (select id from organizations where slug = 'havelgo-demo-presentaciones');
