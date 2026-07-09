-- Migration 007: organizations + roles (Accounts Phase 1)
-- Run in the Supabase SQL editor AFTER migration-006.
--
-- Introduces the company layer: every user belongs to one organization with
-- a role (owner or designer). The org — not the individual user — owns
-- projects and the price book. Existing users are backfilled into one-person
-- orgs where they are the owner, so nothing changes for them until invites
-- ship (Phase 2).
--
-- After this migration:
--   * projects.client_id and the price tables' user_id become creator
--     ATTRIBUTION; org_id is the owning/visibility scope.
--   * All org members can READ projects and prices; only owners can WRITE
--     the price book (price_items, price_sheets, labor_rates, plant_prices).
--   * Inserts that don't set org_id (the Vision Pro ingest route, the
--     dashboard price editors) get it auto-filled by trigger from the
--     creator's membership, so no server code changes are required.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Billing gate for Phase 4 (Stripe). Everything is 'trial' until then.
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'past_due', 'canceled')),
  created_at timestamptz not null default now()
);

-- user_id as primary key = each user belongs to exactly one org. Relax to a
-- composite key later if multi-org membership is ever needed.
create table public.org_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role text not null check (role in ('owner', 'designer')),
  created_at timestamptz not null default now()
);

create index org_members_org_id_idx on public.org_members (org_id);

-- ---------------------------------------------------------------------------
-- 2. RLS helpers
-- ---------------------------------------------------------------------------
-- security definer so policies on other tables can consult org_members
-- without tripping over org_members' own RLS (or recursing).

create or replace function public.user_org_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

create or replace function public.user_is_owner()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid() and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS on the new tables
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;

create policy "Members can view own org"
  on public.organizations for select to authenticated
  using (id = public.user_org_id());

create policy "Owners can update own org"
  on public.organizations for update to authenticated
  using (id = public.user_org_id() and public.user_is_owner())
  with check (id = public.user_org_id() and public.user_is_owner());

-- Designers can see who's on their team; membership changes (invites,
-- removals) go through server routes using the service role in Phase 2.
create policy "Members can view own org members"
  on public.org_members for select to authenticated
  using (org_id = public.user_org_id());

-- ---------------------------------------------------------------------------
-- 4. org_id on existing tables + backfill
-- ---------------------------------------------------------------------------

alter table public.projects add column org_id uuid references public.organizations (id);
alter table public.price_sheets add column org_id uuid references public.organizations (id);
alter table public.price_items add column org_id uuid references public.organizations (id);
alter table public.labor_rates add column org_id uuid references public.organizations (id);
alter table public.plant_prices add column org_id uuid references public.organizations (id);

-- Every existing user becomes the owner of a one-person org named after
-- their email prefix (they can rename it once org settings ship).
do $$
declare
  u record;
  new_org uuid;
begin
  for u in select id, email from auth.users loop
    insert into public.organizations (name)
    values (coalesce(nullif(split_part(u.email, '@', 1), ''), 'My Company'))
    returning id into new_org;

    insert into public.org_members (user_id, org_id, role)
    values (u.id, new_org, 'owner');
  end loop;
end;
$$;

update public.projects p
  set org_id = m.org_id from public.org_members m where m.user_id = p.client_id;
update public.price_sheets t
  set org_id = m.org_id from public.org_members m where m.user_id = t.user_id;
update public.price_items t
  set org_id = m.org_id from public.org_members m where m.user_id = t.user_id;
update public.labor_rates t
  set org_id = m.org_id from public.org_members m where m.user_id = t.user_id;
update public.plant_prices t
  set org_id = m.org_id from public.org_members m where m.user_id = t.user_id;

alter table public.projects alter column org_id set not null;
alter table public.price_sheets alter column org_id set not null;
alter table public.price_items alter column org_id set not null;
alter table public.labor_rates alter column org_id set not null;
alter table public.plant_prices alter column org_id set not null;

create index projects_org_id_idx on public.projects (org_id);
create index price_items_org_id_idx on public.price_items (org_id);
create index labor_rates_org_id_idx on public.labor_rates (org_id);
create index plant_prices_org_id_idx on public.plant_prices (org_id);

comment on column public.projects.client_id is
  'Creating designer (attribution). Visibility is scoped by org_id.';

-- NOTE: labor_rates unique (user_id, size) and plant_prices unique
-- (user_id, plant_key, size) stay user-scoped for now because the dashboard
-- upserts against them. When multi-member orgs ship (Phase 2), migrate these
-- to org-scoped uniques together with the editor UI.

-- ---------------------------------------------------------------------------
-- 5. Auto-fill org_id on insert
-- ---------------------------------------------------------------------------
-- Keeps the Vision Pro ingest route (inserts projects with client_id only)
-- and the dashboard price editors (insert with user_id default auth.uid())
-- working unchanged.

create or replace function public.set_org_from_client_id()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.org_id is null then
    select org_id into new.org_id
    from public.org_members where user_id = new.client_id;
  end if;
  return new;
end;
$$;

create or replace function public.set_org_from_user_id()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.org_id is null then
    select org_id into new.org_id
    from public.org_members where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger projects_set_org before insert on public.projects
  for each row execute function public.set_org_from_client_id();
create trigger price_sheets_set_org before insert on public.price_sheets
  for each row execute function public.set_org_from_user_id();
create trigger price_items_set_org before insert on public.price_items
  for each row execute function public.set_org_from_user_id();
create trigger labor_rates_set_org before insert on public.labor_rates
  for each row execute function public.set_org_from_user_id();
create trigger plant_prices_set_org before insert on public.plant_prices
  for each row execute function public.set_org_from_user_id();

-- ---------------------------------------------------------------------------
-- 6. Rewrite RLS: own-rows → org-rows
-- ---------------------------------------------------------------------------
-- Reads are org-wide. Price-book writes are owner-only (per product decision:
-- one company price book, designers read-only). Every backfilled user is an
-- owner, so current behavior is unchanged.

-- Projects: any member can see the whole org's projects.
drop policy "Clients can view own projects" on public.projects;
create policy "Members can view org projects"
  on public.projects for select to authenticated
  using (org_id = public.user_org_id());

-- Plant estimates (per-project Excel uploads): member-level, org-scoped.
drop policy "Clients can view own estimates" on public.plant_estimates;
drop policy "Clients can upload estimates to own projects" on public.plant_estimates;

create policy "Members can view org estimates"
  on public.plant_estimates for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.org_id = public.user_org_id()
    )
  );

create policy "Members can upload estimates to org projects"
  on public.plant_estimates for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.org_id = public.user_org_id()
    )
  );

-- Price sheets: members read, owners write.
drop policy "Own price sheets: select" on public.price_sheets;
drop policy "Own price sheets: insert" on public.price_sheets;
drop policy "Own price sheets: delete" on public.price_sheets;

create policy "Members can view org price sheets"
  on public.price_sheets for select to authenticated
  using (org_id = public.user_org_id());
create policy "Owners can add price sheets"
  on public.price_sheets for insert to authenticated
  with check (org_id = public.user_org_id() and public.user_is_owner());
create policy "Owners can delete price sheets"
  on public.price_sheets for delete to authenticated
  using (org_id = public.user_org_id() and public.user_is_owner());

-- Price items: members read, owners write.
drop policy "Own price items: select" on public.price_items;
drop policy "Own price items: insert" on public.price_items;
drop policy "Own price items: update" on public.price_items;
drop policy "Own price items: delete" on public.price_items;

create policy "Members can view org price items"
  on public.price_items for select to authenticated
  using (org_id = public.user_org_id());
create policy "Owners can add price items"
  on public.price_items for insert to authenticated
  with check (org_id = public.user_org_id() and public.user_is_owner());
create policy "Owners can update price items"
  on public.price_items for update to authenticated
  using (org_id = public.user_org_id() and public.user_is_owner());
create policy "Owners can delete price items"
  on public.price_items for delete to authenticated
  using (org_id = public.user_org_id() and public.user_is_owner());

-- Labor rates: members read, owners write.
drop policy "Own labor rates: select" on public.labor_rates;
drop policy "Own labor rates: insert" on public.labor_rates;
drop policy "Own labor rates: update" on public.labor_rates;
drop policy "Own labor rates: delete" on public.labor_rates;

create policy "Members can view org labor rates"
  on public.labor_rates for select to authenticated
  using (org_id = public.user_org_id());
create policy "Owners can add labor rates"
  on public.labor_rates for insert to authenticated
  with check (org_id = public.user_org_id() and public.user_is_owner());
create policy "Owners can update labor rates"
  on public.labor_rates for update to authenticated
  using (org_id = public.user_org_id() and public.user_is_owner());
create policy "Owners can delete labor rates"
  on public.labor_rates for delete to authenticated
  using (org_id = public.user_org_id() and public.user_is_owner());

-- Plant prices: members read, owners write.
drop policy "Own plant prices: select" on public.plant_prices;
drop policy "Own plant prices: insert" on public.plant_prices;
drop policy "Own plant prices: update" on public.plant_prices;
drop policy "Own plant prices: delete" on public.plant_prices;

create policy "Members can view org plant prices"
  on public.plant_prices for select to authenticated
  using (org_id = public.user_org_id());
create policy "Owners can add plant prices"
  on public.plant_prices for insert to authenticated
  with check (org_id = public.user_org_id() and public.user_is_owner());
create policy "Owners can update plant prices"
  on public.plant_prices for update to authenticated
  using (org_id = public.user_org_id() and public.user_is_owner());
create policy "Owners can delete plant prices"
  on public.plant_prices for delete to authenticated
  using (org_id = public.user_org_id() and public.user_is_owner());

-- ---------------------------------------------------------------------------
-- 7. Storage: reads become org-wide
-- ---------------------------------------------------------------------------
-- Files stay under {user_id}/… folders; org-mates may read each other's
-- folders. Folder names are compared as text against the org's member ids
-- (org_members' select policy already limits the subquery to the caller's
-- own org).

-- Blueprints + estimate PDFs (written only by the service role).
drop policy "Clients can read own blueprints" on storage.objects;
create policy "Members can read org blueprints"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'blueprints'
    and (storage.foldername(name))[1] in (
      select user_id::text from public.org_members
      where org_id = public.user_org_id()
    )
  );

-- Project estimate Excel uploads: org-wide read, uploads stay own-folder
-- (the existing "Users can upload to own folder" policy is unchanged).
drop policy "Users can read own folder" on storage.objects;
create policy "Members can read org estimate folders"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'estimates'
    and (storage.foldername(name))[1] in (
      select user_id::text from public.org_members
      where org_id = public.user_org_id()
    )
  );

-- Price-sheet files: org-wide read; writes owner-only, still own-folder.
drop policy "Price sheets: read own folder" on storage.objects;
drop policy "Price sheets: upload to own folder" on storage.objects;
drop policy "Price sheets: delete own folder" on storage.objects;

create policy "Members can read org price-sheet folders"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'price-sheets'
    and (storage.foldername(name))[1] in (
      select user_id::text from public.org_members
      where org_id = public.user_org_id()
    )
  );
create policy "Owners can upload price sheets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'price-sheets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.user_is_owner()
  );
create policy "Owners can delete own price sheets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'price-sheets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.user_is_owner()
  );
