-- Migration 010: anchor reference photos
-- Run in the Supabase SQL editor AFTER migration-009.
--
-- The headset captures a reference photo at each of the 3 alignment
-- anchors (origin / first / second) so a designer can re-align a project
-- on a later visit. The Vision Pro app now uploads these on sync; the
-- files live in the existing project-media bucket under
-- {client_id}/{project_id}/anchors/, and their paths are recorded here
-- keyed by step: { "origin": "...", "first": "...", "second": "..." }.

alter table public.projects
  add column anchor_paths jsonb;
