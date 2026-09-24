-- 0086 · parte 1 de 2 — La fecha del servicio en el recurso y en la ruta.
--
-- Pégalo entero en el editor SQL de Supabase y ejecútalo. Luego la parte 2.
--
-- QUÉ HACE
--  · `service_date` en `departure_resource` y `pickup_route`. Hoy esas filas no
--    saben CUÁNDO son: la fecha vive en la salida, tabla unida, y la capa de
--    consulta no sabe filtrar ni ordenar por ahí. Lo que se hace sin ella es
--    pedir quinientas filas y filtrar en memoria — funciona hasta la fila
--    quinientos uno, que desaparece sin que nada avise.
--  · Sus índices, para el portal del proveedor.
--
-- NO borra ni cambia ninguna fila.

alter table departure_resource
  add column if not exists service_date timestamptz;
alter table pickup_route
  add column if not exists service_date timestamptz;

comment on column departure_resource.service_date is
  'Cuándo es este servicio, copiado de `departure.departure_at` (0086). Vive '
  'aquí porque es donde se filtra y se ordena; la capa de consulta no sabe '
  'hacerlo por columna de una tabla unida.';

create index if not exists departure_resource_service_date_idx
  on departure_resource (organization_id, supplier_id, service_date desc);
create index if not exists pickup_route_service_date_idx
  on pickup_route (organization_id, supplier_id, service_date desc);

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('departure_resource','pickup_route')
   and column_name = 'service_date'
 order by table_name;
