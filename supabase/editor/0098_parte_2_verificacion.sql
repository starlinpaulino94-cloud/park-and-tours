-- ═══════════════════════════════════════════════════════════════════════════
-- 0098 · VERIFICACIÓN — se LEE fila a fila
--
-- Pégalo entero y dale a «Run». No cambia nada: solo lee.
--
-- Qué tienes que ver:
--   · fila 1 → OK. Si dice FALTA, la columna no se creó y el webhook de
--              MembeGo seguirá fallando por columna inexistente.
--   · fila 2 → OK. Si dice FALTA, la restricción de valores no está y la
--              columna aceptaría cualquier texto.
--   · fila 3 → cuántas filas quedaron marcadas. Si hay clientes con plan y
--              ninguna quedó en 'active', el UPDATE no corrió.
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
select 1 as fila, 'columna membership_status' as que,
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'membego_customer'
            and column_name = 'membership_status')
       then 'OK' else 'FALTA - el webhook de MembeGo fallara al escribir' end as resultado
union all
select 2, 'solo admite active/cancelled/expired',
       case when exists (
         select 1 from pg_constraint
          where conrelid = 'public.membego_customer'::regclass
            and contype = 'c'
            and pg_get_constraintdef(oid) like '%membership_status%')
       then 'OK' else 'FALTA - la columna aceptaria cualquier texto' end
union all
select 3, 'clientes con plan ya marcados',
       (select count(*)::text from membego_customer m
         where to_jsonb(m) ->> 'membership_status' = 'active')
       || ' en active, de ' ||
       (select count(*)::text from membego_customer m
         where to_jsonb(m) ->> 'membership_id' is not null
            or to_jsonb(m) ->> 'plan_id' is not null
            or to_jsonb(m) ->> 'plan_name' is not null)
       || ' con plan'
order by 1;
