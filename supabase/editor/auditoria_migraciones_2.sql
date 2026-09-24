-- Auditoría de migraciones · parte 2 de 6
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
  ('0037 — facturación fiscal', 'tabla', 'invoice_line', ''),
  ('0037 — facturación fiscal', 'tabla', 'ncf_sequence', ''),
  ('0037 — facturación fiscal', 'columnas', 'invoice', 'credit_note_of_id,ncf_expires_at,balance,issued_by'),
  ('0037 — facturación fiscal', 'columnas', 'ncf_sequence', 'ncf_type,next_number,max_number,expires_at,status'),
  ('0037 — facturación fiscal', 'funcion', 'next_ncf', ''),
  ('0038 — arqueo de caja', 'tabla', 'cash_count', ''),
  ('0038 — arqueo de caja', 'columnas', 'cash_session', 'closed_by,approved_by,approved_at,requires_approval,expected_by_currency,counted_by_currency,difference_by_currency,card_batch_total,card_batch_reference,deposit_reference'),
  ('0038 — arqueo de caja', 'columnas', 'cash_register', 'difference_tolerance'),
  ('0038 — arqueo de caja', 'columnas', 'cash_count', 'currency,kind,breakdown,counted_total,expected_total,difference'),
  ('0038 — arqueo de caja', 'columnas', 'ledger_entry', 'cash_session_id'),
  ('0038 — arqueo de caja', 'valor', 'cash_session', 'status=pending_approval'),
  ('0039 — anticipo, saldo y cuotas', 'tabla', 'payment_schedule', ''),
  ('0039 — anticipo, saldo y cuotas', 'columnas', 'payment_schedule', 'order_id,sequence,kind,due_date,amount,paid_amount,balance,status,reminded_at'),
  ('0039 — anticipo, saldo y cuotas', 'columnas', 'sales_order', 'deposit_type,deposit_percent,deposit_amount,deposit_due_date,balance_due_date,payment_terms,hold_until,collection_status'),
  ('0039 — anticipo, saldo y cuotas', 'columnas', 'product', 'deposit_type,deposit_percent,deposit_amount,balance_due_days'),
  ('0039 — anticipo, saldo y cuotas', 'columnas', 'booking', 'balance_due_date'),
  ('0039 — anticipo, saldo y cuotas', 'columnas', 'payment', 'schedule_id'),
  ('0039 — anticipo, saldo y cuotas', 'columnas', 'organizations', 'hold_hours'),
  ('0039 — anticipo, saldo y cuotas', 'valor', 'sales_order', 'collection_status=overdue'),
  ('0039 — anticipo, saldo y cuotas', 'valor', 'receivable', 'aging_bucket=d1_30'),
  ('0040 — liquidación de proveedores', 'tabla', 'booking_cost', ''),
  ('0040 — liquidación de proveedores', 'columnas', 'booking_cost', 'booking_id,supplier_id,product_cost_id,settlement_id,concept,cost_type,quantity,unit_cost,amount,confirmed_amount,status'),
  ('0040 — liquidación de proveedores', 'columnas', 'settlement', 'supplier_id,services_total,confirmed_total,adjustments_total,retention_isr,retention_itbis,retention_total,net_total,supplier_invoice_number,supplier_invoice_ncf,supplier_invoice_date,confirmed_at,confirmed_by,dispute_reason,beneficiary_name,last_payment_at'),
  ('0040 — liquidación de proveedores', 'columnas', 'supplier', 'tax_regime,retention_isr_pct,retention_itbis_pct,tax_rate,bank_name,bank_account'),
  ('0040 — liquidación de proveedores', 'columnas', 'booking', 'accrued_cost'),
  ('0040 — liquidación de proveedores', 'valor', 'settlement', 'beneficiary_type=supplier'),
  ('0041 — satélite de MembeGo', 'tabla', 'membego_link', ''),
  ('0041 — satélite de MembeGo', 'tabla', 'membego_user', ''),
  ('0041 — satélite de MembeGo', 'tabla', 'membego_customer', ''),
  ('0041 — satélite de MembeGo', 'tabla', 'membego_event', ''),
  ('0041 — satélite de MembeGo', 'tabla', 'membego_sso_jti', ''),
  ('0041 — satélite de MembeGo', 'columnas', 'membego_link', 'membego_company_id,status,linked_by,last_event_at,events_received'),
  ('0041 — satélite de MembeGo', 'columnas', 'membego_user', 'membego_sub,user_id,membego_role,role_managed,last_login_at'),
  ('0041 — satélite de MembeGo', 'columnas', 'membego_customer', 'membego_cliente_id,customer_id,plan_id,plan_name,membership_id,membership_paid,membership_valid_until,visits,purchases'),
  ('0041 — satélite de MembeGo', 'columnas', 'membego_event', 'event_id,tipo,payload,status,error,received_at')
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
