-- Funciones y disparadores de cada migracion, parte 2 de 3.
-- GENERADO: no lo edites. Pegalo ENTERO en el editor SQL. Solo lee.

with o(mig,tipo,nom,propio) as (values
  ('0059','fn','app.commission_net_defaults_to_amount',true),
  ('0059','fn','app.commission_adjustment_append_only',true),
  ('0059','trg','commission_net_default',true),
  ('0059','trg','commission_adjustment_same_tenant',true),
  ('0059','trg','commission_adjustment_append_only',true),
  ('0060','trg','seller_goal_touch',true),
  ('0060','trg','seller_goal_same_tenant',true),
  ('0060','trg','seller_bonus_touch',true),
  ('0060','trg','seller_bonus_same_tenant',true),
  ('0061','fn','app.bundle_item_no_nesting',true),
  ('0061','fn','app.booking_bundle_depth',true),
  ('0061','trg','bundle_item_touch',true),
  ('0061','trg','bundle_item_same_tenant',true),
  ('0061','trg','bundle_item_no_nesting',true),
  ('0061','trg','booking_bundle_same_tenant',true),
  ('0061','trg','booking_bundle_depth',true),
  ('0062','fn','app.search_normalize',true),
  ('0063','fn','app.custom_access_token_hook',false),
  ('0064','fn','app.system_incident_touch',true),
  ('0064','fn','public.health_probe',true),
  ('0064','fn','public.report_incident',true),
  ('0064','trg','system_incident_touch',true),
  ('0066','trg','waitlist_entry_touch',true),
  ('0067','trg','guest_survey_touch',true),
  ('0068','fn','app.custom_access_token_hook',false),
  ('0068','trg','user_active_workspace_touch',true),
  ('0071','fn','app.seller_link_under_quota',true),
  ('0071','trg','seller_link_quota',true),
  ('0072','fn','app.can_read_partner',false),
  ('0073','fn','app.membership_role_matches_org',true),
  ('0073','trg','memberships_role_matches_org',true),
  ('0074','fn','app.membership_role_matches_org',false),
  ('0074','trg','memberships_role_matches_org',false),
  ('0077','fn','app.partner_product_autoriza_nuevo',true),
  ('0077','fn','app.partner_product_socio_nuevo',true),
  ('0077','trg','partner_product_touch',true),
  ('0077','trg','product_autoriza_socios',true),
  ('0077','trg','organizations_autoriza_catalogo',true),
  ('0080','trg','partner_wallet_touch',true),
  ('0080','trg','partner_wallet_same_tenant',true),
  ('0081','fn','app.cash_session_owner_is_frozen',true),
  ('0081','fn','app.cash_movement_matches_session',true),
  ('0081','trg','cash_session_owner_frozen',true),
  ('0081','trg','cash_movement_matches_session',true),
  ('0081','trg','cash_session_same_tenant',true),
  ('0083','fn','public.retain_seller_commission',true),
  ('0084','fn','app.current_supplier_id',true),
  ('0084','fn','app.can_read_supplier',true),
  ('0084','fn','app.custom_access_token_hook',false),
  ('0085','fn','app.fill_supplier_from_resource',true),
  ('0085','trg','departure_resource_supplier',true),
  ('0085','trg','pickup_route_supplier',true)
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
