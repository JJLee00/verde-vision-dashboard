-- Migration 002: Vision Pro integration
-- Run in the Supabase SQL editor AFTER schema.sql.

-- New per-project fields populated by the Vision Pro app.
alter table public.projects
  add column project_date date,
  add column estimate_amount numeric(12, 2),
  add column blueprint_path text;

-- Private bucket for blueprint PDFs, stored under {client_id}/{project_id}/.
insert into storage.buckets (id, name, public)
values ('blueprints', 'blueprints', false);

-- Clients can view blueprints in their own folder. Writes come only from the
-- server (service role), which bypasses RLS, so no insert policy is needed.
create policy "Clients can read own blueprints"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'blueprints'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
