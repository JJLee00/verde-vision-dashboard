-- Migration 008: project JSON + 3D viewer share tokens
-- Run in the Supabase SQL editor AFTER migration-007.
--
-- project_json: the full ProjectFile the Vision Pro app saves on device
-- (placements, boundary, feature polygons, hardscape areas — positions in
-- LOCAL alignment coordinates, meters, Y-up). Sent by the app on every
-- blueprint/estimate sync; drives the dashboard's living-blueprint 3D
-- viewer. Replaced wholesale on each sync.
--
-- share_token / crew_token: unguessable tokens for the public viewer link.
-- share_token shows pricing (homeowner link); crew_token hides pricing
-- (install-crew link). Two separate tokens — not a URL flag — so a crew
-- can't flip pricing on by editing the URL.

alter table public.projects
  add column project_json jsonb,
  add column project_json_updated_at timestamptz,
  add column share_token uuid not null unique default gen_random_uuid(),
  add column crew_token uuid not null unique default gen_random_uuid();
