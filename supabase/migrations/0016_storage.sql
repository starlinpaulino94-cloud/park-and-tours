-- ============================================================================
-- 0016 — Storage buckets + RLS (M4). Replaces Totalum's declarative FILE fields.
-- Path convention (enforced by RLS on storage.objects):
--   {organization_id}/{entity}/{id}/{filename}                     (org-wide)
--   {organization_id}/partners/{partner_id}/{entity}/{filename}    (partner-owned)
-- A Tour Center can never read another's private files: the partner segment
-- must match the caller's partner_id claim.
-- ============================================================================

-- ── Buckets ─────────────────────────────────────────────────────────────────
-- public-assets: logos, product images, marketing (world-readable).
-- private-docs : contracts, settlement PDFs, receipts, participant docs,
--                waivers, maintenance photos (signed-URL delivery only).
insert into storage.buckets (id, name, public)
values ('public-assets', 'public-assets', true),
       ('private-docs',  'private-docs',  false)
on conflict (id) do nothing;

-- ── Path helpers ────────────────────────────────────────────────────────────
-- First folder = organization_id; enforces the tenant on every object.
create or replace function app.storage_org_ok(object_name text) returns boolean
  language sql stable as $$
    select (storage.foldername(object_name))[1] = app.current_org_id()::text
  $$;

-- Partner-owned path check. Non-partner staff pass; a partner-role user only
-- passes for objects under their own {org}/partners/{their_partner_id}/...
create or replace function app.storage_partner_ok(object_name text) returns boolean
  language sql stable as $$
    select case
      when app.current_app_role() is distinct from 'partner' then true
      when (storage.foldername(object_name))[2] = 'partners'
        then (storage.foldername(object_name))[3] = app.current_partner_id()::text
      else false   -- partners may only touch objects under partners/{their id}/
    end
  $$;

-- Writers: any staff role of the org (partners write only to their own folder).
create or replace function app.storage_can_write(object_name text) returns boolean
  language sql stable as $$
    select app.storage_org_ok(object_name) and app.storage_partner_ok(object_name)
  $$;

-- ── public-assets policies ──────────────────────────────────────────────────
create policy "public-assets read" on storage.objects
  for select using (bucket_id = 'public-assets');

create policy "public-assets insert" on storage.objects
  for insert with check (bucket_id = 'public-assets' and app.storage_can_write(name));

create policy "public-assets update" on storage.objects
  for update using (bucket_id = 'public-assets' and app.storage_can_write(name))
           with check (bucket_id = 'public-assets' and app.storage_can_write(name));

create policy "public-assets delete" on storage.objects
  for delete using (bucket_id = 'public-assets' and app.storage_can_write(name));

-- ── private-docs policies ───────────────────────────────────────────────────
create policy "private-docs read" on storage.objects
  for select using (bucket_id = 'private-docs'
                    and app.storage_org_ok(name)
                    and app.storage_partner_ok(name));

create policy "private-docs insert" on storage.objects
  for insert with check (bucket_id = 'private-docs' and app.storage_can_write(name));

create policy "private-docs update" on storage.objects
  for update using (bucket_id = 'private-docs' and app.storage_can_write(name))
           with check (bucket_id = 'private-docs' and app.storage_can_write(name));

create policy "private-docs delete" on storage.objects
  for delete using (bucket_id = 'private-docs' and app.storage_can_write(name));
