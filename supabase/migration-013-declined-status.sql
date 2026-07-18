-- Migration 013: declined status
-- Run in the Supabase SQL editor (order vs 011/012 doesn't matter).
--
-- Lost deals used to sit in `pending` forever, inflating the open
-- pipeline and making Close rate mean "share of quoted won". With
-- `declined`, pipeline = genuinely undecided, and Close rate = won of
-- decided (won + declined). Headset syncs never send status, so a
-- declined project stays declined.

alter table public.projects
  drop constraint projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status in ('pending', 'approved', 'installed', 'declined'));
