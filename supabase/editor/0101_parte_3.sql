-- 0101 · parte 3 de 5 — la transición de estado atómica
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
