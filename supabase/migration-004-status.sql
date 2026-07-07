-- Migration 004: project workflow statuses (pending → approved → installed)
-- Run in the Supabase SQL editor AFTER migration-003.

update public.projects
set status = 'pending'
where status not in ('pending', 'approved', 'installed');

alter table public.projects
  alter column status set default 'pending';

alter table public.projects
  add constraint projects_status_check
  check (status in ('pending', 'approved', 'installed'));
