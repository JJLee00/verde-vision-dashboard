-- Migration 006: estimate PDF + plant usage on projects
-- Run in the Supabase SQL editor AFTER migration-005.
--
-- estimate_path: the itemized estimate PDF uploaded by the Vision Pro app
-- (same private "blueprints" bucket and {client_id}/{project_id}/ folder as
-- the blueprint, so the existing read policy already covers it).
--
-- plant_usage: JSON summary of what's placed in the project, sent by the
-- app on every sync: [{ "key": "aloe vera", "size": "5g", "count": 12 }].
-- Drives the usage stat cards on the Plant/Hardscape Prices pages.

alter table public.projects
  add column estimate_path text,
  add column plant_usage jsonb;
