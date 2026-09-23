-- 0073 — El ciclo de vida del socio: condiciones aceptadas y el cerrojo del rol.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LAS CONDICIONES ACEPTADAS
--
-- Hoy las condiciones comerciales de un socio viven como texto libre en
-- `organizations.metadata.commercial_terms`. Nadie registra si el socio las ha
-- LEÍDO, ni cuáles leyó: el día que hay una discusión sobre una comisión, la
-- operadora no tiene con qué contestar más que «se lo dijimos».
--
-- Cuatro columnas, y las cuatro hacen falta:
--
--   `terms_version`           qué versión rige AHORA. La sube la operadora al
--                             editar el texto (lo hace la aplicación, no un
--                             disparador: el texto vive en `metadata` de otra
--                             tabla y un disparador que lo vigilara tendría que
--                             consultarla en cada escritura).
--   `terms_accepted_version`  qué versión aceptó el socio. Separada de la de
--                             arriba A PROPÓSITO: si fuera una sola columna,
--                             cambiar las condiciones no se distinguiría de que
--                             el socio hubiera aceptado las nuevas. Aceptadas
--                             es «las dos coinciden», no «hay una fecha».
--   `terms_accepted_at`       cuándo.
--   `terms_accepted_by`       quién, de los usuarios del socio. Sin esto la
--                             aceptación no acredita nada: cualquiera del
--                             tour center podría haber pulsado.
--
-- Van en la relación y no en la organización porque son del CONTRATO entre
-- esta operadora y ese socio: la misma agencia puede trabajar con dos
-- operadoras y aceptar condiciones distintas de cada una. El propio esquema lo
-- dice desde 0002: «partner-only attributes live on organization_relationships».
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. EL CERROJO DEL ROL, EN LA BASE
--
-- La regla ya se aplica en la aplicación desde la entrega anterior: si la
-- membresía cuelga de un socio, el rol se fuerza a socio. Esto la escribe donde
-- no depende de que todo el mundo pase por la misma función.
--
-- Cierra DOS puertas, y la segunda no estaba cerrada en ningún sitio del
-- servidor:
--
--   a) Membresía sobre un socio con otro rol (`seller`, `cashier`, …). Esa
--      persona recibe identificador de socio y, hasta 0072, ninguna de las 29
--      condiciones de aislamiento la reconocía como de fuera: entraba al ERP
--      INTERNO de la operadora.
--
--   b) Membresía sobre la operadora con el rol `partner`. El enganche del token
--      solo emite `partner_id` cuando la organización es de tipo socio, así que
--      esa persona sale con rol de socio y SIN identificador — y «sin
--      identificador» es precisamente lo que `app.can_read_partner` entiende
--      como «ve todo». El formulario de Configuración lo impedía, pero SOLO en
--      el navegador: la API aceptaba el alta tal cual.
--
-- Es una equivalencia, no dos comprobaciones sueltas: rol de socio si y solo si
-- organización de socio.
create or replace function app.membership_role_matches_org()
  returns trigger
  language plpgsql
  -- Lee `organizations`, que tiene RLS. Sin `definer`, un alta hecha por quien
  -- no puede leer esa fila vería `kind` nulo y el cerrojo no saltaría nunca:
  -- una comprobación que se salta sola es peor que no tenerla.
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

-- Una SECURITY DEFINER ejecutable por `anon` es una escalada esperando
-- ocurrir, y 0017 lo comprueba contando funciones. Que esta no se pueda llamar
-- más que como disparador no la libra del recuento: el permiso va pegado a la
-- definición, no a una migración posterior.
revoke execute on function app.membership_role_matches_org() from anon, public, authenticated;
grant  execute on function app.membership_role_matches_org() to service_role;

drop trigger if exists memberships_role_matches_org on organization_memberships;
create trigger memberships_role_matches_org
  before insert or update of role, organization_id on organization_memberships
  for each row execute function app.membership_role_matches_org();
