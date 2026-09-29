-- 0100 · parte 2 de 3 — la devolución y los permisos
--
-- Pégalo ENTERO en el editor SQL de Supabase (Ctrl+A, Run). Aguanta ejecutarse
-- dos veces. Las tres partes van EN ORDEN.
--
-- QUÉ ARREGLA. Medido: treinta ventas simultáneas de una plaza contra un cupo
-- garantizado de 10 dejaban `seats_used` en 2, y las treinta pasaban. No es que
-- se pasara del tope: el contador se PERDÍA, y la matriz de cupos enseñaba
-- hueco libre donde el socio ya había vendido tres veces.

-- ───────────────────────────────────────────────────────────────────────────
-- LA DEVOLUCIÓN
--
-- Mismo problema por el otro lado: `releaseBookingAllotment` leía la fila y
-- escribía `max(0, leído - plazas)`. Dos cancelaciones a la vez devolvían una
-- sola plaza, y el socio se quedaba sin cupo que sí había pagado.
--
-- Nunca baja de cero: si alguien editó `seats_used` a mano por el camino, un
-- negativo aquí dejaría el cupo prometiendo plazas que no existen. Devuelve
-- cuántas se devolvieron DE VERDAD, que puede ser menos de las pedidas.
create or replace function public.release_allotment_seats(
  p_allotment uuid,
  p_pax       integer
) returns integer
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_devueltas integer;
begin
  if p_allotment is null or p_pax is null or p_pax <= 0 then
    return 0;
  end if;

  -- El valor VIEJO y el NUEVO en la misma sentencia.
  --
  -- `returning` en Postgres 15 entrega la fila ya escrita, así que desde ahí no
  -- se puede saber de cuánto se venía. Leerlo antes en otra sentencia
  -- reabriría la misma ventana que esta función viene a cerrar, así que las dos
  -- lecturas van dentro de una sola instrucción, y el `for update` serializa a
  -- quien llegue a la vez.
  with antes as (
    select coalesce(seats_used, 0) as viejo
      from allotment
     where id = p_allotment
       for update
  ), despues as (
    update allotment
       set seats_used = greatest(0, coalesce(seats_used, 0) - p_pax),
           updated_at = now()
     where id = p_allotment
    returning coalesce(seats_used, 0) as nuevo
  )
  select a.viejo - d.nuevo into v_devueltas from antes a, despues d;

  return coalesce(v_devueltas, 0);
end;
$$;

grant execute on function public.claim_allotment_seats(uuid, integer)   to authenticated, service_role;
grant execute on function public.release_allotment_seats(uuid, integer) to authenticated, service_role;
