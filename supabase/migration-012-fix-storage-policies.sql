-- Migration 012: repair 011's storage policies
-- Run in the Supabase SQL editor AFTER migration-011.
--
-- 011's storage policies wrote storage.foldername(name) inside a
-- subquery on public.projects — where the unqualified `name` bound to
-- the PROJECT's name column instead of the storage object's path, so
-- the folder match never succeeded and every read/write through those
-- policies failed (including blueprint PDF links). Recreate them with
-- the object path explicitly qualified as objects.name.
-- (migration-011 in the repo is fixed too; this file is the repair for
-- databases that already ran the broken version.)

drop policy if exists "Members can read org project media" on storage.objects;
drop policy if exists "Owners can add org project media" on storage.objects;
drop policy if exists "Owners can delete org project media" on storage.objects;
drop policy if exists "Members can read org project blueprints" on storage.objects;

create policy "Members can read org project media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'project-media'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[2]
        and p.org_id = public.user_org_id()
    )
  );

create policy "Owners can add org project media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-media'
    and public.user_is_owner()
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[2]
        and p.org_id = public.user_org_id()
    )
  );

create policy "Owners can delete org project media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'project-media'
    and public.user_is_owner()
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[2]
        and p.org_id = public.user_org_id()
    )
  );

create policy "Members can read org project blueprints"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'blueprints'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[2]
        and p.org_id = public.user_org_id()
    )
  );
