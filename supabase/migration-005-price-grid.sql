-- Migration 005: structured price grid (Prices tab v2)
-- Run in the Supabase SQL editor AFTER migration-004.
--
-- Replaces free-text price_items as the estimate source. Plants and sizes
-- come from the app catalog (src/lib/catalog.json); designers only store
-- overrides here. Labor is priced per plant BY CONTAINER SIZE — a 5g plant
-- takes the same work regardless of species.

-- Labor rate per container size ("5g", "15g", '24" Box', "Small", ...).
create table public.labor_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  size text not null,
  rate numeric(12, 2) not null check (rate >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, size)
);

-- Designer's price for one (plant, size) cell. plant_key is the catalog's
-- normalized key ("aloe vera"); size matches ContainerSize raw ("5g").
create table public.plant_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  plant_key text not null,
  size text not null,
  price numeric(12, 2) not null check (price >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, plant_key, size)
);

alter table public.labor_rates enable row level security;
alter table public.plant_prices enable row level security;

create policy "Own labor rates: select"
  on public.labor_rates for select to authenticated
  using (user_id = auth.uid());

create policy "Own labor rates: insert"
  on public.labor_rates for insert to authenticated
  with check (user_id = auth.uid());

create policy "Own labor rates: update"
  on public.labor_rates for update to authenticated
  using (user_id = auth.uid());

create policy "Own labor rates: delete"
  on public.labor_rates for delete to authenticated
  using (user_id = auth.uid());

create policy "Own plant prices: select"
  on public.plant_prices for select to authenticated
  using (user_id = auth.uid());

create policy "Own plant prices: insert"
  on public.plant_prices for insert to authenticated
  with check (user_id = auth.uid());

create policy "Own plant prices: update"
  on public.plant_prices for update to authenticated
  using (user_id = auth.uid());

create policy "Own plant prices: delete"
  on public.plant_prices for delete to authenticated
  using (user_id = auth.uid());
