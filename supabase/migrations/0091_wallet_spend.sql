-- 0091 — El monedero se gasta con el cerrojo puesto.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA CARRERA, EN CUATRO LÍNEAS
--
-- Una venta a un socio prepago hace dos cosas, y entre las dos pasa tiempo:
--
--   1. `assertSaldo` lee el saldo y autoriza      ← al empezar la venta
--   2. `descontarVenta` apunta el consumo          ← cuando la venta ya existe
--
-- Con dos ventas a la vez del mismo socio, las dos leen el MISMO saldo en el
-- paso 1 —ninguna ve el consumo de la otra, que todavía no existe— y las dos
-- pasan. Con 100 de saldo y dos ventas de 80, se autorizan las dos y el socio
-- acaba en −60: la operadora prestó 160 de servicio contra un depósito de 100.
--
-- No hace falta mala fe ni concurrencia rara: dos mostradores del mismo tour
-- center vendiendo a la vez, que es lo normal un sábado.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ CIERRA ESTA FUNCIÓN, Y QUÉ NO
--
-- CIERRA que el saldo con el que se descuenta sea VIEJO. La suma se hace dentro
-- de la misma transacción que la escritura y detrás de un `for update` sobre el
-- socio, así que dos consumos del mismo socio se ponen en fila: el segundo ve
-- el primero ya escrito. Hoy el saldo se calcula en JavaScript sobre un `select`
-- que terminó hace rato.
--
-- NO cierra que dos ventas se autoricen a la vez en el paso 1. Eso solo se
-- arregla RESERVANDO el importe al autorizar, y este sistema decidió lo
-- contrario a propósito (`descontarVenta`: «descontar antes y que la saga se
-- compensara dejaría al socio pagando una reserva que no llegó a nacer»).
-- Cambiar esa decisión es una decisión de producto, no una corrección.
--
-- Lo que sí hace es que el descubierto DEJE DE SER INVISIBLE. Hoy el consumo se
-- apunta sin mirar y nadie se entera hasta que alguien suma el libro. La función
-- devuelve el saldo antes, el saldo después y si quedó en descubierto, y quien
-- llama lo grita y lo audita. Es la misma preferencia que ya tiene el módulo:
-- un descuadre VISIBLE antes que una reserva perdida con el turista delante.
--
-- Y sí impide dos cosas del todo:
--   · gastar en una moneda que no es la del monedero —la comprobación vivía
--     solo en la aplicación, y 0080 ya dice por qué eso no basta: «el día que
--     alguien inserte por SQL la aplicación no está delante»—;
--   · descontar dos veces la misma venta, que antes lo paraba el índice único
--     lanzando un error que `descontarVenta` se tragaba. Ahora es una respuesta:
--     «esta orden ya descontó, aquí tienes el movimiento».

create or replace function public.spend_partner_wallet(
  p_org      uuid,
  p_partner  uuid,
  p_movement jsonb
) returns jsonb
  language plpgsql security definer set search_path = public, app
as $fn$
declare
  v_movement  uuid;
  v_previo    record;
  v_moneda    text;
  v_antes     numeric := 0;
  v_despues   numeric := 0;
  v_amount    numeric := round(coalesce((p_movement ->> 'amount')::numeric, 0), 2);
  v_currency  text    := lower(coalesce(nullif(p_movement ->> 'currency', ''), ''));
  v_order     uuid    := nullif(p_movement ->> 'order_id', '')::uuid;
  v_booking   uuid    := nullif(p_movement ->> 'booking_id', '')::uuid;
  -- Mismo criterio que `retain_seller_commission` (0083) y
  -- `reserve_departure_capacity` (0017): sin JWT el llamante es el servidor.
  v_role text := coalesce(auth.jwt() ->> 'role', 'service_role');
begin
  -- FALLA CERRADA: esta función escribe dinero y se salta la RLS por ser
  -- `security definer`, así que el ámbito se comprueba aquí a mano.
  if v_role <> 'service_role'
     and (app.current_org_id() is null or app.current_org_id() <> p_org) then
    raise exception 'Ese monedero está fuera de tu organización'
      using errcode = 'insufficient_privilege';
  end if;

  if v_amount <= 0 then
    raise exception 'Un consumo del monedero tiene que ser mayor que cero'
      using errcode = 'check_violation';
  end if;

  -- ── EL CERROJO ──────────────────────────────────────────────────────────
  --
  -- Sobre la fila del socio, que es lo que todos los consumos suyos comparten.
  -- A partir de aquí, el segundo consumo de este socio espera: cuando entre,
  -- el primero ya está escrito y su suma lo incluye.
  --
  -- Se bloquea el SOCIO y no la tabla de movimientos porque lo que hay que
  -- serializar es «los gastos de este monedero», no «los gastos de todos».
  select lower(coalesce(o.currency, '')) into v_moneda
    from organizations o
   where o.id = p_partner
   for update;

  if not found then
    raise exception 'Ese socio no existe' using errcode = 'no_data_found';
  end if;

  -- ── LA MONEDA, EN LA BASE Y NO SOLO EN LA APLICACIÓN ────────────────────
  if v_moneda = '' then
    raise exception 'Ese socio no declara moneda: no se puede descontar de su saldo'
      using errcode = 'check_violation';
  end if;
  if v_currency <> '' and v_currency <> v_moneda then
    raise exception 'El monedero está en % y el consumo va en %', upper(v_moneda), upper(v_currency)
      using errcode = 'check_violation';
  end if;

  -- ── IDEMPOTENCIA: UNA VENTA DESCUENTA UNA VEZ ───────────────────────────
  --
  -- Lo mismo que hace el índice único de 0080, pero como RESPUESTA en vez de
  -- como error. Un reintento —la saga que vuelve a entrar, el doble clic—
  -- recibe el movimiento que ya había en vez de una excepción que alguien se
  -- traga. Con el cerrojo puesto, mirar y escribir aquí no tiene hueco.
  if v_order is not null then
    select m.id, m.amount into v_previo
      from partner_wallet_movement m
     where m.organization_id = p_org
       and m.order_id = v_order
       and m.movement_type = 'consumption'
     limit 1;
    if found then
      return jsonb_build_object(
        'movement_id', v_previo.id,
        'amount', v_previo.amount,
        'currency', v_moneda,
        'already', true
      );
    end if;
  end if;

  -- ── EL SALDO, SUMADO AQUÍ DENTRO ────────────────────────────────────────
  --
  -- El signo lo pone el TIPO, igual que en `monedero-socio.ts`, y en valor
  -- absoluto por lo mismo que el `check` de 0080: si una fila vieja trajera el
  -- importe negativo, tomarlo tal cual invertiría el movimiento.
  --
  -- Y solo de SU moneda. Sumar todas fue el fallo de la ola 9.3: una fila en
  -- pesos sumaba 30.000 a un saldo de dólares.
  --
  -- Un tipo que no esté en esta lista no suma ni resta, como en el módulo puro:
  -- contarlo a ciegas el día que alguien añada uno sería inventarse dinero.
  select coalesce(sum(
           case m.movement_type
             when 'topup'       then abs(m.amount)
             when 'refund'      then abs(m.amount)
             when 'consumption' then -abs(m.amount)
             when 'adjustment'  then -abs(m.amount)
             else 0
           end), 0)
    into v_antes
    from partner_wallet_movement m
   where m.organization_id = p_org
     and m.partner_id = p_partner
     and lower(coalesce(m.currency, '')) = v_moneda;

  v_despues := round(v_antes - v_amount, 2);

  insert into partner_wallet_movement (
    organization_id, partner_id, movement_type, amount, currency,
    order_id, booking_id, reference, note, created_by
  ) values (
    p_org, p_partner, 'consumption', v_amount, v_moneda,
    v_order, v_booking,
    nullif(p_movement ->> 'reference', ''),
    nullif(p_movement ->> 'note', ''),
    nullif(p_movement ->> 'created_by', '')::uuid
  )
  returning id into v_movement;

  -- El consumo se APUNTA aunque deje el saldo en negativo, y se avisa.
  --
  -- Negarse a escribirlo sería un libro que miente: el servicio ya se prestó y
  -- ese dinero se gastó. Lo que no puede pasar —y es lo que pasaba— es que no
  -- lo sepa nadie.
  return jsonb_build_object(
    'movement_id', v_movement,
    'amount', v_amount,
    'currency', v_moneda,
    'balance_before', v_antes,
    'balance_after', v_despues,
    'overdraft', v_despues < 0,
    'already', false
  );
end;
$fn$;

-- La llama el servidor con la llave de servicio. `anon` y `authenticated` no la
-- tocan: mueve dinero y se salta la RLS.
revoke execute on function public.spend_partner_wallet(uuid, uuid, jsonb)
  from anon, public, authenticated;
grant execute on function public.spend_partner_wallet(uuid, uuid, jsonb)
  to service_role;

comment on function public.spend_partner_wallet(uuid, uuid, jsonb) is
  'Descuenta una venta del monedero de un socio prepago sumando su saldo dentro '
  'de la misma transacción y detrás de un cerrojo sobre el socio (0091). '
  'Devuelve el saldo antes y después, y si quedó en descubierto.';
