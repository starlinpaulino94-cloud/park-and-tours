-- 0081 — De quién es el dinero de esta caja.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE LA CAJA NO SABÍA DECIR
--
-- `cash_register`, `cash_session` y `cash_movement` llevan sucursal y usuario, y
-- nada más. No hay forma de expresar «esta caja es del tour center Coral» ni
-- «este turno es del vendedor de la playa»: el dinero de la calle no cabe en el
-- modelo.
--
-- Y hay un sitio donde eso ya se pierde HOY, sin esperar a la caja externa:
-- `/api/payments` crea el cobro CON su socio —la columna `payment.partner`
-- existe y se rellena— y acto seguido abre el `cash_movement` sin él. El apunte
-- de caja de una venta de socio es indistinguible del efectivo propio de la
-- operadora desde el momento en que se escribe.
--
-- Mientras el socio no pueda abrir caja, eso no descuadra nada: todo el efectivo
-- está de verdad en el cajón de la operadora. Deja de ser cierto en cuanto
-- exista la caja externa, y entonces el arqueo diría que la operadora tiene un
-- dinero que está en el mostrador de otro.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EN LAS TRES TABLAS, Y NO SOLO EN LA SESIÓN
--
-- La CAJA es de quien la opera: una caja del tour center Coral no puede abrir
-- un turno de la operadora ni al revés. El TURNO hereda de la caja, pero se
-- guarda igualmente, porque el arqueo se hace por turno y una consulta que
-- tenga que saltar a la caja para saber de quién es el dinero acaba
-- olvidándose de saltar. Y el MOVIMIENTO se sella también, porque es la fila
-- que se suma: sumar filtrando por una columna de otra tabla es exactamente el
-- salto que se olvida.
--
-- Es el mismo criterio que llevó `partner_id` a `customer` en 0075: el dato
-- vive donde se consulta.
alter table cash_register
  add column if not exists partner_id uuid references organizations(id) on delete restrict,
  add column if not exists seller_id  uuid references seller(id) on delete set null;

alter table cash_session
  add column if not exists partner_id uuid references organizations(id) on delete restrict,
  add column if not exists seller_id  uuid references seller(id) on delete set null;

alter table cash_movement
  add column if not exists partner_id uuid references organizations(id) on delete restrict,
  add column if not exists seller_id  uuid references seller(id) on delete set null;

comment on column cash_session.partner_id is
  'El tour center cuyo mostrador es esta caja (0081). Nulo = caja de la '
  'operadora. El arqueo interno EXCLUYE las que lo llevan: su efectivo está en '
  'el mostrador del socio, no en el cajón de la operadora.';
comment on column cash_movement.partner_id is
  'Se sella al escribir el movimiento, copiándolo del cobro (0081). Vive aquí '
  'y no solo en la sesión porque ésta es la fila que se SUMA: filtrar por una '
  'columna de otra tabla es el salto que alguna consulta se acaba olvidando.';

-- El arqueo pregunta «qué hay en la caja de la operadora en este turno», y esa
-- consulta filtra por socio. Sin el índice, es un recorrido de la tabla entera
-- de movimientos cada vez que alguien cierra un turno.
create index if not exists cash_movement_partner_idx
  on cash_movement (organization_id, partner_id, movement_at desc);
create index if not exists cash_session_partner_idx
  on cash_session (organization_id, partner_id, status);
create index if not exists cash_movement_seller_idx
  on cash_movement (organization_id, seller_id, movement_at desc)
  where seller_id is not null;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- LA POLÍTICA, EN LA MISMA ENTREGA
--
-- El riesgo transversal del plan. Hasta ahora estas tres tablas tenían solo el
-- aislamiento por empresa: la BASE le habría dejado a un miembro de un tour
-- center leer el efectivo de la operadora entera y el de las demás agencias.
-- Hoy lo tapa el rango del rol —`partner` no llega a `cashier`—, que es
-- justamente la clase de defensa que 4.2 quitó de en medio en todas partes.
--
-- `can_read_partner` sirve tal cual: el interno (sin identificador de socio) lo
-- ve todo, y el socio solo lo suyo. A diferencia de `notification`, aquí no hay
-- filas «personales» que se quedarían fuera.
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
