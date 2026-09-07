-- ============================================================================
-- Prueba de la RPC public.dashboard_summary (Panel ejecutivo).
--
-- Cubre los hallazgos de la auditoría que no se pueden verificar sin una base
-- de datos real (agregación multi-divisa, atribución de comisión, conteos):
--   A2  el margen de series/rankings resta la comisión variable (contribución)
--   A3  los conteos financieros solo cuentan filas en moneda base y exponen
--       `*_excluded_count` para las foráneas sin conversión
--   M1  las CxC vencidas se derivan del vencimiento real (due_date), no del flag
--   M2  el efectivo se desglosa por divisa física (`cash_by_currency`)
--   M3  las próximas salidas van en orden cronológico
--   M5  la caja acota la recaudación a los pagos registrados por el cajero
--
-- Ejecutar contra una base con las migraciones 0001..N aplicadas:
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/dashboard_summary.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;
set local session_replication_role = replica;  -- prueba unitaria enfocada: sin disparadores de FK/tenant

\set org '11111111-1111-1111-1111-111111111111'
\set prod '22222222-2222-2222-2222-222222222222'
\set cashier '44444444-4444-4444-4444-444444444444'
\set other '55555555-5555-5555-5555-555555555555'

insert into booking (id, organization_id, booking_number, order_id, product_id, status, currency, base_currency,
  total_amount, base_amount, cost_amount, base_cost_amount, refund_amount, base_refund_amount, exchange_rate, pax_total, booking_date, channel)
values
  ('33333333-3333-3333-3333-333333333331', :'org', 'BK-1', gen_random_uuid(), :'prod', 'paid', 'usd', 'usd', 1000, 1000, 400, 400, 0, 0, 1, 2, now(), 'direct'),
  ('33333333-3333-3333-3333-333333333332', :'org', 'BK-2', gen_random_uuid(), :'prod', 'paid', 'usd', 'usd',  500,  500, 200, 200, 0, 0, 1, 1, now(), 'web');

-- B4: canales adicionales para probar la agrupación en 'otros' (top 5 + resto).
-- Ventas: direct=1000, phone=900, whatsapp=800, walk_in=700, agency=600 (top 5);
-- web=500, ota=100, pos=50 (remanente → 'otros' = 650).
insert into booking (organization_id, booking_number, order_id, product_id, status, currency, base_currency,
  total_amount, base_amount, cost_amount, base_cost_amount, exchange_rate, pax_total, booking_date, channel)
values
  (:'org', 'BK-3', gen_random_uuid(), :'prod', 'paid', 'usd', 'usd', 900, 900, 0, 0, 1, 1, now(), 'phone'),
  (:'org', 'BK-4', gen_random_uuid(), :'prod', 'paid', 'usd', 'usd', 800, 800, 0, 0, 1, 1, now(), 'whatsapp'),
  (:'org', 'BK-5', gen_random_uuid(), :'prod', 'paid', 'usd', 'usd', 700, 700, 0, 0, 1, 1, now(), 'walk_in'),
  (:'org', 'BK-6', gen_random_uuid(), :'prod', 'paid', 'usd', 'usd', 600, 600, 0, 0, 1, 1, now(), 'agency'),
  (:'org', 'BK-7', gen_random_uuid(), :'prod', 'paid', 'usd', 'usd', 100, 100, 0, 0, 1, 1, now(), 'ota'),
  (:'org', 'BK-8', gen_random_uuid(), :'prod', 'paid', 'usd', 'usd',  50,  50, 0, 0, 1, 1, now(), 'pos');

-- A2: comisión en moneda base atribuida a BK-1 (resta del margen).
-- A3: comisión foránea (eur) → excluida del total y del margen, contada aparte.
insert into commission (organization_id, booking_id, beneficiary_type, amount, currency, status)
values
  (:'org', '33333333-3333-3333-3333-333333333331', 'seller', 100, 'usd', 'pending'),
  (:'org', '33333333-3333-3333-3333-333333333332', 'seller',  50, 'eur', 'pending');

-- M1: una CxC con vencimiento pasado pero status 'pending' (flag sin refrescar)
-- debe contar como vencida; una futura no.
insert into receivable (organization_id, balance, currency, status, due_date)
values
  (:'org', 300, 'usd', 'pending', current_date - 5),   -- vencida por due_date
  (:'org', 150, 'usd', 'pending', current_date + 5),   -- al día
  (:'org', 100, 'eur', 'overdue', current_date - 1);   -- foránea + vencida

insert into payable (organization_id, balance, currency, status)
values (:'org', 200, 'usd', 'pending'), (:'org', 80, 'eur', 'pending');

-- M2: efectivo en dos divisas físicas.
insert into cash_session (organization_id, user_id, status, expected_cash, base_expected_cash, currency, exchange_rate)
values
  (:'org', :'cashier', 'open', 500, 500, 'usd', 1),
  (:'org', :'cashier', 'open', 300, 330, 'eur', 1.1);

-- M5: pagos de dos usuarios distintos. El cajero solo debe ver los suyos.
insert into payment (organization_id, user_id, status, payment_type, amount, base_amount, currency, exchange_rate, paid_at, reference)
values
  (:'org', :'cashier', 'completed', 'payment', 400, 400, 'usd', 1, now(), 'PAY-CASHIER'),
  (:'org', :'other',   'completed', 'payment', 600, 600, 'usd', 1, now(), 'PAY-OTHER');

-- M3: salidas en desorden de inserción; deben salir por fecha ascendente.
insert into departure (organization_id, product_id, departure_at, capacity, booked_pax, pending_pax, status)
values
  (:'org', :'prod', now() + interval '5 days', 20, 18, 0, 'available'),   -- más tarde, casi lleno
  (:'org', :'prod', now() + interval '1 day',  20,  2, 0, 'available');   -- más pronto, poca ocupación

select set_config('request.jwt.claims', json_build_object('org_id', :'org', 'app_role', 'owner')::text, true);

do $$
declare
  admin jsonb; cashier jsonb;
  org uuid := '11111111-1111-1111-1111-111111111111';
  cashier_id uuid := '44444444-4444-4444-4444-444444444444';
  f timestamptz := now() - interval '1 day'; t timestamptz := now() + interval '1 day';
  pf timestamptz := now() - interval '2 day'; pt timestamptz := now() - interval '1 day';
  series_margin numeric; usd_cash numeric; eur_cash numeric; first_dep timestamptz;
  direct_margin numeric; otros_sales numeric; channel_sales numeric; n_channels int;
begin
  -- Vista de administración (sin acotar por cajero).
  admin := public.dashboard_summary(org, f, t, pf, pt, 'usd', 'America/Santo_Domingo');

  -- A2: el margen resta la comisión variable. Margen total de series =
  -- direct(1000-400-100=500) + web(300) + phone(900) + whatsapp(800)
  --   + walk_in(700) + agency(600) + ota(100) + pos(50) = 3950.
  select coalesce(sum((e->>'margin')::numeric),0) from jsonb_array_elements(admin->'series') e into series_margin;
  assert series_margin = 3950, format('A2: series margin esperado 3950, obtuvo %s', series_margin);
  -- A2 en el desglose por canal: el canal 'direct' resta su comisión (1000-400-100).
  select (x->>'margin')::numeric from jsonb_array_elements(admin->'by_channel') x where x->>'key' = 'direct' into direct_margin;
  assert direct_margin = 500, format('A2: margen de canal direct esperado 500, obtuvo %s', direct_margin);

  -- B4: 5 canales principales + 'otros'. Suma de porciones = ventas netas (4650).
  select jsonb_array_length(admin->'by_channel') into n_channels;
  assert n_channels = 6, format('B4: se esperaban 6 filas (top5 + otros), obtuvo %s', n_channels);
  select (x->>'sales')::numeric from jsonb_array_elements(admin->'by_channel') x where x->>'key' = 'otros' into otros_sales;
  assert otros_sales = 650, format('B4: ventas de otros esperado 650 (500+100+50), obtuvo %s', otros_sales);
  select coalesce(sum((x->>'sales')::numeric),0) from jsonb_array_elements(admin->'by_channel') x into channel_sales;
  assert channel_sales = (admin->>'net_sales')::numeric, format('B4: suma por canal %s != ventas netas %s', channel_sales, admin->>'net_sales');

  -- A3: comisiones — total solo base (100), 1 contada, 1 excluida (eur).
  assert (admin->>'commission_total')::numeric = 100, format('A3 commission_total=%s', admin->>'commission_total');
  assert (admin->>'commission_count')::int = 1, format('A3 commission_count=%s', admin->>'commission_count');
  assert (admin->>'commission_excluded_count')::int = 1, format('A3 commission_excluded_count=%s', admin->>'commission_excluded_count');
  -- A3: CxC — total base (300+150=450), 2 contadas, 1 excluida.
  assert (admin->>'receivable_total')::numeric = 450, format('A3 receivable_total=%s', admin->>'receivable_total');
  assert (admin->>'receivable_count')::int = 2, format('A3 receivable_count=%s', admin->>'receivable_count');
  assert (admin->>'receivable_excluded_count')::int = 1, format('A3 receivable_excluded_count=%s', admin->>'receivable_excluded_count');
  assert (admin->>'payable_excluded_count')::int = 1, format('A3 payable_excluded_count=%s', admin->>'payable_excluded_count');

  -- M1: vencidas por due_date = 2 (la usd 'pending' vencida + la eur 'overdue' vencida),
  -- NO la usd 'pending' con vencimiento futuro.
  assert (admin->>'receivable_overdue_count')::int = 2, format('M1 overdue_count=%s (esperado 2 por due_date)', admin->>'receivable_overdue_count');

  -- M2: desglose de efectivo por divisa.
  select (x->>'amount')::numeric from jsonb_array_elements(admin->'cash_by_currency') x where x->>'currency' = 'usd' into usd_cash;
  select (x->>'amount')::numeric from jsonb_array_elements(admin->'cash_by_currency') x where x->>'currency' = 'eur' into eur_cash;
  assert usd_cash = 500, format('M2 cash usd=%s', usd_cash);
  assert eur_cash = 300, format('M2 cash eur (nominal)=%s', eur_cash);
  assert jsonb_array_length(admin->'cash_by_currency') = 2, 'M2: se esperaban 2 divisas';
  -- total base sigue disponible: 500 + 330 = 830.
  assert (admin->>'cash_total')::numeric = 830, format('M2 cash_total base=%s', admin->>'cash_total');

  -- M3: primera salida = la de +1 día (cronológica), no la de menor ocupación.
  select (admin->'upcoming_departures'->0->>'departure_at')::timestamptz into first_dep;
  assert first_dep < now() + interval '2 days', format('M3 primera salida=%s (esperada la más próxima)', first_dep);

  -- Recaudación de administración = 400 + 600 = 1000 (toda la organización).
  assert (admin->>'collected')::numeric = 1000, format('collected admin=%s', admin->>'collected');

  -- M5: la caja solo ve su recaudación (400), no la del otro usuario.
  cashier := public.dashboard_summary(org, f, t, pf, pt, 'usd', 'America/Santo_Domingo',
    null, null, null, null, null, 'sales', cashier_id);
  assert (cashier->>'collected')::numeric = 400, format('M5 collected cajero=%s (esperado 400)', cashier->>'collected');

  raise notice 'dashboard_summary: TODAS LAS ASERCIONES PASARON (A2, A3, M1, M2, M3, M5, B4)';
end $$;

rollback;
