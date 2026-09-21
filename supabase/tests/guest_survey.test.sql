-- ============================================================================
-- 0067 — La voz del cliente, comprobada contra la base de verdad.
--
-- Lo que se comprueba no es que la tabla exista —eso ya lo exige el bloque
-- final de la migración— sino que las reglas muerden:
--
--   · una encuesta «contestada» sin nota no entra;
--   · una «omitida» sin motivo tampoco, ni una contestada CON motivo;
--   · una nota fuera de 0–10 no entra;
--   · no caben dos encuestas para la misma reserva;
--   · dos empresas no pueden compartir token;
--   · borrar la reserva se lleva su encuesta, y borrar al guía NO la borra
--     —la nota que le puso el cliente aquel día sigue siendo un hecho—.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/guest_survey.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

insert into organizations (id, name, kind, currency, tenant_org_id)
values ('67670000-6767-6767-6767-676767676767', 'Operadora de la opinión', 'tenant', 'usd',
        '67670000-6767-6767-6767-676767676767');

insert into organizations (id, name, kind, currency, tenant_org_id)
values ('67670000-6767-6767-6767-676767676768', 'La de al lado', 'tenant', 'usd',
        '67670000-6767-6767-6767-676767676768');

insert into product (id, organization_id, name, product_type, status)
values ('67670000-0000-0000-0000-000000000031', '67670000-6767-6767-6767-676767676767',
        'Isla Saona', 'tour', 'active');

insert into departure (id, organization_id, product_id, departure_at, capacity)
values ('67670000-0000-0000-0000-000000000041', '67670000-6767-6767-6767-676767676767',
        '67670000-0000-0000-0000-000000000031', now() - interval '1 day', 40);

insert into customer (id, organization_id, first_name, last_name, email)
values ('67670000-0000-0000-0000-000000000051', '67670000-6767-6767-6767-676767676767',
        'Laura', 'Gutiérrez', 'laura@example.test');

insert into staff (id, organization_id, full_name, staff_type, status)
values ('67670000-0000-0000-0000-000000000061', '67670000-6767-6767-6767-676767676767',
        'Ramón Peña', 'guide', 'active');

insert into sales_order (id, organization_id, order_number, status, currency)
values ('67670000-0000-0000-0000-000000000071', '67670000-6767-6767-6767-676767676767',
        'ORD-6767', 'paid', 'usd');

insert into booking (id, organization_id, order_id, product_id, departure_id, customer_id,
                     booking_number, status, currency, adults)
values ('67670000-0000-0000-0000-000000000081', '67670000-6767-6767-6767-676767676767',
        '67670000-0000-0000-0000-000000000071', '67670000-0000-0000-0000-000000000031',
        '67670000-0000-0000-0000-000000000041', '67670000-0000-0000-0000-000000000051',
        'RSV-6767', 'paid', 'usd', 2);

-- ─────────────────────────────────────────────────────────────────────────────
-- «Contestada» sin nota no es contestada
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare entro boolean := true;
begin
  begin
    insert into guest_survey (organization_id, booking_id, token, status, answered_at)
    values ('67670000-6767-6767-6767-676767676767', '67670000-0000-0000-0000-000000000081',
            'tok-sin-nota', 'answered', now());
  exception when check_violation then entro := false;
  end;
  if entro then
    raise exception 'entró una encuesta contestada sin nota: el NPS se calcularía sobre nulos';
  end if;
  raise notice 'contestada exige nota: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- «Omitida» sin motivo no dice nada, y contestada CON motivo miente
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare entro boolean := true;
begin
  begin
    insert into guest_survey (organization_id, booking_id, token, status)
    values ('67670000-6767-6767-6767-676767676767', '67670000-0000-0000-0000-000000000081',
            'tok-sin-motivo', 'skipped');
  exception when check_violation then entro := false;
  end;
  if entro then
    raise exception 'entró una omitida sin motivo: la tasa de respuesta no se podría explicar';
  end if;
  raise notice 'omitida exige motivo: TODAS LAS ASERCIONES PASARON';
end $$;

do $$
declare entro boolean := true;
begin
  begin
    insert into guest_survey (organization_id, booking_id, token, status, answered_at, nps, skip_reason)
    values ('67670000-6767-6767-6767-676767676767', '67670000-0000-0000-0000-000000000081',
            'tok-contradictorio', 'answered', now(), 9, 'ota');
  exception when check_violation then entro := false;
  end;
  if entro then
    raise exception 'entró una encuesta contestada con motivo de omisión: dos verdades a la vez';
  end if;
  raise notice 'contestada y omitida se excluyen: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- La escala es 0–10 y no otra
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare entro boolean := true;
begin
  begin
    insert into guest_survey (organization_id, booking_id, token, status, answered_at, nps)
    values ('67670000-6767-6767-6767-676767676767', '67670000-0000-0000-0000-000000000081',
            'tok-once', 'answered', now(), 11);
  exception when check_violation then entro := false;
  end;
  if entro then
    raise exception 'entró un 11 sobre 10: la escala del NPS dejaría de ser comparable';
  end if;
  raise notice 'la escala es 0–10: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Una encuesta por reserva: es lo que impide escribirle dos veces al pasajero
-- ─────────────────────────────────────────────────────────────────────────────
insert into guest_survey (organization_id, booking_id, departure_id, product_id, customer_id,
                          guide_staff_id, token, status, asked_at, expires_at)
values ('67670000-6767-6767-6767-676767676767', '67670000-0000-0000-0000-000000000081',
        '67670000-0000-0000-0000-000000000041', '67670000-0000-0000-0000-000000000031',
        '67670000-0000-0000-0000-000000000051', '67670000-0000-0000-0000-000000000061',
        'tok-buena', 'pending', now(), now() + interval '30 days');

do $$
declare entro boolean := true;
begin
  begin
    insert into guest_survey (organization_id, booking_id, token)
    values ('67670000-6767-6767-6767-676767676767', '67670000-0000-0000-0000-000000000081', 'tok-otra');
  exception when unique_violation then entro := false;
  end;
  if entro then
    raise exception 'entraron dos encuestas para la misma reserva: el pasajero recibiría dos correos';
  end if;
  raise notice 'una encuesta por reserva: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- El token es único en TODA la tabla, no por empresa
--
-- La página pública no tiene sesión: resuelve por el token a secas. Si dos
-- operadoras pudieran repetirlo, el pasajero de una vería —y contestaría— la
-- encuesta de la otra.
-- ─────────────────────────────────────────────────────────────────────────────
insert into product (id, organization_id, name, product_type, status)
values ('67670000-0000-0000-0000-000000000032', '67670000-6767-6767-6767-676767676768',
        'Buggy', 'tour', 'active');
insert into sales_order (id, organization_id, order_number, status, currency)
values ('67670000-0000-0000-0000-000000000072', '67670000-6767-6767-6767-676767676768',
        'ORD-6768', 'paid', 'usd');
insert into booking (id, organization_id, order_id, product_id, booking_number, status, currency, adults)
values ('67670000-0000-0000-0000-000000000082', '67670000-6767-6767-6767-676767676768',
        '67670000-0000-0000-0000-000000000072', '67670000-0000-0000-0000-000000000032',
        'RSV-6768', 'paid', 'usd', 1);

do $$
declare entro boolean := true;
begin
  begin
    insert into guest_survey (organization_id, booking_id, token)
    values ('67670000-6767-6767-6767-676767676768', '67670000-0000-0000-0000-000000000082', 'tok-buena');
  exception when unique_violation then entro := false;
  end;
  if entro then
    raise exception 'dos empresas compartieron token: un pasajero vería la encuesta de otra operadora';
  end if;
  raise notice 'token único en toda la tabla: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Borrar al guía NO borra la opinión
--
-- La nota que un cliente puso aquel día es un hecho que ocurrió. Que el guía ya
-- no trabaje aquí no la cambia; lo que se pierde es a quién atribuirla.
-- ─────────────────────────────────────────────────────────────────────────────
delete from staff where id = '67670000-0000-0000-0000-000000000061';

do $$
declare n integer;
begin
  select count(*) into n from guest_survey where token = 'tok-buena';
  if n <> 1 then
    raise exception 'borrar al guía se llevó la opinión del cliente por delante';
  end if;
  select count(*) into n from guest_survey
   where token = 'tok-buena' and guide_staff_id is null;
  if n <> 1 then
    raise exception 'la encuesta quedó apuntando a un guía que ya no existe';
  end if;
  raise notice 'la opinión sobrevive al guía: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Borrar la reserva SÍ se lleva su encuesta
--
-- Al revés que el guía: sin reserva, la encuesta no es de nada. Y es además lo
-- que permite borrar los datos de alguien que lo pide.
-- ─────────────────────────────────────────────────────────────────────────────
delete from booking where id = '67670000-0000-0000-0000-000000000081';

do $$
declare n integer;
begin
  select count(*) into n from guest_survey where token = 'tok-buena';
  if n <> 0 then
    raise exception 'la encuesta sobrevivió a su reserva: quedó una opinión huérfana';
  end if;
  raise notice 'la encuesta muere con su reserva: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
