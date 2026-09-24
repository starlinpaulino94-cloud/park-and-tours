-- Auditoria de migraciones, parte 1 de 7. GENERADO.
-- Pegalo ENTERO en el editor SQL de Supabase. Solo lee.

with e(mig,tipo,obj,det) as (values
  ('0021 — columnas de ejecución (primera ronda)','col','booking','booking_date'),
  ('0021 — columnas de ejecución (primera ronda)','col','product','sort_order'),
  ('0021 — columnas de ejecución (primera ronda)','col','product_modality','sort_order'),
  ('0030 — columnas de ejecución (segunda ronda)','col','booking','unit_price,hotel_id,pickup_time,pickup_location,room_number,voucher_code,checked_in_at,checked_in_pax,override_reason,notes,internal_notes'),
  ('0030 — columnas de ejecución (segunda ronda)','col','participant','full_name,age,nationality,special_requirements,notes'),
  ('0030 — columnas de ejecución (segunda ronda)','col','voucher','issued_at,notes'),
  ('0030 — columnas de ejecución (segunda ronda)','col','departure','branch_id,departure_time,available_pax,waitlist_pax,meeting_point,notes'),
  ('0030 — columnas de ejecución (segunda ronda)','col','sales_order','promotion_id'),
  ('0030 — columnas de ejecución (segunda ronda)','col','customer','hotel_id,assigned_seller_id,whatsapp,language,room,address,preferences'),
  ('0030 — columnas de ejecución (segunda ronda)','col','seller','branch_id,email,phone,whatsapp,seller_role,monthly_goal,currency,photo_url,hire_date,notes'),
  ('0030 — columnas de ejecución (segunda ronda)','col','product','category_id,short_description,cover_image_url,video_url,location,meeting_point,duration_hours,languages,min_age,default_capacity,restrictions,recommendations,inclusions,exclusions,terms,instructions,base_cost,featured'),
  ('0030 — columnas de ejecución (segunda ronda)','col','product_modality','cost,age_from,age_to,capacity_weight'),
  ('0030 — columnas de ejecución (segunda ronda)','col','price_rule','time_from,time_to'),
  ('0030 — columnas de ejecución (segunda ronda)','col','zone','zone_type,max_capacity,current_occupancy,requires_wristband'),
  ('0030 — columnas de ejecución (segunda ronda)','col','cash_register','branch_id,terminal'),
  ('0030 — columnas de ejecución (segunda ronda)','col','cash_session','branch_id,code,difference,card_total,transfer_total,expenses_total,withdrawals_total,notes'),
  ('0030 — columnas de ejecución (segunda ronda)','col','commission','beneficiary_name,generated_at,notes'),
  ('0030 — columnas de ejecución (segunda ronda)','col','commission_rule','category_id,description'),
  ('0030 — columnas de ejecución (segunda ronda)','col','settlement','sales_total,cancellations_total,notes'),
  ('0030 — columnas de ejecución (segunda ronda)','col','receivable','notes'),
  ('0030 — columnas de ejecución (segunda ronda)','col','payable','supplier_id,concept,paid_at,notes')
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
