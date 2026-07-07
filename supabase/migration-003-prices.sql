-- Migration 003: designer prices (Prices tab)
-- Run in the Supabase SQL editor AFTER migration-002.

-- Uploaded Excel price sheets (plant prices, labor rates).
create table public.price_sheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  file_name text not null,
  file_path text not null,
  row_count integer,
  created_at timestamptz not null default now()
);

-- Manually entered prices. category 'plant' is priced per item,
-- 'labor' per hour.
create table public.price_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null,
  category text not null check (category in ('plant', 'labor')),
  price numeric(12, 2) not null,
  unit text not null default 'each',
  created_at timestamptz not null default now()
);

alter table public.price_sheets enable row level security;
alter table public.price_items enable row level security;

create policy "Own price sheets: select"
  on public.price_sheets for select to authenticated
  using (user_id = auth.uid());

create policy "Own price sheets: insert"
  on public.price_sheets for insert to authenticated
  with check (user_id = auth.uid());

create policy "Own price sheets: delete"
  on public.price_sheets for delete to authenticated
  using (user_id = auth.uid());

create policy "Own price items: select"
  on public.price_items for select to authenticated
  using (user_id = auth.uid());

create policy "Own price items: insert"
  on public.price_items for insert to authenticated
  with check (user_id = auth.uid());

create policy "Own price items: update"
  on public.price_items for update to authenticated
  using (user_id = auth.uid());

create policy "Own price items: delete"
  on public.price_items for delete to authenticated
  using (user_id = auth.uid());

-- Private bucket for the uploaded sheets, path {user_id}/{filename}.
insert into storage.buckets (id, name, public)
values ('price-sheets', 'price-sheets', false);

create policy "Price sheets: upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'price-sheets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Price sheets: read own folder"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'price-sheets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Price sheets: delete own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'price-sheets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
