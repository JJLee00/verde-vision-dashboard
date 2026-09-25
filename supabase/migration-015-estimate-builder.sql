-- Migration 015: estimate builder, project versions, company branding
-- Run in the Supabase SQL editor AFTER migration-014.
--
-- One migration instead of three, deliberately: every file in this folder is
-- run by hand in the SQL editor, so each extra migration is another round
-- trip through whoever holds console access. These three changes also land
-- together in the product — the estimate needs branding for its PDF, and the
-- dashboard editor needs versions before it can safely write anything.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PART 1 — estimate_items: the estimate becomes rows, not a number
-- ─────────────────────────────────────────────────────────────────────────
--
-- Until now an estimate reached the dashboard as `projects.estimate_amount`
-- (one number) plus an `estimate_path` PDF rendered in the headset. That
-- estimate can only ever bill what was placed in AR, which is a fraction of
-- a landscape bid — no irrigation, demolition, delivery, dump fees or extra
-- labor, because nobody models those in 3D. So the designer finishes every
-- bid in another tool, and Verde Vision is a plant list rather than the
-- proposal system.
--
-- Three decisions encoded below:
--
-- 1. `source` is the whole design. Rows the AR design wrote ('ar') are
--    rewritten on every headset sync; rows the designer typed ('manual') are
--    never touched by a sync. If a resync ever eats typed work, designers
--    stop typing and the feature is dead.
--
-- 2. A FLAT list, not grouped sections (decided Sep 25 2026). `sort_order` is
--    the designer's drag order and `category` is only a TAG — it carries the
--    Saved Items picker and lets the client PDF roll rows up into lump sums
--    without the editor having to nest anything.
--
-- 3. Sell price only. No cost/markup columns: one price per row, what the
--    client pays. Revisit if margin reporting is ever actually asked for.

create table public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects (id) on delete cascade,
  -- Visibility scope, same as everywhere else since 007. Filled from the
  -- parent PROJECT rather than the creator (see the trigger below).
  org_id uuid references public.organizations (id) on delete cascade,

  -- The designer's drag order. Sparse on purpose (see the reorder note
  -- below) so moving one row rewrites one row.
  sort_order integer not null default 0,

  description text not null check (length(trim(description)) > 0),

  -- A tag, not structure. Drives the Saved Items picker and the grouped
  -- PDF rollup; the editor stays one flat list regardless.
  category text not null default 'other' check (category in (
    'plant', 'hardscape', 'irrigation', 'demolition',
    'labor', 'material', 'service', 'equipment',
    'delivery', 'fee', 'other'
  )),

  quantity numeric(12, 2) not null default 1,
  -- each|hr|ft²|yd³|load|trip|ls — free text rather than a check, because
  -- the next unit a landscaper needs is not predictable and a failed insert
  -- mid-bid is worse than an odd unit string.
  unit text not null default 'each',
  unit_price numeric(12, 2) not null default 0,

  -- Generated, so nothing can ever store a total that disagrees with its own
  -- arithmetic. A lump sum is simply qty 1 × its price.
  total numeric(12, 2) generated always as (quantity * unit_price) stored,

  -- Tax usually applies to materials and not to labor, and which is which
  -- varies by state. Per-row beats a global rule. The app sends labor rows
  -- as taxable = false.
  taxable boolean not null default true,

  -- Optional scope note, printed under the line on the itemized PDF
  -- ("includes 2 valves, excludes trenching under the drive").
  note text,

  source text not null check (source in ('ar', 'manual')),

  -- Stable identity for source='ar' rows so a resync can UPDATE them in
  -- place instead of delete-and-recreate: 'plant:<catalog key>:<size>' and
  -- 'hardscape:<area id>'. Null for manual rows.
  ar_key text,

  -- Set when a designer types over a price the price book supplied. A
  -- resync then updates the QUANTITY but leaves the price alone — otherwise
  -- every walk through the yard stamps $310 back over the $340 they meant.
  price_overridden boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An AR row must carry its key and a manual row must not, or rule 1 above
  -- has no way to tell them apart.
  constraint estimate_items_ar_key_shape check (
    (source = 'ar' and ar_key is not null) or
    (source = 'manual' and ar_key is null)
  )
);

create index estimate_items_project_idx
  on public.estimate_items (project_id, sort_order);

-- What makes the resync an upsert rather than a rebuild.
create unique index estimate_items_ar_key_idx
  on public.estimate_items (project_id, ar_key) where ar_key is not null;

-- org_id comes from the PROJECT, not from auth.uid(). The Vision Pro ingest
-- route writes AR rows with the service role, where auth.uid() is null — the
-- set_org_from_user_id() trigger the price tables use would leave org_id
-- null there and every row would fall out of RLS.
create or replace function public.set_org_from_project()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.org_id is null then
    select org_id into new.org_id
    from public.projects where id = new.project_id;
  end if;
  return new;
end;
$$;

create trigger estimate_items_set_org before insert on public.estimate_items
  for each row execute function public.set_org_from_project();

-- touch_updated_at() first appeared in 014, which is still on an unmerged
-- branch — so define it here too rather than depend on the order those two
-- land in. `create or replace` makes running both harmless.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger estimate_items_touch before update on public.estimate_items
  for each row execute function public.touch_updated_at();

alter table public.estimate_items enable row level security;

-- ANY org member can write, like custom_plants and unlike the price book.
-- Finishing a bid is the designer's own job; routing it through an owner
-- would defeat the feature.
create policy "Members can view org estimate items"
  on public.estimate_items for select to authenticated
  using (org_id = public.user_org_id());

create policy "Members can add org estimate items"
  on public.estimate_items for insert to authenticated
  with check (
    org_id is null or org_id = public.user_org_id()
  );

create policy "Members can update org estimate items"
  on public.estimate_items for update to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

create policy "Members can delete org estimate items"
  on public.estimate_items for delete to authenticated
  using (org_id = public.user_org_id());

-- ─────────────────────────────────────────────────────────────────────────
-- PART 2 — estimate settings on projects
-- ─────────────────────────────────────────────────────────────────────────
--
-- Per-project, not per-org: tax follows the property's jurisdiction and the
-- deposit is negotiated per job. Defaults of 0 mean an untouched project
-- quotes exactly what the rows add up to.

alter table public.projects
  add column tax_rate numeric(6, 3) not null default 0
    check (tax_rate >= 0 and tax_rate <= 100),
  add column deposit_percent numeric(5, 2) not null default 0
    check (deposit_percent >= 0 and deposit_percent <= 100),
  -- 'itemized' shows every row with qty and unit price; 'grouped' rolls rows
  -- up by category into one line each, label and total only. Many
  -- contractors deliberately withhold unit prices so a bid can't be shopped
  -- line by line; some clients demand them. One switch covers both, and both
  -- must produce the same grand total.
  add column estimate_detail text not null default 'itemized'
    check (estimate_detail in ('itemized', 'grouped')),
  -- Defaults from the org's terms at PDF time; set here only to override
  -- for one job.
  add column estimate_terms text;

-- ─────────────────────────────────────────────────────────────────────────
-- PART 3 — widen the price book so Saved Items can exist
-- ─────────────────────────────────────────────────────────────────────────
--
-- price_items is the Saved Items table: name, category, price, unit, already
-- org-scoped by 007 (members read, owners write). Its category check has
-- been ('plant','labor') since 003, so it literally cannot hold "dump fee"
-- or "irrigation modification" — the two things a designer most needs saved.
--
-- Safe to widen: every reader (the project page, the viewer, /api/prices and
-- the share page) filters on category = 'plant', so none of them see the new
-- categories.

alter table public.price_items
  drop constraint if exists price_items_category_check;

alter table public.price_items
  add constraint price_items_category_check check (category in (
    'plant', 'hardscape', 'irrigation', 'demolition',
    'labor', 'material', 'service', 'equipment',
    'delivery', 'fee', 'other'
  ));

-- ─────────────────────────────────────────────────────────────────────────
-- PART 4 — project_versions: stop replacing the design wholesale
-- ─────────────────────────────────────────────────────────────────────────
--
-- `projects.project_json` is REPLACED on every headset sync (migration 008).
-- That is fine while the headset is the only writer, and becomes silent data
-- loss the moment the dashboard can edit a design: the designer's office work
-- disappears the next time they open the project in the Vision Pro.
--
-- Append-only versions fix that and give publishable revisions for free:
-- a draft is a version nobody has published yet.
--
-- `projects.project_json` stays as-is — the viewer, the share page and the
-- crew link all read it, and it keeps meaning "the current published design".
-- Nothing has to change on read the day this runs.

create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete cascade,

  -- 1, 2, 3 … per project. Revision 1 is the first thing the headset synced;
  -- what a client is shown as "Revision 2" is a label over this number.
  revision integer not null,

  -- Who wrote it, and from where. 'headset' versions arrive from the Vision
  -- Pro; 'dashboard' versions are office edits.
  source text not null check (source in ('headset', 'dashboard')),
  author_id uuid references auth.users (id) on delete set null,

  -- 'draft' is private to the designer; 'published' is what a client may
  -- see. Headset syncs publish immediately — the designer was standing in
  -- the yard, there is nothing to review.
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  published_at timestamptz,

  -- The full ProjectFile at this revision.
  project_json jsonb not null,

  -- Human-readable diff summary for the revision list and the client
  -- notification ("3 plants replaced, 1 added, +$1,240").
  summary text,

  created_at timestamptz not null default now()
);

create unique index project_versions_revision_idx
  on public.project_versions (project_id, revision);
create index project_versions_project_idx
  on public.project_versions (project_id, created_at desc);

create trigger project_versions_set_org before insert on public.project_versions
  for each row execute function public.set_org_from_project();

alter table public.project_versions enable row level security;

create policy "Members can view org project versions"
  on public.project_versions for select to authenticated
  using (org_id = public.user_org_id());

create policy "Members can add org project versions"
  on public.project_versions for insert to authenticated
  with check (org_id is null or org_id = public.user_org_id());

-- Update, not insert, because publishing a draft flips status in place.
-- Versions are otherwise append-only: no delete policy at all, so a
-- published revision cannot be quietly removed from the history.
create policy "Members can update org project versions"
  on public.project_versions for update to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

-- Pointer to the newest PUBLISHED version, so readers never have to sort.
alter table public.projects
  add column current_version_id uuid
    references public.project_versions (id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────
-- PART 5 — company branding
-- ─────────────────────────────────────────────────────────────────────────
--
-- Every PDF Verde Vision generates currently says "Verde Vision". It should
-- carry the LANDSCAPER's business — their client should see their brand.
-- Verde Vision keeps a small "designed with" mark, not the headline.
--
-- Owner-only writes: 007 already restricts `organizations` updates to owners,
-- so these columns inherit that with no new policy.

alter table public.organizations
  add column logo_path text,          -- object path in the org-assets bucket
  add column phone text,
  add column email text,
  add column address text,
  add column website text,
  add column license_number text,     -- ROC # in Arizona, varies by state
  add column terms text;              -- default terms block on every estimate

-- Public bucket: a logo is printed on documents that get emailed, shared by
-- link and handed to clients on paper. Nothing private belongs here.
insert into storage.buckets (id, name, public)
values ('org-assets', 'org-assets', true)
on conflict (id) do nothing;

-- Path is {org_id}/{filename}, so the folder check IS the org check.
create policy "Members can read org assets"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1] = public.user_org_id()::text
  );

create policy "Owners can upload org assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1] = public.user_org_id()::text
    and public.user_is_owner()
  );

create policy "Owners can replace org assets"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1] = public.user_org_id()::text
    and public.user_is_owner()
  );

create policy "Owners can delete org assets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'org-assets'
    and (storage.foldername(name))[1] = public.user_org_id()::text
    and public.user_is_owner()
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Note on sort_order, for whoever builds the reorder UI
-- ─────────────────────────────────────────────────────────────────────────
--
-- Rows are inserted at sort_order = (max + 10), leaving gaps, so dragging a
-- row between two others is one UPDATE to the midpoint rather than
-- renumbering the whole bid. When the gap between two neighbours closes to
-- zero the client renumbers that project's rows by 10s and carries on.
