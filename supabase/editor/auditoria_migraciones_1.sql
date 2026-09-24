-- Auditoría de migraciones · parte 1 de 6
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
  ('0021 — columnas de ejecución (primera ronda)', 'columnas', 'booking', 'booking_date'),
  ('0021 — columnas de ejecución (primera ronda)', 'columnas', 'product', 'sort_order'),
  ('0021 — columnas de ejecución (primera ronda)', 'columnas', 'product_modality', 'sort_order'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'booking', 'unit_price,hotel_id,pickup_time,pickup_location,room_number,voucher_code,checked_in_at,checked_in_pax,override_reason,notes,internal_notes'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'participant', 'full_name,age,nationality,special_requirements,notes'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'voucher', 'issued_at,notes'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'departure', 'branch_id,departure_time,available_pax,waitlist_pax,meeting_point,notes'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'sales_order', 'promotion_id'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'customer', 'hotel_id,assigned_seller_id,whatsapp,language,room,address,preferences'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'seller', 'branch_id,email,phone,whatsapp,seller_role,monthly_goal,currency,photo_url,hire_date,notes'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'product', 'category_id,short_description,cover_image_url,video_url,location,meeting_point,duration_hours,languages,min_age,default_capacity,restrictions,recommendations,inclusions,exclusions,terms,instructions,base_cost,featured'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'product_modality', 'cost,age_from,age_to,capacity_weight'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'price_rule', 'time_from,time_to'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'zone', 'zone_type,max_capacity,current_occupancy,requires_wristband'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'cash_register', 'branch_id,terminal'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'cash_session', 'branch_id,code,difference,card_total,transfer_total,expenses_total,withdrawals_total,notes'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'commission', 'beneficiary_name,generated_at,notes'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'commission_rule', 'category_id,description'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'settlement', 'sales_total,cancellations_total,notes'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'receivable', 'notes'),
  ('0030 — columnas de ejecución (segunda ronda)', 'columnas', 'payable', 'supplier_id,concept,paid_at,notes'),
  ('0032 — profundidad de la cotización', 'tabla', 'quote_option', ''),
  ('0032 — profundidad de la cotización', 'columnas', 'quote', 'version,revision_of_id,selected_option_id,deposit_type,deposit_percent,deposit_amount,deposit_due_date,balance_due_date,payment_terms,inclusions,exclusions'),
  ('0032 — profundidad de la cotización', 'columnas', 'quote_line', 'option_id,is_optional,sort_order,line_type,adults,children,infants,supplier_id'),
  ('0033 — cierre de la salida', 'columnas', 'departure', 'closed_at,closed_by,departed_at,returned_at,actual_pax,no_show_pax,incident_notes,guide_notes'),
  ('0034/0035 — bandeja de salida', 'tabla', 'message_template', ''),
  ('0034/0035 — bandeja de salida', 'tabla', 'message', ''),
  ('0034/0035 — bandeja de salida', 'columnas', 'message', 'channel,status,dedupe_key,scheduled_at,attachment_kind'),
  ('0036 — extras vendibles', 'tabla', 'product_extra', ''),
  ('0036 — extras vendibles', 'tabla', 'booking_extra', ''),
  ('0036 — extras vendibles', 'columnas', 'booking', 'extras_amount,extras_cost')
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
