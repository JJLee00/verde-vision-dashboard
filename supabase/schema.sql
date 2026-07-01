-- Verde Vision client dashboard schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).

-- Projects belong to a client (an auth user created via the Supabase dashboard).
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- Each uploaded Excel file of plant estimates.
create table public.plant_estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  uploaded_by uuid not null references auth.users (id) default auth.uid(),
  file_name text not null,
  file_path text not null,
  row_count integer,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;
alter table public.plant_estimates enable row level security;

-- Clients can only see their own projects.
create policy "Clients can view own projects"
  on public.projects for select
  to authenticated
  using (client_id = auth.uid());

-- Clients can see estimates on their own projects.
create policy "Clients can view own estimates"
  on public.plant_estimates for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.client_id = auth.uid()
    )
  );

-- Clients can upload estimates to their own projects.
create policy "Clients can upload estimates to own projects"
  on public.plant_estimates for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.client_id = auth.uid()
    )
  );

-- Private storage bucket for the uploaded Excel files.
insert into storage.buckets (id, name, public)
values ('estimates', 'estimates', false);

-- Files are stored under {user_id}/{project_id}/{filename}; each client can
-- only touch their own top-level folder.
create policy "Users can upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'estimates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read own folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'estimates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
