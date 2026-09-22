-- Supabase-provided objects the migrations depend on (stubbed for local test).
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

-- auth.jwt(): read a session-local JSON claim set we inject in tests.
create or replace function auth.jwt() returns jsonb
  language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;

create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;

-- Las columnas de GoTrue que el cuaderno de diagnóstico consulta
-- (docs/operaciones/DESDE_EL_EDITOR_SQL.md). Estaban fuera del doble, así que
-- nada comprobaba que el SQL que se le entrega a alguien con un acceso roto
-- llegue siquiera a ejecutarse. Son las de siempre de GoTrue; si alguna
-- desaparece allí, lo que hay que actualizar es el cuaderno.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz,
  banned_until       timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Una cuenta sin identidad de correo no puede entrar por contraseña aunque
-- `encrypted_password` tenga algo: es el caso «existe pero no hay clave que
-- probar», y sin esta tabla el cuaderno no podría distinguirlo.
create table if not exists auth.identities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  provider     text not null,
  provider_id  text,
  identity_data jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid
);
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;

grant usage on schema auth, storage to anon, authenticated, service_role;
