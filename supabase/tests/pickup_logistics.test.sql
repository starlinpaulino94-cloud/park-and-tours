-- ============================================================================
-- 0065 — La logística del día, comprobada contra la base de verdad.
--
-- Lo que se comprueba aquí no es que las columnas existan (eso ya lo exige el
-- bloque final de la propia migración), sino que las REGLAS muerden:
--
--   · rehacer las rutas del día no puede duplicarlas;
--   · una ruta hecha a mano no compite con las que arma el motor;
--   · un desfase imposible no entra en la base.
--
-- Sin la primera, cada clic en «armar rutas» dejaría la operación con tres
-- copias de la misma guagua y nadie sabría cuál mirar.
--
-- Los identificadores van escritos tal cual dentro de los bloques `do`: psql no
-- sustituye sus variables dentro de una cadena con comillas de dólar, así que
-- un `:'org'` ahí dentro llegaría a Postgres literal y la prueba fallaría por
-- un motivo que no tiene nada que ver con lo que quiere comprobar.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/pickup_logistics.test.sql
-- Es transaccional y hace rollback: no deja datos.
-- ============================================================================
begin;

insert into organizations (id, name, kind, currency, tenant_org_id)
values ('65650000-6565-6565-6565-656565656565', 'Operadora de la logística', 'tenant', 'usd',
        '65650000-6565-6565-6565-656565656565');

insert into zone (id, organization_id, name, pickup_offset_min)
values ('65650000-0000-0000-0000-000000000021', '65650000-6565-6565-6565-656565656565', 'Bávaro', 75);

insert into product (id, organization_id, name, product_type, status)
values ('65650000-0000-0000-0000-000000000031', '65650000-6565-6565-6565-656565656565',
        'Isla Saona', 'tour', 'active');

insert into departure (id, organization_id, product_id, departure_at, capacity)
values ('65650000-0000-0000-0000-000000000041', '65650000-6565-6565-6565-656565656565',
        '65650000-0000-0000-0000-000000000031', now() + interval '1 day', 40);

-- ─────────────────────────────────────────────────────────────────────────────
-- Rehacer el día no duplica la ruta del motor
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  duplicada boolean := false;
begin
  insert into pickup_route (organization_id, departure_id, zone_id, name, auto_key)
  values ('65650000-6565-6565-6565-656565656565', '65650000-0000-0000-0000-000000000041',
          '65650000-0000-0000-0000-000000000021', 'Bávaro · coche 1', 'zona:bavaro:1');

  begin
    insert into pickup_route (organization_id, departure_id, zone_id, name, auto_key)
    values ('65650000-6565-6565-6565-656565656565', '65650000-0000-0000-0000-000000000041',
            '65650000-0000-0000-0000-000000000021', 'Bávaro · coche 1 (otra vez)', 'zona:bavaro:1');
    duplicada := true;
  exception when unique_violation then
    duplicada := false;
  end;

  if duplicada then
    raise exception 'la misma ruta automática entró dos veces: armar el día duplicaría la operación';
  end if;

  raise notice 'ruta automática irrepetible: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Las rutas hechas a mano no compiten entre ellas
--
-- Dos rutas manuales de la misma salida y la misma zona son legítimas: dos
-- guaguas que el despacho separó a mano. Lo que lo permite NO es que el índice
-- sea parcial —se comprobó quitándole el `where` y esto seguía pasando— sino
-- que Postgres considera distintos los nulos en un índice único. Se comprueba
-- igual, porque es la regla de negocio la que importa: el día que alguien le
-- ponga `nulls not distinct` al índice, esta prueba lo dirá.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  insert into pickup_route (organization_id, departure_id, zone_id, name)
  values ('65650000-6565-6565-6565-656565656565', '65650000-0000-0000-0000-000000000041',
          '65650000-0000-0000-0000-000000000021', 'A mano 1');
  insert into pickup_route (organization_id, departure_id, zone_id, name)
  values ('65650000-6565-6565-6565-656565656565', '65650000-0000-0000-0000-000000000041',
          '65650000-0000-0000-0000-000000000021', 'A mano 2');

  raise notice 'rutas manuales sin llave: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Un desfase imposible no entra
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  entro boolean;
begin
  entro := true;
  begin
    update zone set pickup_offset_min = -10 where id = '65650000-0000-0000-0000-000000000021';
  exception when check_violation then entro := false;
  end;
  if entro then raise exception 'la zona aceptó un desfase negativo'; end if;

  entro := true;
  begin
    update zone set pickup_offset_min = 900 where id = '65650000-0000-0000-0000-000000000021';
  exception when check_violation then entro := false;
  end;
  if entro then raise exception 'la zona aceptó un desfase de 15 horas'; end if;

  raise notice 'desfase de la zona acotado: TODAS LAS ASERCIONES PASARON';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- La parada empieza en 1
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  ruta  uuid;
  entro boolean := true;
begin
  select id into ruta from pickup_route
   where auto_key = 'zona:bavaro:1'
     and organization_id = '65650000-6565-6565-6565-656565656565';

  begin
    insert into pickup (organization_id, route_id, location, pax, sequence)
    values ('65650000-6565-6565-6565-656565656565', ruta, 'Lobby', 2, 0);
  exception when check_violation then entro := false;
  end;
  if entro then raise exception 'entró una parada número 0: la hoja de ruta empezaría en cero'; end if;

  insert into pickup (organization_id, route_id, location, pax, sequence)
  values ('65650000-6565-6565-6565-656565656565', ruta, 'Lobby', 2, 1);

  raise notice 'numeración de paradas: TODAS LAS ASERCIONES PASARON';
end $$;

rollback;
