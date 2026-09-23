-- 0073 · PARTE 1 — condiciones aceptadas y el cerrojo del rol.
--
-- Pegar entero y ejecutar. Re-ejecutable.
--
-- ANTES DE EJECUTAR: la PARTE 0 (abajo del todo, en el fichero
-- `0073_parte_0_filas_que_incumplen.sql`) lista las membresías que el cerrojo
-- rechazaría. El disparador es `before insert or update`, así que las filas
-- existentes NO se rompen — pero la próxima vez que alguien edite una de ellas,
-- la edición fallará. Conviene saber cuáles son antes, no el día que pase.

alter table organization_relationships
  add column if not exists terms_version          integer not null default 0,
  add column if not exists terms_accepted_version integer,
  add column if not exists terms_accepted_at      timestamptz,
  add column if not exists terms_accepted_by      uuid references auth.users(id) on delete set null;

comment on column organization_relationships.terms_version is
  'Versión vigente de las condiciones comerciales. La sube la operadora al '
  'editar el texto. Aceptadas = terms_accepted_version = terms_version.';
comment on column organization_relationships.terms_accepted_version is
  'Versión que el socio aceptó. Separada de terms_version para que cambiar las '
  'condiciones invalide la aceptación sin borrar el rastro de la anterior.';

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

  return new;
end;
$fn$;

comment on function app.membership_role_matches_org() is
  'Rol de socio si y solo si la organización de la membresía es de tipo socio '
  '(0073). Sin la primera mitad, un empleado de tour center con rol seller '
  'entra al ERP interno; sin la segunda, un rol partner sin identificador pasa '
  'app.can_read_partner como si fuera personal de la operadora.';

revoke execute on function app.membership_role_matches_org() from anon, public, authenticated;
grant  execute on function app.membership_role_matches_org() to service_role;

drop trigger if exists memberships_role_matches_org on organization_memberships;
create trigger memberships_role_matches_org
  before insert or update of role, organization_id on organization_memberships
  for each row execute function app.membership_role_matches_org();
