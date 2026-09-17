-- ============================================================================
-- 0059 — Los ajustes de comisión: un movimiento contable no se edita.
--
-- Lo que se comprueba aquí lo sostiene la base y no se puede comprobar desde
-- TypeScript: que un ajuste no se pueda borrar ni reescribir, que no se admita
-- uno de cero ni sin motivo, y que los tres tipos de cálculo por pasajero sean
-- valores válidos del enum —una regla guardada con uno de ellos rompería el
-- INSERT entero si el enum no los tuviera.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/commission_adjustment.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

\set org   '33333333-3333-3333-3333-333333333333'
\set other '77777777-7777-7777-7777-777777777777'

insert into organizations (id, name, kind, currency) values
  (:'org',   'Operadora de comisiones', 'tenant', 'usd'),
  (:'other', 'Operadora ajena',          'tenant', 'usd');

insert into commission (id, organization_id, beneficiary_type, base_amount, amount, currency, status)
values
  ('44440000-0000-0000-0000-000000000001', :'org',   'seller', 300, 30, 'usd', 'paid'),
  ('44440000-0000-0000-0000-000000000002', :'other', 'seller', 300, 30, 'usd', 'paid');

-- ─────────────────────────────────────────────────────────────────────────────
-- Los tipos de cálculo por pasajero existen de verdad en el enum
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '33333333-3333-3333-3333-333333333333';
begin
  -- El acuerdo más común de una operadora de excursiones: «te pago X por cada
  -- adulto». Sin estos valores, guardar esa regla fallaría entera.
  insert into commission_rule (organization_id, name, calc_type, value)
  values (org, 'Por adulto', 'per_adult', 10),
         (org, 'Por niño',   'per_child', 5),
         (org, 'Por pax',    'per_pax',   4);

  -- Y los dos que estuvieron calculándose como porcentaje siguen ahí: quitarlos
  -- dejaría sin cálculo las reglas ya guardadas con ellos.
  insert into commission_rule (organization_id, name, calc_type, value)
  values (org, 'Tarifa neta', 'net_rate', 45), (org, 'Markup', 'markup', 20);

  begin
    insert into commission_rule (organization_id, name, calc_type, value)
    values (org, 'Inventado', 'por_las_buenas', 1);
    raise exception 'se admitió un tipo de cálculo inventado';
  exception when invalid_text_representation then null;
  end;

  -- La base del escalón está acotada: un valor libre haría que el motor cayera
  -- silenciosamente al cálculo por importe.
  insert into commission_rule (organization_id, name, calc_type, value, tier_basis)
  values (org, 'Escalón por pax', 'tiered', 0, 'pax');
  begin
    insert into commission_rule (organization_id, name, calc_type, value, tier_basis)
    values (org, 'Escalón raro', 'tiered', 0, 'por_personas');
    raise exception 'se admitió una base de escalón inventada';
  exception when check_violation then null;
  end;

  -- Una vigencia que termina antes de empezar no aplicaría nunca: es una regla
  -- muerta que parece viva en el listado.
  begin
    insert into commission_rule (organization_id, name, calc_type, value, effective_from, effective_to)
    values (org, 'Al revés', 'percentage', 10, '2026-10-31', '2026-10-01');
    raise exception 'se admitió una vigencia que termina antes de empezar';
  exception when check_violation then null;
  end;

  raise notice 'commission_rule 0059: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- El ajuste: se crea una vez y no se toca más
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '33333333-3333-3333-3333-333333333333';
  comision uuid := '44440000-0000-0000-0000-000000000001';
  ajuste uuid;
  liq uuid;
begin
  insert into commission_adjustment (organization_id, commission_id, amount, reason, reason_code)
  values (org, comision, -30, 'Reserva BK-1 cancelada', 'cancellation')
  returning id into ajuste;

  -- Un ajuste de cero no ajusta nada y ensucia el expediente.
  begin
    insert into commission_adjustment (organization_id, commission_id, amount, reason)
    values (org, comision, 0, 'Nada');
    raise exception 'se admitió un ajuste de cero';
  exception when check_violation then null;
  end;

  -- Un movimiento de dinero sin motivo es lo que hace imposible defender una
  -- liquidación seis semanas después.
  begin
    insert into commission_adjustment (organization_id, commission_id, amount, reason)
    values (org, comision, -5, '   ');
    raise exception 'se admitió un ajuste sin motivo';
  exception when check_violation then null;
  end;

  begin
    insert into commission_adjustment (organization_id, commission_id, amount, reason, reason_code)
    values (org, comision, -5, 'Porque sí', 'porque_si');
    raise exception 'se admitió un código de motivo inventado';
  exception when check_violation then null;
  end;

  -- LA ÚNICA EDICIÓN PERMITIDA: engancharlo a la liquidación que lo paga. Eso
  -- pasa después y no cambia ni el importe ni el motivo.
  insert into settlement (organization_id, code, beneficiary_type)
  values (org, 'PAY-T-1', 'seller') returning id into liq;
  update commission_adjustment set settlement_id = liq where id = ajuste;

  -- Todo lo demás es inmutable: corregir la corrección editándola deja el
  -- histórico diciendo que siempre fue así.
  begin
    update commission_adjustment set amount = -10 where id = ajuste;
    raise exception 'se admitió cambiar el importe de un ajuste';
  exception when check_violation then null;
  end;

  begin
    update commission_adjustment set reason = 'Otra cosa' where id = ajuste;
    raise exception 'se admitió cambiar el motivo de un ajuste';
  exception when check_violation then null;
  end;

  begin
    update commission_adjustment set created_at = now() - interval '30 days' where id = ajuste;
    raise exception 'se admitió retrasar la fecha de un ajuste';
  exception when check_violation then null;
  end;

  begin
    delete from commission_adjustment where id = ajuste;
    raise exception 'se admitió borrar un movimiento contable';
  exception when check_violation then null;
  end;

  if (select count(*) from commission_adjustment where id = ajuste) <> 1 then
    raise exception 'el ajuste desapareció pese al disparador';
  end if;

  -- Aislamiento: no se ajusta la comisión de otra empresa.
  begin
    insert into commission_adjustment (organization_id, commission_id, amount, reason)
    values (org, '44440000-0000-0000-0000-000000000002', -5, 'Cruzado');
    raise exception 'se admitió ajustar la comisión de otra empresa';
  exception when others then
    if sqlerrm not like '%tenant%' and sqlerrm not like '%organization%' then raise; end if;
  end;

  raise notice 'commission_adjustment: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- El neto de la comisión
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  org uuid := '33333333-3333-3333-3333-333333333333';
  comision uuid := '44440000-0000-0000-0000-000000000001';
begin
  -- Sin ajustes el neto ES el importe: nacer en nulo haría que la liquidación
  -- leyera cero para todo lo que ya existía antes de esta migración.
  if (select net_amount from commission where id = comision) is distinct from 30 then
    raise exception 'la comisión existente no heredó su neto';
  end if;

  update commission set adjustment_total = -30, net_amount = 0 where id = comision;

  -- Un neto negativo lo sumaría la liquidación como si fuera cobrable, y no lo
  -- es: una comisión no se convierte en una deuda del vendedor.
  begin
    update commission set net_amount = -5 where id = comision;
    raise exception 'se admitió un neto negativo';
  exception when check_violation then null;
  end;

  -- Los pasajeros congelados no pueden ser negativos.
  begin
    update commission set pax_adults = -1 where id = comision;
    raise exception 'se admitieron pasajeros negativos';
  exception when check_violation then null;
  end;

  update commission set breakdown = '10.00 USD × 3 adultos', pax_adults = 3, pax_children = 0
   where id = comision;

  raise notice 'commission 0059: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
