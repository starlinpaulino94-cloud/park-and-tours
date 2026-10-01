-- Funciones y disparadores de cada migracion, parte 3 de 4.
-- GENERADO: no lo edites. Pegalo ENTERO en el editor SQL. Solo lee.

with o(mig,tipo,nom,propio) as (values
  ('0086','fn','app.fill_service_date_from_departure',true),
  ('0086','fn','app.sync_service_date_to_children',true),
  ('0086','trg','departure_resource_service_date',true),
  ('0086','trg','pickup_route_service_date',true),
  ('0086','trg','departure_service_date_sync',true),
  ('0087','fn','app.set_acceptance_on_assign',true),
  ('0087','fn','app.revoke_supplier_tokens',true),
  ('0087','fn','public.respond_to_supplier_service',true),
  ('0087','trg','supplier_response_token_touch',true),
  ('0087','trg','departure_resource_supplier_acceptance',true),
  ('0087','trg','pickup_route_supplier_acceptance',true),
  ('0087','trg','departure_resource_token_revoke',true),
  ('0087','trg','pickup_route_token_revoke',true),
  ('0087','trg','departure_resource_token_cleanup',true),
  ('0087','trg','pickup_route_token_cleanup',true),
  ('0088','fn','app.fill_pickup_from_route',true),
  ('0088','fn','app.sync_pickup_from_route',true),
  ('0088','trg','pickup_supplier',true),
  ('0088','trg','pickup_route_sync_pickups',true),
  ('0091','fn','public.spend_partner_wallet',true),
  ('0093','fn','app.custom_access_token_hook',false),
  ('0094','fn','public.departure_pax_totals',true),
  ('0095','fn','app.enforce_same_tenant_refs',false),
  ('0095','trg','ledger_entry_same_tenant_refs',true),
  ('0095','trg','cash_session_same_tenant_refs',true),
  ('0095','trg','cash_register_same_tenant_refs',true),
  ('0095','trg','cash_movement_same_tenant_refs',false),
  ('0095','trg','gift_card_same_tenant_refs',true),
  ('0095','trg','gift_card_movement_same_tenant_refs',true),
  ('0095','trg','access_ticket_same_tenant_refs',true),
  ('0095','trg','waiver_same_tenant_refs',true),
  ('0095','trg','commission_rule_same_tenant_refs',true),
  ('0096','fn','public.dashboard_summary',false),
  ('0097','fn','app.enforce_same_tenant_refs',false),
  ('0099','fn','public.reserve_departure_capacity',false),
  ('0099','fn','public.release_departure_capacity',false),
  ('0099','fn','public.departure_pax_totals',false),
  ('0100','fn','public.claim_allotment_seats',true),
  ('0100','fn','public.release_allotment_seats',true),
  ('0101','fn','public.claim_cash_session_status',true),
  ('0102','trg','approval_request_same_tenant_refs',true),
  ('0102','trg','asset_same_tenant_refs',true),
  ('0102','trg','crm_activity_same_tenant_refs',true),
  ('0102','trg','customer_same_tenant_refs',true),
  ('0102','trg','departure_resource_same_tenant_refs',true),
  ('0102','trg','expense_same_tenant_refs',true),
  ('0102','trg','guest_case_same_tenant_refs',true),
  ('0102','trg','guest_survey_same_tenant_refs',true),
  ('0102','trg','incident_same_tenant_refs',true),
  ('0102','trg','inventory_item_same_tenant_refs',true),
  ('0102','trg','lead_same_tenant_refs',true),
  ('0102','trg','membership_same_tenant_refs',true),
  ('0102','trg','pickup_route_same_tenant_refs',true),
  ('0102','trg','pickup_same_tenant_refs',false),
  ('0102','trg','price_rule_same_tenant_refs',true),
  ('0102','trg','product_cost_same_tenant_refs',true),
  ('0102','trg','purchase_order_same_tenant_refs',true),
  ('0102','trg','seller_same_tenant_refs',true),
  ('0102','trg','staff_same_tenant_refs',true),
  ('0102','trg','stock_movement_same_tenant_refs',true),
  ('0102','trg','supplier_response_token_same_tenant_refs',true),
  ('0102','trg','task_same_tenant_refs',true),
  ('0102','trg','vehicle_same_tenant_refs',true),
  ('0102','trg','waitlist_entry_same_tenant_refs',true),
  ('0102','trg','work_order_same_tenant_refs',true)
)
select o.mig as migracion,
       case when o.tipo = 'fn' then 'funcion ' else 'disparador ' end || o.nom as objeto,
       case when o.tipo = 'fn' then
              case when exists (select 1 from pg_proc p
                                  join pg_namespace n on n.oid = p.pronamespace
                                 where n.nspname = split_part(o.nom, '.', 1)
                                   and p.proname = split_part(o.nom, '.', 2))
                   then case when o.propio then 'OK' else 'existe - esta migracion solo lo reemplaza' end
                   else 'FALTA' end
            else
              case when exists (select 1 from pg_trigger g
                                 where g.tgname = o.nom and not g.tgisinternal)
                   then case when o.propio then 'OK' else 'existe - esta migracion solo lo rehace' end
                   else 'FALTA' end
       end as estado
  from o order by 1, 2;

-- "FALTA" = ese trozo de la migracion no se ejecuto. Vuelve a ejecutarla
-- entera: todas aguantan correrse dos veces.
--
-- "solo lo reemplaza/rehace" = el objeto ya existia de una migracion anterior,
-- asi que verlo no prueba que esta se ejecutara. Se mira con el fichero de
-- verificacion de esa migracion en supabase/editor/.
--
-- Si el pegado llego entero, la consulta termina en "order by 1, 2;".
