-- Auditoría de migraciones · parte 3 de 6
--
-- GENERADO por `scripts/build-auditoria-migraciones.mjs`. No lo edites a mano:
-- se regenera y perderías el cambio, y hay una prueba que lo comprueba.
--
-- QUÉ RESPONDE
--   ¿Qué migraciones me faltan por ejecutar?
--
-- Pega este trozo en el editor SQL de Supabase y ejecútalo. Cada fila es una
-- migración: «✅ aplicada» o «❌ FALTA», y en la tercera columna exactamente lo
-- que no encontró. Solo LEE: no escribe, no borra, no consume nada.
--
-- Un «PARCIAL» quiere decir que la migración se aplicó a medias — casi siempre
-- porque el editor truncó el pegado. Se vuelve a ejecutar entera: todas están
-- escritas para poder correrse dos veces.
--
-- Ejecuta las 6 partes; cada una cubre un tramo distinto.

with esperado(migracion, tipo, objeto, detalle) as (values
  ('0042 — el plan como contrato aplicable', 'columnas', 'organizations', 'trial_ends_at,next_billing_at,storage_used_mb'),
  ('0044 — avisos internos', 'columnas', 'notification', 'audience_role,event_key,entity_type,entity_id,dedupe_key'),
  ('0045 — reprogramar sin cancelar', 'columnas', 'booking', 'previous_departure_id,rescheduled_at,reschedule_reason,reschedule_count'),
  ('0046 — ámbito de sucursal', 'columnas', 'organization_memberships', 'branch_id'),
  ('0047 — motor de reservas público', 'columnas', 'organizations', 'public_booking_enabled,public_intro,public_terms'),
  ('0047 — motor de reservas público', 'columnas', 'product', 'published,public_price_from'),
  ('0047 — motor de reservas público', 'columnas', 'booking', 'public_request'),
  ('0048 — embarque sin conexión', 'columnas', 'booking', 'checkin_key'),
  ('0049 — declaración 606', 'columnas', 'expense', 'ncf,ncf_type,ncf_modified,supplier_rnc,itbis_amount,itbis_withheld,isr_withheld,selective_tax,other_taxes,legal_tip,goods_service_type,paid_date'),
  ('0050 — llaves de API', 'tabla', 'api_key', ''),
  ('0050 — llaves de API', 'columnas', 'api_key', 'prefix,secret_hash,scope,partner_id,revoked_at,last_used_at'),
  ('0050 — llaves de API', 'columnas', 'sales_order', 'idempotency_key'),
  ('0051 — RR. HH.', 'tabla', 'payroll_run', ''),
  ('0051 — RR. HH.', 'tabla', 'payroll_line', ''),
  ('0051 — RR. HH.', 'columnas', 'staff', 'payroll_code,salary_type,base_salary,hourly_rate,social_security_id,bank_account,bank_name,applies_social_security,termination_date'),
  ('0051 — RR. HH.', 'columnas', 'certification', 'reminder_sent_at,checked_at'),
  ('0051 — RR. HH.', 'columnas', 'shift', 'published_at,published_by'),
  ('0051 — RR. HH.', 'columnas', 'attendance', 'break_min,regular_hours,approved_at,payroll_run_id'),
  ('0051 — RR. HH.', 'columnas', 'payroll_run', 'period_start,period_end,period_type,status,sfs_employee_pct,afp_employee_pct,sfs_employer_pct,afp_employer_pct,risk_employer_pct,employer_cost'),
  ('0051 — RR. HH.', 'columnas', 'payroll_line', 'staff_id,days_worked,regular_hours,overtime_hours,extra_overtime_hours,gross_amount,sfs_employee,afp_employee,isr_amount,net_amount'),
  ('0052 — recepción de compra y existencias apartadas', 'columnas', 'stock_movement', 'purchase_order_line_id,booking_extra_id'),
  ('0052 — recepción de compra y existencias apartadas', 'columnas', 'product_extra', 'inventory_item_id,warehouse_id,consumes_stock,stock_per_unit'),
  ('0052 — recepción de compra y existencias apartadas', 'columnas', 'booking_extra', 'inventory_item_id,warehouse_id,stock_quantity,stock_state'),
  ('0052 — recepción de compra y existencias apartadas', 'columnas', 'purchase_order', 'receipt_count,last_received_by'),
  ('0053 — cierre contable', 'tabla', 'accounting_period', ''),
  ('0053 — cierre contable', 'columnas', 'accounting_period', 'period,status,closed_at,closed_by,locked_at,reopened_at'),
  ('0053 — cierre contable', 'columnas', 'ledger_entry', 'is_closing,closes_year'),
  ('0053 — cierre contable', 'columnas', 'invoice', 'void_reason_code'),
  ('0054 — motor de cupos', 'columnas', 'booking', 'allotment_id,allotment_seats'),
  ('0054 — motor de cupos', 'columnas', 'allotment', 'released_at,release_runs,closed_at,closed_by'),
  ('0055 — la marca en los documentos', 'columnas', 'organizations', 'whatsapp,address,city,group_name,notes,logo_url,brand_color,document_footer,voucher_terms,invoice_terms'),
  ('0056 — conector OTA (OCTO)', 'columnas', 'booking', 'octo_uuid,octo_option_id,octo_status,octo_reseller_reference,octo_unit_items,octo_contact,octo_test_mode,octo_confirmed_at,octo_api_key_id'),
  ('0056 — conector OTA (OCTO)', 'columnas', 'organizations', 'octo_max_hold_minutes')
),
objetivo as (
  select e.migracion, e.tipo, e.objeto, e.detalle,
         nullif(trim(both from col), '') as columna
    from esperado e
    left join lateral unnest(
           case when e.tipo = 'columnas' then string_to_array(e.detalle, ',')
                else array[null]::text[] end
         ) as col on true
),
falta as (
  select o.migracion,
         case o.tipo
           when 'funcion' then 'función ' || o.objeto || '()'
           when 'valor'   then o.objeto || '.' || o.detalle
           else o.objeto || coalesce('.' || o.columna, '')
         end as que
    from objetivo o
   where case o.tipo
           when 'funcion' then not exists (
             select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = o.objeto)
           -- Un valor admitido: o es una etiqueta de un tipo enum de verdad, o
           -- lo admite una restricción `check`. El esquema usa las dos formas,
           -- así que se miran las dos. Darlo por bueno con solo comprobar que
           -- la tabla existe sería una comprobación que parece una garantía y
           -- no lo es.
           when 'valor' then
             not exists (
               select 1
                 from information_schema.columns c
                 join pg_type ty on ty.typname = c.udt_name
                 join pg_enum en on en.enumtypid = ty.oid
                where c.table_schema = 'public' and c.table_name = o.objeto
                  and c.column_name = split_part(o.detalle, '=', 1)
                  and en.enumlabel = split_part(o.detalle, '=', 2))
             and not exists (
               select 1 from pg_constraint k
                where k.conrelid = to_regclass('public.' || o.objeto)
                  and k.contype = 'c'
                  and pg_get_constraintdef(k) like '%' || split_part(o.detalle, '=', 1) || '%'
                  and pg_get_constraintdef(k) like '%''' || split_part(o.detalle, '=', 2) || '''%')
           else not exists (
             select 1 from information_schema.tables t
              where t.table_schema = 'public' and t.table_name = o.objeto)
             or (o.columna is not null and not exists (
             select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = o.objeto
                and c.column_name = o.columna))
         end
),
total as (
  select migracion, count(*) as objetos
    from objetivo group by migracion
),
ausentes as (
  select migracion, count(*) as n,
         string_agg(que, ', ' order by que) as detalle
    from falta group by migracion
)
select t.migracion,
       case when a.n is null then '✅ aplicada'
            when a.n >= t.objetos then '❌ FALTA ENTERA'
            else '⚠️ PARCIAL — vuelve a ejecutarla' end as estado,
       coalesce(a.detalle, '') as lo_que_no_esta
  from total t
  left join ausentes a on a.migracion = t.migracion
 order by t.migracion;
