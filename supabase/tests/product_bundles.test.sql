-- ============================================================================
-- 0061 — Combos: lo que la base tiene que impedir para que un paquete se pueda
-- operar.
--
-- Las dos de arriba son bucles infinitos disfrazados de error de desplegable:
-- un paquete que se contiene a sí mismo, y un paquete dentro de otro. El motor
-- de itinerarios los recorrería sin fin la primera vez que alguien se equivoque
-- al elegir.
--
-- La de abajo es peor porque no se ve: una reserva componente que a su vez es
-- cabecera. Cancelar el paquete tendría que recorrer un árbol de profundidad
-- desconocida, y el día que ese recorrido se quede a medias habría plazas
-- bloqueadas en una salida sin ninguna reserva que las explique.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/product_bundles.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

\set org '77770000-7777-7777-7777-777777777777'

insert into organizations (id, name, kind, currency) values
  (:'org', 'Operadora de paquetes', 'tenant', 'usd');

insert into product (id, organization_id, name, is_bundle) values
  ('aaaa1111-0000-0000-0000-000000000001', :'org', 'Combo Este',   true),
  ('aaaa1111-0000-0000-0000-000000000002', :'org', 'Combo Norte',  true),
  ('aaaa1111-0000-0000-0000-000000000003', :'org', 'Saona',        false),
  ('aaaa1111-0000-0000-0000-000000000004', :'org', 'Buggy',        false);

-- ─────────────────────────────────────────────────────────────────────────────
-- La composición del paquete
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '77770000-7777-7777-7777-777777777777';
  este   uuid := 'aaaa1111-0000-0000-0000-000000000001';
  norte  uuid := 'aaaa1111-0000-0000-0000-000000000002';
  saona  uuid := 'aaaa1111-0000-0000-0000-000000000003';
  buggy  uuid := 'aaaa1111-0000-0000-0000-000000000004';
begin
  insert into product_bundle_item (organization_id, bundle_id, product_id, day_offset, sort_order)
  values (org, este, saona, 0, 0), (org, este, buggy, 1, 0);

  -- UN PAQUETE NO SE CONTIENE A SÍ MISMO.
  --
  -- Se prueba con un producto que NO está marcado como paquete a propósito. Con
  -- uno que sí lo está, el disparador antianidamiento de más abajo lo pararía
  -- igual y esta comprobación no probaría nada: quitar la restricción no se
  -- notaría. Un producto suelto que se contiene a sí mismo es reachable —basta
  -- elegirlo dos veces en el desplegable— y el día que alguien lo marque como
  -- paquete, el motor de itinerarios entraría en un bucle sin fin.
  begin
    insert into product_bundle_item (organization_id, bundle_id, product_id)
    values (org, saona, saona);
    raise exception 'se admitió un producto dentro de sí mismo';
  exception when check_violation then null;
  end;

  -- NI CONTIENE OTRO PAQUETE. Un paquete de paquetes multiplica el itinerario
  -- por combinaciones que ningún vendedor puede revisar antes de cobrar.
  begin
    insert into product_bundle_item (organization_id, bundle_id, product_id)
    values (org, este, norte);
    raise exception 'se admitió un paquete dentro de otro paquete';
  exception when check_violation then null;
  end;

  -- La misma actividad, el mismo día, dos veces, es un error de tecleo que
  -- duplicaría las plazas consumidas.
  begin
    insert into product_bundle_item (organization_id, bundle_id, product_id, day_offset)
    values (org, este, saona, 0);
    raise exception 'se admitió la misma actividad dos veces el mismo día';
  exception when unique_violation then null;
  end;

  -- La misma actividad OTRO día sí: un combo puede repetir playa dos días.
  insert into product_bundle_item (organization_id, bundle_id, product_id, day_offset)
  values (org, este, saona, 2);

  -- La hora fija es una hora, no «por la mañana»: nadie puede ordenar eso.
  begin
    insert into product_bundle_item (organization_id, bundle_id, product_id, day_offset, fixed_time)
    values (org, norte, buggy, 0, 'por la mañana');
    raise exception 'se admitió una hora fija que no es una hora';
  exception when check_violation then null;
  end;

  insert into product_bundle_item (organization_id, bundle_id, product_id, day_offset, fixed_time)
  values (org, norte, buggy, 0, '09:00');

  -- Un desplazamiento negativo pondría una actividad antes de que empiece el
  -- paquete.
  begin
    insert into product_bundle_item (organization_id, bundle_id, product_id, day_offset)
    values (org, norte, saona, -1);
    raise exception 'se admitió un día negativo';
  exception when check_violation then null;
  end;

  -- El margen del paquete está acotado: doce horas de margen ya no es un
  -- paquete, y un negativo dejaría pasar itinerarios que se pisan.
  begin
    update product set bundle_buffer_minutes = -10 where id = este;
    raise exception 'se admitió un margen negativo';
  exception when check_violation then null;
  end;

  raise notice 'product_bundle_item: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- La reserva: solo dos niveles
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '77770000-7777-7777-7777-777777777777';
  este  uuid := 'aaaa1111-0000-0000-0000-000000000001';
  saona uuid := 'aaaa1111-0000-0000-0000-000000000003';
  buggy uuid := 'aaaa1111-0000-0000-0000-000000000004';
  orden uuid;
  cabecera uuid;
  componente uuid;
begin
  insert into sales_order (organization_id, order_number) values (org, 'SO-PKG-1') returning id into orden;

  -- La cabecera: lleva el precio y NO tiene salida. El paquete no sale ningún
  -- día; salen sus actividades.
  insert into booking (organization_id, booking_number, order_id, product_id, total_amount, pax_total)
  values (org, 'BK-PKG-H', orden, este, 180, 2) returning id into cabecera;

  -- Un componente: lleva la salida y los pasajeros, y vale cero.
  insert into booking (organization_id, booking_number, order_id, product_id,
                       total_amount, pax_total, bundle_booking_id)
  values (org, 'BK-PKG-C1', orden, saona, 0, 2, cabecera) returning id into componente;

  -- UN COMPONENTE NO ES CABECERA DE NADIE: solo dos niveles.
  begin
    insert into booking (organization_id, booking_number, order_id, product_id,
                         total_amount, pax_total, bundle_booking_id)
    values (org, 'BK-PKG-C2', orden, buggy, 0, 2, componente);
    raise exception 'se admitió un componente como cabecera de otro';
  exception when check_violation then null;
  end;

  -- Y una reserva no es su propia cabecera.
  begin
    update booking set bundle_booking_id = cabecera where id = cabecera;
    raise exception 'se admitió que una reserva fuera su propia cabecera';
  exception when check_violation then null;
  end;

  -- Borrar la cabecera se lleva sus componentes: dejarlos vivos sería dejar
  -- plazas ocupadas en una salida sin nada que las explique.
  delete from booking where id = cabecera;
  if (select count(*) from booking where id = componente) <> 0 then
    raise exception 'al borrar la cabecera quedó un componente huérfano';
  end if;

  raise notice 'booking (paquetes): TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
