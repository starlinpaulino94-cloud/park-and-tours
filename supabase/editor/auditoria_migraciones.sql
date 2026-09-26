-- Que migraciones me faltan por ejecutar. GENERADO: no lo edites a mano.
-- Pegalo ENTERO en el editor SQL de Supabase. Solo lee, no escribe nada.

with e(mig,obj,col) as (values
  ('0021','product','sort_order'),
  ('0030','payable','supplier_id'),
  ('0032','quote_option',''),
  ('0032','quote_line','option_id'),
  ('0033','departure','closed_at'),
  ('0034/0035','message_template',''),
  ('0034/0035','message','status'),
  ('0036','product_extra',''),
  ('0036','booking_extra',''),
  ('0036','booking','extras_cost'),
  ('0037','invoice_line',''),
  ('0037','invoice','credit_note_of_id'),
  ('0038','ledger_entry','cash_session_id'),
  ('0039','payment_schedule','due_date'),
  ('0040','settlement','last_payment_at'),
  ('0041','membego_sso_jti',''),
  ('0041','membego_event','received_at'),
  ('0042','organizations','next_billing_at'),
  ('0044','notification','dedupe_key'),
  ('0045','booking','rescheduled_at'),
  ('0046','organization_memberships','branch_id'),
  ('0047','booking','public_request'),
  ('0048','booking','checkin_key'),
  ('0049','expense','ncf'),
  ('0050','sales_order','idempotency_key'),
  ('0051','payroll_line','staff_id'),
  ('0052','product_extra','warehouse_id'),
  ('0053','invoice','void_reason_code'),
  ('0054','booking','allotment_id'),
  ('0055','organizations','brand_color'),
  ('0056','organizations','octo_max_hold_minutes'),
  ('0057','booking','membego_discount'),
  ('0058','seller_type',''),
  ('0058','seller_link','name'),
  ('0059','commission_adjustment','created_by'),
  ('0060','settlement','in_kind_total'),
  ('0061','booking','bundle_booking_id'),
  ('0062','customer','search_text'),
  ('0064','job_run','status'),
  ('0065','pickup_route','auto_key'),
  ('0066','waitlist_entry','booking_id'),
  ('0067','guest_survey','token'),
  ('0068','user_active_workspace','user_id'),
  ('0069','seller','user_id'),
  ('0070','commission','service_date'),
  ('0071','seller_link','hits'),
  ('0072','',''),
  ('0073','organization_relationships','terms_version'),
  ('0074','organization_memberships','partner_role'),
  ('0075','customer','partner_id'),
  ('0076','settlement','disputed_at'),
  ('0077','partner_product','product_id'),
  ('0078','organization_relationships','pricing_model'),
  ('0079','notification','partner_id'),
  ('0080','organization_relationships','payment_mode'),
  ('0081','cash_register','partner_id'),
  ('0082','organization_relationships','collection_mode'),
  ('0083','cash_movement','commission_id'),
  ('0084','supplier','user_id'),
  ('0085','departure_resource','supplier_id'),
  ('0086','departure_resource','service_date'),
  ('0087','supplier_response_token',''),
  ('0087','departure_resource','confirmation_number'),
  ('0088','pickup','supplier_id'),
  ('0089','settlement','supplier_ncf'),
  ('0090','message','attachment_scope'),
  ('0092','customer','blocked_at')
)
select e.mig as migracion,
       case when to_regclass('public.' || e.obj) is null
              then 'FALTA - no existe ' || e.obj
            when e.obj = '' then 'SIN COMPROBACION AUTOMATICA - mirala a mano'
            when e.col <> '' and not exists (
              select 1 from information_schema.columns c
               where c.table_schema = 'public' and c.table_name = e.obj
                 and c.column_name = e.col)
              then 'FALTA - ' || e.obj || ' sin ' || e.col
            else 'OK' end as estado
  from e order by 1, 2;

-- Si el pegado llego entero, la linea de arriba termina en "order by 1, 2;".
--
-- Comprueba, de cada migracion, la ULTIMA columna que su fichero escribe (y
-- las tablas que no declaran columnas). Lo ultimo es lo que importa: estas
-- migraciones fallan porque el editor trunca el pegado, y entonces lo que
-- falta es siempre el final.
--
-- CUIDADO CON EL "OK" DE LAS MIGRACIONES DE VARIOS TROZOS. De 0077 en
-- adelante lo que cada una aporta son funciones y disparadores, y van al final
-- del fichero: esta consulta mira una columna que crea la PRIMERA linea, asi
-- que dice OK aunque solo se ejecutara el primer trozo. Para eso estan
-- auditoria_funciones_N.sql, que miran lo ultimo de verdad.
--
-- "SIN COMPROBACION AUTOMATICA": esa migracion no deja tabla ni columna, solo
-- cambia una funcion o una politica. Se mira con su propio fichero de
-- verificacion en supabase/editor/.
--
-- Y estas migraciones no salen arriba por lo mismo, no hay nada que preguntar
-- por catalogo de tablas: 0022, 0023, 0024, 0025, 0026, 0027, 0028, 0029, 0031, 0043, 0063, 0091, 0093, 0094, 0095
--
-- Para el detalle columna por columna: auditoria_migraciones_N.sql
