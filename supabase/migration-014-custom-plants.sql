-- Migration 014: custom placeholder plants
-- Run in the Supabase SQL editor AFTER migration-013.
--
-- The 3D library will never cover every plant a designer specifies. A
-- placeholder lets them place a correctly-sized stand-in — a stylized
-- symbol at the real mature dimensions — name it, price it, and keep
-- designing. The plant still lands in the estimate and can still be
-- ordered; only its photoreal mesh is missing.
--
-- Two deliberate decisions:
--
-- 1. ANY org member can write here, unlike the price book (which is
--    owner-only per migration 007). A placeholder exists precisely
--    because a designer hit a gap mid-session, often standing in a
--    client's yard. Routing it through an owner would defeat the
--    feature. The price a designer enters is a proposal an owner can
--    correct in the library.
--
-- 2. `key` is the name normalized the same way as plant_prices.plant_key
--    (lowercase alphanumeric words, single-space joined). It is what
--    makes this table a demand signal: aggregating keys across orgs
--    ranks which missing plants are worth modelling next.

create table public.custom_plants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  -- Creator attribution; org_id is the visibility scope (see 007).
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,

  name text not null check (length(trim(name)) > 0),
  botanical_name text,
  key text not null,

  -- Which stand-in mesh the headset draws. These are all GlyphKind values
  -- in src/lib/viewer/catalog.ts, so the blueprint viewer renders a
  -- placeholder with no special-casing.
  symbol text not null check (symbol in (
    'tree', 'palm', 'shrub', 'groundcover', 'columnar', 'rosette', 'barrel'
  )),

  -- Massing. This is the real job of a placeholder: even without a
  -- photoreal mesh, a correctly-sized form shows what the plant fills,
  -- blocks, and frames.
  mature_height_ft numeric check (mature_height_ft > 0),
  mature_width_ft numeric check (mature_width_ft > 0),

  -- [{ "size": "15g", "price": 125, "installedHeightFt": 4 }, ...]
  -- installedHeightFt is what the plant looks like on install day (what
  -- the client sees in normal mode); mature_height_ft is what Mature
  -- mode grows it into.
  sizes jsonb not null default '[]'::jsonb,

  -- Private project-media object path, {user_id}/placeholders/{file}.
  -- A real nursery photo beside a right-sized form covers most of what
  -- the missing mesh would have shown.
  photo_path text,
  notes text,

  -- 'draft' = created in the headset with only a symbol and a size, still
  -- needs details at the desk. 'ready' = complete enough to quote.
  status text not null default 'ready'
    check (status in ('draft', 'ready')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index custom_plants_org_id_idx on public.custom_plants (org_id);
create index custom_plants_key_idx on public.custom_plants (key);

-- One placeholder per name per org — a second designer typing the same
-- plant should edit the existing row, not fork it, or the estimate and
-- the demand signal both fragment.
create unique index custom_plants_org_key_idx
  on public.custom_plants (org_id, key);

-- Same auto-fill as the price tables: inserts that omit org_id get it
-- from the creator's membership, so client code stays unchanged.
create trigger custom_plants_set_org before insert on public.custom_plants
  for each row execute function public.set_org_from_user_id();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger custom_plants_touch before update on public.custom_plants
  for each row execute function public.touch_updated_at();

alter table public.custom_plants enable row level security;

create policy "Members can view org custom plants"
  on public.custom_plants for select to authenticated
  using (org_id = public.user_org_id());

create policy "Members can add org custom plants"
  on public.custom_plants for insert to authenticated
  with check (org_id is null or org_id = public.user_org_id());

create policy "Members can update org custom plants"
  on public.custom_plants for update to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

create policy "Members can delete org custom plants"
  on public.custom_plants for delete to authenticated
  using (org_id = public.user_org_id());

-- Placeholder photos live beside project media, under a per-user
-- placeholders/ folder. Members read org-wide; writes stay own-folder.
create policy "Members can read org placeholder photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[2] = 'placeholders'
    and (storage.foldername(name))[1] in (
      select user_id::text from public.org_members
      where org_id = public.user_org_id()
    )
  );

create policy "Members can upload placeholder photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-media'
    and (storage.foldername(name))[2] = 'placeholders'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Members can delete own placeholder photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-media'
    and (storage.foldername(name))[2] = 'placeholders'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
