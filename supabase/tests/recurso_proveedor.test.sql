-- ============================================================================
-- El proveedor de un recurso de salida SE DEDUCE, y lo escrito a mano se tira
--
-- ───────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTA PRUEBA EXISTE
--
-- El sembrador del E2E escribía `departure_resource.supplier_id` a mano, con
-- un comentario que decía que el disparador de 0085 «solo lo deduce cuando hay
-- vehículo o personal detrás». No es así: su última línea es
-- `new.supplier_id := v_supplier`, SIN condición, y en un `insert` la lista
-- `of vehicle_id, staff_id` no restringe nada —solo restringe los `update`—,
-- así que el disparador corre siempre y pisa lo escrito con lo que deduce.
-- Sin vehículo ni personal, deduce null.
--
-- Resultado: dos filas sembradas sin dueño, ningún error al sembrar, y el
-- portal del proveedor vacío. Las pruebas rojas señalaban la ruta; el fallo
-- estaba en el dato. Un valor que la base acepta y tira en silencio es de lo
-- más caro que hay: no falla donde se escribe, falla donde se lee.
--
-- Se comprueba aquí y no en una guarda de texto porque lo que hay que afirmar
-- es el COMPORTAMIENTO del motor: una guarda que lea el fichero .sql afirma
-- cómo está escrito el disparador, no qué hace.
--
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

do $$
declare
  fallos text[] := '{}';
  v_org uuid;
  v_prov_a uuid;
  v_prov_b uuid;
  v_producto uuid;
  v_salida uuid;
  v_guagua uuid;
  v_recurso uuid;
  v_duenio uuid;
  v_fecha timestamptz;
begin
  insert into organizations (name, kind) values ('Recurso proveedor', 'tenant') returning id into v_org;
  insert into supplier (organization_id, name) values (v_org, 'Transporte A') returning id into v_prov_a;
  insert into supplier (organization_id, name) values (v_org, 'Transporte B') returning id into v_prov_b;
  insert into product (organization_id, name) values (v_org, 'Excursión') returning id into v_producto;
  insert into departure (organization_id, product_id, departure_at, capacity)
    values (v_org, v_producto, now() + interval '1 day', 40)
    returning id into v_salida;
  insert into vehicle (organization_id, supplier_id, plate, name)
    values (v_org, v_prov_a, 'BUS-01', 'Guagua A')
    returning id into v_guagua;

  -- ── 1. SIN VEHÍCULO NI PERSONAL, LO ESCRITO A MANO DESAPARECE ────────────
  -- Ésta es la trampa entera, y la razón de la prueba. Si algún día el
  -- disparador pasara a RESPETAR el valor escrito, esto falla y hay que
  -- revisar el sembrador del E2E, que hoy depende de la deducción.
  insert into departure_resource (organization_id, departure_id, supplier_id, resource_role, pax_assigned)
    values (v_org, v_salida, v_prov_a, 'vehicle', 2)
    returning id into v_recurso;
  select supplier_id into v_duenio from departure_resource where id = v_recurso;
  if v_duenio is not null then
    fallos := fallos || format(
      'el supplier_id escrito a mano SOBREVIVIÓ (%s): el sembrador del E2E y la guarda de ui-contracts dan por hecho que no',
      v_duenio);
  end if;

  -- ── 2. CON VEHÍCULO, SALE EL PROVEEDOR DEL VEHÍCULO ──────────────────────
  insert into departure_resource (organization_id, departure_id, vehicle_id, resource_role, pax_assigned)
    values (v_org, v_salida, v_guagua, 'vehicle', 2)
    returning id into v_recurso;
  select supplier_id into v_duenio from departure_resource where id = v_recurso;
  if v_duenio is distinct from v_prov_a then
    fallos := fallos || format('con vehículo de A el recurso quedó de %s', coalesce(v_duenio::text, 'nadie'));
  end if;

  -- ── 3. Y MANDA EL VEHÍCULO SOBRE LO ESCRITO, NO AL REVÉS ─────────────────
  -- Un `supplier_id` de B junto a una guagua de A tiene que quedar de A. Sin
  -- esto, quien quisiera podría regalarse las filas de otro por el CRUD
  -- genérico — y en esta tabla «ver» es leer datos de clientes de terceros.
  insert into departure_resource (organization_id, departure_id, vehicle_id, supplier_id, resource_role, pax_assigned)
    values (v_org, v_salida, v_guagua, v_prov_b, 'vehicle', 2)
    returning id into v_recurso;
  select supplier_id into v_duenio from departure_resource where id = v_recurso;
  if v_duenio is distinct from v_prov_a then
    fallos := fallos || format('el supplier_id escrito ganó al vehículo: quedó de %s', coalesce(v_duenio::text, 'nadie'));
  end if;

  -- ── 4. Y LA FECHA DEL SERVICIO LLEGA SOLA (0086) ─────────────────────────
  -- Va en la misma prueba a propósito: el portal del proveedor filtra por las
  -- DOS columnas a la vez, y con cualquiera de ellas en null la lista sale
  -- vacía exactamente igual. Comprobar solo el dueño dejaría media causa sin
  -- cubrir.
  select service_date into v_fecha from departure_resource where id = v_recurso;
  if v_fecha is null then
    -- El `::text` no es adorno: sin él Postgres resuelve el literal como
    -- `text[]` y revienta con «malformed array literal», que es un fallo de la
    -- prueba disfrazado de fallo del sistema.
    fallos := fallos || 'service_date llegó nula: el servicio no sale ni en próximos ni en pasados'::text;
  end if;

  if array_length(fallos, 1) is not null then
    raise exception E'recurso_proveedor:\n  - %', array_to_string(fallos, E'\n  - ');
  end if;
  raise notice 'recurso_proveedor: el proveedor se deduce del vehículo y lo escrito a mano se descarta';
end $$;

rollback;
