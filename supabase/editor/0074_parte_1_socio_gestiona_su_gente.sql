-- 0074 · PARTE 1 — el socio gestiona a su propia gente.
--
-- Pegar entero y ejecutar. Re-ejecutable.
-- REQUIERE 0073 aplicada antes (reescribe su disparador).

alter table organization_memberships
  add column if not exists partner_role text
    check (partner_role is null or partner_role in ('admin','agent'));

comment on column organization_memberships.partner_role is
  'Jerarquía DENTRO de un tour center (0074): admin gestiona a los suyos, '
  'agent no. Null fuera de las organizaciones de tipo socio. No participa en '
  'el aislamiento, que sigue decidiéndose por role + partner_id.';

-- El más antiguo de cada socio queda de administrador: es la persona con la que
-- se abrió la cuenta. Sin esto la función nace apagada para todos los tour
-- centers que ya existen; poniendo a todos, un becario da de alta a quien
-- quiera el primer día.
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
  '(0073), y la jerarquía interna del socio coherente con eso (0074).';

revoke execute on function app.membership_role_matches_org() from anon, public, authenticated;
grant  execute on function app.membership_role_matches_org() to service_role;

drop trigger if exists memberships_role_matches_org on organization_memberships;
create trigger memberships_role_matches_org
  before insert or update of role, organization_id, partner_role on organization_memberships
  for each row execute function app.membership_role_matches_org();
