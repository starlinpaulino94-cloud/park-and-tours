-- ============================================================================
-- Prueba de `departure_pax_totals` (0094).
--
-- Esta función es la que decide si cabe una venta más, así que lo que se
-- comprueba aquí no se puede comprobar sin base de datos:
--
--  · que sume TODAS las reservas y no las primeras mil —que era el fallo—;
--  · que no sepa qué es una reserva confirmada: suma lo que le digan, porque
--    esa regla vive en la aplicación y no puede tener dos copias;
--  · que una reserva con `pax_total` nulo cuente como CERO plazas y no se
--    caiga de la suma;
--  · que una salida que no existe devuelva `found: false` y NO ceros, porque
--    ceros querrían decir «caben todos» sobre algo que no está;
--  · y que no la pueda llamar un usuario cualquiera, porque se salta la RLS.
--
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

do $$
declare
  fallos   text[] := '{}';
  v_org    uuid;
  v_org2   uuid;
  v_prod   uuid;
  v_dep    uuid;
  v_otra   uuid;
  v_ord    uuid;
  res      jsonb;
  confirm  text[] := array['confirmed','partially_paid','paid','checked_in','completed'];
  pend     text[] := array['pending','pending_payment'];
begin
  insert into organizations (name, kind) values ('Prueba 0094', 'tenant') returning id into v_org;
  insert into organizations (name, kind) values ('Otra 0094', 'tenant') returning id into v_org2;
  insert into product (organization_id, name, base_price)
    values (v_org, 'Entrada general', 25) returning id into v_prod;
  insert into departure (organization_id, product_id, departure_at, capacity)
    values (v_org, v_prod, now() + interval '2 days', 2000) returning id into v_dep;
  insert into departure (organization_id, product_id, departure_at, capacity)
    values (v_org, v_prod, now() + interval '3 days', 50) returning id into v_otra;
  -- `booking.order_id` es `not null`: una reserva cuelga siempre de una venta.
  insert into sales_order (organization_id, order_number, status)
    values (v_org, 'ORD-0094', 'pending_payment') returning id into v_ord;

  -- ── LA SUMA PASA DE MIL ──────────────────────────────────────────────────
  -- 1 500 reservas de 2 plazas confirmadas = 3 000 plazas. Con el tope de mil
  -- de la versión anterior salían 2 000, así que la salida decía tener sitio
  -- para mil personas que no caben.
  -- `booking_number` es `not null` sin valor por defecto: sin nombrarlo, este
  -- insert no entra y la prueba no llega a correr ni una vez.
  insert into booking (organization_id, departure_id, product_id, status, pax_total, booking_date, booking_number, order_id)
  select v_org, v_dep, v_prod, 'paid', 2, now(), 'C-'||g, v_ord from generate_series(1, 1500) g;

  -- Y 300 pendientes de 1 plaza.
  insert into booking (organization_id, departure_id, product_id, status, pax_total, booking_date, booking_number, order_id)
  select v_org, v_dep, v_prod, 'pending', 1, now(), 'P-'||g, v_ord from generate_series(1, 300) g;

  res := public.departure_pax_totals(v_org, v_dep, confirm, pend);

  if (res ->> 'found')::boolean is not true then
    fallos := fallos || 'la salida existe y dice que no';
  end if;
  if (res ->> 'booked')::integer is distinct from 3000 then
    fallos := fallos || format('confirmadas: esperaba 3000 y dio %s (¿volvió el tope?)', res ->> 'booked');
  end if;
  if (res ->> 'pending')::integer is distinct from 300 then
    fallos := fallos || format('pendientes: esperaba 300 y dio %s', res ->> 'pending');
  end if;
  if (res ->> 'capacity')::integer is distinct from 2000 then
    fallos := fallos || format('capacidad: esperaba 2000 y dio %s', res ->> 'capacity');
  end if;

  -- ── LO QUE NO ESTÁ EN NINGUNA DE LAS DOS LISTAS NO CUENTA ─────────────────
  -- Una reserva cancelada no ocupa asiento. Si contara, la salida se cerraría
  -- por reservas que no existen.
  insert into booking (organization_id, departure_id, product_id, status, pax_total, booking_date, booking_number, order_id)
    values (v_org, v_dep, v_prod, 'cancelled', 40, now(), 'X-1', v_ord);
  res := public.departure_pax_totals(v_org, v_dep, confirm, pend);
  if (res ->> 'booked')::integer is distinct from 3000 then
    fallos := fallos || 'una cancelada entró en la suma de confirmadas';
  end if;

  -- ── LA FUNCIÓN NO SABE QUÉ ES «CONFIRMADA» ────────────────────────────────
  -- Es lo que impide que la regla tenga dos copias. Con las listas al revés,
  -- los totales se cambian de sitio: si la función tuviera su propia idea de
  -- qué cuenta, esto daría lo mismo que antes.
  res := public.departure_pax_totals(v_org, v_dep, pend, confirm);
  if (res ->> 'booked')::integer is distinct from 300
     or (res ->> 'pending')::integer is distinct from 3000 then
    fallos := fallos || 'la función tiene su propia idea de qué estado cuenta: la regla está duplicada';
  end if;

  -- ── POR QUÉ LA SUMA NO PUEDE PERDER UNA FILA ──────────────────────────────
  --
  -- `sum` SALTA los nulos, así que una reserva con `pax_total` nulo se caería
  -- de la suma en silencio. La función lleva un `coalesce` por eso, pero lo que
  -- de verdad lo impide está en el esquema: `pax_total` es `not null`. Se
  -- comprueba AQUÍ y no se da por sabido, porque el día que alguien relaje esa
  -- columna el `coalesce` pasa de ser defensa sobrante a ser lo único que evita
  -- una salida que dice tener sitio de más.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'booking'
       and column_name = 'pax_total' and is_nullable = 'YES'
  ) then
    fallos := fallos || 'booking.pax_total admite nulos: revisa que el coalesce de la función siga puesto';
  end if;

  -- Y una salida con dos reservas pequeñas suma lo que suman, no lo que cabe.
  -- (`pax_total` tiene además un `check` de mayor que cero: no existen reservas
  -- de cero personas, así que las dos filas llevan pasajeros de verdad.)
  insert into booking (organization_id, departure_id, product_id, status, pax_total, booking_date, booking_number, order_id)
    values (v_org, v_otra, v_prod, 'paid', 2, now(), 'N-1', v_ord);
  insert into booking (organization_id, departure_id, product_id, status, pax_total, booking_date, booking_number, order_id)
    values (v_org, v_otra, v_prod, 'paid', 3, now(), 'N-2', v_ord);
  res := public.departure_pax_totals(v_org, v_otra, confirm, pend);
  if (res ->> 'booked')::integer is distinct from 5 then
    fallos := fallos || format('la suma de 2 + 3 salió %s', res ->> 'booked');
  end if;

  -- ── UNA SALIDA VACÍA DE VERDAD ────────────────────────────────────────────
  if (public.departure_pax_totals(v_org, gen_random_uuid(), confirm, pend) ->> 'found')::boolean
     is not false then
    fallos := fallos || 'una salida que no existe se declara encontrada: devolver ceros diría «caben todos»';
  end if;

  -- ── LA SALIDA DE OTRA EMPRESA NO SE VE ────────────────────────────────────
  -- El argumento de empresa es parte del filtro, no un adorno: pedir la salida
  -- de la empresa A diciendo que eres la B no puede devolver sus pasajeros.
  res := public.departure_pax_totals(v_org2, v_dep, confirm, pend);
  if (res ->> 'found')::boolean is not false then
    fallos := fallos || 'la salida de otra empresa se lee con solo cambiar el argumento';
  end if;

  if array_length(fallos, 1) is null then
    raise notice 'departure_pax_totals: TODAS LAS ASERCIONES PASARON';
  else
    raise exception 'departure_pax_totals: %', array_to_string(fallos, ' | ');
  end if;
end $$;

-- ── quién puede llamarla ────────────────────────────────────────────────────
-- Se salta la RLS por ser `security definer`: si la pudiera llamar un anónimo,
-- censaría los pasajeros de cualquier salida de cualquier empresa.
do $$
begin
  if has_function_privilege('anon',
      'public.departure_pax_totals(uuid, uuid, text[], text[])', 'execute') then
    raise exception 'departure_pax_totals: anon puede ejecutarla';
  end if;
  if not has_function_privilege('service_role',
      'public.departure_pax_totals(uuid, uuid, text[], text[])', 'execute') then
    raise exception 'departure_pax_totals: el rol de servicio NO puede ejecutarla';
  end if;
  raise notice 'departure_pax_totals: permisos de ejecución correctos';
end $$;

-- ── y sigue siendo definer con search_path fijado ───────────────────────────
-- Como invocador devolvería cero pasajeros sin fallar, y la aplicación
-- entendería que la salida está vacía. Es el fallo más peligroso posible aquí.
do $$
declare
  v_def boolean;
  v_path text;
begin
  select p.prosecdef, array_to_string(coalesce(p.proconfig, '{}'), ',')
    into v_def, v_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'departure_pax_totals';

  if not coalesce(v_def, false) then
    raise exception 'departure_pax_totals dejó de ser security definer: devolvería cero pasajeros y la venta pasaría siempre';
  end if;
  if v_path not like '%search_path%' then
    raise exception 'departure_pax_totals dejó de fijar search_path';
  end if;
  raise notice 'departure_pax_totals: security definer y search_path en su sitio';
end $$;

rollback;
