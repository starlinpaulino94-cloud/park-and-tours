-- 0094 — Los pasajeros de una salida se cuentan en la base, no en la aplicación.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL TECHO QUE ROMPÍA LA ÚNICA GUARDA CONTRA LA SOBREVENTA
--
-- `recalculateDeparture` (availability.ts) recalcula `booked_pax` y
-- `pending_pax` de una salida sumando sus reservas, y `assertCapacity` decide
-- con esos números si cabe una venta más. La cabecera del módulo lo dice con
-- todas las letras: «the single guard against overselling», y «the counters can
-- never silently drift out of sync with reality».
--
-- Leía las reservas con `_limit: 1000`.
--
-- Una salida de entrada general de un parque —dos mil entradas al día— pasa de
-- mil reservas sin nada raro. Y pasado el tope:
--
--   · la suma sale CORTA,
--   · así que `available_pax` sale ALTA,
--   · así que `assertCapacity` deja pasar la venta que no cabe.
--
-- La guarda no falla: aprueba. Y los contadores que se escriben en la salida
-- quedan por debajo de la realidad, así que la pantalla de despacho, la
-- previsión de ocupación y el semáforo de «casi llena» mienten todos a la vez
-- en la misma dirección. Justo lo que el módulo promete que no puede pasar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ UNA FUNCIÓN Y NO PAGINAR
--
-- Paginar habría arreglado la exactitud y roto otra cosa. Esto corre en CADA
-- venta: con una salida de cinco mil reservas, cada entrada vendida traería
-- cinco mil filas a la aplicación para sumar dos números. La operadora que más
-- vende sería la que más lento vende.
--
-- Una suma es lo que una base de datos hace mejor que nadie: aquí vuelve UNA
-- fila con los dos totales, exacta, sin tope y sin transferir nada.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ DECIDE LA APLICACIÓN Y QUÉ DECIDE ESTA FUNCIÓN
--
-- QUÉ ESTADOS CUENTAN lo sigue decidiendo `availability.ts`, y por eso las dos
-- listas VIAJAN COMO ARGUMENTO en vez de estar escritas aquí. Copiarlas a la
-- base habría dejado dos copias de la misma regla —y de dos copias, la que se
-- queda vieja es siempre la que nadie mira—. La función no sabe qué es una
-- reserva confirmada: suma lo que se le diga.
--
-- Y esta función NO escribe: devuelve los totales. El estado de la salida
-- (`available` / `almost_full` / `full`) lo sigue derivando `deriveStatus` en
-- la aplicación, que es puro y está probado, y la escritura sigue donde estaba.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE SIGUE SIN CERRAR
--
-- La carrera de AUD-B01. Dos ventas simultáneas siguen pudiendo leer los mismos
-- totales antes de que ninguna de las dos haya escrito su reserva. Esta función
-- hace la suma EXACTA, no ATÓMICA respecto de la venta: cerrar eso pide apartar
-- la plaza al autorizar, que es la misma decisión de producto que quedó abierta
-- en 0091 para el monedero. Se dice aquí para que nadie lea esta migración como
-- «la sobreventa está resuelta».

create or replace function public.departure_pax_totals(
  p_org        uuid,
  p_departure  uuid,
  p_confirmed  text[],
  p_pending    text[]
) returns jsonb
  language plpgsql
  -- `security definer` porque quien llama es el cliente de servicio en un camino
  -- sin sesión (el punto de venta, el motor público, la API del socio). Y como
  -- eso se salta la RLS, el ámbito se comprueba A MANO más abajo.
  security definer
  set search_path = public, app
as $$
declare
  v_confirmadas integer := 0;
  v_pendientes  integer := 0;
  v_capacidad   integer;
  v_existe      boolean;
begin
  -- El ámbito, a mano y primero. `app.current_org_id()` es nulo cuando llama el
  -- rol de servicio, así que la comprobación solo muerde cuando hay sesión de
  -- verdad: lo que impide es que un usuario autenticado de otra empresa cuente
  -- los pasajeros de una salida ajena.
  if app.current_org_id() is not null and app.current_org_id() <> p_org then
    raise exception 'departure_pax_totals: la salida no es de esta empresa';
  end if;

  select true, coalesce(d.capacity, 0)
    into v_existe, v_capacidad
    from departure d
   where d.organization_id = p_org and d.id = p_departure;

  -- Una salida que no existe NO es una salida con cero pasajeros: devolver
  -- ceros aquí diría «caben todos» sobre algo que no está, y la venta seguiría
  -- adelante contra una salida inventada.
  if not coalesce(v_existe, false) then
    return jsonb_build_object('found', false);
  end if;

  -- Los dos totales, en una sola pasada sobre el índice
  -- `booking_departure_idx`.
  --
  -- El `coalesce` sobre `pax_total` es defensa, no lógica: hoy esa columna es
  -- `not null` y además tiene un `check` de mayor que cero, así que no hay
  -- reservas sin pasajeros. Se deja puesto porque `sum` SALTA los nulos —una
  -- fila nula no sumaría cero, desaparecería de la cuenta— y el día que alguien
  -- relaje la columna esta línea pasa de sobrante a ser lo único que impide una
  -- salida que dice tener sitio de más. La prueba SQL comprueba el `not null`
  -- justamente para que se sepa cuándo esto deja de ser defensa.
  select
    coalesce(sum(case when b.status = any(p_confirmed) then coalesce(b.pax_total, 0) else 0 end), 0),
    coalesce(sum(case when b.status = any(p_pending)   then coalesce(b.pax_total, 0) else 0 end), 0)
    into v_confirmadas, v_pendientes
    from booking b
   where b.organization_id = p_org
     and b.departure_id = p_departure;

  return jsonb_build_object(
    'found', true,
    'capacity', v_capacidad,
    'booked', v_confirmadas,
    'pending', v_pendientes
  );
end;
$$;

-- Que no la llame cualquiera: se salta la RLS por ser `security definer`, así
-- que un usuario anónimo podría censar los pasajeros de cualquier salida de
-- cualquier empresa.
revoke all on function public.departure_pax_totals(uuid, uuid, text[], text[]) from anon, public;
grant execute on function public.departure_pax_totals(uuid, uuid, text[], text[]) to service_role;

-- ── La comprobación de que quedó como se pidió ──────────────────────────────
-- Una función que existe pero corre como invocador no falla: devuelve cero
-- pasajeros —porque la RLS del rol de servicio no ve nada sin sesión— y la
-- aplicación entiende «la salida está vacía, caben todos». Es el fallo más
-- peligroso posible aquí, así que la migración se niega a terminar sin
-- comprobarlo.
do $$
declare
  v_def boolean;
  v_path text;
begin
  select p.prosecdef, array_to_string(coalesce(p.proconfig, '{}'), ',')
    into v_def, v_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'departure_pax_totals';

  if v_def is null then
    raise exception '0094: public.departure_pax_totals no se creó';
  end if;
  if not v_def then
    raise exception '0094: departure_pax_totals no quedó security definer: devolvería cero pasajeros y la venta pasaría siempre';
  end if;
  if v_path not like '%search_path%' then
    raise exception '0094: departure_pax_totals no fijó search_path';
  end if;
  raise notice '0094: departure_pax_totals lista (security definer, search_path fijado)';
end $$;
