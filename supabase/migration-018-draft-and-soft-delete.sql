-- Migration 018: a project can be a draft, and a project can be deleted.
-- Run in the Supabase SQL editor AFTER migration-017.
--
-- Both halves exist because projects stopped being something only the
-- headset creates. Parts 2 and 3 are ahead of the code that uses them on
-- purpose: delete-both-ways and dashboard-side creation are one change each,
-- and bundling their schema here means the console is touched once rather
-- than three times.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PART 1 — draft, so the pipeline means something again
-- ─────────────────────────────────────────────────────────────────────────
--
-- As of Sep 29 2026 the app tells the dashboard about a project the moment
-- it is created, instead of waiting for someone to export a blueprint. That
-- is a real improvement — until then an unexported design lived on exactly
-- one headset — but it puts every project a designer starts into `pending`,
-- which the owner's home screen counts as "N awaiting approval". A test
-- project in someone's living room would land in the firm's pipeline.
--
-- `pending` has never meant "this project has content". Migration 013 defines
-- the pipeline as genuinely undecided and close rate as won of decided, so
-- `pending` means a bid is out and the client has not answered. Creating a
-- project is not that. Neither is exporting a PDF, and neither is saving and
-- walking away: all three measure the designer's activity, not the client's
-- answer.
--
-- So `draft` is set once, at creation, and the headset never promotes it.
-- Promotion to `pending` is a dashboard action, taken when the proposal
-- actually reaches the client. That also keeps 013's rule intact — "headset
-- syncs never send status, so a declined project stays declined" — which
-- exists so a sync can't resurrect a deal the client already turned down.
--
-- The DEFAULT deliberately stays `pending`. It is what happens when a caller
-- says nothing, and every existing caller says nothing; changing it would
-- silently re-file work from headsets that haven't updated yet. New projects
-- are marked draft explicitly by the ingest route instead.

alter table public.projects
  drop constraint projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status in ('draft', 'pending', 'approved', 'installed', 'declined'));

-- ─────────────────────────────────────────────────────────────────────────
-- PART 2 — deleting a project without destroying the record of it
-- ─────────────────────────────────────────────────────────────────────────
--
-- Deleting a project on the headset currently removes a local JSON file and
-- nothing else, so the dashboard row orphans and stays forever. The fix is
-- for delete to travel — but not as a real delete. A project row owns the
-- client's blueprint PDFs, their estimate and its line items, the anchor
-- photos and the whole version history. Tidying up a headset must not
-- destroy a signed bid, so the row is marked and hidden instead, and an
-- owner can put it back.
--
-- No policy work: "Clients can update own projects" (009) and "Owners can
-- update org projects" (011) already cover writing this column.
--
-- Readers are NOT filtered here. Every existing query would have to learn
-- about this at once, and a partial rollout that hides a project from one
-- screen and not another is worse than showing it everywhere. The filter
-- lands with the delete endpoints that write the column.

alter table public.projects
  add column if not exists deleted_at timestamptz;

comment on column public.projects.deleted_at is
  'Soft delete. Non-null = removed by a designer; the row, its PDFs, its '
  'estimate and its version history are all kept so an owner can restore it.';

-- Partial: every screen asks for the living projects, and none of them want
-- the index carrying the deleted ones.
create index if not exists projects_live_idx
  on public.projects (org_id, created_at desc)
  where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- PART 3 — the dashboard can create a project
-- ─────────────────────────────────────────────────────────────────────────
--
-- `projects` has had select and update policies since 007/009/011 and never
-- an insert policy, because until now exactly one thing created a project:
-- the Vision Pro ingest route, writing with the service role, which RLS is
-- never consulted for. A designer starting a job from their desk is an
-- authenticated insert, and today it would fail silently.
--
-- The rule is keyed on `client_id` rather than `org_id` on purpose. A BEFORE
-- INSERT trigger (`projects_set_org`, 007) derives org_id from client_id, so
-- a check on org_id would depend on how trigger evaluation and RLS order
-- against each other. client_id is supplied by the caller and means exactly
-- what the rule is about: you may create a project for someone in your own
-- org, and for nobody else.

create policy "Members can create org projects"
  on public.projects for insert to authenticated
  with check (
    client_id in (
      select user_id from public.org_members
      where org_id = public.user_org_id()
    )
  );

insert into public.migrations_applied (name)
values ('018-draft-and-soft-delete')
on conflict do nothing;
