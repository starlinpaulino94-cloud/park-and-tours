-- 0083 · parte 1 de 2 — El vínculo entre la comisión y su movimiento de caja.
--
-- Pégalo entero en el editor SQL de Supabase y ejecútalo. Luego la parte 2.
--
-- QUÉ HACE
--  · `cash_movement.commission_id`: qué comisión retiene este movimiento.
--  · Su índice único, que es lo que impide retirar dos veces la misma.
--
-- NO borra ni cambia ninguna fila.

alter table cash_movement
  add column if not exists commission_id uuid references commission(id) on delete set null;

comment on column cash_movement.commission_id is
  'La comisión que este movimiento retiene (0083). Con el índice único de '
  'abajo, una comisión se retira UNA vez: un reintento devuelve lo que ya '
  'había en vez de sacar el dinero otra vez.';

create unique index if not exists cash_movement_commission_once_idx
  on cash_movement (organization_id, commission_id)
  where commission_id is not null;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Tienen que salir la columna y el índice único.
select 'columna' as que, count(*) as existe
  from information_schema.columns
 where table_schema = 'public' and table_name = 'cash_movement'
   and column_name = 'commission_id'
union all
select 'indice unico', count(*)
  from pg_indexes
 where tablename = 'cash_movement'
   and indexname = 'cash_movement_commission_once_idx';
