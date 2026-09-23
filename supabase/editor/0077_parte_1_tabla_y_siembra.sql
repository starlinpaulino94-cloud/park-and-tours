-- 0077 · PARTE 1 — la tabla del contrato socio–producto, y su siembra.
--
-- Pegar entero y ejecutar. Re-ejecutable. SIN bloques $$ a propósito: el editor
-- de Supabase inyecta su `enable row level security` después de un
-- `create table`, y si cae dentro de un bloque con comillas de dólar revienta
-- con «unterminated dollar-quoted string». Por eso la política y los
-- disparadores van en la PARTE 2.
--
-- IMPORTANTE: la siembra no es una comodidad. Sin ella, en cuanto se despliegue
-- el código ningún tour center podría vender nada —la lista vacía deja de
-- significar «todo»— y el síntoma sería «el catálogo me sale vacío», que nadie
-- relaciona con una migración.

create table if not exists partner_product (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  partner_id      uuid not null references organizations(id) on delete cascade,
  product_id      uuid not null references product(id) on delete cascade,
  -- Se desautoriza poniéndolo inactivo, no borrando la fila: queda el rastro
  -- de que ese producto estuvo autorizado, que es lo que se mira cuando un
  -- socio reclama una reserva que «antes sí podía hacer».
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

-- ── La siembra: todo el catálogo activo, para cada socio ────────────────────
insert into partner_product (organization_id, partner_id, product_id)
select o.tenant_org_id, o.id, p.id
  from organizations o
  join product p
    on p.organization_id = o.tenant_org_id
   and p.status <> 'inactive'
 where o.kind = 'partner'
   and o.tenant_org_id is not null
on conflict (partner_id, product_id) do nothing;
