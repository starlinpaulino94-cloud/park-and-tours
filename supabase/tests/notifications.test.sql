-- ============================================================================
-- Prueba de las notificaciones internas (0044).
--
-- Lo que se comprueba aquí es lo único que la aplicación NO puede garantizar
-- sola: que dos instancias escribiendo el mismo aviso a la vez dejen una sola
-- fila. Un `select` previo desde la aplicación no lo impide —las dos verían la
-- tabla vacía—, y el resultado sería una bandeja con copias que nadie vuelve a
-- abrir.
--
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;
set local session_replication_role = replica;  -- sin disparadores de FK/tenant

\set org '11111111-1111-1111-1111-111111111111'

do $$
declare
  fallos text[] := '{}';
  n integer;
begin
  -- ── el dedupe ────────────────────────────────────────────────────────────
  insert into notification (organization_id, title, notification_type, event_key, dedupe_key)
  values ('11111111-1111-1111-1111-111111111111', 'Cobro vencido', 'payment',
          'receivable_overdue', 'receivable_overdue:r1:-:-');

  begin
    insert into notification (organization_id, title, notification_type, event_key, dedupe_key)
    values ('11111111-1111-1111-1111-111111111111', 'Cobro vencido', 'payment',
            'receivable_overdue', 'receivable_overdue:r1:-:-');
    fallos := fallos || 'el mismo aviso se escribió dos veces';
  exception when unique_violation then
    null;  -- es lo que tiene que pasar
  end;

  -- ── otra empresa no compite por la clave ─────────────────────────────────
  -- Sin la organización en el índice, el aviso de una empresa silenciaría el de
  -- otra: el peor fallo posible en un sistema multiempresa.
  insert into notification (organization_id, title, notification_type, event_key, dedupe_key)
  values ('22222222-2222-2222-2222-222222222222', 'Cobro vencido', 'payment',
          'receivable_overdue', 'receivable_overdue:r1:-:-');

  -- ── los avisos sin clave no compiten entre sí ────────────────────────────
  insert into notification (organization_id, title, notification_type)
  values ('11111111-1111-1111-1111-111111111111', 'Aviso suelto', 'info'),
         ('11111111-1111-1111-1111-111111111111', 'Otro aviso suelto', 'info');

  select count(*) into n from notification
   where organization_id = '11111111-1111-1111-1111-111111111111';
  if n <> 3 then
    fallos := fallos || format('se esperaban 3 avisos y hay %s', n);
  end if;

  -- ── el rol de destino está acotado ───────────────────────────────────────
  begin
    insert into notification (organization_id, title, notification_type, audience_role)
    values ('11111111-1111-1111-1111-111111111111', 'Rol inventado', 'info', 'jefe_supremo');
    fallos := fallos || 'se aceptó un rol de destino que no existe';
  exception when check_violation then
    null;
  end;

  -- ── un rol real sí entra ─────────────────────────────────────────────────
  insert into notification (organization_id, title, notification_type, audience_role)
  values ('11111111-1111-1111-1111-111111111111', 'Para gerencia', 'alert', 'manager');

  if array_length(fallos, 1) is null then
    raise notice 'notificaciones: TODAS LAS ASERCIONES PASARON';
  else
    raise exception 'notificaciones: %', array_to_string(fallos, ' | ');
  end if;
end $$;

rollback;
