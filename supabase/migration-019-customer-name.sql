-- Migration 019: a project knows whose yard it is.
-- Run in the Supabase SQL editor AFTER migration-018.
--
-- `projects` has carried an address and a contact email since 009, but never
-- a name for the person. Designers have been compensating by naming the
-- PROJECT after the customer — "Dani", "Gavin" — which works until the same
-- customer wants a second job and the list holds two projects called Dani.
--
-- Kept separate from `name` rather than derived from it: a project name
-- should be free to say "Hartley — front yard" while the customer stays
-- Hartley, and the client PDF and the share page both want the person, not
-- the job.
--
-- Nullable, with no backfill. Every project that exists predates the field
-- and guessing a customer out of a project name would put wrong names in
-- front of clients.

alter table public.projects
  add column if not exists customer_name text;

comment on column public.projects.customer_name is
  'The homeowner this project is for. Separate from projects.name, which '
  'names the job — one customer can have several.';

insert into public.migrations_applied (name)
values ('019-customer-name')
on conflict do nothing;
