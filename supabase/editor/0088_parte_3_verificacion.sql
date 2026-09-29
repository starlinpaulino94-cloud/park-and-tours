-- ═══════════════════════════════════════════════════════════════════════════
-- 0088 · VERIFICACIÓN — se LEE fila a fila
--
-- Pégalo entero y dale a «Run». No cambia nada: solo lee.
--
-- Por qué existe: los pasos 1 y 2 de la lista no tenían forma de comprobarse.
-- «Success. No rows returned» del editor no distingue «hizo lo suyo» de «no
-- hizo nada», y estas dos partes dejan columnas, disparadores Y una política.
-- Un disparador que no quedó registrado no se nota hasta que una parada se
-- escribe sin proveedor y la hoja de ruta del chofer sale vacía.
--
-- Todas las filas tienen que decir OK.
--
-- POR QUÉ LAS FILAS DE DATOS LEEN POR `to_jsonb(...) ->> 'columna'`
--
-- Porque si la columna NO está, una referencia directa revienta la consulta
-- ENTERA con un error de Postgres —«column ... does not exist»— en vez de
-- devolver la fila que dice FALTA. Es decir: justo el día que algo salió mal,
-- la verificación deja de verificar y escupe un error crudo.
--
-- Lo encontró el control negativo de `db-test.sh`, que borra la columna a
-- propósito y exige que la fila lo diga. `to_jsonb` se resuelve en ejecución y
-- devuelve nulo cuando la columna no existe, así que la fila sobrevive y acusa.
-- ═══════════════════════════════════════════════════════════════════════════
with esperado(fila, que, tipo, nombre, sobre) as (values
  (1, 'pickup.supplier_id',        'col', 'supplier_id',  'pickup'),
  (2, 'pickup.service_date',       'col', 'service_date', 'pickup'),
  (3, 'pickup.marked_at',          'col', 'marked_at',    'pickup'),
  (4, 'pickup.marked_by',          'col', 'marked_by',    'pickup'),
  (5, 'pickup.marked_via',         'col', 'marked_via',   'pickup'),
  (6, 'indice por proveedor',      'idx', 'pickup_supplier_idx', 'pickup'),
  -- Las dos mitades del mismo problema: copiar al escribir la parada, y MOVER
  -- cuando la ruta cambia de proveedor o de fecha. Con una sola, las paradas ya
  -- escritas se quedan apuntando al proveedor anterior.
  (7, 'copia al escribir la parada', 'trg', 'pickup_supplier', 'pickup'),
  (8, 'mueve si la ruta cambia',     'trg', 'pickup_route_sync_pickups', 'pickup_route')
)
select e.fila, e.que,
       case e.tipo
         when 'col' then case when exists (
                select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = e.sobre and column_name = e.nombre)
              then 'OK' else 'FALTA' end
         when 'idx' then case when exists (
                select 1 from pg_indexes where schemaname = 'public' and indexname = e.nombre)
              then 'OK' else 'FALTA' end
         else case when exists (
                select 1 from pg_trigger t
                 where t.tgname = e.nombre and t.tgrelid = ('public.' || e.sobre)::regclass
                   and not t.tgisinternal)
              then 'OK' else 'FALTA' end
       end as resultado
  from esperado e
union all
-- Lo que ya existía tiene que haber quedado relleno, o el primer chofer que
-- entre ve su hoja vacía y no hay nada que lo explique.
select 9, 'paradas con ruta y sin proveedor',
       case when (select count(*) from pickup p
                   where to_jsonb(p) ->> 'route_id' is not null
                     and to_jsonb(p) ->> 'supplier_id' is null) = 0
            then 'OK' else 'FALTA - ' ||
              (select count(*)::text from pickup p
                where to_jsonb(p) ->> 'route_id' is not null
                  and to_jsonb(p) ->> 'supplier_id' is null)
              || ' paradas sin rellenar' end
union all
select 10, 'politica de lectura por inquilino',
       case when exists (select 1 from pg_policies
                          where schemaname = 'public' and tablename = 'pickup' and policyname = 'tenant_select')
            then 'OK' else 'FALTA' end
order by 1;
