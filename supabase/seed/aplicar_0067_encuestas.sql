-- ============================================================================
-- MIGRACION 0067 (PLANA) — LA TABLA DE ENCUESTAS, PARA EL EDITOR SQL.
--
-- Version sin comentarios largos, sin caracteres especiales y SIN bloques
-- "do $$ ... $$". Se hizo asi porque el editor SQL de Supabase inyecta solo un
-- "ALTER TABLE ... ENABLE ROW LEVEL SECURITY" al final y, si el script termina
-- en un bloque con comillas-dolar, lo parte y da "unterminated dollar-quoted
-- string". Aqui todo son sentencias planas, asi que esa inyeccion cae despues
-- de un ";" de verdad y no rompe nada.
--
-- Hace lo mismo que supabase/migrations/0067_guest_survey.sql: crea la tabla
-- guest_survey con su RLS (4 politicas) y sus indices, y anade
-- organizations.review_url y customer.survey_opt_out.
--
-- Es idempotente: "if not exists" y "drop policy if exists". Aplicala una vez y
-- luego corre supabase/seed/demo_presentation.sql.
-- ============================================================================

create table if not exists guest_survey (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  booking_id   uuid not null references booking(id) on delete cascade,
  departure_id uuid references departure(id) on delete set null,
  product_id   uuid references product(id) on delete set null,
  customer_id  uuid references customer(id) on delete cascade,
  guide_staff_id uuid references staff(id) on delete set null,
  token text not null unique,
  status text not null default 'pending'
    check (status in ('pending','answered','expired','skipped')),
  skip_reason text
    check (skip_reason is null or skip_reason in
           ('ota','cancelled','no_show','no_contact','fatigue','no_consent')),
  asked_at    timestamptz,
  expires_at  timestamptz,
  answered_at timestamptz,
  nps smallint check (nps is null or (nps between 0 and 10)),
  rating_guide     smallint check (rating_guide     is null or (rating_guide     between 1 and 5)),
  rating_transport smallint check (rating_transport is null or (rating_transport between 1 and 5)),
  rating_value     smallint check (rating_value     is null or (rating_value     between 1 and 5)),
  comment text,
  language text,
  review_requested  boolean not null default false,
  review_clicked_at timestamptz,
  guest_case_id uuid references guest_case(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_survey_answered_check
    check (status <> 'answered' or (answered_at is not null and nps is not null)),
  constraint guest_survey_skip_check
    check ((status = 'skipped') = (skip_reason is not null)),
  unique (organization_id, booking_id)
);

create index if not exists guest_survey_org_idx
  on guest_survey (organization_id, status, asked_at desc);
create index if not exists guest_survey_product_idx
  on guest_survey (organization_id, product_id, answered_at desc)
  where status = 'answered';
create index if not exists guest_survey_guide_idx
  on guest_survey (organization_id, guide_staff_id, answered_at desc)
  where status = 'answered' and guide_staff_id is not null;
create index if not exists guest_survey_expiry_idx
  on guest_survey (expires_at)
  where status = 'pending';
create index if not exists guest_survey_customer_idx
  on guest_survey (organization_id, customer_id, asked_at desc)
  where customer_id is not null;

drop trigger if exists guest_survey_touch on guest_survey;
create trigger guest_survey_touch before update on guest_survey
  for each row execute function app.touch_updated_at();

alter table guest_survey enable row level security;
alter table guest_survey force row level security;
drop policy if exists tenant_select on guest_survey;
create policy tenant_select on guest_survey for select
  using (organization_id = app.current_org_id());
drop policy if exists tenant_insert on guest_survey;
create policy tenant_insert on guest_survey for insert
  with check (organization_id = app.current_org_id());
drop policy if exists tenant_update on guest_survey;
create policy tenant_update on guest_survey for update
  using (organization_id = app.current_org_id())
  with check (organization_id = app.current_org_id());
drop policy if exists tenant_delete on guest_survey;
create policy tenant_delete on guest_survey for delete
  using (organization_id = app.current_org_id());

alter table customer
  add column if not exists survey_opt_out boolean not null default false;
alter table organizations
  add column if not exists review_url text;
