-- Auditoría de migraciones · parte 4 de 6
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
  ('0057 — canje de beneficios MembeGo', 'tabla', 'membego_redemption', ''),
  ('0057 — canje de beneficios MembeGo', 'columnas', 'membego_redemption', 'order_id,booking_id,customer_id,membego_cliente_id,benefit_type,benefit_id,redemption_id,uses_left,effect_kind,amount_discounted,status,idempotency_key'),
  ('0057 — canje de beneficios MembeGo', 'columnas', 'booking', 'membego_benefit,membego_discount'),
  ('0058 — atribución comercial', 'tabla', 'seller_type', ''),
  ('0058 — atribución comercial', 'tabla', 'seller_link', ''),
  ('0058 — atribución comercial', 'tabla', 'seller_attribution', ''),
  ('0058 — atribución comercial', 'columnas', 'seller_link', 'seller_id,slug,name,channel,product_id,campaign,status'),
  ('0058 — atribución comercial', 'columnas', 'seller_attribution', 'seller_id,link_id,customer_id,visitor_id,stage,channel,landing,campaign,order_id,booking_id'),
  ('0058 — atribución comercial', 'columnas', 'seller', 'seller_type_id'),
  ('0058 — atribución comercial', 'columnas', 'sales_order', 'attribution_id,attribution_policy'),
  ('0058 — atribución comercial', 'columnas', 'organizations', 'attribution_policy,attribution_window_days'),
  ('0059 — profundidad de las comisiones', 'tabla', 'commission_adjustment', ''),
  ('0059 — profundidad de las comisiones', 'columnas', 'commission_adjustment', 'commission_id,amount,currency,reason,reason_code,booking_id,settlement_id,created_by'),
  ('0059 — profundidad de las comisiones', 'columnas', 'commission', 'breakdown,pax_adults,pax_children,adjustment_total,net_amount'),
  ('0059 — profundidad de las comisiones', 'columnas', 'commission_rule', 'tier_basis,effective_from,effective_to'),
  ('0059 — profundidad de las comisiones', 'valor', 'commission_rule', 'calc_type=per_adult'),
  ('0060 — metas comerciales y bonos', 'tabla', 'seller_goal', ''),
  ('0060 — metas comerciales y bonos', 'tabla', 'seller_bonus', ''),
  ('0060 — metas comerciales y bonos', 'columnas', 'seller_goal', 'seller_id,seller_type_id,branch_id,product_id,category_id,period,period_from,period_to,target_signups,target_bookings,target_sales,target_pax,target_revenue,currency,reward,status'),
  ('0060 — metas comerciales y bonos', 'columnas', 'seller_bonus', 'seller_id,goal_id,description,condition,amount,currency,payout_kind,status,settlement_id,awarded_at,paid_at,approved_by'),
  ('0060 — metas comerciales y bonos', 'columnas', 'settlement', 'bonus_total,in_kind_total'),
  ('0061 — combos y paquetes', 'tabla', 'product_bundle_item', ''),
  ('0061 — combos y paquetes', 'columnas', 'product_bundle_item', 'bundle_id,product_id,modality_id,day_offset,sort_order,fixed_time,allow_overlap,is_optional'),
  ('0061 — combos y paquetes', 'columnas', 'product', 'is_bundle,bundle_buffer_minutes'),
  ('0061 — combos y paquetes', 'columnas', 'booking', 'bundle_booking_id,bundle_item_id'),
  ('0062 — búsqueda sin acentos', 'columnas', 'customer', 'search_text'),
  ('0062 — búsqueda sin acentos', 'columnas', 'seller', 'search_text'),
  ('0062 — búsqueda sin acentos', 'columnas', 'product', 'search_text'),
  ('0062 — búsqueda sin acentos', 'columnas', 'supplier', 'search_text'),
  ('0064 — salud del sistema', 'tabla', 'job_run', ''),
  ('0064 — salud del sistema', 'tabla', 'system_incident', ''),
  ('0064 — salud del sistema', 'columnas', 'job_run', 'organization_id,job,trigger,started_at,finished_at,status,summary,error'),
  ('0064 — salud del sistema', 'columnas', 'system_incident', 'organization_id,fingerprint,source,message,level,occurrences,first_seen_at,last_seen_at,status,context')
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
