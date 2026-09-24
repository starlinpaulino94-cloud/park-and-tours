-- Auditoria de migraciones, parte 2 de 7. GENERADO.
-- Pegalo ENTERO en el editor SQL de Supabase. Solo lee.

with e(mig,tipo,obj,det) as (values
  ('0032 — profundidad de la cotización','tab','quote_option',''),
  ('0032 — profundidad de la cotización','col','quote','version,revision_of_id,selected_option_id,deposit_type,deposit_percent,deposit_amount,deposit_due_date,balance_due_date,payment_terms,inclusions,exclusions'),
  ('0032 — profundidad de la cotización','col','quote_line','option_id,is_optional,sort_order,line_type,adults,children,infants,supplier_id'),
  ('0033 — cierre de la salida','col','departure','closed_at,closed_by,departed_at,returned_at,actual_pax,no_show_pax,incident_notes,guide_notes'),
  ('0034/0035 — bandeja de salida','tab','message_template',''),
  ('0034/0035 — bandeja de salida','tab','message',''),
  ('0034/0035 — bandeja de salida','col','message','channel,status,dedupe_key,scheduled_at,attachment_kind'),
  ('0036 — extras vendibles','tab','product_extra',''),
  ('0036 — extras vendibles','tab','booking_extra',''),
  ('0036 — extras vendibles','col','booking','extras_amount,extras_cost'),
  ('0037 — facturación fiscal','tab','invoice_line',''),
  ('0037 — facturación fiscal','tab','ncf_sequence',''),
  ('0037 — facturación fiscal','col','invoice','credit_note_of_id,ncf_expires_at,balance,issued_by'),
  ('0037 — facturación fiscal','col','ncf_sequence','ncf_type,next_number,max_number,expires_at,status'),
  ('0037 — facturación fiscal','fn','next_ncf',''),
  ('0038 — arqueo de caja','tab','cash_count',''),
  ('0038 — arqueo de caja','col','cash_session','closed_by,approved_by,approved_at,requires_approval,expected_by_currency,counted_by_currency,difference_by_currency,card_batch_total,card_batch_reference,deposit_reference'),
  ('0038 — arqueo de caja','col','cash_register','difference_tolerance'),
  ('0038 — arqueo de caja','col','cash_count','currency,kind,breakdown,counted_total,expected_total,difference'),
  ('0038 — arqueo de caja','col','ledger_entry','cash_session_id'),
  ('0038 — arqueo de caja','val','cash_session','pending_approval'),
  ('0039 — anticipo, saldo y cuotas','tab','payment_schedule',''),
  ('0039 — anticipo, saldo y cuotas','col','payment_schedule','order_id,sequence,kind,due_date,amount,paid_amount,balance,status,reminded_at'),
  ('0039 — anticipo, saldo y cuotas','col','sales_order','deposit_type,deposit_percent,deposit_amount,deposit_due_date,balance_due_date,payment_terms,hold_until,collection_status'),
  ('0039 — anticipo, saldo y cuotas','col','product','deposit_type,deposit_percent,deposit_amount,balance_due_days'),
  ('0039 — anticipo, saldo y cuotas','col','booking','balance_due_date'),
  ('0039 — anticipo, saldo y cuotas','col','payment','schedule_id'),
  ('0039 — anticipo, saldo y cuotas','col','organizations','hold_hours'),
  ('0039 — anticipo, saldo y cuotas','val','sales_order','overdue'),
  ('0039 — anticipo, saldo y cuotas','val','receivable','d1_30')
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
