-- Funciones y disparadores de cada migracion, parte 3 de 3.
-- GENERADO: no lo edites. Pegalo ENTERO en el editor SQL. Solo lee.

with o(mig,tipo,nom,propio) as (values
  ('0086','fn','app.fill_service_date_from_departure',true),
  ('0086','fn','app.sync_service_date_to_children',true),
  ('0086','trg','departure_resource_service_date',true),
  ('0086','trg','pickup_route_service_date',true),
  ('0086','trg','departure_service_date_sync',true),
  ('0087','fn','app.set_acceptance_on_assign',true),
  ('0087','fn','app.revoke_supplier_tokens',true),
  ('0087','fn','public.respond_to_supplier_service',true),
  ('0087','trg','supplier_response_token_touch',true),
  ('0087','trg','departure_resource_supplier_acceptance',true),
  ('0087','trg','pickup_route_supplier_acceptance',true),
  ('0087','trg','departure_resource_token_revoke',true),
  ('0087','trg','pickup_route_token_revoke',true),
  ('0087','trg','departure_resource_token_cleanup',true),
  ('0087','trg','pickup_route_token_cleanup',true)
)
select o.mig as migracion,
       case when o.tipo = 'fn' then 'funcion ' else 'disparador ' end || o.nom as objeto,
       case when o.tipo = 'fn' then
              case when exists (select 1 from pg_proc p
                                  join pg_namespace n on n.oid = p.pronamespace
                                 where n.nspname = split_part(o.nom, '.', 1)
                                   and p.proname = split_part(o.nom, '.', 2))
                   then case when o.propio then 'OK' else 'existe - esta migracion solo lo reemplaza' end
                   else 'FALTA' end
            else
              case when exists (select 1 from pg_trigger g
                                 where g.tgname = o.nom and not g.tgisinternal)
                   then case when o.propio then 'OK' else 'existe - esta migracion solo lo rehace' end
                   else 'FALTA' end
       end as estado
  from o order by 1, 2;

-- "FALTA" = ese trozo de la migracion no se ejecuto. Vuelve a ejecutarla
-- entera: todas aguantan correrse dos veces.
--
-- "solo lo reemplaza/rehace" = el objeto ya existia de una migracion anterior,
-- asi que verlo no prueba que esta se ejecutara. Se mira con el fichero de
-- verificacion de esa migracion en supabase/editor/.
--
-- Si el pegado llego entero, la consulta termina en "order by 1, 2;".
