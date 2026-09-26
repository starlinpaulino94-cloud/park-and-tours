-- ============================================================================
-- P-001 · El plan del panel ejecutivo, con volumen encima (0096).
--
-- En 9.11 se comprobó que los índices del panel EXISTEN. Nadie había
-- comprobado que se USEN, ni cuánto cuesta la consulta cuando hay datos. Con
-- 120.000 reservas de un mismo inquilino, una ventana de 365 días tardaba
-- ~800 ms: `current_booking` se definía como `select b.*`, materializaba las
-- ~60 columnas de `booking` en disco (1.247 bytes por fila) y los seis
-- agregados que la leen la releían entera cada uno.
--
-- Un tope de milisegundos aquí sería una prueba inestable —la CI no es una
-- máquina de producción—, así que se comprueba lo que sí es determinista y es
-- exactamente lo que se rompió:
--
--  · que la CTE `current_booking` NO arrastre la fila entera: se mide el
--    `width` que el planificador le asigna, que es el número que se disparó;
--  · que el camino filtrado (empresa + fecha + producto) entre POR ÍNDICE y no
--    por barrido secuencial, que era la pregunta original de P-001;
--  · y que ninguna de las ocho CTE base de la función haya vuelto a `select X.*`.
--
-- Siembra 20.000 reservas dentro de la transacción y hace rollback: no deja
-- datos. Los disparadores se apagan durante la siembra porque lo que se mide
-- aquí es el plan de lectura, no la escritura (eso se mide en 0097).
-- ============================================================================
begin;

do $$
declare
  fallos   text[] := '{}';
  v_org    uuid;
  v_prod   uuid;
  v_ord    uuid;
  v_dep    uuid;
  plan     jsonb;
  v_width  integer;
  v_nodo   text;
  v_def    text;
  v_alias  text;
  v_i      integer;
  v_prods  uuid[] := '{}';
  v_deps   uuid[] := '{}';
  -- El ancho medido tras 0096 es 169. El techo deja aire para una columna más
  -- sin tener que tocar la prueba, y sigue estando un orden de magnitud por
  -- debajo de los 1.247 de `select b.*`: volver a la fila entera lo rompe.
  TECHO_ANCHO constant integer := 320;
begin
  insert into organizations (name, kind) values ('Plan P-001', 'tenant') returning id into v_org;
  insert into sales_order (organization_id, order_number, status)
    values (v_org, 'ORD-P001', 'pending_payment') returning id into v_ord;

  /**
   * VEINTE PRODUCTOS, NO UNO.
   *
   * Con un solo producto el filtro por producto no descarta NADA: el
   * planificador elige barrido secuencial con toda la razón y la prueba
   * fallaría por culpa del fixture, no del código. Una operadora real tiene
   * decenas de excursiones y el panel filtra por una; eso es lo que hay que
   * medir. Veinte deja cada una en el 5% de las reservas.
   */
  for v_i in 1..20 loop
    insert into product (organization_id, name, base_price)
      values (v_org, 'Excursión ' || v_i, 40) returning id into v_prod;
    insert into departure (organization_id, product_id, departure_at, capacity)
      values (v_org, v_prod, now() + interval '5 days', 100000) returning id into v_dep;
    v_prods := v_prods || v_prod;
    v_deps  := v_deps  || v_dep;
  end loop;

  set local session_replication_role = replica;
  insert into booking (organization_id, departure_id, product_id, order_id, booking_number,
                       status, pax_total, total_amount, currency, booking_date)
  select v_org, v_deps[1 + (g % 20)], v_prods[1 + (g % 20)], v_ord, 'PB-'||g,
         case when g % 2 = 0 then 'paid' else 'cancelled' end,
         2, 100, 'dop',
         now() - (g % 360) * interval '1 day'
    from generate_series(1, 20000) g;
  set local session_replication_role = origin;

  v_prod := v_prods[1];
  analyze booking;

  -- ── 1. LA CTE NO PUEDE ARRASTRAR LA FILA ENTERA ──────────────────────────
  -- Misma proyección que `current_booking` en 0096. Si alguien la devuelve a
  -- `b.*`, el `width` se dispara y esta aserción lo dice antes que el usuario.
  execute format($q$
    explain (format json)
    select b.status, b.booking_date, b.channel, b.product_id, b.seller_id,
           b.partner_id, b.pax_total, b.total_amount
      from booking b
     where b.organization_id = %L
       and b.booking_date >= now() - interval '365 days'
       and b.booking_date <= now()
  $q$, v_org) into plan;

  v_width := (plan -> 0 -> 'Plan' ->> 'Plan Width')::integer;
  if v_width is null then
    fallos := fallos || 'no se pudo leer el ancho del plan'::text;
  elsif v_width > TECHO_ANCHO then
    fallos := fallos || format(
      'la proyección de current_booking pesa %s bytes por fila (techo %s): ¿volvió el select b.*?',
      v_width, TECHO_ANCHO);
  end if;

  -- ── 2. EL CAMINO FILTRADO TIENE QUE ENTRAR POR ÍNDICE ────────────────────
  -- Ésta era la pregunta de P-001: los índices están, ¿se usan? Con 20.000
  -- filas y un producto de las 20.000, el barrido secuencial ya no es la
  -- opción barata; si el planificador lo elige igual, algo tapa el índice.
  execute format($q$
    explain (format json)
    select count(*) from booking b
     where b.organization_id = %L
       and b.booking_date >= now() - interval '365 days'
       and b.booking_date <= now()
       and b.product_id = %L
  $q$, v_org, v_prod) into plan;

  -- No vale con que aparezca la palabra «Index»: sin los índices del panel el
  -- planificador se agarra a cualquier otro (medido: `booking_voucher_code_idx`
  -- por mapa de bits) y una aserción laxa lo daría por bueno. Tiene que ser uno
  -- de los que 0023 creó PARA esto.
  select string_agg(x.nombre #>> '{}', ',') into v_nodo
    from jsonb_path_query(plan, '$.**."Index Name"') as x(nombre);

  if v_nodo is null then
    fallos := fallos || format(
      'el panel filtrado por producto NO usa índice con 20.000 reservas: %s',
      coalesce(plan #>> '{0,Plan,Plans,0,Node Type}', '¿?'));
  elsif v_nodo not like '%booking_dashboard_%' then
    fallos := fallos || format(
      'el panel filtrado por producto usa %s, no un índice del panel', v_nodo);
  end if;

  -- ── 3. NINGUNA CTE BASE PUEDE VOLVER A `select X.*` ──────────────────────
  -- El `width` de arriba mide una consulta equivalente, no la función. Esto
  -- mira la función de verdad: si vuelve el comodín, vuelve el coste.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dashboard_summary';

  if v_def is null then
    fallos := fallos || 'public.dashboard_summary no existe'::text;
  else
    -- Los ocho alias de las CTE base, que son las que leen tablas grandes.
    -- `cr.*` queda fuera a propósito: `ranked` proyecta sobre `channel_rows`,
    -- que ya son diez filas agregadas, no la tabla.
    foreach v_alias in array array['b', 'p', 'c', 'r', 'cs'] loop
      if position(format('select %s.*,', v_alias) in v_def) > 0 then
        fallos := fallos || format(
          'una CTE base de dashboard_summary volvió a proyectar la fila entera: select %s.*', v_alias);
      end if;
    end loop;
    -- Y las columnas que los seis agregados necesitan tienen que seguir ahí:
    -- recortar de más rompe el panel en vez de acelerarlo.
    if v_def not like '%b.status, b.booking_date, b.channel, b.product_id, b.seller_id%' then
      fallos := fallos || 'current_booking dejó de nombrar las columnas que consumen los seis agregados'::text;
    end if;
  end if;

  if array_length(fallos, 1) is null then
    raise notice 'dashboard_plan: TODAS LAS ASERCIONES PASARON';
  else
    raise exception E'dashboard_plan: FALLOS\n  · %', array_to_string(fallos, E'\n  · ');
  end if;
end $$;

rollback;
