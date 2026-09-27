-- Auditoria de migraciones, parte 4 de 7. GENERADO.
-- Pegalo ENTERO en el editor SQL de Supabase. Solo lee.

with e(mig,tipo,obj,det) as (values
  ('0051 — RR. HH.','tab','payroll_run',''),
  ('0051 — RR. HH.','tab','payroll_line',''),
  ('0051 — RR. HH.','col','staff','payroll_code,salary_type,base_salary,hourly_rate,social_security_id,bank_account,bank_name,applies_social_security,termination_date'),
  ('0051 — RR. HH.','col','certification','reminder_sent_at,checked_at'),
  ('0051 — RR. HH.','col','shift','published_at,published_by'),
  ('0051 — RR. HH.','col','attendance','break_min,regular_hours,approved_at,payroll_run_id'),
  ('0051 — RR. HH.','col','payroll_run','period_start,period_end,period_type,status,sfs_employee_pct,afp_employee_pct,sfs_employer_pct,afp_employer_pct,risk_employer_pct,employer_cost'),
  ('0051 — RR. HH.','col','payroll_line','staff_id,days_worked,regular_hours,overtime_hours,extra_overtime_hours,gross_amount,sfs_employee,afp_employee,isr_amount,net_amount'),
  ('0052 — recepción de compra y existencias apartadas','col','stock_movement','purchase_order_line_id,booking_extra_id'),
  ('0052 — recepción de compra y existencias apartadas','col','product_extra','inventory_item_id,warehouse_id,consumes_stock,stock_per_unit'),
  ('0052 — recepción de compra y existencias apartadas','col','booking_extra','inventory_item_id,warehouse_id,stock_quantity,stock_state'),
  ('0052 — recepción de compra y existencias apartadas','col','purchase_order','receipt_count,last_received_by'),
  ('0053 — cierre contable','tab','accounting_period',''),
  ('0053 — cierre contable','col','accounting_period','period,status,closed_at,closed_by,locked_at,reopened_at'),
  ('0053 — cierre contable','col','ledger_entry','is_closing,closes_year'),
  ('0053 — cierre contable','col','invoice','void_reason_code'),
  ('0054 — motor de cupos','col','booking','allotment_id,allotment_seats'),
  ('0054 — motor de cupos','col','allotment','released_at,release_runs,closed_at,closed_by'),
  ('0055 — la marca en los documentos','col','organizations','whatsapp,address,city,group_name,notes,logo_url,brand_color,document_footer,voucher_terms,invoice_terms'),
  ('0056 — conector OTA (OCTO)','col','booking','octo_uuid,octo_option_id,octo_status,octo_reseller_reference,octo_unit_items,octo_contact,octo_test_mode,octo_confirmed_at,octo_api_key_id'),
  ('0056 — conector OTA (OCTO)','col','organizations','octo_max_hold_minutes'),
  ('0057 — canje de beneficios MembeGo','tab','membego_redemption',''),
  ('0057 — canje de beneficios MembeGo','col','membego_redemption','order_id,booking_id,customer_id,membego_cliente_id,benefit_type,benefit_id,redemption_id,uses_left,effect_kind,amount_discounted,status,idempotency_key'),
  ('0057 — canje de beneficios MembeGo','col','booking','membego_benefit,membego_discount')
), obj as (
  select e.mig, e.tipo, e.obj, nullif(trim(both from c), '') as col
    from e left join lateral unnest(
      case when e.tipo = 'col' then string_to_array(e.det, ',')
           else array[null]::text[] end) as c on true
), falta as (
  select o.mig, o.obj || coalesce('.' || o.col, '') as que from obj o
   where case when o.tipo = 'fn' then not exists (
                select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = o.obj)
              when o.tipo = 'val' then not exists (
                select 1 from pg_constraint k
                 where k.conrelid = to_regclass('public.' || o.obj) and k.contype = 'c'
                   and pg_get_constraintdef(k) like '%''' || o.det || '''%')
              else to_regclass('public.' || o.obj) is null
                or (o.col is not null and not exists (
                     select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = o.obj
                        and c.column_name = o.col)) end
), hay as (select mig, count(*) n from obj group by 1),
   no_hay as (select mig, count(*) n, string_agg(que, ', ') d from falta group by 1)
select h.mig as migracion,
       case when f.n is null then 'OK'
            when f.n >= h.n then 'FALTA ENTERA'
            else 'A MEDIAS - vuelve a ejecutarla' end as estado,
       coalesce(f.d, '') as lo_que_no_esta
  from hay h left join no_hay f on f.mig = h.mig order by 1;

-- Ejecuta las 7 partes: cada una cubre un tramo distinto.
-- "A MEDIAS" quiere decir que ese pegado se trunco en su dia; vuelve a
-- ejecutar esa migracion entera, que todas aguantan correrse dos veces.
