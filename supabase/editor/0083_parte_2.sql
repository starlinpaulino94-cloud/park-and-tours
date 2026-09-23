-- 0083 · parte 2 de 2 — La función que escribe las dos cosas a la vez.
--
-- Ejecuta la parte 1 ANTES que esta. Pégalo entero y ejecútalo.
--
-- Inserta la comisión YA cobrada y el movimiento de caja que la saca del
-- cajón, en la MISMA transacción. En dos pasos hay dos finales malos: si se
-- apunta el movimiento y falla la comisión, el vendedor se llevó su dinero y
-- la comisión sigue en `pending`, entra en la liquidación del mes y se le paga
-- OTRA VEZ; si se marca la comisión y falla el movimiento, el arqueo cuadra de
-- menos y el vendedor aparece debiendo lo que ya era suyo.
--
-- NO borra ni cambia ninguna fila.

create or replace function public.retain_seller_commission(
  p_org          uuid,
  p_cash_session uuid,
  p_user         uuid,
  p_commission   jsonb
) returns jsonb
  language plpgsql security definer set search_path = public, app
as $fn$
declare
  v_commission uuid;
  v_movement   uuid;
  v_partner    uuid;
  v_session    record;
  v_previo     record;
  v_booking    uuid    := nullif(p_commission ->> 'booking_id', '')::uuid;
  v_seller     uuid    := nullif(p_commission ->> 'seller_id', '')::uuid;
  v_amount     numeric := coalesce((p_commission ->> 'amount')::numeric, 0);
  v_currency   text    := coalesce(nullif(p_commission ->> 'currency', ''), 'usd');
  -- Sin JWT (el servidor llamando directo) el llamante es de confianza; con
  -- JWT, el claim distingue service_role de un usuario cualquiera. Mismo
  -- criterio que `reserve_departure_capacity` desde 0017.
  v_role text := coalesce(auth.jwt() ->> 'role', 'service_role');
begin
  -- FALLA CERRADA: esta función escribe dinero y se salta la RLS por ser
  -- `security definer`, así que el ámbito se comprueba aquí a mano.
  if v_role <> 'service_role'
     and (app.current_org_id() is null or app.current_org_id() <> p_org) then
    raise exception 'La venta está fuera de tu organización'
      using errcode = 'insufficient_privilege';
  end if;

  if v_amount <= 0 then
    raise exception 'La comisión retenida tiene que ser mayor que cero'
      using errcode = 'check_violation';
  end if;
  if v_booking is null or v_seller is null then
    raise exception 'Falta la reserva o el vendedor de la comisión retenida'
      using errcode = 'check_violation';
  end if;

  -- El turno tiene que existir, estar ABIERTO y ser de este vendedor. Retener
  -- contra un turno cerrado mete un movimiento en un arqueo ya firmado.
  --
  -- El `for update` además SERIALIZA: dos peticiones a la vez del mismo
  -- vendedor —el doble clic de siempre— esperan aquí una a otra, y la segunda
  -- encuentra ya escrita la retención de la primera.
  select cs.id, cs.partner_id, cs.seller_id, cs.status
    into v_session
    from cash_session cs
   where cs.id = p_cash_session and cs.organization_id = p_org
   for update;

  if not found then
    raise exception 'No hay turno de caja para retener la comisión'
      using errcode = 'no_data_found';
  end if;
  if v_session.status <> 'open' then
    raise exception 'El turno de caja está cerrado' using errcode = 'check_violation';
  end if;
  if v_session.seller_id is distinct from v_seller then
    raise exception 'Ese turno de caja es de otro vendedor'
      using errcode = 'insufficient_privilege';
  end if;
  v_partner := v_session.partner_id;

  -- ── IDEMPOTENTE: UNA RESERVA SE RETIENE UNA VEZ ─────────────────────────
  --
  -- Un reintento devuelve lo que ya había en vez de sacar el dinero otra vez.
  -- Se mira la comisión y su movimiento juntos: una comisión retenida sin su
  -- movimiento no puede existir —esta función las escribe a la vez—, así que
  -- encontrar una sin el otro significa que alguien la escribió por fuera, y
  -- entonces lo honesto es parar y no tapar el descuadre con otro apunte.
  select c.id as commission_id, m.id as movement_id
    into v_previo
    from commission c
    left join cash_movement m
      on m.commission_id = c.id and m.organization_id = c.organization_id
   where c.organization_id = p_org
     and c.booking_id = v_booking
     and c.seller_id = v_seller
     and c.beneficiary_type = 'seller'
     and c.status = 'paid'
   limit 1;

  if found then
    if v_previo.movement_id is null then
      raise exception 'Hay una comisión ya cobrada sin su movimiento de caja; revísala antes de retener'
        using errcode = 'check_violation';
    end if;
    return jsonb_build_object(
      'commission_id', v_previo.commission_id,
      'movement_id', v_previo.movement_id,
      'amount', v_amount,
      'already', true
    );
  end if;

  -- ── LAS DOS INSERCIONES, EN LA MISMA TRANSACCIÓN ────────────────────────
  --
  -- La comisión NACE en `paid`. No se crea en `pending` para actualizarla
  -- después: eso son otra vez dos pasos, y el hueco entre ellos es por donde se
  -- cuela la liquidación del mes que la paga por segunda vez.
  insert into commission (
    organization_id, booking_id, order_id, seller_id, partner_id,
    beneficiary_type, beneficiary_name, calc_type, base_amount, percentage,
    amount, currency, status, service_date, generated_at, snapshot
  ) values (
    p_org,
    v_booking,
    nullif(p_commission ->> 'order_id', '')::uuid,
    v_seller,
    v_partner,
    'seller',
    coalesce(nullif(p_commission ->> 'beneficiary_name', ''), 'Vendedor'),
    coalesce(nullif(p_commission ->> 'calc_type', ''), 'percentage')::calc_type,
    coalesce((p_commission ->> 'base_amount')::numeric, 0),
    coalesce((p_commission ->> 'percentage')::numeric, 0),
    v_amount,
    v_currency::currency,
    'paid',
    nullif(p_commission ->> 'service_date', '')::timestamptz,
    now(),
    p_commission -> 'snapshot'
  )
  returning id into v_commission;

  -- Y el movimiento que saca ese dinero del cajón: el vendedor se lo queda.
  -- `withdrawal` y no un `sale` negativo — el cobro del turista ya entró como
  -- venta por su camino normal, y esto es la parte que no se entrega. Así el
  -- turno cuadra: entró el depósito, salió la comisión, y lo que queda por
  -- entregar es la diferencia.
  insert into cash_movement (
    organization_id, cash_session_id, user_id, partner_id, seller_id,
    commission_id, movement_type, amount, currency, concept, movement_at
  ) values (
    p_org, p_cash_session, p_user, v_partner, v_seller,
    v_commission, 'withdrawal', v_amount, v_currency::currency,
    'Comisión retenida por el vendedor', now()
  )
  returning id into v_movement;

  return jsonb_build_object(
    'commission_id', v_commission,
    'movement_id', v_movement,
    'amount', v_amount,
    'already', false
  );
end;
$fn$;

-- La escribe el servidor con la llave de servicio. `anon` y `authenticated` no
-- la tocan: es una función que mueve dinero y se salta la RLS.
revoke execute on function public.retain_seller_commission(uuid, uuid, uuid, jsonb)
  from anon, public, authenticated;
grant execute on function public.retain_seller_commission(uuid, uuid, uuid, jsonb)
  to service_role;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- La función tiene que existir y NO ser llamable por anon ni authenticated.
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as usuario,
       has_function_privilege('service_role', p.oid, 'execute')  as servidor
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'retain_seller_commission';
