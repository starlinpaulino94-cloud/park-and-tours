-- 0101 · parte 5 de 5 — verificación.
--
-- Seis filas. Cada una dice qué pasa si NO está bien.

select 'una caja no admite dos turnos abiertos' as comprobacion,
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public'
                            and indexname = 'cash_session_un_turno_abierto_idx')
            then 'ok' else 'FALTA: dos cajeros pueden abrir el mismo cajón y ningún arqueo cuadrará' end as resultado
union all
-- Un índice NO único no restringe nada: comprueba que de verdad sea único.
select 'y el candado es único, no un índice cualquiera',
       case when exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                          where c.relname = 'cash_session_un_turno_abierto_idx' and i.indisunique)
            then 'ok' else 'FALTA: el índice existe pero no impide nada' end
union all
select 'existe la transición atómica del turno',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'claim_cash_session_status')
            then 'ok' else 'FALTA: cerrar y aprobar siguen siendo comprobar-y-actuar' end
union all
-- Sin el estado de partida dentro del `where`, la función escribe siempre y
-- deja de serializar: es la línea entera de la que depende.
select 'la transición exige el estado de partida',
       case when (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'claim_cash_session_status')
                 like '%and status = p_from%'
            then 'ok' else 'FALTA: la transición no comprueba de dónde viene y deja pasar a todos' end
union all
select 'el libro diario no asienta dos veces lo mismo',
       case when (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
                   where c.relname in ('ledger_entry_una_vez_por_cobro_idx',
                                       'ledger_entry_una_vez_por_liquidacion_idx',
                                       'ledger_entry_una_vez_por_turno_idx')
                     and i.indisunique) = 3
            then 'ok' else 'FALTA: un descuadre o un cobro se pueden contabilizar dos veces' end
union all
select 'quien cierra la caja puede llamar a la transición',
       case when exists (select 1 from information_schema.role_routine_grants
                          where routine_schema = 'public'
                            and routine_name = 'claim_cash_session_status'
                            and grantee in ('authenticated', 'service_role'))
            then 'ok' else 'FALTA: sin permiso, cerrar un turno fallará siempre' end;
