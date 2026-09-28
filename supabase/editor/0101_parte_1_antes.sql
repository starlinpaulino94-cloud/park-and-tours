-- 0101 · parte 1 de 5 — qué hay que cuadrar a mano ANTES (no toca nada)
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

select 'cajas con más de un turno abierto' as comprobacion,
       coalesce(string_agg(format('caja %s: %s turnos', cash_register_id, n), '; '), 'ninguna — se puede seguir') as resultado
  from (
    select cash_register_id, count(*) as n
      from cash_session
     where status = 'open' and cash_register_id is not null
     group by organization_id, cash_register_id
    having count(*) > 1
  ) d
union all
select 'asientos repetidos en el libro diario',
       coalesce(string_agg(txt, '; '), 'ninguno — se puede seguir')
  from (
    select format('%s x%s sobre el cobro %s', source_type, count(*), payment_id) as txt
      from ledger_entry where payment_id is not null
     group by organization_id, source_type, payment_id, line_no having count(*) > 1
    union all
    select format('%s x%s sobre la liquidación %s', source_type, count(*), settlement_id)
      from ledger_entry where settlement_id is not null
     group by organization_id, source_type, settlement_id, line_no having count(*) > 1
    union all
    select format('%s x%s sobre el turno de caja %s', source_type, count(*), cash_session_id)
      from ledger_entry where cash_session_id is not null
     group by organization_id, source_type, cash_session_id, line_no having count(*) > 1
  ) d;
