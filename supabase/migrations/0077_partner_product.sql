-- 0077 — El contrato socio–producto: qué puede vender cada tour center.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NO ES QUE SE DESCARTARA AL GUARDAR. ES QUE NO SE PODÍA ESCRIBIR.
--
-- `authorized_products` aparece en el tipo `Partner`, el catálogo del portal lo
-- pide expandido y el reparto del formulario lo descarta a propósito. Lo que no
-- hay en ninguna parte es DÓNDE guardarlo: no existe la tabla, `partner` no lo
-- declara escribible, ningún formulario lo ofrece, y `authorized_products` ni
-- siquiera está en el mapa de relaciones — así que la expansión devuelve vacío
-- SIEMPRE.
--
-- Y el catálogo del portal, ante la lista vacía, enseña el catálogo entero. O
-- sea: la autorización por producto no está rota, **no existe**, y el código
-- está escrito como si existiera. Un operador que mire esa pantalla concluirá
-- que su tour center solo ve lo autorizado.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA SIEMBRA NO ES UNA COMODIDAD: SIN ELLA SE CORTA LA VENTA
--
-- En cuanto la lista vacía deje de significar «todo», un socio sin filas no
-- puede vender nada. Si esta migración no sembrara, el despliegue apagaría la
-- venta de todos los tour centers existentes a la vez — y el síntoma sería «el
-- catálogo me sale vacío», que nadie relaciona con una migración.
--
-- Así que nace con lo que hay hoy: todo el catálogo activo, para cada socio
-- activo. A partir de ahí la operadora QUITA, que es la operación que tiene
-- sentido hacer con una lista de autorizaciones.
create table if not exists partner_product (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  partner_id      uuid not null references organizations(id) on delete cascade,
  product_id      uuid not null references product(id) on delete cascade,
  -- Se desautoriza poniéndolo inactivo, no borrando la fila: así queda el
  -- rastro de que ese producto estuvo autorizado, que es lo que se mira cuando
  -- un socio reclama una reserva que «antes sí podía hacer».
  status     text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, product_id)
);

create index if not exists partner_product_partner_idx
  on partner_product (organization_id, partner_id) where status = 'active';
create index if not exists partner_product_product_idx
  on partner_product (organization_id, product_id);

drop trigger if exists partner_product_touch on partner_product;
create trigger partner_product_touch before update on partner_product
  for each row execute function app.touch_updated_at();

-- Tabla nueva y actor externo: su política, en la misma migración. Es el
-- riesgo transversal del plan, y aquí la tabla ES la autorización — sin
-- política, un socio leería las autorizaciones de sus competidores, que es el
-- mapa de qué vende cada uno.
select app.enable_tenant_rls('public.partner_product', true);

-- ── La siembra ──────────────────────────────────────────────────────────────
insert into partner_product (organization_id, partner_id, product_id)
select o.tenant_org_id, o.id, p.id
  from organizations o
  join product p
    on p.organization_id = o.tenant_org_id
   and p.status <> 'inactive'
 where o.kind = 'partner'
   and o.tenant_org_id is not null
on conflict (partner_id, product_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Y EL PRODUCTO NUEVO NACE AUTORIZADO PARA TODOS
--
-- La alternativa es que nazca sin autorizar para nadie. Suena más «contrato
-- explícito» y es la trampa: la operadora publica una excursión nueva, los tour
-- centers no la ven, y se entera cuando uno llama a preguntar por qué. Con
-- decenas de socios, publicar un producto pasaría a ser publicar un producto y
-- acordarse de autorizarlo decenas de veces.
--
-- Lo que esta fase arregla es que la lista EXISTA, se pueda escribir y se
-- aplique al vender. Que el valor por defecto de una relación nueva sea
-- «autorizado» es una decisión aparte, y es la que no rompe nada: la operadora
-- quita, igual que con la siembra de arriba.
--
-- Va como disparador de base y no en la aplicación porque los productos entran
-- por cuatro caminos —el CRUD, el importador, el sembrador de demostración y
-- SQL a mano— y tres de ellos no pasarían por el código de la aplicación.
create or replace function app.partner_product_autoriza_nuevo()
  returns trigger
  language plpgsql
  -- Lee `organizations`, que tiene RLS. Sin `definer`, un alta hecha por quien
  -- no puede leer esas filas no autorizaría a nadie y el producto nuevo nacería
  -- invisible para todos los socios, en silencio.
  security definer
  set search_path = public, app
as $fn$
begin
  insert into partner_product (organization_id, partner_id, product_id)
  select new.organization_id, o.id, new.id
    from organizations o
   where o.kind = 'partner'
     and o.tenant_org_id = new.organization_id
  on conflict (partner_id, product_id) do nothing;
  return new;
end;
$fn$;

comment on function app.partner_product_autoriza_nuevo() is
  'Un producto nuevo nace autorizado para los socios de su operadora (0077). '
  'Lo contrario suena más explícito y es la trampa: publicar una excursión '
  'dejaría de verse en los tour centers hasta que alguien se acordara de '
  'autorizarla uno a uno.';

revoke execute on function app.partner_product_autoriza_nuevo() from anon, public, authenticated;
grant  execute on function app.partner_product_autoriza_nuevo() to service_role;

drop trigger if exists product_autoriza_socios on product;
create trigger product_autoriza_socios
  after insert on product
  for each row execute function app.partner_product_autoriza_nuevo();

-- ── Y el socio nuevo nace con el catálogo de hoy ────────────────────────────
-- Mismo razonamiento por el otro lado: un tour center recién dado de alta que
-- no pueda vender nada hasta que alguien le autorice producto a producto es un
-- alta que parece rota.
create or replace function app.partner_product_socio_nuevo()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, app
as $fn$
begin
  if new.kind <> 'partner' or new.tenant_org_id is null then
    return new;
  end if;

  insert into partner_product (organization_id, partner_id, product_id)
  select new.tenant_org_id, new.id, p.id
    from product p
   where p.organization_id = new.tenant_org_id
     and p.status <> 'inactive'
  on conflict (partner_id, product_id) do nothing;
  return new;
end;
$fn$;

revoke execute on function app.partner_product_socio_nuevo() from anon, public, authenticated;
grant  execute on function app.partner_product_socio_nuevo() to service_role;

drop trigger if exists organizations_autoriza_catalogo on organizations;
create trigger organizations_autoriza_catalogo
  after insert on organizations
  for each row execute function app.partner_product_socio_nuevo();
