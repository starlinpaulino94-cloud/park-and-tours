-- ═══════════════════════════════════════════════════════════════════════════
-- 0101 — LA CAJA: TRES COMPROBAR-Y-ACTUAR SOBRE DINERO (dimensión F)
--
-- ───────────────────────────────────────────────────────────────────────────
-- LO MEDIDO
--
-- Veinte aperturas simultáneas de la misma caja, por el camino que usa la
-- aplicación —leer si hay turno abierto, comprobar el rango y el dueño, crear
-- el turno—: **18 turnos abiertos sobre el mismo cajón**.
--
-- Dos turnos sobre un cajón no es un número mal puesto: los cobros se reparten
-- entre los dos según cuál lea cada petición, y al final del día NINGUNO de los
-- dos arqueos cuadra. El faltante de uno es el sobrante del otro y no hay forma
-- de saberlo desde la pantalla.
--
-- ───────────────────────────────────────────────────────────────────────────
-- Y DOS MÁS QUE SALIERON AL MIRAR
--
--  · CERRAR el turno: la ruta lee el estado, comprueba que sea `open`, y luego
--    escribe el conteo, el movimiento de cierre y el asiento del descuadre. Dos
--    cierres a la vez lo escribirían todo dos veces. **Hoy no pasa**, pero por
--    accidente: `cash_count_unique_idx` existe desde 0038 por una razón de
--    forma —un conteo de cierre por sesión y moneda— y el conteo se escribe
--    ANTES del movimiento, así que el segundo cierre muere ahí. Mover ese
--    `insert` dos líneas más abajo reabriría el agujero sin que nada avisara, y
--    quien cierra ve un error de clave duplicada en vez de «ya está cerrada».
--
--  · APROBAR el descuadre: esta no tiene defensa ninguna. Lee
--    `status = 'pending_approval'`, escribe `reconciled` y asienta la
--    diferencia en el libro. Dos aprobaciones a la vez **asientan el faltante
--    dos veces**, y lo único que lo impedía era `alreadyPosted`, que es una
--    lectura: las dos miran, las dos no encuentran nada, las dos escriben.
--
-- ───────────────────────────────────────────────────────────────────────────
-- LO QUE SE HACE
--
-- Nada de esto se arregla en la aplicación: comprobar-y-actuar sobre dos
-- peticiones no se arregla comprobando mejor. Van las tres a la base:
--
--  1. un índice único parcial que hace IMPOSIBLE un segundo turno abierto;
--  2. una transición de estado atómica, con el estado de partida explícito,
--     para cerrar y para aprobar;
--  3. y tres índices únicos que convierten `alreadyPosted` en una cortesía en
--     vez de en la única defensa del libro diario.
--
-- ───────────────────────────────────────────────────────────────────────────
-- SI YA HAY DATOS QUE LO INCUMPLEN, ESTO SE PARA
--
-- Un índice único no se puede crear sobre filas que ya lo violan. Podría
-- cerrar el turno más viejo y seguir, y no lo hace: **el sistema no puede
-- decidir cuál de dos cajones tiene el dinero**. Así que nombra los que
-- sobran y se detiene, para que alguien los cuadre a mano.
--
-- Antes de ejecutarla, `supabase/editor/0101_parte_1_antes.sql` los lista sin
-- tocar nada.
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ── 2 · LA TRANSICIÓN DE ESTADO, ATÓMICA ──────────────────────────────────
--
-- El estado de PARTIDA es un argumento y no se da por supuesto: así la misma
-- función sirve para cerrar (`open` → `closed`/`pending_approval`) y para
-- aprobar (`pending_approval` → `reconciled`/`open`) sin que ninguna de las dos
-- pueda saltarse un paso. Devuelve `false` cuando otro llegó primero, que es lo
-- que la ruta traduce a «ya está cerrada» en vez de a un error de la base.
create or replace function public.claim_cash_session_status(
  p_session   uuid,
  p_from      text,
  p_to        text,
  p_at        timestamptz default now(),
  p_by        uuid        default null
) returns boolean
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_ok boolean;
begin
  if p_session is null or p_from is null or p_to is null then
    raise exception 'La transición de un turno de caja necesita sesión, estado de partida y estado de llegada'
      using errcode = 'null_value_not_allowed';
  end if;
  if p_from = p_to then
    raise exception 'Una transición de % a sí mismo no transiciona nada', p_from
      using errcode = 'check_violation';
  end if;

  update cash_session
     set status = p_to,
         -- Se escriben aquí y no en un `update` aparte para que el turno no
         -- pueda quedar cerrado sin decir cuándo ni quién: es la mitad del
         -- expediente de un descuadre.
         closed_at = case when p_to in ('closed', 'pending_approval') then p_at else closed_at end,
         closed_by = case when p_to in ('closed', 'pending_approval') then coalesce(p_by, closed_by) else closed_by end,
         approved_at = case when p_to = 'reconciled' then p_at else approved_at end,
         approved_by = case when p_to = 'reconciled' then coalesce(p_by, approved_by) else approved_by end,
         updated_at = now()
   where id = p_session
     and status = p_from
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

grant execute on function public.claim_cash_session_status(uuid, text, text, timestamptz, uuid)
  to authenticated, service_role;

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
