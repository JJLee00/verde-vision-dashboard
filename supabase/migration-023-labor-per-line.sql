-- Migration 023: labor becomes a column on every estimate line.
-- Run in the Supabase SQL editor AFTER migration-022, and BEFORE deploying
-- the dashboard build that reads it (the old build keeps working against
-- this schema — new columns default to 0 — so run it first).
--
-- Until now a design's labor reached the estimate as ONE line, "Installation
-- labor", summed from every plant's rate. Two problems with that:
--
--   * A price typed over that line froze it. Add ten plants afterwards and the
--     labor stayed exactly what it was, with nothing on screen to say so.
--   * Nobody could see what drove it, or adjust the one tree on a slope that
--     takes twice the work without hand-editing the whole sum.
--
-- So every line carries its own labor beside its price, the way a contractor's
-- estimate always has: Price · Labor · Amount. The design fills it from the
-- org's labor rates; typing over it sets labor_overridden, which a resync
-- respects exactly as price_overridden protects the price.
--
-- Tax: only the MATERIAL part of a taxable line is taxed (quantity ×
-- unit_price). Labor is never taxed — the same rule the old untaxed labor line
-- followed, now applied per line in src/lib/estimate.ts.

alter table public.estimate_items
  add column if not exists labor_unit_price numeric(12, 2) not null default 0
    check (labor_unit_price >= 0),
  add column if not exists labor_overridden boolean not null default false;

-- A generated column's expression can't be altered in place, so `total` is
-- dropped and recreated: quantity × (price + labor). Every existing line has
-- labor 0, so every existing total is unchanged.
alter table public.estimate_items drop column total;
alter table public.estimate_items
  add column total numeric(12, 2)
    generated always as (quantity * (unit_price + labor_unit_price)) stored;

-- The old single "Installation labor" lines are NOT deleted here. They still
-- add up correctly, and the next sync of each project replaces them with
-- per-line labor — deleting them now would drop labor from every bid until
-- its headset synced again.

insert into public.migrations_applied (name)
values ('023-labor-per-line')
on conflict do nothing;
