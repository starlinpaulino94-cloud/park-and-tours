-- 0101 · parte 2 de 5 — el candado de un solo turno abierto por caja
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

-- ── 1 · UN SOLO TURNO ABIERTO POR CAJA ────────────────────────────────────
do $$
declare
  v_sobran text;
begin
  select string_agg(format('caja %s: %s turnos abiertos', cash_register_id, n), '; ')
    into v_sobran
    from (
      select cash_register_id, count(*) as n
        from cash_session
       where status = 'open' and cash_register_id is not null
       group by organization_id, cash_register_id
      having count(*) > 1
    ) d;

  if v_sobran is not null then
    raise exception
      'Hay cajas con más de un turno abierto y hay que cuadrarlas a mano antes de poner el candado: %',
      v_sobran
      using hint = 'Cierra los turnos que sobren desde Caja y vuelve a ejecutar esta migración';
  end if;
end $$;

-- `organization_id` va dentro aunque el identificador de la caja ya sea único:
-- el índice es el que sirve la consulta «¿tiene turno abierto esta caja?», y sin
-- la empresa delante no la aprovecha.
create unique index if not exists cash_session_un_turno_abierto_idx
  on cash_session (organization_id, cash_register_id)
  where status = 'open' and cash_register_id is not null;
