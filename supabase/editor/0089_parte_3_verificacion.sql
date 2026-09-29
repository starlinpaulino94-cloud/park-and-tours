-- ═══════════════════════════════════════════════════════════════════════════
-- 0089 · VERIFICACIÓN — se LEE fila a fila
--
-- Pégalo entero y dale a «Run». No cambia nada: solo lee.
--
-- Por qué existe: los pasos 3 y 4 de la lista no tenían forma de comprobarse, y
-- aquí hay una cosa que NO se puede dejar sin comprobar — el índice único del
-- NCF. Sin él, el mismo comprobante fiscal del mismo proveedor entra dos veces,
-- y eso es una factura duplicada ante la DGII.
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
with esperado(fila, que, nombre) as (values
  (1, 'settlement.accepted_at',            'accepted_at'),
  (2, 'settlement.accepted_by',            'accepted_by'),
  (3, 'settlement.supplier_ncf',           'supplier_ncf'),
  (4, 'settlement.supplier_ncf_type',      'supplier_ncf_type'),
  (5, 'settlement.supplier_invoice_number','supplier_invoice_number'),
  (6, 'settlement.supplier_invoice_at',    'supplier_invoice_at'),
  (7, 'settlement.supplier_invoice_by',    'supplier_invoice_by')
)
select e.fila, e.que,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'settlement'
                            and column_name = e.nombre)
            then 'OK' else 'FALTA' end as resultado
  from esperado e
union all
-- El mismo NCF del mismo proveedor dos veces es la misma factura contada dos
-- veces. Esta es la fila que no se puede quedar en FALTA.
select 8, 'el mismo NCF del mismo proveedor, una sola vez',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public' and indexname = 'settlement_supplier_ncf_uq')
            then 'OK' else 'FALTA - un NCF duplicado entraria' end
union all
select 9, 'NCF de proveedor ya repetidos',
       case when (select count(*) from (
              select to_jsonb(s) ->> 'supplier_id' as prov, to_jsonb(s) ->> 'supplier_ncf' as ncf
                from settlement s
               where to_jsonb(s) ->> 'supplier_ncf' is not null
                 and to_jsonb(s) ->> 'supplier_id' is not null
               group by 1, 2 having count(*) > 1) x) = 0
            then 'OK' else 'HAY duplicados: el indice unico no se pudo crear' end
union all
select 10, 'ambito del proveedor en settlement y booking_cost',
       case when (select count(*) from pg_policies
                   where schemaname = 'public' and tablename in ('settlement','booking_cost')
                     and policyname = 'tenant_select') = 2
            then 'OK' else 'FALTA' end
order by 1;
