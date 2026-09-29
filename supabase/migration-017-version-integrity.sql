-- Migration 017: make project_versions genuinely append-only, let drafts be
-- cleaned up, and stop trusting a client-supplied org_id.
-- Run in the Supabase SQL editor AFTER migration-016.
--
-- Parts 1 and 3 are Jason's review notes on 016. Part 2 is a bug found while
-- writing part 1: the same missing-delete-policy decision that makes history
-- safe also makes drafts immortal.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PART 1 — drafts can be deleted, published versions still cannot
-- ─────────────────────────────────────────────────────────────────────────
--
-- 016 gave project_versions no delete policy at all, deliberately, so that a
-- published revision could never be quietly removed. But two code paths
-- delete DRAFTS: publishRevision() clears the open draft once its content is
-- published, and the editor's Discard button throws one away. Under RLS a
-- delete with no policy removes zero rows and reports no error, and neither
-- caller checks — so today Discard does not discard, and publishing leaves
-- the draft behind. The editor finds that stale draft on the next open and
-- resumes editing work the designer already published or threw away.
--
-- A delete policy scoped to status = 'draft' fixes both without reopening
-- the hole 016 was closing: history is exactly the published rows, and those
-- stay undeletable.

create policy "Members can delete org draft versions"
  on public.project_versions for delete to authenticated
  using (org_id = public.user_org_id() and status = 'draft');

-- ─────────────────────────────────────────────────────────────────────────
-- PART 2 — a published version is frozen; a draft is still a draft
-- ─────────────────────────────────────────────────────────────────────────
--
-- 016 claimed append-only and enforced half of it. "Members can update org
-- project versions" allows an UPDATE to any column, project_json included,
-- so a published revision could be rewritten in place and the history would
-- still look untouched — worse than losing it.
--
-- The rule is NOT "only status and published_at may ever change", though:
-- saving a draft in the design editor is an UPDATE of project_json on the
-- open draft row, so that rule would break every save. The real invariant is
-- that PUBLISHED rows are frozen and drafts stay editable until they aren't.
--
-- Identity columns are frozen in both states — nothing legitimate moves a
-- version to another project or org. `revision` stays mutable on a draft on
-- purpose: publishRevision() assigns the final number at publish time so a
-- headset sync landing mid-edit can't strand the draft behind it.
--
-- RLS cannot express "these columns only", so this goes in a trigger, which
-- has the side benefit of covering the service role that RLS never sees.

create or replace function public.project_versions_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- author_id is `on delete set null`, and Postgres applies that as an UPDATE
  -- on this table. Without this escape a published version would make its
  -- author undeletable ("immutable") and a draft would fail on the identity
  -- check — deleting an auth user who ever authored a version would error.
  --
  -- Narrow on purpose: it only lets through the exact shape the FK produces,
  -- author_id going non-null → null with every other column byte-identical.
  -- Anything else riding along fails the comparison and hits the rules below.
  if new.author_id is null and old.author_id is not null
     and (to_jsonb(new) - 'author_id') = (to_jsonb(old) - 'author_id') then
    return new;
  end if;

  if old.status = 'published' then
    raise exception
      'project_versions: a published revision is immutable (id %)', old.id
      using errcode = 'check_violation';
  end if;

  if new.id         is distinct from old.id
  or new.project_id is distinct from old.project_id
  or new.org_id     is distinct from old.org_id
  or new.source     is distinct from old.source
  or new.author_id  is distinct from old.author_id
  or new.created_at is distinct from old.created_at then
    raise exception
      'project_versions: identity columns cannot be changed (id %)', old.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists project_versions_no_rewrite on public.project_versions;
create trigger project_versions_no_rewrite
  before update on public.project_versions
  for each row execute function public.project_versions_guard_update();

-- ─────────────────────────────────────────────────────────────────────────
-- PART 3 — org_id is always derived, never accepted
-- ─────────────────────────────────────────────────────────────────────────
--
-- set_org_from_project() in 016 fills org_id only when the incoming row
-- leaves it null, so a caller that supplies one is believed. An
-- authenticated writer is caught by the insert policies, but the Vision Pro
-- ingest route writes with the service role, where RLS is not consulted at
-- all — the headset's payload would decide which org owns the row. The
-- project already knows the answer, so nothing is lost by always asking it.
--
-- Replacing the function is enough: both triggers (estimate_items and
-- project_versions) point at it and neither needs recreating.

create or replace function public.set_org_from_project()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  select org_id into new.org_id
  from public.projects where id = new.project_id;
  return new;
end;
$$;

insert into public.migrations_applied (name)
values ('017-version-integrity')
on conflict do nothing;
