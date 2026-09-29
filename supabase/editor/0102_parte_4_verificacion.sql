-- ═══════════════════════════════════════════════════════════════════════════
-- 0102 · VERIFICACIÓN — se LEE fila a fila
--
-- Pégalo entero y dale a «Run». No cambia nada: solo lee.
--
-- Qué tienes que ver:
--   · fila 1  → OK, y 25 tablas con disparador. Si dice FALTA, lista cuáles.
--   · fila 2  → OK. Si dice FALTA, `pickup` perdió lo que 0018 ya comprobaba.
--   · fila 3  → el hueco que queda a propósito. Tiene que decir 105.
--   · fila 4  → OK. Si dice HAY, hay referencias a una persona sin comprobar,
--               y esas son las que 0102 venía a cerrar.
-- ═══════════════════════════════════════════════════════════════════════════
with esperadas as (
  select unnest(array[
    'approval_request', 'asset', 'crm_activity', 'customer', 'departure_resource',
    'expense', 'guest_case', 'guest_survey', 'incident', 'inventory_item',
    'lead', 'membership', 'pickup', 'pickup_route', 'price_rule',
    'product_cost', 'purchase_order', 'seller', 'staff', 'stock_movement',
    'supplier_response_token', 'task', 'vehicle', 'waitlist_entry', 'work_order'
  ]) as tabla
),
puestas as (
  select c.relname as tabla
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
   where p.proname = 'enforce_same_tenant_refs' and not t.tgisinternal
),
-- Las columnas que hacen saltar el disparador de `pickup`. Si aquí no están
-- las cinco, registrar `pickup` de nuevo sustituyó al de 0018 en vez de sumarse.
pickup_cols as (
  select a.attname
    from pg_trigger t
    join lateral unnest(t.tgattr) as col(attnum) on true
    join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = col.attnum
   where t.tgname = 'pickup_same_tenant_refs'
     and t.tgrelid = 'public.pickup'::regclass
     and not t.tgisinternal
),
-- Toda tabla de inquilino: la que tiene `organization_id`.
inq as (
  select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'organization_id'
                    and a.attnum > 0 and not a.attisdropped)
),
fks as (
  select hija.relname as tabla, att.attname as columna, padre.relname as padre
    from pg_constraint k
    join inq hija on hija.oid = k.conrelid
    join inq padre on padre.oid = k.confrelid
    join pg_attribute att on att.attrelid = k.conrelid and att.attnum = k.conkey[1]
   where k.contype = 'f' and array_length(k.conkey, 1) = 1
     and att.attname <> 'organization_id'
),
cubiertas as (
  select t.tabla, t.args[i] as columna
    from (
      select tr.tgrelid::regclass::text as tabla,
             string_to_array(encode(tr.tgargs, 'escape'), E'\\000') as args
        from pg_trigger tr join pg_proc p on p.oid = tr.tgfoid
       where p.proname = 'enforce_same_tenant_refs' and not tr.tgisinternal
    ) t, generate_subscripts(t.args, 1) i
   where i % 2 = 1 and coalesce(t.args[i], '') <> ''
),
sin_cubrir as (
  select f.* from fks f
   where not exists (select 1 from cubiertas c where c.tabla = f.tabla and c.columna = f.columna)
)
select 1 as fila, 'disparadores de 0102' as que,
       case when count(*) filter (where p.tabla is null) = 0
            then 'OK · ' || count(*) || ' tablas con disparador'
            else 'FALTA · ' || string_agg(e.tabla, ', ') filter (where p.tabla is null)
       end as resultado
  from esperadas e left join puestas p on p.tabla = e.tabla
union all
select 2, 'pickup conserva lo de 0018',
       case when (select count(*) from pickup_cols
                   where attname in ('organization_id','booking_id','hotel_id','route_id','supplier_id')) = 5
            then 'OK · reserva, hotel, ruta y proveedor'
            else 'FALTA · pickup quedó en: ' ||
                 coalesce((select string_agg(attname, ', ' order by attname) from pickup_cols), 'sin disparador')
       end
union all
select 3, 'hueco que queda a proposito',
       (select count(*)::text from sin_cubrir) || ' referencias sin comprobar (lo medido son 105)'
union all
select 4, 'referencias a una persona',
       coalesce('HAY sin comprobar · ' ||
                (select string_agg(tabla || '.' || columna, ', ' order by tabla, columna)
                   from sin_cubrir
                  where padre in ('customer','seller','supplier','booking','sales_order')),
                'OK · todas comprobadas')
order by 1;
