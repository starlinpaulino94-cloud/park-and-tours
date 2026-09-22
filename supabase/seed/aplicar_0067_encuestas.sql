-- ============================================================================
-- MIGRACIÓN 0067 (COMPACTA) — LA TABLA DE ENCUESTAS, PARA EL EDITOR SQL.
--
-- Es la migración 0067 sin los comentarios largos ni los caracteres especiales,
-- para que se pegue de una sola vez en el editor de Supabase sin cortarse. Hace
-- EXACTAMENTE lo mismo que supabase/migrations/0067_guest_survey.sql: crea la
-- tabla guest_survey (con su RLS y su índice de token único) y añade
-- organizations.review_url y customer.survey_opt_out.
--
-- Es idempotente: usa "if not exists" y "if not exists (select 1 from
-- pg_constraint ...)", así que ejecutarla dos veces no falla.
--
-- Aplícala UNA vez y luego corre supabase/seed/demo_presentation.sql.
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
  unique (organization_id, booking_id)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'guest_survey_answered_check') then
    alter table guest_survey add constraint guest_survey_answered_check
      check (status <> 'answered' or (answered_at is not null and nps is not null));
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'guest_survey_skip_check') then
    alter table guest_survey add constraint guest_survey_skip_check
      check ((status = 'skipped') = (skip_reason is not null));
  end if;
end $$;
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
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'guest_survey' and policyname = 'tenant_select') then
    perform app.enable_tenant_rls('public.guest_survey');
  end if;
end $$;
alter table customer
  add column if not exists survey_opt_out boolean not null default false;
alter table organizations
  add column if not exists review_url text;
do $$
declare
  faltan text := '';
begin
  if not exists (select 1 from information_schema.tables where table_name = 'guest_survey')
    then faltan := faltan || 'tabla guest_survey '; end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'organizations' and column_name = 'review_url')
    then faltan := faltan || 'organizations.review_url '; end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'customer' and column_name = 'survey_opt_out')
    then faltan := faltan || 'customer.survey_opt_out '; end if;
  if not exists (select 1 from pg_constraint where conname = 'guest_survey_answered_check')
    then faltan := faltan || 'check de contestada '; end if;
  if not exists (select 1 from pg_constraint where conname = 'guest_survey_skip_check')
    then faltan := faltan || 'check de omitida '; end if;
  if not exists (select 1 from pg_indexes where indexname = 'guest_survey_expiry_idx')
    then faltan := faltan || 'índice de caducidad '; end if;
  if not exists (select 1 from pg_indexes where indexname = 'guest_survey_guide_idx')
    then faltan := faltan || 'índice por guía '; end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.guest_survey'::regclass and c.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
           from unnest(c.conkey) k join pg_attribute a
             on a.attrelid = c.conrelid and a.attnum = k) = array['token']
  ) then faltan := faltan || 'unicidad global del token '; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'guest_survey' and policyname = 'tenant_select')
    then faltan := faltan || 'RLS '; end if;
  if faltan <> '' then
    raise exception '0067 incompleta, falta: %', faltan;
  end if;
end $$;
