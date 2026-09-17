-- ============================================================================
-- 0060 — Metas comerciales y bonos.
--
-- Lo que se comprueba aquí es lo que la base tiene que impedir para que una
-- meta signifique algo: que no exista una meta que no pide nada (no se puede
-- cumplir ni incumplir), que un rango sin fechas no se cuele como campaña, y
-- que un premio en especie se distinga siempre del dinero — porque esa
-- distinción decide si la operadora transfiere o no.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/seller_goals.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

\set org   '55555555-5555-5555-5555-555555555555'
\set other '66666666-6666-6666-6666-666666666666'

insert into organizations (id, name, kind, currency) values
  (:'org',   'Operadora de metas', 'tenant', 'usd'),
  (:'other', 'Operadora ajena',    'tenant', 'usd');

insert into seller (id, organization_id, code, first_name) values
  ('99990000-0000-0000-0000-000000000001', :'org',   'MET-001', 'Rafael'),
  ('99990000-0000-0000-0000-000000000002', :'other', 'AJE-001', 'Ajeno');

-- ─────────────────────────────────────────────────────────────────────────────
-- La meta
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '55555555-5555-5555-5555-555555555555';
  rafael uuid := '99990000-0000-0000-0000-000000000001';
  meta uuid;
begin
  -- «Rafael: 40 ventas y 150 pasajeros este mes.»
  insert into seller_goal (organization_id, name, seller_id, period, target_sales, target_pax)
  values (org, 'Rafael septiembre', rafael, 'monthly', 40, 150)
  returning id into meta;

  -- UNA META QUE NO PIDE NADA no se puede cumplir ni incumplir: es una fila que
  -- ocupa sitio en el tablero y no significa nada.
  begin
    insert into seller_goal (organization_id, name, seller_id, period)
    values (org, 'Meta vacía', rafael, 'monthly');
    raise exception 'se admitió una meta sin ninguna dimensión';
  exception when check_violation then null;
  end;

  -- Una meta de ingresos SOLA sí vale: es una dimensión como cualquier otra.
  insert into seller_goal (organization_id, name, seller_id, period, target_revenue, currency)
  values (org, 'Solo ingresos', rafael, 'monthly', 50000, 'usd');

  -- Una meta de cero ventas se cumple sola y ensucia el tablero.
  begin
    insert into seller_goal (organization_id, name, seller_id, period, target_sales)
    values (org, 'Cero', rafael, 'monthly', 0);
    raise exception 'se admitió una meta de cero';
  exception when check_violation then null;
  end;

  -- Un periodo inventado no se podría medir.
  begin
    insert into seller_goal (organization_id, name, seller_id, period, target_sales)
    values (org, 'Cuando sea', rafael, 'cuando_sea', 10);
    raise exception 'se admitió un periodo inventado';
  exception when check_violation then null;
  end;

  -- UN RANGO SIN FECHAS es una meta perpetua disfrazada de campaña.
  begin
    insert into seller_goal (organization_id, name, seller_id, period, target_sales)
    values (org, 'Rango sin fechas', rafael, 'range', 10);
    raise exception 'se admitió un rango sin fechas';
  exception when check_violation then null;
  end;

  insert into seller_goal (organization_id, name, seller_id, period, period_from, period_to, target_sales)
  values (org, 'Campaña de octubre', rafael, 'range', '2026-10-01', '2026-10-15', 20);

  -- Un rango que termina antes de empezar parece vivo y es imposible.
  begin
    insert into seller_goal (organization_id, name, seller_id, period, period_from, period_to, target_sales)
    values (org, 'Al revés', rafael, 'range', '2026-10-15', '2026-10-01', 20);
    raise exception 'se admitió un rango que termina antes de empezar';
  exception when check_violation then null;
  end;

  -- Aislamiento: no se le pone una meta al vendedor de otra empresa.
  begin
    insert into seller_goal (organization_id, name, seller_id, period, target_sales)
    values (org, 'Cruzada', '99990000-0000-0000-0000-000000000002', 'monthly', 10);
    raise exception 'se admitió una meta sobre el vendedor de otra empresa';
  exception when others then
    if sqlerrm not like '%tenant%' and sqlerrm not like '%organization%' then raise; end if;
  end;

  raise notice 'seller_goal: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- El bono
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '55555555-5555-5555-5555-555555555555';
  rafael uuid := '99990000-0000-0000-0000-000000000001';
begin
  -- En efectivo: sale del banco.
  insert into seller_bonus (organization_id, seller_id, description, amount, payout_kind)
  values (org, rafael, 'Meta de pasajeros de septiembre', 100, 'cash');

  -- En especie: tiene valor y NO sale del banco. La distinción vive en la
  -- columna, no en una convención de nombres.
  insert into seller_bonus (organization_id, seller_id, description, amount, payout_kind, condition)
  values (org, rafael, 'Dos pases a Saona', 80, 'in_kind',
          '{"target_pax": 150, "reached": 163}'::jsonb);

  -- Una tercera forma de pagar no existiría en ninguna liquidación.
  begin
    insert into seller_bonus (organization_id, seller_id, description, amount, payout_kind)
    values (org, rafael, 'Con un abrazo', 10, 'abrazo');
    raise exception 'se admitió una forma de pago inventada';
  exception when check_violation then null;
  end;

  -- Un bono sin descripción no se puede explicar en una liquidación, que es
  -- donde alguien lo va a leer.
  begin
    insert into seller_bonus (organization_id, seller_id, description, amount)
    values (org, rafael, '   ', 10);
    raise exception 'se admitió un bono sin descripción';
  exception when check_violation then null;
  end;

  -- Para quitar se usa un ajuste de comisión, no un bono en negativo.
  begin
    insert into seller_bonus (organization_id, seller_id, description, amount)
    values (org, rafael, 'Devolución', -10);
    raise exception 'se admitió un bono negativo';
  exception when check_violation then null;
  end;

  begin
    insert into seller_bonus (organization_id, seller_id, description, amount, status)
    values (org, rafael, 'Estado raro', 10, 'casi_pagado');
    raise exception 'se admitió un estado de bono inventado';
  exception when check_violation then null;
  end;

  raise notice 'seller_bonus: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- La liquidación separa lo que se transfiere de lo que no
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '55555555-5555-5555-5555-555555555555';
  liq uuid;
begin
  insert into settlement (organization_id, code, beneficiary_type)
  values (org, 'PAY-G-1', 'seller') returning id into liq;

  -- Las dos columnas arrancan en cero, no en nulo: una liquidación anterior a
  -- esta migración diría «sin bonos», que es la verdad.
  if (select bonus_total from settlement where id = liq) is distinct from 0 then
    raise exception 'bonus_total no arranca en cero';
  end if;
  if (select in_kind_total from settlement where id = liq) is distinct from 0 then
    raise exception 'in_kind_total no arranca en cero';
  end if;

  update settlement set bonus_total = 100, in_kind_total = 80 where id = liq;

  begin
    update settlement set in_kind_total = -1 where id = liq;
    raise exception 'se admitió un total en especie negativo';
  exception when check_violation then null;
  end;

  raise notice 'settlement 0060: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
