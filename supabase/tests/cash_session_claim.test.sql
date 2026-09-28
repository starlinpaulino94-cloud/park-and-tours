-- ============================================================================
-- 0101 — LA TRANSICIÓN DE UN TURNO DE CAJA SE RECLAMA UNA VEZ.
--
-- Lo medido: veinte aperturas simultáneas de la misma caja dejaban 18 turnos
-- abiertos sobre el mismo cajón. Y aprobar el descuadre no tenía defensa
-- ninguna: con las dos que añade esta migración fuera, el mismo faltante se
-- asentó VEINTE veces en el libro diario.
--
-- La carrera de verdad —procesos en paralelo— vive en `scripts/db-test.sh`.
-- Aquí se sujeta la función: que el estado de partida decida, que no se pueda
-- saltar un paso, y que quien llega segundo reciba `false` y no una excepción
-- que alguien se trague.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/cash_session_claim.test.sql
-- Transaccional: hace rollback, no deja datos.
-- ============================================================================
begin;

\set org '02000000-0000-0000-0000-0000000000b0'
\set reg '02000000-0000-0000-0000-0000000000b1'
\set ses '02000000-0000-0000-0000-0000000000b2'

insert into organizations (id, name, kind) values (:'org', 'Operadora', 'tenant');
insert into cash_register (id, organization_id, name, currency, status)
  values (:'reg', :'org', 'Mostrador', 'usd', 'active');

do $$
declare
  org    uuid := '02000000-0000-0000-0000-0000000000b0';
  reg    uuid := '02000000-0000-0000-0000-0000000000b1';
  ses    uuid := '02000000-0000-0000-0000-0000000000b2';
  fallos text := '';
  ok     boolean;
begin
  insert into cash_session (id, organization_id, cash_register_id, opening_amount, currency, status, code)
    values (ses, org, reg, 100, 'usd', 'open', 'CJ-TEST');

  -- ── UNA CAJA, UN TURNO ABIERTO ──────────────────────────────────────────
  -- Dos turnos sobre un cajón reparten los cobros entre los dos y ninguno de
  -- los arqueos cuadra: el faltante de uno es el sobrante del otro.
  begin
    insert into cash_session (organization_id, cash_register_id, opening_amount, currency, status, code)
      values (org, reg, 50, 'usd', 'open', 'CJ-TEST-2');
    fallos := fallos || 'se abrió un segundo turno sobre la misma caja; '::text;
  exception when unique_violation then null;
  end;

  -- Cerrado el primero, el siguiente turno sí se puede abrir: el candado es
  -- sobre los ABIERTOS, no sobre la historia de la caja.
  update cash_session set status = 'closed' where id = ses;
  begin
    insert into cash_session (organization_id, cash_register_id, opening_amount, currency, status, code)
      values (org, reg, 50, 'usd', 'open', 'CJ-TEST-3');
  exception when others then
    fallos := fallos || format('el candado impide abrir el turno siguiente: %s; ', sqlerrm);
  end;
  delete from cash_session where code = 'CJ-TEST-3';
  update cash_session set status = 'open' where id = ses;

  -- ── LA TRANSICIÓN, UNA SOLA VEZ ─────────────────────────────────────────
  ok := public.claim_cash_session_status(ses, 'open', 'pending_approval', now(), null);
  if ok is not true then fallos := fallos || 'no dejó cerrar un turno abierto; '::text; end if;
  if (select status from cash_session where id = ses) <> 'pending_approval' then
    fallos := fallos || 'el estado no cambió; '::text;
  end if;
  -- Y deja el expediente: un turno cerrado sin decir cuándo no se puede revisar.
  if (select closed_at from cash_session where id = ses) is null then
    fallos := fallos || 'cerró el turno sin apuntar cuándo; '::text;
  end if;

  -- El segundo intento recibe `false`. No una excepción: quien llega segundo
  -- tiene que poder decir «ya está cerrada» y no un error de la base.
  ok := public.claim_cash_session_status(ses, 'open', 'pending_approval', now(), null);
  if ok is not false then
    fallos := fallos || 'la MISMA transición se pudo reclamar dos veces; '::text;
  end if;

  -- ── NO SE PUEDE SALTAR UN PASO ──────────────────────────────────────────
  -- El estado de partida es un argumento y no se da por supuesto: sin él,
  -- aprobar un turno que nadie cerró sería posible.
  ok := public.claim_cash_session_status(ses, 'open', 'reconciled', now(), null);
  if ok is not false then
    fallos := fallos || 'aprobó un turno partiendo de un estado que no tenía; '::text;
  end if;

  -- Desde el estado que SÍ tiene, sí.
  ok := public.claim_cash_session_status(ses, 'pending_approval', 'reconciled', now(), null);
  if ok is not true then fallos := fallos || 'no dejó aprobar lo que estaba en revisión; '::text; end if;
  if (select approved_at from cash_session where id = ses) is null then
    fallos := fallos || 'aprobó sin apuntar cuándo; '::text;
  end if;
  -- Y no borra lo del cierre al aprobar: son dos momentos y dos firmas.
  if (select closed_at from cash_session where id = ses) is null then
    fallos := fallos || 'aprobar borró la fecha de cierre; '::text;
  end if;

  -- ── LO QUE NO ES UNA TRANSICIÓN ─────────────────────────────────────────
  begin
    ok := public.claim_cash_session_status(ses, 'reconciled', 'reconciled', now(), null);
    fallos := fallos || 'admitió una transición de un estado a sí mismo; '::text;
  exception when check_violation then null;
  end;
  begin
    ok := public.claim_cash_session_status(null, 'open', 'closed', now(), null);
    fallos := fallos || 'admitió una transición sin turno; '::text;
  exception when null_value_not_allowed then null;
  end;

  -- Un turno que no existe no es un error: es uno que alguien borró mientras se
  -- cerraba. No se reclama, y ya está.
  ok := public.claim_cash_session_status('02000000-0000-0000-0000-0000000face0'::uuid, 'open', 'closed', now(), null);
  if ok is not false then fallos := fallos || 'reclamó un turno inexistente; '::text; end if;

  -- ── EL LIBRO NO ASIENTA DOS VECES EL MISMO DESCUADRE ────────────────────
  insert into ledger_account (organization_id, code, name, account_type)
    values (org, '5206', 'Faltantes de caja', 'expense');
  insert into ledger_entry (organization_id, source_type, cash_session_id, line_no,
                            ledger_account_id, debit, currency, posted_at)
    select org, 'cash_close', ses, 1, id, 25, 'usd', now()
      from ledger_account where organization_id = org and code = '5206';
  begin
    insert into ledger_entry (organization_id, source_type, cash_session_id, line_no,
                              ledger_account_id, debit, currency, posted_at)
      select org, 'cash_close', ses, 1, id, 25, 'usd', now()
        from ledger_account where organization_id = org and code = '5206';
    fallos := fallos || 'el mismo descuadre se asentó dos veces en el libro; '::text;
  exception when unique_violation then null;
  end;
  -- La segunda LÍNEA del mismo asiento sí, que es el abono: sin `line_no` en la
  -- clave, el asiento chocaría consigo mismo.
  begin
    insert into ledger_entry (organization_id, source_type, cash_session_id, line_no,
                              ledger_account_id, credit, currency, posted_at)
      select org, 'cash_close', ses, 2, id, 25, 'usd', now()
        from ledger_account where organization_id = org and code = '5206';
  exception when others then
    fallos := fallos || format('el asiento no pudo escribir su segunda línea: %s; ', sqlerrm);
  end;

  if fallos <> '' then
    raise exception 'cash_session 0101 FALLÓ: %', fallos;
  end if;
  raise notice 'cash_session 0101: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
