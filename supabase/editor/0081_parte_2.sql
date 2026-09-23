-- 0081 · parte 2 de 2 — Los cerrojos y la política de lectura.
--
-- Ejecuta la parte 1 ANTES que esta.
--
-- QUÉ HACE
--  · Un turno de caja no cambia de dueño a mitad. Sin esto, mover el socio de
--    una sesión abierta reasigna de golpe todo su efectivo, y en la dirección
--    cara: una caja de socio que se vuelve de la operadora mete en el arqueo un
--    dinero que nadie tiene.
--  · Un movimiento no cae en el arqueo de otro: es el cerrojo del criterio del
--    plan. El arqueo suma los movimientos de SU turno, así que basta con que
--    ninguno pueda llevar un dueño distinto del de su turno — y eso no se
--    consigue acordándose de copiarlo bien en las tres rutas que escriben.
--  · El cerrojo de empresa de siempre: una caja no puede apuntar al socio de
--    otra operadora.
--  · Y la política de lectura. Hasta ahora estas tres tablas tenían solo el
--    aislamiento por empresa: la BASE le habría dejado a un miembro de un tour
--    center leer el efectivo de la operadora entera. Hoy lo tapa el rango del
--    rol, que es justo la clase de defensa que la fase 4 quitó de en medio.
--
-- NO borra ni cambia ninguna fila.

-- ─────────────────────────────────────────────────────────────────────────────
-- EL CERROJO: UN TURNO NO CAMBIA DE DUEÑO A MITAD
--
-- Sin esto, mover `partner_id` en una sesión abierta reasigna de golpe todo el
-- efectivo del turno — y lo hace en la dirección cara: una caja de socio que se
-- vuelve caja de la operadora mete en el arqueo un dinero que nadie tiene.
-- Se corrige creando el turno que toca, no editando el que hay.
-- ─────────────────────────────────────────────────────────────────────────────
-- EL CERROJO: UN TURNO NO CAMBIA DE DUEÑO A MITAD
--
-- Sin esto, mover `partner_id` en una sesión abierta reasigna de golpe todo el
-- efectivo del turno — y lo hace en la dirección cara: una caja de socio que se
-- vuelve caja de la operadora mete en el arqueo un dinero que nadie tiene.
-- Se corrige creando el turno que toca, no editando el que hay.
create or replace function app.cash_session_owner_is_frozen()
returns trigger language plpgsql as $fn$
begin
  if old.partner_id is distinct from new.partner_id
     or old.seller_id is distinct from new.seller_id then
    raise exception 'El dueño de un turno de caja no se cambia; abre el turno que corresponda'
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists cash_session_owner_frozen on cash_session;
create trigger cash_session_owner_frozen
before update of partner_id, seller_id on cash_session
for each row execute function app.cash_session_owner_is_frozen();

-- ─────────────────────────────────────────────────────────────────────────────
-- UN MOVIMIENTO NO CAE EN EL ARQUEO DE OTRO
--
-- Este es el cerrojo del criterio: «un arqueo de la operadora no incluye ni un
-- movimiento de caja de socio». El arqueo suma los movimientos de SU turno, así
-- que basta con que ningún movimiento pueda llevar un dueño distinto del de su
-- turno — y eso no se consigue acordándose de copiarlo bien en las tres rutas
-- que escriben, se consigue aquí.
--
-- Sin esto, un movimiento con el socio mal puesto entra en el arqueo
-- equivocado sin que nada chille, y se descubre contando el efectivo.
create or replace function app.cash_movement_matches_session()
returns trigger language plpgsql as $fn2$
declare
  s_partner uuid;
  s_seller  uuid;
begin
  if new.cash_session_id is null then
    return new;
  end if;

  select partner_id, seller_id into s_partner, s_seller
    from cash_session where id = new.cash_session_id;

  -- `is distinct from` y no `<>`: con nulos, `<>` devuelve nulo y la condición
  -- no se cumple nunca — que es justo el caso normal, la caja de la operadora.
  if new.partner_id is distinct from s_partner then
    raise exception 'El movimiento es de otro tour center que su turno de caja'
      using errcode = '23514';
  end if;
  if new.seller_id is distinct from s_seller then
    raise exception 'El movimiento es de otro vendedor que su turno de caja'
      using errcode = '23514';
  end if;
  return new;
end;
$fn2$;

drop trigger if exists cash_movement_matches_session on cash_movement;
create trigger cash_movement_matches_session
before insert or update of partner_id, seller_id, cash_session_id on cash_movement
for each row execute function app.cash_movement_matches_session();

-- Y el cerrojo de empresa de siempre: una caja no puede apuntar al socio de
-- otra operadora.
drop trigger if exists cash_session_same_tenant on cash_session;
create trigger cash_session_same_tenant
before insert or update of organization_id, partner_id on cash_session
for each row execute function app.enforce_same_tenant_refs('partner_id', 'organizations');

do $pol$
declare
  t text;
begin
  foreach t in array array['cash_register', 'cash_session', 'cash_movement'] loop
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format(
      'create policy tenant_select on public.%I for select '
      'using (organization_id = app.current_org_id() and app.can_read_partner(partner_id))',
      t
    );
  end loop;
end $pol$;

-- ── VERIFICACIÓN ───────────────────────────────────────────────────────────
-- Tienen que salir las TRES políticas, cada una con `can_read_partner` dentro.
select polrelid::regclass as tabla,
       pg_get_expr(polqual, polrelid) as condicion
  from pg_policy
 where polrelid in ('public.cash_register'::regclass,
                    'public.cash_session'::regclass,
                    'public.cash_movement'::regclass)
   and polname = 'tenant_select'
 order by tabla;
