-- 0092 parte 2 de 2 — comprobación. Devuelve CUATRO filas; todas tienen que
-- decir OK. Cualquier otra cosa significa que la parte 1 no llegó entera.

select 'las tres columnas del bloqueo' as comprueba,
       case when (
         select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'customer'
            and column_name in ('blocked_reason', 'blocked_at', 'blocked_by')
       ) = 3 then 'OK' else 'FALTAN' end as resultado
union all
-- Sin el `check`, la aplicación puede exigir el motivo hoy y el día que
-- aparezca un segundo camino queda una ficha bloqueada que nadie sabe explicar.
select 'no se puede bloquear sin motivo',
       case when exists (
         select 1 from pg_constraint
          where conname = 'customer_blacklist_needs_reason'
       ) then 'OK' else 'FALTA' end
union all
-- Y que no haya quedado ninguna de antes sin motivo: si el `update` de la
-- parte 1 no corrió, el `check` tampoco habría entrado.
select 'ninguna ficha bloqueada sin motivo',
       case when not exists (
         select 1 from customer
          where status = 'blacklist'
            and (blocked_reason is null or btrim(blocked_reason) = '')
       ) then 'OK' else 'HAY FICHAS SIN MOTIVO' end
union all
select 'el índice de la lista',
       case when exists (
         select 1 from pg_indexes
          where schemaname = 'public' and indexname = 'customer_blacklist_idx'
       ) then 'OK' else 'FALTA' end;
