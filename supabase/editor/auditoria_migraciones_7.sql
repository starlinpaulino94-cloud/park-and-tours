-- Auditoria de migraciones, parte 7 de 7. GENERADO.
-- Pegalo ENTERO en el editor SQL de Supabase. Solo lee.

with e(mig,tipo,obj,det) as (values
  ('0082 — quién se queda el dinero entre la venta y el servicio','col','organization_relationships','collection_mode'),
  ('0082 — quién se queda el dinero entre la venta y el servicio','col','seller','collection_mode'),
  ('0082 — quién se queda el dinero entre la venta y el servicio','col','sales_order','collection_mode'),
  ('0083 — la comisión retenida, en una sola escritura','col','cash_movement','commission_id'),
  ('0084 — el proveedor entra al sistema','col','supplier','user_id'),
  ('0085 — el proveedor solo ve lo suyo','col','departure_resource','supplier_id'),
  ('0085 — el proveedor solo ve lo suyo','col','pickup_route','supplier_id'),
  ('0086 — la fecha del servicio, donde se consulta','col','departure_resource','service_date'),
  ('0086 — la fecha del servicio, donde se consulta','col','pickup_route','service_date'),
  ('0087 — aceptar o rechazar, con plazo y número','tab','supplier_response_token',''),
  ('0087 — aceptar o rechazar, con plazo y número','col','departure_resource','acceptance,acceptance_deadline,responded_at,responded_by,response_note,responded_via,confirmation_number'),
  ('0087 — aceptar o rechazar, con plazo y número','col','pickup_route','acceptance,acceptance_deadline,responded_at,responded_by,response_note,responded_via,confirmation_number'),
  ('0087 — aceptar o rechazar, con plazo y número','col','supplier','acceptance_window_hours,on_deadline_expiry'),
  ('0087 — aceptar o rechazar, con plazo y número','fn','respond_to_supplier_service','')
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
