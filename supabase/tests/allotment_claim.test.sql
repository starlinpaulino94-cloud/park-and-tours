-- ============================================================================
-- 0100 — EL CUPO DEL SOCIO SE RECLAMA EN UNA SOLA SENTENCIA.
--
-- Lo medido antes de esta migración: treinta ventas simultáneas de una plaza
-- contra un cupo garantizado de 10 dejaban `seats_used` en 2, con las treinta
-- pasando. El contador no sobrepasaba el tope: se PERDÍA, y la matriz de cupos
-- enseñaba hueco libre donde el socio ya había vendido tres veces.
--
-- La carrera de verdad —procesos en paralelo— vive en `scripts/db-test.sh`,
-- porque una prueba SQL corre en UNA sesión. Aquí se sujeta lo que sí se puede
-- comprobar en una: que el tope es el bueno, que el reclamo es todo o nada, y
-- que la devolución dice cuántas plazas devolvió DE VERDAD.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/allotment_claim.test.sql
-- Transaccional: hace rollback, no deja datos.
-- ============================================================================
begin;

\set org    '01000000-0000-0000-0000-0000000000a0'
\set socio  '01000000-0000-0000-0000-0000000000a1'
\set prod   '01000000-0000-0000-0000-0000000000a2'
\set cupo   '01000000-0000-0000-0000-0000000000a3'

insert into organizations (id, name, kind) values (:'org', 'Operadora', 'tenant');
insert into organizations (id, name, kind, tenant_org_id)
  values (:'socio', 'Tour center', 'partner', :'org');
insert into product (id, organization_id, name, base_price)
  values (:'prod', :'org', 'Isla Saona', 89);

do $$
declare
  cupo       uuid := '01000000-0000-0000-0000-0000000000a3';
  org        uuid := '01000000-0000-0000-0000-0000000000a0';
  socio      uuid := '01000000-0000-0000-0000-0000000000a1';
  prod       uuid := '01000000-0000-0000-0000-0000000000a2';
  fallos     text := '';
  ok         boolean;
  devueltas  integer;
begin
  insert into allotment (id, organization_id, partner_id, product_id,
                         allotment_type, seats, seats_used, seats_released, status)
    values (cupo, org, socio, prod, 'guaranteed', 10, 0, 0, 'active');

  -- ── el reclamo normal ───────────────────────────────────────────────────
  ok := public.claim_allotment_seats(cupo, 4);
  if ok is not true then fallos := fallos || 'no dejó reclamar 4 de 10; '::text; end if;
  if (select seats_used from allotment where id = cupo) <> 4 then
    fallos := fallos || 'el contador no subió a 4; '::text;
  end if;

  -- ── TODO O NADA ─────────────────────────────────────────────────────────
  -- Un reclamo que no cabe no puede dejar el cupo a medias: sería vender media
  -- excursión a una familia de cuatro.
  ok := public.claim_allotment_seats(cupo, 7);
  if ok is not false then fallos := fallos || 'dejó reclamar 7 cuando quedaban 6; '::text; end if;
  if (select seats_used from allotment where id = cupo) <> 4 then
    fallos := fallos || 'un reclamo rechazado movió el contador; '::text;
  end if;

  -- ── LAS LIBERADAS RESTAN ────────────────────────────────────────────────
  -- Volvieron a la venta libre: contarlas como disponibles prometería dos veces
  -- la misma plaza, una al socio y otra a quien la compró después.
  update allotment set seats_released = 3 where id = cupo;
  ok := public.claim_allotment_seats(cupo, 4);
  if ok is not false then
    fallos := fallos || 'ignoró las plazas liberadas al calcular lo que queda; '::text;
  end if;
  ok := public.claim_allotment_seats(cupo, 3);
  if ok is not true then fallos := fallos || 'no dejó reclamar las 3 que sí quedaban; '::text; end if;
  if (select seats_used from allotment where id = cupo) <> 7 then
    fallos := fallos || 'el contador no llegó a 7; '::text;
  end if;

  -- ── EL CUPO LLENO ───────────────────────────────────────────────────────
  ok := public.claim_allotment_seats(cupo, 1);
  if ok is not false then fallos := fallos || 'dejó pasar del tope con el cupo lleno; '::text; end if;

  -- ── LA DEVOLUCIÓN DICE LA VERDAD ────────────────────────────────────────
  devueltas := public.release_allotment_seats(cupo, 3);
  if devueltas <> 3 then
    fallos := fallos || 'la devolución de 3 dijo ' || devueltas || '; '::text;
  end if;
  if (select seats_used from allotment where id = cupo) <> 4 then
    fallos := fallos || 'la devolución no bajó el contador a 4; '::text;
  end if;

  -- Devolver más de lo consumido no puede dejar el contador en negativo —el
  -- cupo prometería plazas que no existen— y tiene que DECIR que devolvió
  -- menos de lo que se le pidió.
  devueltas := public.release_allotment_seats(cupo, 99);
  if devueltas <> 4 then
    fallos := fallos || 'devolver de más dijo ' || devueltas || ' en vez de 4; '::text;
  end if;
  if (select seats_used from allotment where id = cupo) <> 0 then
    fallos := fallos || 'la devolución dejó el contador fuera de cero; '::text;
  end if;

  -- ── LO QUE NO ES UN RECLAMO ─────────────────────────────────────────────
  begin
    ok := public.claim_allotment_seats(cupo, 0);
    fallos := fallos || 'admitió un reclamo de cero plazas; '::text;
  exception when check_violation then null;
  end;
  begin
    ok := public.claim_allotment_seats(cupo, -3);
    fallos := fallos || 'admitió un reclamo negativo, que sería una devolución disfrazada; '::text;
  exception when check_violation then null;
  end;
  begin
    ok := public.claim_allotment_seats(null, 2);
    fallos := fallos || 'admitió un reclamo sin cupo; '::text;
  exception when null_value_not_allowed then null;
  end;

  -- Un cupo que no existe no es un error: es un contrato que alguien borró
  -- mientras se vendía. No cabe, y ya está.
  ok := public.claim_allotment_seats('01000000-0000-0000-0000-00000000dead'::uuid, 1);
  if ok is not false then fallos := fallos || 'dijo que cabía en un cupo inexistente; '::text; end if;
  if public.release_allotment_seats('01000000-0000-0000-0000-00000000dead'::uuid, 1) <> 0 then
    fallos := fallos || 'devolvió plazas a un cupo inexistente; '::text;
  end if;

  if fallos <> '' then
    raise exception 'allotment 0100 FALLÓ: %', fallos;
  end if;
  raise notice 'allotment 0100: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
