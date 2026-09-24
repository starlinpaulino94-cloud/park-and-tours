-- Auditoria de migraciones, parte 5 de 7. GENERADO.
-- Pegalo ENTERO en el editor SQL de Supabase. Solo lee.

with e(mig,tipo,obj,det) as (values
  ('0058 — atribución comercial','tab','seller_type',''),
  ('0058 — atribución comercial','tab','seller_link',''),
  ('0058 — atribución comercial','tab','seller_attribution',''),
  ('0058 — atribución comercial','col','seller_link','seller_id,slug,name,channel,product_id,campaign,status'),
  ('0058 — atribución comercial','col','seller_attribution','seller_id,link_id,customer_id,visitor_id,stage,channel,landing,campaign,order_id,booking_id'),
  ('0058 — atribución comercial','col','seller','seller_type_id'),
  ('0058 — atribución comercial','col','sales_order','attribution_id,attribution_policy'),
  ('0058 — atribución comercial','col','organizations','attribution_policy,attribution_window_days'),
  ('0059 — profundidad de las comisiones','tab','commission_adjustment',''),
  ('0059 — profundidad de las comisiones','col','commission_adjustment','commission_id,amount,currency,reason,reason_code,booking_id,settlement_id,created_by'),
  ('0059 — profundidad de las comisiones','col','commission','breakdown,pax_adults,pax_children,adjustment_total,net_amount'),
  ('0059 — profundidad de las comisiones','col','commission_rule','tier_basis,effective_from,effective_to'),
  ('0059 — profundidad de las comisiones','val','commission_rule','per_adult'),
  ('0060 — metas comerciales y bonos','tab','seller_goal',''),
  ('0060 — metas comerciales y bonos','tab','seller_bonus',''),
  ('0060 — metas comerciales y bonos','col','seller_goal','seller_id,seller_type_id,branch_id,product_id,category_id,period,period_from,period_to,target_signups,target_bookings,target_sales,target_pax,target_revenue,currency,reward,status'),
  ('0060 — metas comerciales y bonos','col','seller_bonus','seller_id,goal_id,description,condition,amount,currency,payout_kind,status,settlement_id,awarded_at,paid_at,approved_by'),
  ('0060 — metas comerciales y bonos','col','settlement','bonus_total,in_kind_total'),
  ('0061 — combos y paquetes','tab','product_bundle_item',''),
  ('0061 — combos y paquetes','col','product_bundle_item','bundle_id,product_id,modality_id,day_offset,sort_order,fixed_time,allow_overlap,is_optional'),
  ('0061 — combos y paquetes','col','product','is_bundle,bundle_buffer_minutes'),
  ('0061 — combos y paquetes','col','booking','bundle_booking_id,bundle_item_id'),
  ('0062 — búsqueda sin acentos','col','customer','search_text'),
  ('0062 — búsqueda sin acentos','col','seller','search_text'),
  ('0062 — búsqueda sin acentos','col','product','search_text'),
  ('0062 — búsqueda sin acentos','col','supplier','search_text'),
  ('0064 — salud del sistema','tab','job_run',''),
  ('0064 — salud del sistema','tab','system_incident',''),
  ('0064 — salud del sistema','col','job_run','organization_id,job,trigger,started_at,finished_at,status,summary,error'),
  ('0064 — salud del sistema','col','system_incident','organization_id,fingerprint,source,message,level,occurrences,first_seen_at,last_seen_at,status,context')
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
