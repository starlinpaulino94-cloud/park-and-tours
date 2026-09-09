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

rollback;
