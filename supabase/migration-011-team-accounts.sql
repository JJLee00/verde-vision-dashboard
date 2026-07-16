-- Migration 011: team accounts (master/owner + designer seats)
-- Run in the Supabase SQL editor AFTER migration-010.
--
-- A design firm gets 1 owner (master) account + up to 3 designer seats.
-- Migration 007 built the org model; this one makes it usable: the owner
-- invites designers from the dashboard (/api/team fills email/full_name
-- here), a per-firm seat cap, owner edit rights on every org project, and
-- storage policies widened so the owner sees and manages designers' media.

-- ---------------------------------------------------------------------------
-- 1. Seat cap — default 3 designer seats, overridable per firm in the
--    table editor (bigger plans later).
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column max_designers int not null default 3;

-- ---------------------------------------------------------------------------
-- 2. Member identity — denormalized onto org_members so pages can show
--    names without service-role lookups (there is no profiles table).
--    Filled by /api/team on invite; backfilled from auth.users here.
--    Members can already read their own org's rows (007 select policy).
-- ---------------------------------------------------------------------------
alter table public.org_members
  add column email text,
  add column full_name text;

update public.org_members m
set email = u.email,
    full_name = coalesce(
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name'
    )
from auth.users u
where u.id = m.user_id;

-- ---------------------------------------------------------------------------
-- 3. Seat-cap backstop. /api/team pre-checks the count, but two racing
--    invites could both pass it — the org-row lock here serializes them.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_designer_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap int;
  cnt int;
begin
  if new.role = 'designer' then
    select max_designers into cap
      from public.organizations
      where id = new.org_id
      for update;
    select count(*) into cnt
      from public.org_members
      where org_id = new.org_id and role = 'designer';
    if cnt >= cap then
      raise exception 'designer_seat_limit_reached';
    end if;
  end if;
  return new;
end;
$$;

create trigger org_members_designer_cap
  before insert on public.org_members
  for each row execute function public.enforce_designer_cap();

-- ---------------------------------------------------------------------------
-- 4. Owners can edit every org project. Additive to 009's own-row policy
--    ("Clients can update own projects") — permissive policies OR together,
--    so designers keep editing their own projects.
-- ---------------------------------------------------------------------------
create policy "Owners can update org projects"
  on public.projects for update
  to authenticated
  using (org_id = public.user_org_id() and public.user_is_owner())
  with check (org_id = public.user_org_id() and public.user_is_owner());

-- ---------------------------------------------------------------------------
-- 5. project-media: reads become org-wide, owners can also write.
--    Paths are {client_id}/{project_id}/… so the check keys on the
--    PROJECT (2nd folder), not the member list — a removed designer's
--    covers/videos/anchors stay visible because the project row keeps
--    its org_id even after the org_members row is gone.
--    009's own-folder insert/delete policies stay for designers' uploads.
-- ---------------------------------------------------------------------------
drop policy "Own project media: select" on storage.objects;

create policy "Members can read org project media"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'project-media'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[2]
        and p.org_id = public.user_org_id()
    )
  );

create policy "Owners can add org project media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'project-media'
    and public.user_is_owner()
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[2]
        and p.org_id = public.user_org_id()
    )
  );

create policy "Owners can delete org project media"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'project-media'
    and public.user_is_owner()
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[2]
        and p.org_id = public.user_org_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. blueprints: same project-scoped rewrite of the read policy, so a
--    removed designer's blueprint/estimate PDFs (paths are also
--    {client_id}/{project_id}/…) don't go dark for the org. The
--    estimates and price-sheets buckets keep 007's member-folder reads.
-- ---------------------------------------------------------------------------
drop policy "Members can read org blueprints" on storage.objects;

create policy "Members can read org project blueprints"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'blueprints'
    and exists (
      select 1 from public.projects p
      where p.id::text = (storage.foldername(objects.name))[2]
        and p.org_id = public.user_org_id()
    )
  );
