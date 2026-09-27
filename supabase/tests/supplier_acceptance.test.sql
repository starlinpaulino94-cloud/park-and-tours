-- ============================================================================
-- Prueba de la aceptación del proveedor (0087).
--
-- Lo que se comprueba aquí NO se puede comprobar sin base de datos:
--
--  · que asignar PONGA el servicio en pendiente, con su plazo, sin que nadie
--    lo mande desde la aplicación;
--  · que el plazo nunca pase de la hora de la salida;
--  · que reasignar revoque el enlace que ya se mandó;
--  · y que contestar gaste el enlace y escriba la respuesta A LA VEZ — que es
--    la razón de que esa función exista, y que fuera de una transacción de
--    verdad no se puede demostrar.
--
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

do $$
declare
  fallos  text[] := '{}';
  v_org   uuid;
  v_prov  uuid;
  v_prov2 uuid;
  v_dep   uuid;
  v_rec   uuid;
  v_prod  uuid;
  v_veh   uuid;
  v_veh2  uuid;
  v_tok   uuid;
  r       record;
  res     jsonb;
  v_estado text;
  v_plazo  timestamptz;
  v_salida timestamptz := now() + interval '3 hours';
begin
  -- `kind` es `not null` sin valor por defecto desde 0002: sin nombrarlo, este
  -- insert nunca entró y esta prueba no llegó a correr ni una vez.
  insert into organizations (name, kind) values ('Prueba 0087', 'tenant') returning id into v_org;
  insert into supplier (organization_id, name, on_deadline_expiry)
    values (v_org, 'Transporte A', 'alert') returning id into v_prov;
  insert into supplier (organization_id, name, on_deadline_expiry)
    values (v_org, 'Transporte B', 'tacit') returning id into v_prov2;

  -- ── EL PROVEEDOR DE UN SERVICIO SE DERIVA, NO SE TECLEA ──────────────────
  --
  -- `app.fill_supplier_from_resource` (0085) calcula `supplier_id` a partir del
  -- vehículo —y si no hay, del chofer— en CADA inserción, así que escribirlo a
  -- mano no sirve de nada: el disparador lo pisa con el que salga del recurso, o
  -- con nulo si no hay ninguno.
  --
  -- Esta prueba lo hacía a mano y por eso no podía pasar: el servicio nacía sin
  -- proveedor y el disparador de 0087 lo dejaba, correctamente, en
  -- `not_required`. Lo que se asigna es la guagua.
  insert into vehicle (organization_id, supplier_id, plate, name)
    values (v_org, v_prov, 'A-0001', 'Guagua de A') returning id into v_veh;
  insert into vehicle (organization_id, supplier_id, plate, name)
    values (v_org, v_prov2, 'B-0001', 'Guagua de B') returning id into v_veh2;
  -- La salida necesita su producto: `departure.product_id` es `not null` desde
  -- 0004, y sin él este bloque tampoco llegaba a entrar.
  insert into product (organization_id, name, base_price)
    values (v_org, 'Excursión de prueba', 100) returning id into v_prod;
  insert into departure (organization_id, product_id, departure_at)
    values (v_org, v_prod, v_salida) returning id into v_dep;

  -- ── asignar es preguntar ──────────────────────────────────────────────────
  -- Se inserta SIN tocar `acceptance`: lo tiene que poner el disparador. Si lo
  -- pusiera la aplicación, el día que se asigne desde la mesa de despacho o
  -- desde una importación el servicio saldría sin que nadie lo hubiera pedido.
  insert into departure_resource (organization_id, departure_id, vehicle_id, resource_role)
    values (v_org, v_dep, v_veh, 'vehicle') returning id into v_rec;

  select acceptance, acceptance_deadline into v_estado, v_plazo
    from departure_resource where id = v_rec;

  if v_estado is distinct from 'pending' then
    fallos := fallos || format('asignar no dejó el servicio pendiente (quedó %s)', v_estado);
  end if;

  -- ── el plazo NUNCA pasa de la salida ──────────────────────────────────────
  -- La ventana por defecto son 24 horas y la salida es dentro de 3. Un plazo
  -- que vence después del viaje no es un plazo.
  if v_plazo is null or v_plazo > v_salida + interval '1 second' then
    fallos := fallos || format('el plazo (%s) pasa de la salida (%s)', v_plazo, v_salida);
  end if;

  -- ── un enlace, y revocado al reasignar ────────────────────────────────────
  insert into supplier_response_token
    (organization_id, supplier_id, resource_kind, resource_id, token_hash, expires_at)
    values (v_org, v_prov, 'departure_resource', v_rec, 'hash-de-prueba', v_salida)
    returning id into v_tok;

  update departure_resource set vehicle_id = v_veh2 where id = v_rec;

  select revoked_at is not null as revocado into r from supplier_response_token where id = v_tok;
  if not r.revocado then
    fallos := fallos || 'reasignar NO revocó el enlace: el proveedor viejo puede aceptar lo que ya no es suyo';
  end if;

  -- Y la respuesta anterior se borra al reasignar: conservar «aceptado»
  -- dejaría una fila diciendo que hay conformidad de quien ya no tiene nada
  -- que ver con ese viaje.
  update departure_resource
     set acceptance = 'accepted', confirmation_number = 'CNF-PRUEBA-1'
   where id = v_rec;
  update departure_resource set vehicle_id = v_veh where id = v_rec;
  select acceptance, confirmation_number is null as sin_numero into r
    from departure_resource where id = v_rec;
  if r.acceptance is distinct from 'pending' or not r.sin_numero then
    fallos := fallos || 'reasignar conservó la respuesta del proveedor anterior';
  end if;

  -- ── contestar: una sola escritura ─────────────────────────────────────────
  insert into supplier_response_token
    (organization_id, supplier_id, resource_kind, resource_id, token_hash, expires_at)
    values (v_org, v_prov, 'departure_resource', v_rec, 'hash-de-prueba-2', v_salida)
    returning id into v_tok;

  res := public.respond_to_supplier_service('hash-de-prueba-2', 'accepted', null, 'CNF-PRUEBA-2');
  if (res ->> 'ok')::boolean is not true then
    fallos := fallos || format('contestar falló: %s', res ->> 'reason');
  end if;

  select acceptance, confirmation_number, responded_via into r
    from departure_resource where id = v_rec;
  if r.acceptance is distinct from 'accepted' then
    fallos := fallos || 'el enlace se gastó y la respuesta no se escribió';
  end if;
  if r.confirmation_number is distinct from 'CNF-PRUEBA-2' then
    fallos := fallos || 'se aceptó sin número de confirmación';
  end if;
  if r.responded_via is distinct from 'enlace' then
    fallos := fallos || 'no consta por dónde contestó';
  end if;
  if (select used_at from supplier_response_token where id = v_tok) is null then
    fallos := fallos || 'la respuesta se escribió y el enlace sigue vivo: no es de un solo uso';
  end if;

  -- ── y una segunda vez, no ─────────────────────────────────────────────────
  res := public.respond_to_supplier_service('hash-de-prueba-2', 'rejected', null, 'CNF-PRUEBA-3');
  if (res ->> 'reason') is distinct from 'already_used' then
    fallos := fallos || format('el enlace se pudo usar dos veces (%s)', res::text);
  end if;
  if (select acceptance from departure_resource where id = v_rec) is distinct from 'accepted' then
    fallos := fallos || 'el segundo uso cambió la respuesta';
  end if;

  -- ── un enlace caducado no vale ────────────────────────────────────────────
  insert into supplier_response_token
    (organization_id, supplier_id, resource_kind, resource_id, token_hash, expires_at)
    values (v_org, v_prov, 'departure_resource', v_rec, 'hash-caducado', now() - interval '1 hour');
  res := public.respond_to_supplier_service('hash-caducado', 'accepted', null, 'CNF-PRUEBA-4');
  if (res ->> 'reason') is distinct from 'expired' then
    fallos := fallos || format('un enlace caducado contestó igual (%s)', res::text);
  end if;

  -- ── y uno que no existe ───────────────────────────────────────────────────
  res := public.respond_to_supplier_service('no-existe', 'accepted', null, 'CNF-PRUEBA-5');
  if (res ->> 'reason') is distinct from 'not_found' then
    fallos := fallos || 'un enlace inexistente no se rechaza';
  end if;

  -- ── sin proveedor no hay nada que preguntar ───────────────────────────────
  update departure_resource set vehicle_id = null where id = v_rec;
  select acceptance, acceptance_deadline is null as sin_plazo into r
    from departure_resource where id = v_rec;
  if r.acceptance is distinct from 'not_required' or not r.sin_plazo then
    fallos := fallos || 'un servicio que vuelve a ser de la casa sigue esperando respuesta';
  end if;

  if array_length(fallos, 1) is null then
    raise notice 'supplier_acceptance: TODAS LAS ASERCIONES PASARON';
  else
    raise exception 'supplier_acceptance: %', array_to_string(fallos, ' | ');
  end if;
end $$;

-- ── quién puede llamar la función ───────────────────────────────────────────
-- Si la pudiera llamar un usuario cualquiera, aceptaría servicios en nombre de
-- cualquier proveedor de cualquier empresa: se salta la RLS por ser
-- `security definer`.
do $$
begin
  if has_function_privilege('anon', 'public.respond_to_supplier_service(text, text, text, text)', 'execute') then
    raise exception 'supplier_acceptance: anon puede ejecutar la función';
  end if;
  if has_function_privilege('authenticated', 'public.respond_to_supplier_service(text, text, text, text)', 'execute') then
    raise exception 'supplier_acceptance: authenticated puede ejecutar la función';
  end if;
  if not has_function_privilege('service_role', 'public.respond_to_supplier_service(text, text, text, text)', 'execute') then
    raise exception 'supplier_acceptance: el rol de servicio NO puede ejecutarla';
  end if;
  raise notice 'supplier_acceptance: permisos de ejecución correctos';
end $$;

-- ── y la tabla del enlace no la lee nadie por la vía normal ─────────────────
do $$
declare
  n integer;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'supplier_response_token';
  if n <> 0 then
    raise exception 'supplier_acceptance: la tabla del enlace tiene % políticas; debería tener CERO', n;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.supplier_response_token'::regclass) then
    raise exception 'supplier_acceptance: la tabla del enlace no tiene RLS encendida';
  end if;
  raise notice 'supplier_acceptance: el material de credenciales está cerrado';
end $$;

rollback;
