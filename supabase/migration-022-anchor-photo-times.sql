-- Migration 022: plate photos learn when they were taken.
-- Run in the Supabase SQL editor AFTER migration-021.
--
-- `anchor_paths` has only ever been a map of step → file path, with no sense
-- of when any of it was written. That left the headset one rule it could
-- safely follow — take a photo only for a plate it has none for — and two
-- consequences nobody wanted:
--
--   * Replacing a plate photo at a desk never reached a headset that already
--     had one. The office's correction simply stayed in the office.
--   * Deleting one in the headset did not stick. The local file went, the next
--     refresh saw an empty slot, and the office's copy came straight back
--     down — about twenty seconds later.
--
-- A timestamp per step fixes both, and makes plate photos behave the way the
-- cover photo and the plate notes already do: newer wins, and a timestamp with
-- no file behind it is a deletion rather than an absence.
--
-- Its own column rather than reshaping `anchor_paths`: that map is a wire
-- contract with headsets already in the field, and a build that has not been
-- updated still reads it exactly as before.
--
-- NOT backfilled, for the same reason 021 wasn't. Every plate photo that
-- exists predates this column, and a backfilled now() would outrank every copy
-- already sitting on a headset and replace all of them on the next refresh.
-- Null means no claim: the existing fill-an-empty-slot behaviour, until
-- somebody actually writes a photo.

alter table public.projects
  add column if not exists anchor_photo_times jsonb;

comment on column public.projects.anchor_photo_times is
  'When each plate photo in anchor_paths was written, keyed by the same step '
  '(origin/first/second): { "origin": "2026-10-04T...Z" }. Newer wins; a time '
  'with no matching anchor_paths entry means the photo was deleted.';

insert into public.migrations_applied (name)
values ('022-anchor-photo-times')
on conflict do nothing;
