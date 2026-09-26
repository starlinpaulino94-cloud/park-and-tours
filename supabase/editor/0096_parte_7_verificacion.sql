-- 0096 · parte 7 de 7 — verificación
--
-- POR QUÉ ESTA MIGRACIÓN VA EN TROZOS Y LAS DEMÁS NO.
--
-- `dashboard_summary` son 20 kB de una sola sentencia: no se puede partir en
-- varias porque `create or replace function` es indivisible. El editor SQL de
-- Supabase trunca los pegados largos —ya pasó a los 7,3 kB, con «syntax error
-- at end of input» en la línea 0—, así que el texto de la función se deja en
-- una tabla auxiliar, trozo a trozo, y la última parte la ejecuta entera.
--
-- Las partes van EN ORDEN y ninguna se puede saltar. Si te paras a la mitad,
-- la función sigue siendo la de 0028 (correcta, solo que lenta) y la tabla
-- auxiliar se queda ahí: repetir desde la parte 1 la limpia.

-- Cinco filas. Cada una dice qué pasa si NO está bien.
select
  'la función existe'                                              as comprobacion,
  case when to_regprocedure(
         'public.dashboard_summary(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text,uuid,uuid,uuid,uuid,text,text,uuid)'
       ) is not null
       then 'sí' else 'FALTA — el panel no carga' end              as resultado
union all
select
  'ninguna CTE base arrastra la fila entera',
  case when coalesce(
         (select pg_get_functiondef(p.oid) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'dashboard_summary'), ''
       ) like '%select b.*,%'
       then 'SIGUE AHÍ el select b.* — no se aplicó 0096'
       else 'sí' end
union all
select
  'current_booking nombra sus columnas',
  case when coalesce(
         (select pg_get_functiondef(p.oid) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'dashboard_summary'), ''
       ) like '%b.status, b.booking_date, b.channel, b.product_id, b.seller_id%'
       then 'sí' else 'NO se aplicó 0096' end
union all
select
  'la tabla auxiliar quedó borrada',
  case when to_regclass('app.editor_sql_0096') is null
       then 'sí' else 'SIGUE AHÍ app.editor_sql_0096 — bórrala a mano' end
union all
select
  'los índices del panel siguen en su sitio',
  case when (select count(*) from pg_indexes
              where schemaname = 'public' and indexname like 'booking_dashboard_%') >= 6
       then 'sí' else 'FALTAN índices del panel: el panel filtrado iría por barrido' end;
