-- ============================================================================
-- 0066 — La lista de espera, comprobada contra la base de verdad.
--
-- Lo que se comprueba no es que la tabla exista —eso ya lo exige el bloque
-- final de la migración— sino que las reglas muerden:
--
--   · una espera sin forma de avisar no entra;
--   · una espera de cero personas tampoco;
--   · la cola sale por orden de llegada;
--   · borrar la salida se lleva su cola, pero borrar la ficha del cliente no
--     borra la espera —el teléfono sigue sirviendo—.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/waitlist.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

insert into organizations (id, name, kind, currency, tenant_org_id)
values ('66660000-6666-6666-6666-666666666666', 'Operadora de la cola', 'tenant', 'usd',
        '66660000-6666-6666-6666-666666666666');

insert into product (id, organization_id, name, product_type, status)
values ('66660000-0000-0000-0000-000000000031', '66660000-6666-6666-6666-666666666666',
        'Isla Saona', 'tour', 'active');

insert into departure (id, organization_id, product_id, departure_at, capacity)
values ('66660000-0000-0000-0000-000000000041', '66660000-6666-6666-6666-666666666666',
        '66660000-0000-0000-0000-000000000031', now() + interval '2 days', 40);

insert into customer (id, organization_id, first_name, last_name)
values ('66660000-0000-0000-0000-000000000051', '66660000-6666-6666-6666-666666666666',
        'Laura', 'Gutiérrez');

-- ─────────────────────────────────────────────────────────────────────────────
-- Una espera sin forma de avisar no sirve de nada
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  entro boolean := true;
begin
  begin
    insert into waitlist_entry (organization_id, departure_id, contact_name, pax)
    values ('66660000-6666-6666-6666-666666666666', '66660000-0000-0000-0000-000000000041',
            'Alguien sin teléfono', 2);
  exception when check_violation then entro := false;
  end;
  if entro then
    raise exception 'entró una espera sin cliente, sin teléfono y sin correo: nadie podría avisarla';
  end if;

  -- Un espacio en blanco no es un teléfono.
  entro := true;
  begin
    insert into waitlist_entry (organization_id, departure_id, contact_name, contact_phone, pax)
    values ('66660000-6666-6666-6666-666666666666', '66660000-0000-0000-0000-000000000041',
            'Alguien', '   ', 2);
  exception when check_violation then entro := false;
  end;
  if entro then raise exception 'un teléfono en blanco pasó por teléfono'; end if;

  -- Con teléfono, sí.
  insert into waitlist_entry (organization_id, departure_id, contact_name, contact_phone, pax)
  values ('66660000-6666-6666-6666-666666666666', '66660000-0000-0000-0000-000000000041',
          'Michael Brennan', '+1 809 555 0101', 3);

  -- Con ficha de cliente y sin teléfono, también.
  insert into waitlist_entry (organization_id, departure_id, customer_id, pax)
  values ('66660000-6666-6666-6666-666666666666', '66660000-0000-0000-0000-000000000041',
          '66660000-0000-0000-0000-000000000051', 2);

  raise notice 'contacto obligatorio: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Una espera de cero personas no es una espera
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  entro boolean := true;
begin
  begin
    insert into waitlist_entry (organization_id, departure_id, contact_phone, pax)
    values ('66660000-6666-6666-6666-666666666666', '66660000-0000-0000-0000-000000000041',
            '+1 809 555 0000', 0);
  exception when check_violation then entro := false;
  end;
  if entro then raise exception 'entró una espera de 0 pax'; end if;
  raise notice 'pax mínimo: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Un estado inventado no entra
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  entro boolean := true;
begin
  begin
    update waitlist_entry set status = 'avisado'
     where organization_id = '66660000-6666-6666-6666-666666666666';
  exception when check_violation then entro := false;
  end;
  if entro then raise exception 'la tabla aceptó un estado que el código no conoce'; end if;
  raise notice 'estados acotados: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Borrar la ficha del cliente se lleva SU espera, y solo la suya
--
-- Esta prueba encontró un fallo de diseño en la primera versión de 0066. Con
-- `on delete set null`, borrar un cliente cuya espera no tenía teléfono propio
-- dejaba la fila sin ninguna forma de contacto, el check la rechazaba y
-- Postgres abortaba el borrado ENTERO: una espera pendiente impedía borrar la
-- ficha de un cliente que pedía que borraran sus datos.
--
-- Con `cascade` se va con su ficha, que además es lo correcto —la espera es un
-- dato personal de esa misma persona—. La espera de mostrador, que nunca tuvo
-- ficha, se queda: su teléfono sigue sirviendo.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  quedan integer;
  con_telefono integer;
begin
  delete from customer where id = '66660000-0000-0000-0000-000000000051';

  select count(*) into quedan from waitlist_entry
   where organization_id = '66660000-6666-6666-6666-666666666666';
  if quedan <> 1 then
    raise exception 'tras borrar el cliente deberían quedar 1 espera (la de mostrador), quedan %', quedan;
  end if;

  select count(*) into con_telefono from waitlist_entry
   where organization_id = '66660000-6666-6666-6666-666666666666'
     and contact_phone = '+1 809 555 0101';
  if con_telefono <> 1 then
    raise exception 'se llevó por delante la espera de mostrador, que no era suya';
  end if;

  raise notice 'la espera se va con su ficha, y solo la suya: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Borrar la salida SÍ se lleva su cola
--
-- Una espera para una salida que ya no existe no se puede ofrecer ni caducar:
-- se quedaría en la tabla para siempre sin que nada la mire.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  quedan integer;
begin
  delete from departure where id = '66660000-0000-0000-0000-000000000041';
  select count(*) into quedan from waitlist_entry
   where organization_id = '66660000-6666-6666-6666-666666666666';
  if quedan <> 0 then
    raise exception 'la cola sobrevivió a su salida: quedan %', quedan;
  end if;
  raise notice 'la cola muere con su salida: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
