-- 0074 — El socio gestiona a su propia gente.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ HACE FALTA UNA COLUMNA NUEVA Y NO VALE EL ROL DE SIEMPRE
--
-- Desde 0073 la equivalencia es dura: rol de socio si y solo si organización de
-- socio. O sea que TODAS las personas de un tour center tienen exactamente el
-- mismo `role`, y no hay dónde escribir «esta puede dar de alta a las demás».
--
-- Relajar la equivalencia para meter ahí la jerarquía del socio sería reabrir
-- la puerta que 0073 cierra: cada rol nuevo admitido sobre una organización de
-- socio es un rol que el aislamiento tendría que volver a reconocer uno a uno.
--
-- Así que la jerarquía INTERNA del socio va en su propia columna. El
-- aislamiento sigue leyendo `role`, que no se mueve; `partner_role` solo decide
-- quién manda DENTRO del tour center, y no significa nada fuera de él.
alter table organization_memberships
  add column if not exists partner_role text
    check (partner_role is null or partner_role in ('admin','agent'));

comment on column organization_memberships.partner_role is
  'Jerarquía DENTRO de un tour center (0074): admin gestiona a los suyos, '
  'agent no. Null fuera de las organizaciones de tipo socio. No participa en '
  'el aislamiento, que sigue decidiéndose por role + partner_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- EL RELLENO, Y POR QUÉ EL MÁS ANTIGUO
--
-- Sin esto, ningún tour center existente tendría administrador y la función
-- entera nacería apagada para todos ellos — con la operadora dándoles de alta a
-- mano, igual que hoy, pero ahora además creyendo que ya no hace falta.
--
-- El más antiguo de cada socio, y solo ése: es la persona con la que se abrió
-- la cuenta. Poner a todos de administrador sería la otra opción y es la que no
-- se puede deshacer — un becario dando de alta a quien quiera el primer día.
with primero as (
  select distinct on (m.organization_id) m.id
    from organization_memberships m
    join organizations o on o.id = m.organization_id
   where o.kind = 'partner'
   order by m.organization_id, m.created_at asc
)
update organization_memberships m
   set partner_role = case when m.id in (select id from primero) then 'admin' else 'agent' end
  from organizations o
 where o.id = m.organization_id
   and o.kind = 'partner'
   and m.partner_role is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Y EL DISPARADOR DE 0073 SE ENCARGA DE MANTENERLO COHERENTE
--
-- Se REESCRIBE entero —`create or replace` no conserva lo que no se repite— y
-- ahora hace dos cosas más, las dos por asignación y no por rechazo: una
-- membresía nueva sobre un socio que no diga nada nace de `agent`, y una que no
-- cuelgue de un socio se queda sin jerarquía de socio aunque la manden. Lo
-- segundo importa: `partner_role = 'admin'` colgando de la operadora sería un
-- campo con valor que nadie lee, esperando a que alguien lo lea algún día.
create or replace function app.membership_role_matches_org()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, app
as $fn$
declare
  org_kind text;
begin
  select kind into org_kind from organizations where id = new.organization_id;

  if org_kind = 'partner' and new.role <> 'partner' then
    raise exception
      'Una membresía sobre una empresa asociada solo puede tener el rol de socio (llegó %)', new.role
      using errcode = 'check_violation';
  end if;

  if org_kind is distinct from 'partner' and new.role = 'partner' then
    raise exception
      'El rol de socio exige que la membresía cuelgue de una empresa asociada'
      using errcode = 'check_violation';
  end if;

  if org_kind = 'partner' then
    new.partner_role := coalesce(new.partner_role, 'agent');
  else
    new.partner_role := null;
  end if;

  return new;
end;
$fn$;

comment on function app.membership_role_matches_org() is
  'Rol de socio si y solo si la organización de la membresía es de tipo socio '
  '(0073), y la jerarquía interna del socio coherente con eso (0074). Sin la '
  'primera mitad, un empleado de tour center con rol seller entra al ERP '
  'interno; sin la segunda, un rol partner sin identificador pasa '
  'app.can_read_partner como si fuera personal de la operadora.';

revoke execute on function app.membership_role_matches_org() from anon, public, authenticated;
grant  execute on function app.membership_role_matches_org() to service_role;

-- El disparador tiene que oír también los cambios de `partner_role`: sin
-- añadirlo a la lista de columnas, subir a alguien a administrador desde la
-- operadora no pasaría por la coherencia de arriba.
drop trigger if exists memberships_role_matches_org on organization_memberships;
create trigger memberships_role_matches_org
  before insert or update of role, organization_id, partner_role on organization_memberships
  for each row execute function app.membership_role_matches_org();
