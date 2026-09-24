-- Funciones y disparadores de cada migracion, parte 1 de 3.
-- GENERADO: no lo edites. Pegalo ENTERO en el editor SQL. Solo lee.

with o(mig,tipo,nom,propio) as (values
  ('0023','fn','public.dashboard_summary',true),
  ('0024','fn','public.dashboard_summary',false),
  ('0025','fn','public.dashboard_summary',false),
  ('0026','fn','public.dashboard_summary',false),
  ('0027','fn','public.dashboard_summary',false),
  ('0028','fn','public.dashboard_summary',false),
  ('0030','trg','booking_same_tenant_refs',false),
  ('0030','trg','sales_order_same_tenant_refs',false),
  ('0030','trg','payable_same_tenant_refs',false),
  ('0032','trg','quote_option_touch',true),
  ('0032','trg','quote_option_same_tenant_refs',true),
  ('0032','trg','quote_line_same_tenant_refs',true),
  ('0032','trg','quote_same_tenant_refs',true),
  ('0034','trg','message_template_touch',true),
  ('0034','trg','message_touch',true),
  ('0034','trg','message_same_tenant_refs',true),
  ('0036','trg','product_extra_touch',true),
  ('0036','trg','product_extra_same_tenant_refs',true),
  ('0036','trg','booking_extra_touch',true),
  ('0036','trg','booking_extra_same_tenant_refs',true),
  ('0037','fn','public.next_ncf',true),
  ('0037','trg','invoice_line_touch',true),
  ('0037','trg','invoice_line_same_tenant_refs',true),
  ('0037','trg','ncf_sequence_touch',true),
  ('0037','trg','ncf_sequence_same_tenant_refs',true),
  ('0037','trg','invoice_same_tenant_refs',true),
  ('0038','trg','cash_count_touch',true),
  ('0038','trg','cash_count_same_tenant_refs',true),
  ('0038','trg','ledger_entry_cash_session_same_tenant',true),
  ('0039','trg','payment_schedule_touch',true),
  ('0039','trg','payment_schedule_same_tenant_refs',true),
  ('0039','trg','payment_schedule_same_tenant',true),
  ('0040','trg','booking_cost_touch',true),
  ('0040','trg','booking_cost_same_tenant_refs',true),
  ('0040','trg','settlement_same_tenant_refs',false),
  ('0041','trg','membego_link_touch',true),
  ('0041','trg','membego_user_touch',true),
  ('0041','trg','membego_customer_touch',true),
  ('0041','trg','membego_customer_same_tenant_refs',true),
  ('0043','fn','public.rate_limit_hit',true),
  ('0046','fn','app.custom_access_token_hook',false),
  ('0051','trg','payroll_run_same_tenant_refs',true),
  ('0051','trg','payroll_line_same_tenant_refs',true),
  ('0052','trg','stock_movement_po_line_same_tenant',true),
  ('0052','trg','product_extra_stock_same_tenant',true),
  ('0052','trg','booking_extra_stock_same_tenant',true),
  ('0054','trg','booking_allotment_same_tenant',true),
  ('0057','trg','membego_redemption_touch',true),
  ('0057','trg','membego_redemption_same_tenant_refs',true),
  ('0058','fn','app.seller_attribution_append_only',true),
  ('0058','trg','seller_type_touch',true),
  ('0058','trg','seller_type_same_tenant',true),
  ('0058','trg','seller_link_touch',true),
  ('0058','trg','seller_link_same_tenant',true),
  ('0058','trg','seller_attribution_same_tenant',true),
  ('0058','trg','seller_attribution_append_only',true)
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
