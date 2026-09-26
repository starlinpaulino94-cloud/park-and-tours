-- 0096 · parte 6 de 7 — montar y ejecutar la función
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

-- Si falta algún trozo, esto para aquí en vez de crear media función.
do $montar$
declare
  v_faltan integer;
  v_sql    text;
begin
  select 4 - count(*) into v_faltan from app.editor_sql_0096;
  if v_faltan <> 0 then
    raise exception 'Faltan % trozos: vuelve a la parte 2 y sigue en orden', v_faltan;
  end if;
  select string_agg(txt, '' order by n) into v_sql from app.editor_sql_0096;
  execute v_sql;
end $montar$;

drop table app.editor_sql_0096;

revoke execute on function public.dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text, text, uuid, uuid, uuid, uuid, text, text, uuid) from anon, public;
grant execute on function public.dashboard_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text, text, uuid, uuid, uuid, uuid, text, text, uuid) to authenticated, service_role;

select 'función montada, sigue con la verificación' as siguiente;
