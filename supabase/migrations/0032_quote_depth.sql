-- ============================================================================
-- 0032 — La cotización deja de ser una cabecera con importes sueltos
--
-- El módulo listaba propuestas y sumaba líneas, pero el objeto "cotización" que
-- usa una operadora turística no cabía en el esquema:
--
--   · No se podía revisar una propuesta. Cambiar un precio pisaba el documento
--     que el cliente ya tenía en la mano, y no quedaba rastro de qué se ofreció
--     antes ni a qué precio. Todo el sector trabaja por versiones (v1, v2, v3)
--     precisamente porque la negociación de un grupo son varias rondas.
--   · No se podían ofrecer alternativas. Una propuesta de grupo se presenta con
--     dos o tres opciones —hotel 4* contra 5*, con guía o sin guía— y el cliente
--     escoge una. Sin eso, ofrecer alternativas obligaba a crear cotizaciones
--     sueltas que ya no se sabía que eran la misma negociación.
--   · No se podía pedir un depósito. Una reserva de grupo se sostiene sobre un
--     anticipo con fecha; la cotización es donde se pacta. El importe se tecleaba
--     en las condiciones como texto libre, así que ningún informe lo veía.
--   · Las condiciones eran un `text` único. Qué incluye, qué no incluye, la
--     política de cancelación y la forma de pago son cuatro bloques distintos
--     del documento que se le manda al cliente, y cada uno se reutiliza.
--   · La línea no sabía cuántos adultos y niños cubría, así que convertir la
--     cotización en reserva era imposible: `booking-service` necesita ese
--     desglose para calcular precio y ocupar cupo.
--   · El margen se prometía en la pantalla (`margin_percent`) pero no había
--     dónde guardar el coste del que sale.
--
-- Todo es aditivo y con `if not exists`.
-- ============================================================================

-- ── quote: identidad y versionado ──────────────────────────────────────────
alter table quote
  add column if not exists title           text,
  add column if not exists version         integer not null default 1,
  add column if not exists revision_of_id  uuid references quote(id) on delete set null,
  add column if not exists superseded_at   timestamptz,
  add column if not exists revision_reason text;

comment on column quote.revision_of_id is
  'Cotización de la que esta es revisión. La cadena completa es el histórico de la negociación.';

-- Una revisión reemplaza a la anterior: la vieja queda fuera del embudo para no
-- contar dos veces el mismo negocio.
alter table quote drop constraint if exists quote_status_check;
alter table quote
  add constraint quote_status_check
  check (status in
    ('draft','sent','negotiating','accepted','rejected','expired','converted','superseded'));

-- ── quote: el comprador ────────────────────────────────────────────────────
-- Una cotización de grupo se negocia con una persona (la coordinadora del
-- colegio, el wedding planner) que casi nunca es todavía un cliente dado de
-- alta. Sin estos campos no había dónde anotar a quién mandar la propuesta.
alter table quote
  add column if not exists contact_name  text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists company_name  text;

-- ── quote: dinero ──────────────────────────────────────────────────────────
alter table quote
  add column if not exists tax_percent   numeric(6,3) check (tax_percent is null or tax_percent >= 0),
  add column if not exists cost_total    numeric(14,2) not null default 0,
  add column if not exists margin_amount numeric(14,2) not null default 0;

comment on column quote.tax_percent is
  'Tasa aplicada sobre la base para obtener `tax`. En RD el ITBIS es 18%; se guarda la tasa, no solo el importe, para que la revisión recalcule sola.';

-- ── quote: depósito y vencimientos ─────────────────────────────────────────
alter table quote
  add column if not exists deposit_type    text not null default 'none',
  add column if not exists deposit_percent numeric(6,3) check (deposit_percent is null or (deposit_percent >= 0 and deposit_percent <= 100)),
  add column if not exists deposit_amount  numeric(14,2) check (deposit_amount is null or deposit_amount >= 0),
  add column if not exists deposit_due_date date,
  add column if not exists balance_due_date date;

-- El dominio va en su propio `add constraint` para que la columna y el
-- diccionario de la UI queden enlazados por `src/lib/domain-values.test.ts`.
alter table quote drop constraint if exists quote_deposit_type_check;
alter table quote add constraint quote_deposit_type_check
  check (deposit_type in ('none','percent','amount'));

-- ── quote: el documento que ve el cliente ──────────────────────────────────
alter table quote
  add column if not exists inclusions          text,
  add column if not exists exclusions          text,
  add column if not exists cancellation_policy text,
  add column if not exists payment_terms       text,
  add column if not exists internal_notes      text;

comment on column quote.internal_notes is
  'Notas que NO salen en el documento del cliente (coste del proveedor, margen negociable, histórico de la llamada).';

-- ── quote: seguimiento comercial ───────────────────────────────────────────
alter table quote
  add column if not exists follow_up_at timestamptz,
  add column if not exists accepted_by  text,
  add column if not exists sent_count   integer not null default 0;

create index if not exists quote_follow_up_idx on quote (organization_id, follow_up_at)
  where follow_up_at is not null;
create index if not exists quote_revision_idx  on quote (revision_of_id);

-- ── quote_option: las alternativas de una misma propuesta ──────────────────
-- Una cotización sin opciones sigue funcionando igual que antes (todas sus
-- líneas son comunes). Con opciones, cada una suma las líneas comunes más las
-- suyas, y el cliente escoge una: esa es la que se convierte en reserva.
create table if not exists quote_option (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  quote_id        uuid not null references quote(id) on delete cascade,
  name            text not null,
  description     text,
  sort_order      integer not null default 0,
  is_recommended  boolean not null default false,
  is_selected     boolean not null default false,
  subtotal      numeric(14,2) not null default 0,
  discount      numeric(14,2) not null default 0,
  tax           numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  cost_total    numeric(14,2) not null default 0,
  margin_amount numeric(14,2) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists quote_option_quote_idx on quote_option (quote_id, sort_order);
drop trigger if exists quote_option_touch on quote_option;
create trigger quote_option_touch before update on quote_option
  for each row execute function app.touch_updated_at();

-- `app.enable_tenant_rls` crea sus políticas sin `if not exists`, así que
-- volver a ejecutar esta migración fallaba ahí. Todo lo demás del archivo es
-- re-ejecutable; esto lo iguala, que es lo que hace segura una reaplicación
-- tras un fallo a mitad.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'quote_option' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.quote_option');
  end if;
end $$;

drop trigger if exists quote_option_same_tenant_refs on quote_option;
create trigger quote_option_same_tenant_refs
before insert or update of organization_id, quote_id on quote_option
for each row execute function app.enforce_same_tenant_refs('quote_id', 'quote');

-- Cuál escogió el cliente: se guarda en la opción, y la cabecera apunta a ella
-- para que un informe no tenga que recorrer las opciones.
alter table quote
  add column if not exists selected_option_id uuid references quote_option(id) on delete set null;

-- ── quote_line: lo que hacía falta para que una línea sea vendible ─────────
alter table quote_line
  add column if not exists option_id   uuid references quote_option(id) on delete cascade,
  add column if not exists is_optional boolean not null default false,
  add column if not exists sort_order  integer not null default 0,
  add column if not exists line_type   text,
  add column if not exists adults      integer check (adults   is null or adults   >= 0),
  add column if not exists children    integer check (children is null or children >= 0),
  add column if not exists infants     integer check (infants  is null or infants  >= 0),
  add column if not exists supplier_id uuid references supplier(id) on delete set null,
  add column if not exists notes       text;

comment on column quote_line.option_id is
  'Opción a la que pertenece la línea. NULL = línea común: entra en el total de todas las opciones.';
comment on column quote_line.is_optional is
  'Extra que el cliente puede añadir. No suma al total de la opción hasta que se acepta.';

alter table quote_line drop constraint if exists quote_line_line_type_check;
alter table quote_line add constraint quote_line_line_type_check
  check (line_type is null or line_type in
    ('service','transport','accommodation','meal','guide','ticket','fee','insurance','other'));

create index if not exists quote_line_option_idx on quote_line (option_id);
create index if not exists quote_line_order_idx  on quote_line (quote_id, sort_order);

-- ── integridad de referencias entre inquilinos ─────────────────────────────
-- Las referencias nuevas entran en la lista de 0018: una línea de cotización no
-- puede apuntar al proveedor ni a la opción de otra organización.
drop trigger if exists quote_line_same_tenant_refs on quote_line;
create trigger quote_line_same_tenant_refs
before insert or update of organization_id, quote_id, product_id, product_modality_id, departure_id, option_id, supplier_id on quote_line
for each row execute function app.enforce_same_tenant_refs(
  'quote_id', 'quote',
  'product_id', 'product',
  'product_modality_id', 'product_modality',
  'departure_id', 'departure',
  'option_id', 'quote_option',
  'supplier_id', 'supplier'
);

drop trigger if exists quote_same_tenant_refs on quote;
create trigger quote_same_tenant_refs
before insert or update of organization_id, customer_id, seller_id, lead_id, order_id, revision_of_id, selected_option_id on quote
for each row execute function app.enforce_same_tenant_refs(
  'customer_id', 'customer',
  'seller_id', 'seller',
  'lead_id', 'lead',
  'order_id', 'sales_order',
  'revision_of_id', 'quote',
  'selected_option_id', 'quote_option'
);
