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

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
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
