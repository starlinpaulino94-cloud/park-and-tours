-- QUE MIGRACIONES ME FALTAN POR EJECUTAR, parte 1 de 2.
-- GENERADO: no lo edites. Pegalo ENTERO en el editor SQL. Solo lee.

with u(mig,tipo,nom,huella) as (values
  ('0021','idx','modality_product_sort_order_idx',''),
  ('0022','idx','approval_request_pending_idx',''),
  ('0023','fn','public.dashboard_summary',''),
  ('0024','?','',''),
  ('0025','idx','payment_dashboard_order_idx',''),
  ('0026','?','',''),
  ('0027','?','',''),
  ('0028','src','public.dashboard_summary','''otros'', ''otros'''),
  ('0029','?','',''),
  ('0030','col','payable.supplier_id',''),
  ('0031','idx','org_rel_pair_idx',''),
  ('0032','idx','quote_line_order_idx',''),
  ('0033','idx','departure_closed_idx',''),
  ('0034','idx','message_customer_idx',''),
  ('0035','col','message.attachment_kind',''),
  ('0036','col','booking.extras_amount',''),
  ('0037','idx','invoice_ncf_idx',''),
  ('0038','idx','ledger_entry_cash_session_idx',''),
  ('0039','col','organizations.hold_hours',''),
  ('0040','col','settlement.last_payment_at',''),
  ('0041','idx','membego_sso_jti_expires_idx',''),
  ('0042','idx','booking_created_idx',''),
  ('0043','fn','public.rate_limit_hit',''),
  ('0044','idx','notification_audience_idx',''),
  ('0045','idx','booking_rescheduled_idx',''),
  ('0046','idx','memberships_branch_idx',''),
  ('0047','col','booking.public_request',''),
  ('0048','idx','booking_checkin_key_idx',''),
  ('0049','idx','invoice_issued_idx',''),
  ('0050','idx','sales_order_idempotency_idx',''),
  ('0051','idx','attendance_payroll_idx',''),
  ('0052','col','purchase_order.receipt_count',''),
  ('0053','col','invoice.void_reason_code',''),
  ('0054','idx','allotment_departure_idx',''),
  ('0055','col','organizations.whatsapp',''),
  ('0056','col','organizations.octo_max_hold_minutes',''),
  ('0057','col','booking.membego_benefit',''),
  ('0058','col','organizations.attribution_policy',''),
  ('0059','fn','app.commission_adjustment_append_only',''),
  ('0060','col','settlement.bonus_total',''),
  ('0061','fn','app.booking_bundle_depth',''),
  ('0062','idx','supplier_search_trgm',''),
  ('0063','?','',''),
  ('0064','fn','public.report_incident',''),
  ('0065','col','departure_resource.conflict_reason',''),
  ('0066','idx','waitlist_entry_booking_idx',''),
  ('0067','col','organizations.review_url',''),
  ('0068','tbl','user_active_workspace',''),
  ('0069','idx','seller_user_unique_idx',''),
  ('0070','idx','commission_seller_service_idx',''),
  ('0071','idx','seller_link_activos_idx',''),
  ('0072','?','',''),
  ('0073','fn','app.membership_role_matches_org','')
), v as (
  select u.mig,
         case u.tipo
           when '?' then 'NO SE PUEDE COMPROBAR ASI'
           when 'src' then case when position(u.huella in coalesce((
                  select pg_get_functiondef(p.oid) from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = split_part(u.nom, '.', 1)
                     and p.proname = split_part(u.nom, '.', 2)), '')) > 0
                then 'OK' else 'FALTA' end
           when 'fn' then case when exists (
                  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = split_part(u.nom, '.', 1)
                     and p.proname = split_part(u.nom, '.', 2))
                then 'OK' else 'FALTA' end
           when 'trg' then case when exists (
                  select 1 from pg_trigger g where g.tgname = u.nom and not g.tgisinternal)
                then 'OK' else 'FALTA' end
           when 'idx' then case when exists (
                  select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = u.nom)
                then 'OK' else 'FALTA' end
           when 'tbl' then case when to_regclass('public.' || u.nom) is not null
                then 'OK' else 'FALTA' end
           else case when exists (
                  select 1 from information_schema.columns c
                   where c.table_schema = 'public'
                     and c.table_name = split_part(u.nom, '.', 1)
                     and c.column_name = split_part(u.nom, '.', 2))
                then 'OK' else 'FALTA' end
         end as estado,
         case u.tipo when 'fn' then 'funcion ' when 'trg' then 'disparador '
                     when 'idx' then 'indice ' when 'tbl' then 'tabla '
                     when 'src' then 'en el cuerpo de '
                     when '?' then '' else 'columna ' end || u.nom
         || case when u.tipo = 'src' then ': ' || u.huella else '' end as ultimo
    from u
)
select v.mig as migracion, v.estado,
       case when v.estado = 'NO SE PUEDE COMPROBAR ASI'
            then 'solo reemplaza cosas que ya existian: mirala con su fichero de verificacion'
            else 'lo ultimo que escribe: ' || v.ultimo end as detalle
  from v
 order by case v.estado when 'FALTA' then 0 when 'NO SE PUEDE COMPROBAR ASI' then 1 else 2 end,
          v.mig;

-- Si el pegado llego entero, la consulta termina en "v.mig;".
--
-- COMO SE LEE. Las que FALTAN salen arriba. De cada migracion se comprueba lo
-- ULTIMO que su fichero escribe: si eso esta, la migracion llego al final.
-- Es lo que el resumen de columnas no podia ver, porque miraba una columna que
-- crea la PRIMERA linea y daba OK a una migracion ejecutada a medias.
--
-- "NO SE PUEDE COMPROBAR ASI" no quiere decir que este. Quiere decir que esa
-- migracion solo REEMPLAZA cosas que ya existian, asi que verlas en el
-- catalogo no prueba nada. Cada una tiene su fichero NNNN_parte_N_verificacion
-- en supabase/editor/: ese si lo dice.
--
-- Todas aguantan ejecutarse dos veces, asi que ante la duda, vuelve a correrla.
