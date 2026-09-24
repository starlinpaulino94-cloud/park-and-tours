-- Auditoría de migraciones · parte 5 de 6
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
  ('0065 — logística del día', 'columnas', 'zone', 'pickup_offset_min'),
  ('0065 — logística del día', 'columnas', 'pickup', 'planned_time,sequence'),
  ('0065 — logística del día', 'columnas', 'pickup_route', 'auto_key'),
  ('0065 — logística del día', 'columnas', 'departure_resource', 'conflict_reason'),
  ('0066 — lista de espera', 'tabla', 'waitlist_entry', ''),
  ('0066 — lista de espera', 'columnas', 'waitlist_entry', 'organization_id,departure_id,customer_id,contact_name,contact_phone,contact_email,seller_id,partner_id,pax,status,offered_at,offer_expires_at,booking_id,notes'),
  ('0067 — la voz del cliente', 'tabla', 'guest_survey', ''),
  ('0067 — la voz del cliente', 'columnas', 'guest_survey', 'organization_id,booking_id,departure_id,product_id,customer_id,guide_staff_id,token,status,skip_reason,asked_at,expires_at,answered_at,nps,rating_guide,rating_transport,rating_value,comment,language,review_requested,review_clicked_at,guest_case_id'),
  ('0067 — la voz del cliente', 'columnas', 'organizations', 'review_url'),
  ('0067 — la voz del cliente', 'columnas', 'customer', 'survey_opt_out'),
  ('0068 — empresa activa en el token', 'tabla', 'user_active_workspace', ''),
  ('0068 — empresa activa en el token', 'columnas', 'user_active_workspace', 'user_id,organization_id,updated_at'),
  ('0069 — una cuenta, un vendedor', 'tabla', 'seller', ''),
  ('0069 — una cuenta, un vendedor', 'columnas', 'seller', 'user_id'),
  ('0070 — la comisión sabe de qué día es', 'tabla', 'commission', ''),
  ('0070 — la comisión sabe de qué día es', 'columnas', 'commission', 'service_date'),
  ('0071 — el enlace de venta en autoservicio', 'tabla', 'seller_link', ''),
  ('0071 — el enlace de venta en autoservicio', 'columnas', 'seller_link', 'created_by,hits'),
,
  ('0073 — el ciclo de vida del socio', 'columnas', 'organization_relationships', 'terms_version,terms_accepted_version,terms_accepted_at,terms_accepted_by'),
  ('0074 — el socio gestiona a su propia gente', 'columnas', 'organization_memberships', 'partner_role'),
  ('0075 — la cartera propia del tour center', 'columnas', 'customer', 'partner_id'),
  ('0076 — la disputa de una liquidación', 'columnas', 'settlement', 'disputed_at,disputed_by,dispute_assignee'),
  ('0077 — el contrato socio–producto', 'tabla', 'partner_product', ''),
  ('0077 — el contrato socio–producto', 'columnas', 'partner_product', 'partner_id,product_id,status'),
  ('0078 — el modelo comercial del socio', 'columnas', 'organization_relationships', 'pricing_model'),
  ('0079 — la bandeja del tour center', 'columnas', 'notification', 'partner_id'),
  ('0080 — el saldo prepago del tour center', 'tabla', 'partner_wallet_movement', ''),
  ('0080 — el saldo prepago del tour center', 'columnas', 'partner_wallet_movement', 'partner_id,movement_type,amount,currency'),
  ('0080 — el saldo prepago del tour center', 'columnas', 'organization_relationships', 'payment_mode'),
  ('0081 — de quién es el dinero de cada caja', 'columnas', 'cash_register', 'partner_id,seller_id'),
  ('0081 — de quién es el dinero de cada caja', 'columnas', 'cash_session', 'partner_id,seller_id'),
  ('0081 — de quién es el dinero de cada caja', 'columnas', 'cash_movement', 'partner_id,seller_id'),
  ('0082 — quién se queda el dinero entre la venta y el servicio', 'columnas', 'organization_relationships', 'collection_mode'),
  ('0082 — quién se queda el dinero entre la venta y el servicio', 'columnas', 'seller', 'collection_mode'),
  ('0082 — quién se queda el dinero entre la venta y el servicio', 'columnas', 'sales_order', 'collection_mode'),
  ('0083 — la comisión retenida, en una sola escritura', 'columnas', 'cash_movement', 'commission_id'),
  ('0084 — el proveedor entra al sistema', 'columnas', 'supplier', 'user_id')
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
