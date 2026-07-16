-- Migration 009: project page fields + media storage
-- Run in the Supabase SQL editor AFTER migration-008.
--
-- The project page (/dashboard/projects/[id]) makes a project's record
-- editable on the dashboard, where typing is pleasant — the headset only
-- syncs what it captures. address / contact_email / notes are free-text
-- fields owned by the designer; cover_path points into the new
-- project-media bucket (cover photo + walkthrough videos, stored under
-- {client_id}/{project_id}/...).

alter table public.projects
  add column address text,
  add column contact_email text,
  add column notes text,
  add column cover_path text;

-- Designers can now edit their own projects from the dashboard (status,
-- notes, address, contact email, cover). Previously select-only.
create policy "Clients can update own projects"
  on public.projects for update
  to authenticated
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

-- Private bucket for project media (cover photo, walkthrough videos).
insert into storage.buckets (id, name, public)
values ('project-media', 'project-media', false);

create policy "Own project media: insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Own project media: select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Own project media: delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
