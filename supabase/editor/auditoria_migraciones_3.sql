-- Auditoria de migraciones, parte 3 de 7. GENERADO.
-- Pegalo ENTERO en el editor SQL de Supabase. Solo lee.

with e(mig,tipo,obj,det) as (values
  ('0040 — liquidación de proveedores','tab','booking_cost',''),
  ('0040 — liquidación de proveedores','col','booking_cost','booking_id,supplier_id,product_cost_id,settlement_id,concept,cost_type,quantity,unit_cost,amount,confirmed_amount,status'),
  ('0040 — liquidación de proveedores','col','settlement','supplier_id,services_total,confirmed_total,adjustments_total,retention_isr,retention_itbis,retention_total,net_total,supplier_invoice_number,supplier_invoice_ncf,supplier_invoice_date,confirmed_at,confirmed_by,dispute_reason,beneficiary_name,last_payment_at'),
  ('0040 — liquidación de proveedores','col','supplier','tax_regime,retention_isr_pct,retention_itbis_pct,tax_rate,bank_name,bank_account'),
  ('0040 — liquidación de proveedores','col','booking','accrued_cost'),
  ('0040 — liquidación de proveedores','val','settlement','supplier'),
  ('0041 — satélite de MembeGo','tab','membego_link',''),
  ('0041 — satélite de MembeGo','tab','membego_user',''),
  ('0041 — satélite de MembeGo','tab','membego_customer',''),
  ('0041 — satélite de MembeGo','tab','membego_event',''),
  ('0041 — satélite de MembeGo','tab','membego_sso_jti',''),
  ('0041 — satélite de MembeGo','col','membego_link','membego_company_id,status,linked_by,last_event_at,events_received'),
  ('0041 — satélite de MembeGo','col','membego_user','membego_sub,user_id,membego_role,role_managed,last_login_at'),
  ('0041 — satélite de MembeGo','col','membego_customer','membego_cliente_id,customer_id,plan_id,plan_name,membership_id,membership_paid,membership_valid_until,visits,purchases'),
  ('0041 — satélite de MembeGo','col','membego_event','event_id,tipo,payload,status,error,received_at'),
  ('0042 — el plan como contrato aplicable','col','organizations','trial_ends_at,next_billing_at,storage_used_mb'),
  ('0044 — avisos internos','col','notification','audience_role,event_key,entity_type,entity_id,dedupe_key'),
  ('0045 — reprogramar sin cancelar','col','booking','previous_departure_id,rescheduled_at,reschedule_reason,reschedule_count'),
  ('0046 — ámbito de sucursal','col','organization_memberships','branch_id'),
  ('0047 — motor de reservas público','col','organizations','public_booking_enabled,public_intro,public_terms'),
  ('0047 — motor de reservas público','col','product','published,public_price_from'),
  ('0047 — motor de reservas público','col','booking','public_request'),
  ('0048 — embarque sin conexión','col','booking','checkin_key'),
  ('0049 — declaración 606','col','expense','ncf,ncf_type,ncf_modified,supplier_rnc,itbis_amount,itbis_withheld,isr_withheld,selective_tax,other_taxes,legal_tip,goods_service_type,paid_date'),
  ('0050 — llaves de API','tab','api_key',''),
  ('0050 — llaves de API','col','api_key','prefix,secret_hash,scope,partner_id,revoked_at,last_used_at'),
  ('0050 — llaves de API','col','sales_order','idempotency_key')
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
