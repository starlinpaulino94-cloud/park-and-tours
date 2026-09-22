-- SEMBRADOR DEMO - TROZO 01 de 08. Ejecutar EN ORDEN, del 01 al 08.
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
