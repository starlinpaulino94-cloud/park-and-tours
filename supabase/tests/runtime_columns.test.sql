-- ============================================================================
-- Prueba de las columnas de ejecución añadidas por 0030.
--
-- El guardián de TypeScript (`src/lib/schema-contract.test.ts`) compara lo que
-- la aplicación escribe contra el texto de las migraciones. Esto lo comprueba
-- contra Postgres de verdad: ejecuta los mismos INSERT/UPDATE que hacían fallar
-- a PostgREST —crear una reserva, guardar acompañantes, generar una salida,
-- abrir y cerrar caja— y verifica además que el disparador de aislamiento sigue
-- rechazando una referencia de otra organización en las columnas nuevas.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/runtime_columns.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

\set org   '11111111-1111-1111-1111-111111111111'
\set other '99999999-9999-9999-9999-999999999999'

insert into organizations (id, name, kind, currency) values
  (:'org',   'Tenant de prueba', 'tenant', 'usd'),
  (:'other', 'Otro tenant',      'tenant', 'usd');

insert into hotel (id, organization_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'org',   'Hotel propio'),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'other', 'Hotel ajeno');

insert into product (id, organization_id, name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', :'org', 'Tour de prueba');

insert into sales_order (id, organization_id, order_number) values
  ('00000000-0000-0000-0000-0000000000a1', :'org', 'SO-RT-1');

insert into branch (id, organization_id, name) values
  ('cccccccc-0000-0000-0000-000000000001', :'org', 'Sucursal');

-- ── reserva completa, tal como la escribe booking-service.ts ────────────────
insert into booking (
  id, organization_id, booking_number, order_id, product_id, status, currency, pax_total,
  unit_price, hotel_id, pickup_time, pickup_location, room_number, voucher_code,
  checked_in_at, checked_in_pax, checkin_status, override_reason, notes, internal_notes
) values (
  'dddddddd-0000-0000-0000-000000000001', :'org', 'BK-RT-1',
  '00000000-0000-0000-0000-0000000000a1',
  'bbbbbbbb-0000-0000-0000-000000000001', 'confirmed', 'usd', 2,
  75.50, 'aaaaaaaa-0000-0000-0000-000000000001', '08:30', 'Lobby', '204', 'VCH-1',
  now(), 1, 'partial', 'cupo forzado por gerencia', 'nota visible', 'nota interna'
);

insert into participant (organization_id, booking_id, full_name, age, nationality, special_requirements, notes, checkin_status)
values (:'org', 'dddddddd-0000-0000-0000-000000000001', 'Ana Pérez', 34, 'DO', 'silla de ruedas', 'vegetariana', 'partial');

insert into voucher (organization_id, booking_id, code, issued_at, notes)
values (:'org', 'dddddddd-0000-0000-0000-000000000001', 'VCH-RT-1', now(), 'emitido en prueba');

-- ── salida generada y recálculo de cupo ────────────────────────────────────
insert into departure (id, organization_id, product_id, departure_at, capacity, booked_pax, pending_pax,
  branch_id, departure_time, available_pax, waitlist_pax, meeting_point, notes)
values ('eeeeeeee-0000-0000-0000-000000000001', :'org', 'bbbbbbbb-0000-0000-0000-000000000001',
  now() + interval '1 day', 20, 4, 1, 'cccccccc-0000-0000-0000-000000000001', '09:00', 15, 0, 'Parqueo norte', 'generada');

update departure set available_pax = 12, waitlist_pax = 2
 where id = 'eeeeeeee-0000-0000-0000-000000000001';

-- ── caja: apertura, recálculo y cierre ────────────────────────────────────
insert into cash_register (id, organization_id, name, branch_id, terminal)
values ('ffffffff-0000-0000-0000-000000000001', :'org', 'Caja 1', 'cccccccc-0000-0000-0000-000000000001', 'POS-01');

insert into cash_session (id, organization_id, cash_register_id, branch_id, code, opening_amount,
  expected_cash, counted_cash, difference, card_total, transfer_total, sales_total,
  expenses_total, withdrawals_total, currency, status, notes)
values ('ffffffff-0000-0000-0000-000000000002', :'org', 'ffffffff-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000001', 'CS-0001', 100, 100, 0, 0, 0, 0, 0, 0, 0, 'usd', 'open', 'apertura');

update cash_session
   set expected_cash = 540, card_total = 200, transfer_total = 150,
       sales_total = 890, expenses_total = 25, withdrawals_total = 0
 where id = 'ffffffff-0000-0000-0000-000000000002';

update cash_session set counted_cash = 535, difference = -5, status = 'closed', closed_at = now(), notes = 'arqueo'
 where id = 'ffffffff-0000-0000-0000-000000000002';

-- ── catálogo, vendedor y zona ──────────────────────────────────────────────
insert into product_category (id, organization_id, name) values
  ('11111111-0000-0000-0000-000000000001', :'org', 'Excursiones');

update product
   set category_id = '11111111-0000-0000-0000-000000000001', short_description = 'corta',
       duration_hours = 4.5, languages = '{es,en}', min_age = 6, default_capacity = 30,
       base_cost = 30, featured = 'yes', location = 'Bávaro', meeting_point = 'Lobby',
       inclusions = 'transporte', exclusions = 'propinas', terms = 'términos',
       instructions = 'llevar gorra', restrictions = 'no embarazadas', recommendations = 'protector solar',
       cover_image_url = 'https://x/y.jpg', video_url = 'https://x/y.mp4'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';

insert into seller (organization_id, code, first_name, branch_id, email, phone, whatsapp,
  seller_role, monthly_goal, currency, photo_url, hire_date, notes)
values (:'org', 'SL-1', 'Luis', 'cccccccc-0000-0000-0000-000000000001', 'luis@example.com',
  '809-000-0000', '809-000-0001', 'supervisor', 50000, 'usd', 'https://x/p.jpg', current_date, 'nota');

insert into zone (organization_id, name, zone_type, max_capacity, current_occupancy, requires_wristband)
values (:'org', 'Piscina principal', 'pool', 120, 0, 'yes');

do $$
begin
  -- El dominio de los campos nuevos con diccionario queda cerrado.
  begin
    insert into zone (organization_id, name, zone_type) values
      ('11111111-1111-1111-1111-111111111111', 'Zona inválida', 'casino');
    raise exception 'zone_type aceptó un valor fuera del diccionario';
  exception when check_violation then null;
  end;

  begin
    insert into seller (organization_id, code, seller_role) values
      ('11111111-1111-1111-1111-111111111111', 'SL-X', 'cajero');
    raise exception 'seller_role aceptó un valor fuera del diccionario';
  exception when check_violation then null;
  end;

  -- Y el aislamiento entre organizaciones cubre las referencias nuevas.
  begin
    update booking set hotel_id = 'aaaaaaaa-0000-0000-0000-000000000002'
     where id = 'dddddddd-0000-0000-0000-000000000001';
    raise exception 'booking.hotel_id aceptó un hotel de otra organización';
  exception when check_violation then null;
  end;

  raise notice 'runtime_columns: TODAS LAS ASERCIONES PASARON';
end $$;

-- ── condiciones comerciales del partner (0031) ─────────────────────────────
-- El límite de crédito, los días y la comisión viven en la relación, no en la
-- organización: es donde el esquema los puso desde 0002 y donde el traductor no
-- los guardaba.
insert into organizations (id, name, kind, currency, tenant_org_id, parent_org_id, metadata) values
  ('22222222-0000-0000-0000-000000000001', 'Caribe Tours', 'partner', 'usd', :'org', :'org',
   '{"commercial_name":"Caribe","contact_name":"Ana"}'::jsonb);

insert into organization_relationships (from_org_id, to_org_id, relationship_type,
  default_commission_pct, credit_limit, credit_days, contract_from, contract_to)
values (:'org', '22222222-0000-0000-0000-000000000001', 'agency', 12.5, 25000, 30, current_date, current_date + 365);

do $$
declare
  limite numeric;
begin
  select credit_limit into limite
    from organization_relationships
   where to_org_id = '22222222-0000-0000-0000-000000000001';
  if limite is distinct from 25000 then
    raise exception 'el límite de crédito del partner no se guardó (%)', limite;
  end if;

  -- 'ota' es el valor que ofrecía la UI y que la base rechazaba antes de 0031.
  begin
    insert into organization_relationships (from_org_id, to_org_id, relationship_type)
    values ('11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'ota');
  exception when check_violation then
    raise exception 'relationship_type sigue rechazando ota';
  end;

  begin
    insert into organization_relationships (from_org_id, to_org_id, relationship_type)
    values ('11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'marketplace');
    raise exception 'relationship_type aceptó un valor fuera del diccionario';
  exception when check_violation then null;
  end;

  raise notice 'partner_terms: TODAS LAS ASERCIONES PASARON';
end $$;

-- ── gift cards: el saldo no puede quedar negativo ──────────────────────────
-- La acción rechaza consumir más que el saldo, y la base lo respalda con su
-- propio `check (balance >= 0)`: dos redes para el mismo dinero.
insert into gift_card (id, organization_id, code, status, initial_amount, balance, currency)
values ('33333333-0000-0000-0000-000000000001', :'org', 'GC-TEST-1', 'active', 100, 100, 'usd');

insert into gift_card_movement (organization_id, gift_card_id, movement_type, amount, balance_after)
values (:'org', '33333333-0000-0000-0000-000000000001', 'issue', 100, 100);

do $$
begin
  update gift_card set balance = 70, status = 'partially_used'
   where id = '33333333-0000-0000-0000-000000000001';

  begin
    update gift_card set balance = -10 where id = '33333333-0000-0000-0000-000000000001';
    raise exception 'gift_card.balance aceptó un saldo negativo';
  exception when check_violation then null;
  end;

  begin
    insert into gift_card_movement (organization_id, gift_card_id, movement_type, amount, balance_after)
    values ('11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000001', 'canje', 10, 60);
    raise exception 'movement_type aceptó un valor fuera del diccionario';
  exception when check_violation then null;
  end;

  raise notice 'gift_cards: TODAS LAS ASERCIONES PASARON';
end $$;

-- ── cotizaciones: alternativas, versiones y aislamiento (0032) ─────────────
-- Una propuesta se negocia por rondas y puede ofrecer varias alternativas; las
-- líneas de una alternativa tienen que caer con ella, y nada puede apuntar a la
-- cotización de otra organización.
insert into quote (id, organization_id, code, status, quote_type, currency, valid_until, deposit_type, tax_percent)
values ('44444444-0000-0000-0000-000000000001', :'org', 'COT-TEST-1', 'draft', 'group', 'usd',
        now() + interval '15 days', 'percent', 18);

insert into quote_option (id, organization_id, quote_id, name, sort_order, is_recommended)
values ('44444444-0000-0000-0000-00000000000a', :'org', '44444444-0000-0000-0000-000000000001', 'Hotel 4*', 10, false),
       ('44444444-0000-0000-0000-00000000000b', :'org', '44444444-0000-0000-0000-000000000001', 'Hotel 5*', 20, true);

insert into quote_line (organization_id, quote_id, option_id, description, quantity, unit_price, line_total, line_type, is_optional)
values (:'org', '44444444-0000-0000-0000-000000000001', null, 'Transporte', 1, 300, 300, 'transport', false),
       (:'org', '44444444-0000-0000-0000-000000000001', '44444444-0000-0000-0000-00000000000a', 'Hotel 4*', 1, 700, 700, 'accommodation', false),
       (:'org', '44444444-0000-0000-0000-000000000001', '44444444-0000-0000-0000-00000000000b', 'Hotel 5*', 1, 1200, 1200, 'accommodation', false);

do $$
declare
  n integer;
begin
  -- 'superseded' es el estado que 0032 necesita para sacar del embudo la
  -- versión que una revisión reemplaza.
  begin
    update quote set status = 'superseded' where id = '44444444-0000-0000-0000-000000000001';
  exception when check_violation then
    raise exception 'quote.status sigue rechazando superseded';
  end;
  update quote set status = 'draft' where id = '44444444-0000-0000-0000-000000000001';

  begin
    update quote set deposit_type = 'cuota' where id = '44444444-0000-0000-0000-000000000001';
    raise exception 'deposit_type aceptó un valor fuera del diccionario';
  exception when check_violation then null;
  end;

  begin
    insert into quote_line (organization_id, quote_id, description, quantity, unit_price, line_total, line_type)
    values ('11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000001', 'Algo', 1, 10, 10, 'excursion');
    raise exception 'line_type aceptó un valor fuera del diccionario';
  exception when check_violation then null;
  end;

  -- Retirar una alternativa se lleva sus líneas: si sobrevivieran, sumarían a
  -- un precio que ya no se ofrece.
  delete from quote_option where id = '44444444-0000-0000-0000-00000000000a';
  select count(*) into n from quote_line
   where quote_id = '44444444-0000-0000-0000-000000000001'
     and option_id = '44444444-0000-0000-0000-00000000000a';
  if n <> 0 then
    raise exception 'las líneas de la alternativa retirada sobrevivieron (%)', n;
  end if;
  select count(*) into n from quote_line where quote_id = '44444444-0000-0000-0000-000000000001';
  if n <> 2 then
    raise exception 'la línea común no debía caer con la alternativa (quedan %)', n;
  end if;

  -- Y una línea no puede colgarse de la cotización de otro inquilino: es la
  -- lista de referencias que 0018 protege con su disparador.
  begin
    insert into quote_line (organization_id, quote_id, description, quantity, unit_price, line_total)
    values ('99999999-9999-9999-9999-999999999999', '44444444-0000-0000-0000-000000000001', 'Fuga', 1, 10, 10);
    raise exception 'quote_line aceptó una cotización de otra organización';
  exception when others then
    if sqlstate not in ('23514', '23503') then raise; end if;
  end;

  -- Lo mismo con la alternativa escogida que guarda la cabecera.
  begin
    insert into quote_option (organization_id, quote_id, name)
    values ('99999999-9999-9999-9999-999999999999', '44444444-0000-0000-0000-000000000001', 'Ajena');
    raise exception 'quote_option aceptó una cotización de otra organización';
  exception when others then
    if sqlstate not in ('23514', '23503') then raise; end if;
  end;

  raise notice 'cotizaciones: TODAS LAS ASERCIONES PASARON';
end $$;

-- ── cierre de salida (0033) ────────────────────────────────────────────────
-- Cerrar una salida es afirmar cuánta gente viajó DE VERDAD, que no es lo
-- vendido: un no-show se cobró y no ocupó asiento.
insert into departure (id, organization_id, product_id, departure_at, capacity, booked_pax)
values ('55555555-0000-0000-0000-000000000001', :'org', 'bbbbbbbb-0000-0000-0000-000000000001',
        now() - interval '2 hours', 20, 8);

do $$
declare
  pax integer;
begin
  update departure
     set status = 'completed', closed_at = now(), departed_at = now() - interval '2 hours',
         actual_pax = 6, no_show_pax = 2,
         incident_notes = 'Retraso de 40 minutos por avería',
         guide_notes = 'Grupo puntual'
   where id = '55555555-0000-0000-0000-000000000001';

  select actual_pax into pax from departure where id = '55555555-0000-0000-0000-000000000001';
  if pax is distinct from 6 then
    raise exception 'el cierre no guardó los pax embarcados (%)', pax;
  end if;

  -- Un recuento negativo no existe: son plazas ocupadas.
  begin
    update departure set actual_pax = -1 where id = '55555555-0000-0000-0000-000000000001';
    raise exception 'actual_pax aceptó un recuento negativo';
  exception when check_violation then null;
  end;

  raise notice 'cierre_salida: TODAS LAS ASERCIONES PASARON';
end $$;

-- ── bandeja de salida (0034) ───────────────────────────────────────────────
-- Un aviso se manda UNA vez: el índice único de `dedupe_key` es lo que sostiene
-- esa promesa aunque dos pasadas del cron se solapen.
insert into customer (id, organization_id, first_name, last_name, email)
values ('66666666-0000-0000-0000-000000000001', :'org', 'Ana', 'Pérez', 'ana@example.com');

insert into message (organization_id, channel, template_key, status, to_address, body, dedupe_key, customer_id)
values (:'org', 'email', 'booking_confirmation', 'queued', 'ana@example.com',
        'Hola Ana', 'booking_confirmation:email:b1', '66666666-0000-0000-0000-000000000001');

do $$
declare
  n integer;
begin
  begin
    insert into message (organization_id, channel, template_key, status, to_address, body, dedupe_key)
    values ('11111111-1111-1111-1111-111111111111', 'email', 'booking_confirmation', 'queued',
            'ana@example.com', 'Hola Ana otra vez', 'booking_confirmation:email:b1');
    raise exception 'la bandeja aceptó dos veces el mismo aviso';
  exception when unique_violation then null;
  end;

  -- Pero el mismo aviso por OTRO canal sí es otro mensaje: quien dio correo y
  -- WhatsApp recibe por los dos.
  insert into message (organization_id, channel, template_key, status, to_address, body, dedupe_key)
  values ('11111111-1111-1111-1111-111111111111', 'whatsapp', 'booking_confirmation', 'queued',
          '+18095550101', 'Hola Ana', 'booking_confirmation:whatsapp:b1');

  -- Y los mensajes sin clave no se estorban entre sí: un reenvío a mano puede
  -- repetirse tantas veces como el cliente lo pida.
  insert into message (organization_id, channel, status, to_address, body)
  values ('11111111-1111-1111-1111-111111111111', 'email', 'queued', 'ana@example.com', 'Reenvío 1'),
         ('11111111-1111-1111-1111-111111111111', 'email', 'queued', 'ana@example.com', 'Reenvío 2');

  select count(*) into n from message where organization_id = '11111111-1111-1111-1111-111111111111';
  if n <> 4 then
    raise exception 'la bandeja no tiene los mensajes esperados (%)', n;
  end if;

  begin
    update message set status = 'entregado' where dedupe_key = 'booking_confirmation:email:b1';
    raise exception 'message.status aceptó un valor fuera del diccionario';
  exception when check_violation then null;
  end;

  -- Un mensaje no puede colgarse del cliente de otra organización.
  begin
    insert into message (organization_id, channel, status, to_address, body, customer_id)
    values ('99999999-9999-9999-9999-999999999999', 'email', 'queued', 'x@example.com', 'Fuga',
            '66666666-0000-0000-0000-000000000001');
    raise exception 'message aceptó un cliente de otra organización';
  exception when others then
    if sqlstate not in ('23514', '23503') then raise; end if;
  end;

  raise notice 'comunicaciones: TODAS LAS ASERCIONES PASARON';
end $$;

-- ── documento adjunto (0035) ───────────────────────────────────────────────
-- La fila guarda QUÉ documento acompaña al aviso, no el documento: el PDF se
-- compone al entregar para que nunca viaje una versión vieja.
do $$
begin
  update message set attachment_kind = 'voucher'
   where dedupe_key = 'booking_confirmation:email:b1';

  begin
    update message set attachment_kind = 'factura'
     where dedupe_key = 'booking_confirmation:email:b1';
    raise exception 'attachment_kind aceptó un documento que no se sabe componer';
  exception when check_violation then null;
  end;

  -- Un mensaje sin adjunto es lo normal y sigue siendo válido.
  update message set attachment_kind = null
   where dedupe_key = 'booking_confirmation:whatsapp:b1';

  raise notice 'adjuntos: TODAS LAS ASERCIONES PASARON';
end $$;

-- ── extras vendibles (0036) ────────────────────────────────────────────────
-- El precio de lo contratado se congela con la reserva, y retirar un extra del
-- catálogo no puede borrar lo que un cliente ya compró.
insert into product_extra (id, organization_id, product_id, name, price_type, price, cost, is_required)
values ('77777777-0000-0000-0000-000000000001', :'org', 'bbbbbbbb-0000-0000-0000-000000000001',
        'Almuerzo langosta', 'per_person', 35, 18, false);

insert into booking_extra (organization_id, booking_id, extra_id, name, price_type, quantity, unit_price, total_amount, cost_amount)
values (:'org', 'dddddddd-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001',
        'Almuerzo langosta', 'per_person', 2, 35, 70, 36);

do $$
declare
  guardado numeric;
  quedan integer;
begin
  begin
    update product_extra set price_type = 'por_grupo'
     where id = '77777777-0000-0000-0000-000000000001';
    raise exception 'price_type aceptó un valor fuera del diccionario';
  exception when check_violation then null;
  end;

  -- Retirar el extra del catálogo deja la venta en pie: el voucher de una
  -- reserva vieja tiene que seguir diciendo qué se compró y por cuánto.
  delete from product_extra where id = '77777777-0000-0000-0000-000000000001';
  select count(*), max(unit_price) into quedan, guardado
    from booking_extra where booking_id = 'dddddddd-0000-0000-0000-000000000001';
  if quedan <> 1 or guardado is distinct from 35 then
    raise exception 'la venta del extra no sobrevivió a su retirada del catálogo (% filas, precio %)', quedan, guardado;
  end if;

  -- Y un extra no puede colgarse de la reserva de otra organización.
  begin
    insert into booking_extra (organization_id, booking_id, name, quantity, unit_price, total_amount)
    values ('99999999-9999-9999-9999-999999999999', 'dddddddd-0000-0000-0000-000000000001', 'Fuga', 1, 10, 10);
    raise exception 'booking_extra aceptó una reserva de otra organización';
  exception when others then
    if sqlstate not in ('23514', '23503') then raise; end if;
  end;

  raise notice 'extras: TODAS LAS ASERCIONES PASARON';
end $$;

-- ── secuencia de NCF (0037) ────────────────────────────────────────────────
-- El número de un comprobante fiscal se consume UNA vez: dos facturas con el
-- mismo NCF invalidan las dos, y un hueco en la secuencia hay que justificarlo
-- ante la DGII tres meses después, cuando ya nadie recuerda por qué.
insert into ncf_sequence (organization_id, ncf_type, next_number, max_number, expires_at)
values (:'org', 'b02', 1, 3, current_date + 365),
       (:'org', 'b01', 1, 100, current_date - 1);

-- La función se declaró `security invoker` con comprobación de organización, así
-- que hay que hablarle como le habla la aplicación: con el inquilino en el
-- claim. Sin sesión no entrega números, y eso también se comprueba abajo.
select set_config('request.jwt.claims',
  '{"org_id":"11111111-1111-1111-1111-111111111111","app_role":"admin"}', false);

do $$
declare
  a bigint; b bigint; c bigint;
begin
  a := public.next_ncf('11111111-1111-1111-1111-111111111111', 'b02');
  b := public.next_ncf('11111111-1111-1111-1111-111111111111', 'b02');
  if a <> 1 or b <> 2 then
    raise exception 'la secuencia no avanza de uno en uno (% y %)', a, b;
  end if;

  -- El tercero agota el rango autorizado; el cuarto tiene que fallar DICIENDO
  -- que se agotó, no con un error genérico.
  c := public.next_ncf('11111111-1111-1111-1111-111111111111', 'b02');
  if c <> 3 then raise exception 'el último número del rango no se entregó (%)', c; end if;

  begin
    perform public.next_ncf('11111111-1111-1111-1111-111111111111', 'b02');
    raise exception 'la secuencia entregó un número fuera del rango autorizado';
  exception when others then
    if position('agotó' in sqlerrm) = 0 then
      raise exception 'el agotamiento no se explica: %', sqlerrm;
    end if;
  end;

  -- Una autorización vencida no entrega números aunque le queden.
  begin
    perform public.next_ncf('11111111-1111-1111-1111-111111111111', 'b01');
    raise exception 'la secuencia vencida entregó un número';
  exception when others then
    if position('venció' in sqlerrm) = 0 then
      raise exception 'el vencimiento no se explica: %', sqlerrm;
    end if;
  end;

  -- Un tipo sin configurar se distingue de uno agotado.
  begin
    perform public.next_ncf('11111111-1111-1111-1111-111111111111', 'b15');
    raise exception 'entregó un número de un tipo sin configurar';
  exception when others then
    if position('No hay secuencia' in sqlerrm) = 0 then
      raise exception 'la falta de configuración no se explica: %', sqlerrm;
    end if;
  end;

  -- Y dos filas del mismo tipo serían dos numeraciones paralelas.
  begin
    insert into ncf_sequence (organization_id, ncf_type)
    values ('11111111-1111-1111-1111-111111111111', 'b02');
    raise exception 'se admitieron dos secuencias del mismo tipo';
  exception when unique_violation then null;
  end;

  -- La secuencia de OTRO inquilino no se toca ni pasando su id: sin esto,
  -- cualquier usuario autenticado podría quemarle los NCF a la competencia.
  begin
    perform public.next_ncf('99999999-9999-9999-9999-999999999999', 'b02');
    raise exception 'entregó un número de la secuencia de otra organización';
  exception when insufficient_privilege then null;
  end;

  raise notice 'ncf: TODAS LAS ASERCIONES PASARON';
end $$;

select set_config('request.jwt.claims', '', false);

-- ─────────────────────────────────────────────────────────────────────────────
-- 0038 — El arqueo de caja
--
-- Lo que se comprueba aquí es lo que sostiene el control: que el conteo de una
-- moneda no se pueda duplicar, que el estado de revisión exista de verdad, y
-- que un conteo no se pueda colgar de la caja de otra empresa.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '11111111-1111-1111-1111-111111111111';
  other uuid := '99999999-9999-9999-9999-999999999999';
  sess uuid := 'ffffffff-0000-0000-0000-000000000002';
begin
  -- La tolerancia es política de la empresa y vive en la caja.
  update cash_register set difference_tolerance = 25
   where id = 'ffffffff-0000-0000-0000-000000000001';

  insert into cash_count (organization_id, cash_session_id, currency, kind, breakdown,
                          counted_total, expected_total, difference)
  values (org, sess, 'dop', 'close',
          '[{"denomination":2000,"quantity":3},{"denomination":100,"quantity":5}]'::jsonb,
          6500, 6700, -200);

  -- Dos conteos de cierre de la misma moneda serían dos verdades sobre el
  -- mismo dinero.
  begin
    insert into cash_count (organization_id, cash_session_id, currency, kind)
    values (org, sess, 'dop', 'close');
    raise exception 'se admitieron dos conteos de cierre de la misma moneda';
  exception when unique_violation then null;
  end;

  -- La otra moneda del turno sí se cuenta aparte: ese es el punto.
  insert into cash_count (organization_id, cash_session_id, currency, kind, counted_total)
  values (org, sess, 'usd', 'close', 120);

  -- Un arqueo sorpresa puede repetirse: el índice único es parcial.
  insert into cash_count (organization_id, cash_session_id, currency, kind, counted_total)
  values (org, sess, 'dop', 'spot', 3000), (org, sess, 'dop', 'spot', 2500);

  -- Un conteo colgado de la caja de otra empresa no entra.
  begin
    insert into cash_count (organization_id, cash_session_id, currency, kind)
    values (other, sess, 'dop', 'spot');
    raise exception 'se admitió un conteo entre inquilinos distintos';
  exception when others then
    if position('Cross-tenant' in sqlerrm) = 0 then
      raise exception 'el rechazo entre inquilinos no se explica: %', sqlerrm;
    end if;
  end;

  -- El estado de revisión existe y es alcanzable; 'reconciled' ya estaba en el
  -- check desde 0006 pero ninguna ruta lo escribía.
  update cash_session
     set status = 'pending_approval', requires_approval = true, closed_by = null,
         expected_by_currency = '{"dop":6700,"usd":120}'::jsonb,
         counted_by_currency  = '{"dop":6500,"usd":120}'::jsonb,
         difference_by_currency = '{"dop":-200,"usd":0}'::jsonb,
         card_batch_total = 4200, card_batch_reference = 'LOTE-77',
         deposit_reference = 'BOV-12', difference_reason = 'vuelto mal dado'
   where id = sess;

  update cash_session set status = 'reconciled', approved_at = now(), approval_notes = 'revisado'
   where id = sess;

  begin
    update cash_session set status = 'whatever' where id = sess;
    raise exception 'la sesión admitió un estado inventado';
  exception when check_violation then null;
  end;

  -- Y el descuadre llega a la contabilidad enlazado a su turno.
  insert into ledger_entry (organization_id, entry_code, line_no, source_type, cash_session_id, debit, credit)
  values (org, 'AS-TEST-1', 1, 'cash_close', sess, 200, 0),
         (org, 'AS-TEST-1', 2, 'cash_close', sess, 0, 200);

  raise notice 'arqueo: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0039 — El anticipo, el saldo y el plan de cuotas
--
-- Lo que se prueba: que el calendario no pueda tener dos cuotas con el mismo
-- número, que el estado de cobro de la venta exista de verdad, que una cuota no
-- se pueda colgar de la orden de otra empresa, y que la antigüedad hable el
-- mismo idioma que la pantalla —que es justo lo que no pasaba.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '11111111-1111-1111-1111-111111111111';
  other uuid := '99999999-9999-9999-9999-999999999999';
  ord uuid := '00000000-0000-0000-0000-0000000000a1';
  bk  uuid := 'dddddddd-0000-0000-0000-000000000001';
  sched uuid;
begin
  -- Condiciones pactadas en la venta y política del producto.
  update sales_order
     set deposit_type = 'percent', deposit_percent = 30, deposit_due_date = current_date,
         balance_due_date = current_date + 30, payment_terms = '30% ahora, saldo 15 días antes',
         hold_until = now() + interval '48 hours', collection_status = 'on_track'
   where id = ord;

  update product
     set deposit_type = 'percent', deposit_percent = 30, balance_due_days = 15
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';

  update booking set balance_due_date = current_date + 15 where id = bk;

  insert into payment_schedule (organization_id, order_id, booking_id, sequence, kind, due_date, amount, balance)
  values (org, ord, bk, 1, 'deposit', current_date, 300, 300)
  returning id into sched;

  insert into payment_schedule (organization_id, order_id, sequence, kind, due_date, amount, balance)
  values (org, ord, 2, 'balance', current_date + 30, 700, 700);

  -- Dos cuotas con el mismo número son dos calendarios a la vez.
  begin
    insert into payment_schedule (organization_id, order_id, sequence, kind, due_date, amount)
    values (org, ord, 1, 'installment', current_date + 7, 100);
    raise exception 'se admitieron dos cuotas con el mismo número';
  exception when unique_violation then null;
  end;

  -- Una cuota de la orden de otra empresa no entra.
  begin
    insert into payment_schedule (organization_id, order_id, sequence, kind, due_date, amount)
    values (other, ord, 9, 'installment', current_date, 50);
    raise exception 'se admitió una cuota entre inquilinos distintos';
  exception when others then
    if position('Cross-tenant' in sqlerrm) = 0 then
      raise exception 'el rechazo entre inquilinos no se explica: %', sqlerrm;
    end if;
  end;

  -- Los estados del calendario y del cobro son los que escribe la aplicación.
  update payment_schedule set status = 'overdue' where id = sched;
  update payment_schedule set status = 'partially_paid', paid_amount = 100, balance = 200 where id = sched;
  update payment_schedule set status = 'waived' where id = sched;

  begin
    update payment_schedule set status = 'inventado' where id = sched;
    raise exception 'la cuota admitió un estado inventado';
  exception when check_violation then null;
  end;

  update sales_order set collection_status = 'overdue' where id = ord;
  update sales_order set collection_status = 'settled' where id = ord;

  begin
    update sales_order set collection_status = 'loquesea' where id = ord;
    raise exception 'la venta admitió un estado de cobro inventado';
  exception when check_violation then null;
  end;

  begin
    update sales_order set deposit_type = 'porcentaje' where id = ord;
    raise exception 'la venta admitió un tipo de anticipo inventado';
  exception when check_violation then null;
  end;

  -- El pago se imputa a una cuota.
  insert into payment (organization_id, order_id, schedule_id, reference, amount, currency)
  values (org, ord, sched, 'PAY-RT-SCHED', 300, 'usd');

  -- Y la antigüedad habla el mismo idioma que la pantalla: 'd1_30', no '1_30'.
  -- El enum decía una cosa y la interfaz otra, así que guardar el tramo que la
  -- propia UI ofrecía lo rechazaba la base.
  insert into receivable (organization_id, order_id, amount, balance, aging_bucket, due_date)
  values (org, ord, 500, 500, 'd1_30', current_date - 10);

  begin
    insert into receivable (organization_id, order_id, amount, aging_bucket)
    values (org, ord, 100, '1_30');
    raise exception 'el enum sigue admitiendo el vocabulario viejo';
  exception when invalid_text_representation then null;
  end;

  -- La retención del cupo se configura por empresa; nulo significa sin límite.
  update organizations set hold_hours = 48 where id = org;
  update organizations set hold_hours = null where id = org;

  begin
    update organizations set hold_hours = -1 where id = org;
    raise exception 'se admitió una retención negativa';
  exception when check_violation then null;
  end;

  raise notice 'cobros: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0040 — La liquidación del proveedor que operó el servicio
--
-- Lo que se comprueba: que el devengo se pueda colgar de una reserva y de su
-- proveedor pero no de los de otra empresa, que el estado del devengo y el de la
-- liquidación existan de verdad, que 'supplier' sea un beneficiario válido, y
-- que la cuenta por pagar pueda nombrar al proveedor —que podía desde 0030 y
-- nadie lo hacía nunca.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '11111111-1111-1111-1111-111111111111';
  other uuid := '99999999-9999-9999-9999-999999999999';
  bk  uuid := 'dddddddd-0000-0000-0000-000000000001';
  dep uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  sup uuid;
  tariff uuid;
  liq uuid;
  cost uuid;
begin
  insert into supplier (organization_id, name, supplier_type, tax_id, tax_regime,
                        retention_isr_pct, retention_itbis_pct, tax_rate,
                        payment_terms_days, bank_name, bank_account)
  values (org, 'Transporte de prueba', 'transport', '130123456', 'individual',
          10, 100, 18, 15, 'Banco Popular', '1234567890')
  returning id into sup;

  insert into product_cost (organization_id, product_id, supplier_id, concept, cost_type, amount, currency)
  values (org, 'bbbbbbbb-0000-0000-0000-000000000001', sup, 'Transporte', 'per_person', 350, 'dop')
  returning id into tariff;

  -- El devengo: lo que esta reserva le debe a ese proveedor.
  insert into booking_cost (organization_id, booking_id, departure_id, supplier_id, product_cost_id,
                            concept, cost_type, quantity, unit_cost, amount, currency)
  values (org, bk, dep, sup, tariff, 'Transporte', 'per_person', 2, 350, 700, 'dop')
  returning id into cost;

  update booking set accrued_cost = 700 where id = bk;

  -- Todos los estados del devengo son alcanzables.
  update booking_cost set status = 'confirmed', confirmed_amount = 700 where id = cost;
  update booking_cost set status = 'disputed', confirmed_amount = 900 where id = cost;
  update booking_cost set status = 'settled' where id = cost;
  update booking_cost set status = 'paid' where id = cost;
  update booking_cost set status = 'waived' where id = cost;
  update booking_cost set status = 'accrued', confirmed_amount = null where id = cost;

  begin
    update booking_cost set status = 'inventado' where id = cost;
    raise exception 'el devengo admitió un estado inventado';
  exception when check_violation then null;
  end;

  begin
    update booking_cost set cost_type = 'por_persona' where id = cost;
    raise exception 'el devengo admitió un tipo de costo inventado';
  exception when check_violation then null;
  end;

  -- Un devengo no se cuelga de la reserva de otra empresa.
  begin
    insert into booking_cost (organization_id, booking_id, concept, amount)
    values (other, bk, 'Cruzado', 100);
    raise exception 'se admitió un devengo entre inquilinos distintos';
  exception when others then
    if position('Cross-tenant' in sqlerrm) = 0 then
      raise exception 'el rechazo entre inquilinos no se explica: %', sqlerrm;
    end if;
  end;

  -- 'supplier' es un beneficiario válido de una liquidación (el enum se amplió).
  insert into settlement (organization_id, code, beneficiary_type, supplier_id, beneficiary_name,
                          services_total, confirmed_total, base_total,
                          retention_isr, retention_itbis, retention_total, net_total,
                          supplier_invoice_number, supplier_invoice_ncf, supplier_invoice_date,
                          currency, status)
  values (org, 'LIQ-RT-SUP', 'supplier', sup, 'Transporte de prueba',
          700, 826, 700, 70, 126, 196, 630,
          'B0100000123', 'B0100000123', current_date, 'dop', 'pending')
  returning id into liq;

  update booking_cost set settlement_id = liq, status = 'settled' where id = cost;

  -- El abono parcial existe: 'partially_paid' estaba en el check desde 0006 y
  -- ninguna ruta lo escribía.
  update settlement set status = 'partially_paid', paid_total = 300, pending_total = 330,
                        last_payment_at = now()
   where id = liq;
  update settlement set status = 'disputed', dispute_reason = 'no cuadra' where id = liq;
  update settlement set status = 'paid', paid_total = 630, pending_total = 0 where id = liq;

  -- La cuenta por pagar nombra al proveedor.
  insert into payable (organization_id, supplier_id, settlement_id, concept, category,
                       amount, balance, currency, status)
  values (org, sup, liq, 'Liquidación de servicios', 'supplier_services', 630, 630, 'dop', 'pending');

  -- El régimen fiscal está acotado.
  begin
    update supplier set tax_regime = 'loquesea' where id = sup;
    raise exception 'el proveedor admitió un régimen fiscal inventado';
  exception when check_violation then null;
  end;

  begin
    update supplier set retention_isr_pct = 120 where id = sup;
    raise exception 'se admitió una retención por encima del 100%%';
  exception when check_violation then null;
  end;

  raise notice 'liquidacion_proveedor: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0041 — Park & Tours como satélite de MembeGo
--
-- Lo que se comprueba: que el vínculo empresa↔organización sea uno-a-uno en
-- las DOS direcciones, que el mapa de identidad sea por `sub` único, que el
-- espejo del cliente no pueda cruzar la ficha de otra organización, y que las
-- dos idempotencias del contrato (evento y jti) choquen de verdad en el
-- segundo insert — que es todo lo que las hace idempotencias.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org   uuid := '11111111-1111-1111-1111-111111111111';
  other uuid := '99999999-9999-9999-9999-999999999999';
  usr  uuid;
  cust uuid;
begin
  insert into auth.users (email) values ('membego-admin@ejemplo.com') returning id into usr;

  insert into membego_link (organization_id, membego_company_id, linked_by)
  values (org, 'cmre-empresa-1', usr);

  -- Una organización tiene UN vínculo…
  begin
    insert into membego_link (organization_id, membego_company_id) values (org, 'cmre-empresa-2');
    raise exception 'se admitió un segundo vínculo para la misma organización';
  exception when unique_violation then null;
  end;

  -- …y una empresa de MembeGo también: dos organizaciones leyendo los
  -- clientes de la misma empresa sería un cruce de datos, no una integración.
  begin
    insert into membego_link (organization_id, membego_company_id) values (other, 'cmre-empresa-1');
    raise exception 'se admitió la misma empresa de MembeGo en dos organizaciones';
  exception when unique_violation then null;
  end;

  begin
    update membego_link set status = 'roto' where organization_id = org;
    raise exception 'el vínculo admitió un estado inventado';
  exception when check_violation then null;
  end;
  update membego_link set status = 'suspended' where organization_id = org;
  update membego_link set status = 'active'    where organization_id = org;

  -- El mapa de identidad es por sub, y el sub es único: un cambio de correo
  -- en MembeGo no puede fabricar una segunda cuenta local.
  insert into membego_user (organization_id, membego_sub, user_id, membego_role, role_managed)
  values (org, 'sub-123', usr, 'ADMIN_EMPRESA', true);
  begin
    insert into membego_user (organization_id, membego_sub, user_id) values (org, 'sub-123', usr);
    raise exception 'se admitió el mismo sub de MembeGo dos veces';
  exception when unique_violation then null;
  end;

  -- El espejo del cliente, y su cruce prohibido entre organizaciones.
  insert into customer (organization_id, first_name, last_name, email)
  values (org, 'Cliente', 'Membego', 'cliente-membego@ejemplo.com')
  returning id into cust;

  insert into membego_customer (organization_id, membego_cliente_id, customer_id, plan_name, visits)
  values (org, 'cli-1', cust, 'Plan Oro', 1);

  begin
    insert into membego_customer (organization_id, membego_cliente_id, customer_id)
    values (other, 'cli-2', cust);
    raise exception 'el espejo apuntó a la ficha de otra organización';
  exception when others then
    if position('Cross-tenant' in sqlerrm) = 0 then
      raise exception 'el rechazo entre inquilinos no se explica: %', sqlerrm;
    end if;
  end;

  -- El upsert de efectos usa la clave natural (organización, cliente).
  insert into membego_customer (organization_id, membego_cliente_id, visits)
  values (org, 'cli-1', 2)
  on conflict (organization_id, membego_cliente_id) do update set visits = excluded.visits;

  -- La idempotencia del evento ES la clave primaria: el reintento choca aquí.
  insert into membego_event (event_id, organization_id, tipo, payload)
  values ('evt-1', org, 'cliente.visita', '{"clienteId":"cli-1"}');
  begin
    insert into membego_event (event_id, organization_id, tipo) values ('evt-1', org, 'cliente.visita');
    raise exception 'el mismo evento entró dos veces';
  exception when unique_violation then null;
  end;
  begin
    update membego_event set status = 'pendiente' where event_id = 'evt-1';
    raise exception 'el evento admitió un estado inventado';
  exception when check_violation then null;
  end;
  update membego_event set status = 'failed', error = 'efecto falló' where event_id = 'evt-1';

  -- Y el jti del SSO igual: el segundo canje del mismo token choca.
  insert into membego_sso_jti (jti, expires_at) values ('jti-1', now() + interval '90 seconds');
  begin
    insert into membego_sso_jti (jti, expires_at) values ('jti-1', now());
    raise exception 'el mismo jti se canjeó dos veces';
  exception when unique_violation then null;
  end;

  raise notice 'membego: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
