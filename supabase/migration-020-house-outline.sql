-- Migration 020: a project can carry its lot and house outline.
-- Run in the Supabase SQL editor AFTER migration-019.
--
-- Auto Blueprint looks a property up by address — the county parcel, plus a
-- house footprint traced from aerial imagery — and the headset walks two
-- house corners to drop that outline into the yard. Until now the lookup
-- could only be run IN the headset, on site: typing or confirming an address
-- in a driveway, then waiting on the yard's connection for a ~15 s imagery
-- fetch. That is desk work. The project page now does it, and the headset
-- receives the result with the project list.
--
-- Three columns rather than one blob:
--
--   blueprint_payload    The chosen parcel as /api/blueprint returns it
--                        (outline, house footprint, attributes, imagery date
--                        and extent, warnings) plus the address it was
--                        looked up from. NEVER the aerial image itself — that
--                        is ~500 KB of base64 and this column rides along on
--                        every project-list request a headset makes.
--   blueprint_ortho_path The aerial tile, in the project-media bucket under
--                        {client_id}/{project_id}/blueprint/ortho.jpg. Signed
--                        for the headset the same way anchor photos are.
--   blueprint_fetched_at When the office picked it. The headset compares this
--                        with its own copy so a re-pick reaches it, and an
--                        outline it fetched itself later is not overwritten.
--
-- No policy work: the existing project update policies (009, 011) cover these
-- columns, and the tile lives under the folders 011/012 already govern.

alter table public.projects
  add column if not exists blueprint_payload jsonb,
  add column if not exists blueprint_ortho_path text,
  add column if not exists blueprint_fetched_at timestamptz;

comment on column public.projects.blueprint_payload is
  'Auto Blueprint lot + house outline picked on the dashboard. Geometry in '
  'metres from the parcel centroid (x east, z south). No image bytes.';
comment on column public.projects.blueprint_ortho_path is
  'project-media path of the aerial tile behind blueprint_payload.';
comment on column public.projects.blueprint_fetched_at is
  'When blueprint_payload was picked; the headset adopts newer ones.';

insert into public.migrations_applied (name)
values ('020-house-outline')
on conflict do nothing;
