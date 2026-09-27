-- 0096 · parte 1 de 7 — preparar la tabla auxiliar
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

-- Tabla NORMAL a propósito: la conexión del editor es agrupada y una temporal
-- se perdería entre pegado y pegado. La parte final la borra. Si el editor le
-- inyecta su `enable row level security`, da igual: solo la toca el propietario
-- y no sobrevive a esta migración.
create table if not exists app.editor_sql_0096 (
  n   integer primary key,
  txt text not null
);

delete from app.editor_sql_0096;

select 'tabla auxiliar lista, sigue con la parte 2' as siguiente;
