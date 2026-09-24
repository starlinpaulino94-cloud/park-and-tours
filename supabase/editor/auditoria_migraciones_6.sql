-- Auditoria de migraciones, parte 6 de 7. GENERADO.
-- Pegalo ENTERO en el editor SQL de Supabase. Solo lee.

with e(mig,tipo,obj,det) as (values
  ('0065 — logística del día','col','zone','pickup_offset_min'),
  ('0065 — logística del día','col','pickup','planned_time,sequence'),
  ('0065 — logística del día','col','pickup_route','auto_key'),
  ('0065 — logística del día','col','departure_resource','conflict_reason'),
  ('0066 — lista de espera','tab','waitlist_entry',''),
  ('0066 — lista de espera','col','waitlist_entry','organization_id,departure_id,customer_id,contact_name,contact_phone,contact_email,seller_id,partner_id,pax,status,offered_at,offer_expires_at,booking_id,notes'),
  ('0067 — la voz del cliente','tab','guest_survey',''),
  ('0067 — la voz del cliente','col','guest_survey','organization_id,booking_id,departure_id,product_id,customer_id,guide_staff_id,token,status,skip_reason,asked_at,expires_at,answered_at,nps,rating_guide,rating_transport,rating_value,comment,language,review_requested,review_clicked_at,guest_case_id'),
  ('0067 — la voz del cliente','col','organizations','review_url'),
  ('0067 — la voz del cliente','col','customer','survey_opt_out'),
  ('0068 — empresa activa en el token','tab','user_active_workspace',''),
  ('0068 — empresa activa en el token','col','user_active_workspace','user_id,organization_id,updated_at'),
  ('0069 — una cuenta, un vendedor','tab','seller',''),
  ('0069 — una cuenta, un vendedor','col','seller','user_id'),
  ('0070 — la comisión sabe de qué día es','tab','commission',''),
  ('0070 — la comisión sabe de qué día es','col','commission','service_date'),
  ('0071 — el enlace de venta en autoservicio','tab','seller_link',''),
  ('0071 — el enlace de venta en autoservicio','col','seller_link','created_by,hits'),
,
  ('0073 — el ciclo de vida del socio','col','organization_relationships','terms_version,terms_accepted_version,terms_accepted_at,terms_accepted_by'),
  ('0074 — el socio gestiona a su propia gente','col','organization_memberships','partner_role'),
  ('0075 — la cartera propia del tour center','col','customer','partner_id'),
  ('0076 — la disputa de una liquidación','col','settlement','disputed_at,disputed_by,dispute_assignee'),
  ('0077 — el contrato socio–producto','tab','partner_product',''),
  ('0077 — el contrato socio–producto','col','partner_product','partner_id,product_id,status'),
  ('0078 — el modelo comercial del socio','col','organization_relationships','pricing_model'),
  ('0079 — la bandeja del tour center','col','notification','partner_id'),
  ('0080 — el saldo prepago del tour center','tab','partner_wallet_movement',''),
  ('0080 — el saldo prepago del tour center','col','partner_wallet_movement','partner_id,movement_type,amount,currency'),
  ('0080 — el saldo prepago del tour center','col','organization_relationships','payment_mode'),
  ('0081 — de quién es el dinero de cada caja','col','cash_register','partner_id,seller_id'),
  ('0081 — de quién es el dinero de cada caja','col','cash_session','partner_id,seller_id'),
  ('0081 — de quién es el dinero de cada caja','col','cash_movement','partner_id,seller_id')
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
