-- Migration 021: the project record, the cover photo and the plate notes
-- reach the headset.
-- Run in the Supabase SQL editor AFTER migration-020.
--
-- Three things a designer needs in a yard have only ever existed at a desk:
-- whose yard it is, what the project looks like on a card, and what somebody
-- wrote down about where plate B is mounted. The project list already carries
-- the address for Auto Blueprint; this widens that same channel.
--
-- Nothing here goes near `project_json`. These are RECORD fields, not design
-- fields: project_json is versioned and revision-gated, so a note typed at a
-- desk would become a design revision and could reject the next sync from the
-- yard with a 409. The project-list GET carries them down and an ordinary
-- ingest POST with no project_json carries them up, which is a path that
-- never creates a version and is never blocked.
--
--   anchor_notes      What the designer wrote about each alignment point —
--                     "garage frame, 4 ft up". Keyed by the same three step
--                     names anchor_paths uses (origin / first / second), each
--                     holding { text, updated_at }.
--
--                     The text is EDITABLE ON BOTH SIDES, so each entry
--                     carries its own timestamp and the newer write wins. A
--                     single column-level updated_at could not do that: two
--                     people editing different plates would each look newer
--                     than the other's work.
--
--                     Until now the dashboard read this note out of
--                     project_json.markerRegistrations[].note, which the app
--                     only ever writes when a plate is REGISTERED. A note
--                     typed afterwards never appeared, and the one on screen
--                     could be months stale. Those notes are still read as a
--                     fallback so nothing on screen today disappears; this
--                     column is now the truth.
--
--   cover_updated_at  When cover_path was last written, so the headset — whose
--                     covers are plain files in its Documents folder — can
--                     compare it against its local file's modification date
--                     and work out which side is newer.
--
-- Deliberately NOT backfilled. Every cover that exists predates the column,
-- and a backfilled `now()` would read as newer than every cover already
-- sitting on a headset and quietly replace all of them on the next refresh.
-- Null means "no claim": the headset takes a remote cover it has no local copy
-- of, and otherwise leaves its own alone until the office actually replaces
-- one.
--
-- No policy work: the project update policies (009, 011) already cover new
-- columns on this table.

alter table public.projects
  add column if not exists anchor_notes jsonb,
  add column if not exists cover_updated_at timestamptz;

comment on column public.projects.anchor_notes is
  'Per-alignment-point reference notes, keyed by step (origin/first/second): '
  '{ "origin": { "text": "garage frame", "updated_at": "2026-10-03T…Z" } }. '
  'Editable on the dashboard and in the headset; newer updated_at wins.';
comment on column public.projects.cover_updated_at is
  'When cover_path was last written. The headset compares it with its local '
  'cover file''s modification date. Null = never written since migration 021.';

insert into public.migrations_applied (name)
values ('021-record-sync')
on conflict do nothing;
