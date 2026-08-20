-- Shim mínimo de Supabase para reproducir el entorno real en local.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);

-- Claims del JWT simulados vía GUC, como hace PostgREST.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid
);
create or replace function storage.foldername(p text) returns text[] language sql immutable as $$
  select string_to_array(p, '/')
$$;
grant usage on schema auth, storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

-- ⭐ CLAVE: privilegios por defecto de Supabase sobre `public`.
-- Es lo que hace que una tabla sin RLS quede expuesta por PostgREST.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
