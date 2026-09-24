-- ¿Qué migraciones me faltan por ejecutar?
--
-- GENERADO por `scripts/build-auditoria-migraciones.mjs`. No lo edites a mano.
--
-- UN SOLO PEGADO. Pégalo en el editor SQL de Supabase y ejecútalo: cada fila es
-- una migración, con «✅ aplicada» o «❌ FALTA». Solo LEE.
--
-- QUÉ COMPRUEBA, Y POR QUÉ ESO BASTA
--   De cada migración: las tablas y funciones que crea, y la ÚLTIMA columna que
--   su fichero escribe. Lo último es lo que importa, porque la forma en que
--   estas migraciones fallan de verdad es que el editor trunque el pegado — y
--   entonces lo que falta es siempre el final.
--
-- QUÉ NO COMPRUEBA
--   Columna por columna, ni los valores nuevos de un enum. Para eso están las
--   partes `auditoria_migraciones_N.sql`, que lo miran todo y dicen
--   exactamente qué falta. Míralas si una sale en rojo, o antes de desplegar.

with esperado(migracion, tipo, objeto, detalle) as (values
  ('0021', 'columnas', 'product', 'sort_order'),
  ('0030', 'columnas', 'payable', 'supplier_id'),
  ('0032', 'tabla', 'quote_option', ''),
  ('0032', 'columnas', 'quote_line', 'option_id'),
  ('0033', 'columnas', 'departure', 'closed_at'),
  ('0034/0035', 'tabla', 'message_template', ''),
  ('0034/0035', 'tabla', 'message', ''),
  ('0034/0035', 'columnas', 'message', 'status'),
  ('0036', 'tabla', 'product_extra', ''),
  ('0036', 'tabla', 'booking_extra', ''),
  ('0036', 'columnas', 'booking', 'extras_cost'),
  ('0037', 'tabla', 'invoice_line', ''),
  ('0037', 'tabla', 'ncf_sequence', ''),
  ('0037', 'funcion', 'next_ncf', ''),
  ('0037', 'columnas', 'invoice', 'credit_note_of_id'),
  ('0038', 'tabla', 'cash_count', ''),
  ('0038', 'columnas', 'ledger_entry', 'cash_session_id'),
  ('0039', 'tabla', 'payment_schedule', ''),
  ('0039', 'columnas', 'payment_schedule', 'due_date'),
  ('0040', 'tabla', 'booking_cost', ''),
  ('0040', 'columnas', 'settlement', 'last_payment_at'),
  ('0041', 'tabla', 'membego_link', ''),
  ('0041', 'tabla', 'membego_user', ''),
  ('0041', 'tabla', 'membego_customer', ''),
  ('0041', 'tabla', 'membego_event', ''),
  ('0041', 'tabla', 'membego_sso_jti', ''),
  ('0041', 'columnas', 'membego_event', 'received_at'),
  ('0042', 'columnas', 'organizations', 'next_billing_at'),
  ('0044', 'columnas', 'notification', 'dedupe_key'),
  ('0045', 'columnas', 'booking', 'rescheduled_at'),
  ('0046', 'columnas', 'organization_memberships', 'branch_id'),
  ('0047', 'columnas', 'booking', 'public_request'),
  ('0048', 'columnas', 'booking', 'checkin_key'),
  ('0049', 'columnas', 'expense', 'ncf'),
  ('0050', 'tabla', 'api_key', ''),
  ('0050', 'columnas', 'sales_order', 'idempotency_key'),
  ('0051', 'tabla', 'payroll_run', ''),
  ('0051', 'tabla', 'payroll_line', ''),
  ('0051', 'columnas', 'payroll_line', 'staff_id'),
  ('0052', 'columnas', 'product_extra', 'warehouse_id'),
  ('0053', 'tabla', 'accounting_period', ''),
  ('0053', 'columnas', 'invoice', 'void_reason_code'),
  ('0054', 'columnas', 'booking', 'allotment_id'),
  ('0055', 'columnas', 'organizations', 'brand_color'),
  ('0056', 'columnas', 'organizations', 'octo_max_hold_minutes'),
  ('0057', 'tabla', 'membego_redemption', ''),
  ('0057', 'columnas', 'booking', 'membego_discount'),
  ('0058', 'tabla', 'seller_type', ''),
  ('0058', 'tabla', 'seller_link', ''),
  ('0058', 'tabla', 'seller_attribution', ''),
  ('0058', 'columnas', 'seller_link', 'name'),
  ('0059', 'tabla', 'commission_adjustment', ''),
  ('0059', 'columnas', 'commission_adjustment', 'created_by'),
  ('0060', 'tabla', 'seller_goal', ''),
  ('0060', 'tabla', 'seller_bonus', ''),
  ('0060', 'columnas', 'settlement', 'in_kind_total'),
  ('0061', 'tabla', 'product_bundle_item', ''),
  ('0061', 'columnas', 'booking', 'bundle_booking_id'),
  ('0062', 'columnas', 'customer', 'search_text'),
  ('0064', 'tabla', 'job_run', ''),
  ('0064', 'tabla', 'system_incident', ''),
  ('0064', 'columnas', 'job_run', 'status'),
  ('0065', 'columnas', 'pickup_route', 'auto_key'),
  ('0066', 'tabla', 'waitlist_entry', ''),
  ('0066', 'columnas', 'waitlist_entry', 'booking_id'),
  ('0067', 'tabla', 'guest_survey', ''),
  ('0067', 'columnas', 'guest_survey', 'token'),
  ('0068', 'tabla', 'user_active_workspace', ''),
  ('0068', 'columnas', 'user_active_workspace', 'user_id'),
  ('0069', 'tabla', 'seller', ''),
  ('0069', 'columnas', 'seller', 'user_id'),
  ('0070', 'tabla', 'commission', ''),
  ('0070', 'columnas', 'commission', 'service_date'),
  ('0071', 'tabla', 'seller_link', ''),
  ('0071', 'columnas', 'seller_link', 'hits'),
  ('0073', 'columnas', 'organization_relationships', 'terms_version'),
  ('0074', 'columnas', 'organization_memberships', 'partner_role'),
  ('0075', 'columnas', 'customer', 'partner_id'),
  ('0076', 'columnas', 'settlement', 'disputed_at'),
  ('0077', 'tabla', 'partner_product', ''),
  ('0077', 'columnas', 'partner_product', 'product_id'),
  ('0078', 'columnas', 'organization_relationships', 'pricing_model'),
  ('0079', 'columnas', 'notification', 'partner_id'),
  ('0080', 'tabla', 'partner_wallet_movement', ''),
  ('0080', 'columnas', 'organization_relationships', 'payment_mode'),
  ('0081', 'columnas', 'cash_register', 'partner_id'),
  ('0082', 'columnas', 'organization_relationships', 'collection_mode'),
  ('0083', 'columnas', 'cash_movement', 'commission_id'),
  ('0084', 'columnas', 'supplier', 'user_id'),
  ('0085', 'columnas', 'departure_resource', 'supplier_id'),
  ('0086', 'columnas', 'departure_resource', 'service_date'),
  ('0087', 'tabla', 'supplier_response_token', ''),
  ('0087', 'funcion', 'respond_to_supplier_service', ''),
  ('0087', 'columnas', 'departure_resource', 'confirmation_number')
),
objetivo as (
  select e.migracion, e.tipo, e.objeto,
         nullif(trim(both from col), '') as columna
    from esperado e
    left join lateral unnest(
           case when e.tipo = 'columnas' then string_to_array(e.detalle, ',')
                else array[null]::text[] end
         ) as col on true
),
falta as (
  select o.migracion,
         case when o.tipo = 'funcion' then 'función ' || o.objeto || '()'
              else o.objeto || coalesce('.' || o.columna, '') end as que
    from objetivo o
   where case when o.tipo = 'funcion' then not exists (
             select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = o.objeto)
         else not exists (
             select 1 from information_schema.tables t
              where t.table_schema = 'public' and t.table_name = o.objeto)
             or (o.columna is not null and not exists (
             select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = o.objeto
                and c.column_name = o.columna))
         end
),
total as (select migracion, count(*) as objetos from objetivo group by migracion),
ausentes as (
  select migracion, count(*) as n, string_agg(que, ', ' order by que) as detalle
    from falta group by migracion
)
select t.migracion,
       case when a.n is null then '✅ aplicada'
            when a.n >= t.objetos then '❌ FALTA ENTERA'
            else '⚠️ A MEDIAS — vuelve a ejecutarla' end as estado,
       coalesce(a.detalle, '') as lo_que_no_esta
  from total t
  left join ausentes a on a.migracion = t.migracion
 order by t.migracion;
