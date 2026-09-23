-- 0077 · PARTE 2 — la política del contrato y los dos disparadores.
--
-- Pegar entero y ejecutar DESPUÉS de la parte 1. Re-ejecutable.
-- Sin `create table` aquí: es lo que permite usar bloques con comillas de dólar
-- sin que el editor de Supabase meta su `enable row level security` dentro.

-- La política, con guarda para poder repetir: aquí la tabla ES la
-- autorización, y sin ella un socio leería las de sus competidores — el mapa de
-- qué vende cada uno.
do $pol$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'partner_product' and policyname = 'tenant_select'
  ) then
    perform app.enable_tenant_rls('public.partner_product', true);
  end if;
end $pol$;

-- ── Un producto nuevo nace autorizado para todos ────────────────────────────
-- Lo contrario suena más «contrato explícito» y es la trampa: la operadora
-- publica una excursión nueva, los tour centers no la ven, y se entera cuando
-- uno llama a preguntar por qué.
create or replace function app.partner_product_autoriza_nuevo()
  returns trigger
  language plpgsql
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

revoke execute on function app.partner_product_autoriza_nuevo() from anon, public, authenticated;
grant  execute on function app.partner_product_autoriza_nuevo() to service_role;

drop trigger if exists product_autoriza_socios on product;
create trigger product_autoriza_socios
  after insert on product
  for each row execute function app.partner_product_autoriza_nuevo();

-- ── Y un socio nuevo nace con el catálogo de hoy ────────────────────────────
create or replace function app.partner_product_socio_nuevo()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, app
as $fn2$
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
$fn2$;

revoke execute on function app.partner_product_socio_nuevo() from anon, public, authenticated;
grant  execute on function app.partner_product_socio_nuevo() to service_role;

drop trigger if exists organizations_autoriza_catalogo on organizations;
create trigger organizations_autoriza_catalogo
  after insert on organizations
  for each row execute function app.partner_product_socio_nuevo();
