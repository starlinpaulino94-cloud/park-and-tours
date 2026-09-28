-- QUE MIGRACIONES ME FALTAN POR EJECUTAR, parte 2 de 2.
-- GENERADO: no lo edites. Pegalo ENTERO en el editor SQL. Solo lee.

with u(mig,tipo,nom,huella) as (values
  ('0074','col','organization_memberships.partner_role',''),
  ('0075','idx','customer_partner_idx',''),
  ('0076','idx','settlement_disputed_idx',''),
  ('0077','fn','app.partner_product_socio_nuevo',''),
  ('0078','col','organization_relationships.pricing_model',''),
  ('0079','idx','notification_partner_idx',''),
  ('0080','col','organization_relationships.payment_mode',''),
  ('0081','fn','app.cash_movement_matches_session',''),
  ('0082','idx','sales_order_collection_mode_idx',''),
  ('0083','fn','public.retain_seller_commission',''),
  ('0084','fn','app.can_read_supplier',''),
  ('0085','fn','app.fill_supplier_from_resource',''),
  ('0086','fn','app.sync_service_date_to_children',''),
  ('0087','fn','public.respond_to_supplier_service',''),
  ('0088','fn','app.sync_pickup_from_route',''),
  ('0089','idx','settlement_supplier_ncf_uq',''),
  ('0090','idx','message_departure_idx',''),
  ('0091','fn','public.spend_partner_wallet',''),
  ('0092','idx','customer_blacklist_idx',''),
  ('0093','src','app.custom_access_token_hook','user_active_workspace'),
  ('0094','fn','public.departure_pax_totals',''),
  ('0095','src','app.enforce_same_tenant_refs','tenant_org_id'),
  ('0096','src','public.dashboard_summary','b.status, b.booking_date, b.channel'),
  ('0097','src','app.enforce_same_tenant_refs','select %I, true from %s'),
  ('0098','col','membego_customer.membership_status',''),
  ('0099','col','departure.hold_pax','')
), v as (
  select u.mig,
         case u.tipo
           when '?' then 'NO SE PUEDE COMPROBAR ASI'
           when 'src' then case when position(u.huella in coalesce((
                  select pg_get_functiondef(p.oid) from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = split_part(u.nom, '.', 1)
                     and p.proname = split_part(u.nom, '.', 2)), '')) > 0
                then 'OK' else 'FALTA' end
           when 'fn' then case when exists (
                  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = split_part(u.nom, '.', 1)
                     and p.proname = split_part(u.nom, '.', 2))
                then 'OK' else 'FALTA' end
           when 'trg' then case when exists (
                  select 1 from pg_trigger g where g.tgname = u.nom and not g.tgisinternal)
                then 'OK' else 'FALTA' end
           when 'idx' then case when exists (
                  select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = u.nom)
                then 'OK' else 'FALTA' end
           when 'tbl' then case when to_regclass('public.' || u.nom) is not null
                then 'OK' else 'FALTA' end
           else case when exists (
                  select 1 from information_schema.columns c
                   where c.table_schema = 'public'
                     and c.table_name = split_part(u.nom, '.', 1)
                     and c.column_name = split_part(u.nom, '.', 2))
                then 'OK' else 'FALTA' end
         end as estado,
         case u.tipo when 'fn' then 'funcion ' when 'trg' then 'disparador '
                     when 'idx' then 'indice ' when 'tbl' then 'tabla '
                     when 'src' then 'en el cuerpo de '
                     when '?' then '' else 'columna ' end || u.nom
         || case when u.tipo = 'src' then ': ' || u.huella else '' end as ultimo
    from u
)
select v.mig as migracion, v.estado,
       case when v.estado = 'NO SE PUEDE COMPROBAR ASI'
            then 'solo reemplaza cosas que ya existian: mirala con su fichero de verificacion'
            else 'lo ultimo que escribe: ' || v.ultimo end as detalle
  from v
 order by case v.estado when 'FALTA' then 0 when 'NO SE PUEDE COMPROBAR ASI' then 1 else 2 end,
          v.mig;

-- Si el pegado llego entero, la consulta termina en "v.mig;".
--
-- COMO SE LEE. Las que FALTAN salen arriba. De cada migracion se comprueba lo
-- ULTIMO que su fichero escribe: si eso esta, la migracion llego al final.
-- Es lo que el resumen de columnas no podia ver, porque miraba una columna que
-- crea la PRIMERA linea y daba OK a una migracion ejecutada a medias.
--
-- "NO SE PUEDE COMPROBAR ASI" no quiere decir que este. Quiere decir que esa
-- migracion solo REEMPLAZA cosas que ya existian, asi que verlas en el
-- catalogo no prueba nada. Cada una tiene su fichero NNNN_parte_N_verificacion
-- en supabase/editor/: ese si lo dice.
--
-- Todas aguantan ejecutarse dos veces, asi que ante la duda, vuelve a correrla.
