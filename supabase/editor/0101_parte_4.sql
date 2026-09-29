-- 0101 · parte 4 de 5 — los candados del libro diario
--
-- Pégalo ENTERO en el editor SQL de Supabase (Ctrl+A, Run). Aguanta ejecutarse
-- dos veces. Las cinco partes van EN ORDEN.
--
-- QUÉ ARREGLA. Medido: veinte aperturas simultáneas de la misma caja dejaban 18
-- TURNOS ABIERTOS sobre el mismo cajón —los cobros se reparten entre los dos y
-- ninguno de los arqueos cuadra—. Y aprobar el descuadre no tenía defensa
-- ninguna: el mismo faltante se asentó VEINTE veces en el libro diario.
--
-- OJO CON LA PARTE 2: si ya hay cajas con más de un turno abierto, se detiene y
-- los nombra. No elige cuál cerrar a propósito: el sistema no puede decidir cuál
-- de dos cajones tiene el dinero. Ejecuta primero la parte 1, que solo mira.

-- ── 3 · EL LIBRO DIARIO NO ASIENTA DOS VECES LO MISMO ─────────────────────
--
-- `alreadyPosted` pregunta si ya hay un asiento de esa fuente para esa fila.
-- Es una LECTURA: dos peticiones a la vez preguntan las dos, no encuentran
-- nada las dos, y escriben las dos. Y no había nada detrás.
--
-- La clave lleva `line_no` porque un asiento son varias filas —un cargo y un
-- abono—: sin él, el propio asiento choca consigo mismo. Con él, el SEGUNDO
-- asiento choca en su primera línea y no llega a escribirse.
--
-- Son tres índices y no uno porque cada fuente cuelga de una columna distinta,
-- y un índice sobre una columna nula no restringe nada (los nulos son todos
-- distintos entre sí).
do $$
declare
  v_dup text;
begin
  select string_agg(txt, '; ') into v_dup from (
    select format('%s x%s sobre el cobro %s', source_type, count(*), payment_id) as txt
      from ledger_entry
     where payment_id is not null
     group by organization_id, source_type, payment_id, line_no
    having count(*) > 1
    union all
    select format('%s x%s sobre la liquidación %s', source_type, count(*), settlement_id)
      from ledger_entry
     where settlement_id is not null
     group by organization_id, source_type, settlement_id, line_no
    having count(*) > 1
    union all
    select format('%s x%s sobre el turno de caja %s', source_type, count(*), cash_session_id)
      from ledger_entry
     where cash_session_id is not null
     group by organization_id, source_type, cash_session_id, line_no
    having count(*) > 1
  ) d;

  if v_dup is not null then
    raise exception 'El libro diario ya tiene asientos repetidos y hay que reversarlos antes de poner el candado: %', v_dup
      using hint = 'Reversa los asientos duplicados (reversed = true) o bórralos, y vuelve a ejecutar esta migración';
  end if;
end $$;

create unique index if not exists ledger_entry_una_vez_por_cobro_idx
  on ledger_entry (organization_id, source_type, payment_id, line_no)
  where payment_id is not null;

create unique index if not exists ledger_entry_una_vez_por_liquidacion_idx
  on ledger_entry (organization_id, source_type, settlement_id, line_no)
  where settlement_id is not null;

create unique index if not exists ledger_entry_una_vez_por_turno_idx
  on ledger_entry (organization_id, source_type, cash_session_id, line_no)
  where cash_session_id is not null;
