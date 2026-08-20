-- Migration 015: Stripe billing (Accounts Phase 4)
-- Run in the Supabase SQL editor AFTER migration-011.
--
-- Migration 007 created organizations.subscription_status as the billing
-- gate and left it there. This migration fills in the rest: the Stripe
-- identifiers the webhook writes back to, the plan the firm bought, and
-- the paid seat count that backs max_designers.
--
-- The webhook is the only writer for every column here — it runs with the
-- service role, so no RLS policy grants write access to any of them. Owners
-- read them on the account page; changes go through Stripe Checkout and the
-- billing portal, never through the dashboard directly.

-- ---------------------------------------------------------------------------
-- 1. Stripe identifiers.
--    customer_id survives cancellation (a firm that resubscribes keeps its
--    payment history), subscription_id is cleared when the sub is deleted.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column stripe_customer_id text,
  add column stripe_subscription_id text;

-- One Stripe customer per org, and vice versa. Partial so the many orgs
-- with no customer yet don't collide on null.
create unique index organizations_stripe_customer_id_idx
  on public.organizations (stripe_customer_id)
  where stripe_customer_id is not null;

-- ---------------------------------------------------------------------------
-- 2. What they bought.
--    'founding' is the 40%-off first year sold before Dec 2 2026; it is a
--    coupon on the standard prices, not a separate product, so the plan
--    here is a record of how they came in rather than a different SKU.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column plan text
    check (plan in ('founding', 'standard')),
  add column billing_interval text
    check (billing_interval in ('month', 'year'));

-- ---------------------------------------------------------------------------
-- 3. Dates the account page shows. Both mirror Stripe — never authoritative,
--    always last-known. Stripe stays the source of truth.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column trial_ends_at timestamptz,
  add column current_period_end timestamptz;

-- ---------------------------------------------------------------------------
-- 4. Paid seats.
--    Every plan bundles 3 designer seats; extra seats are a second
--    subscription item priced per seat. max_designers (011) stays the value
--    the seat-cap trigger enforces — the webhook sets it to 3 + extras so
--    the cap and the invoice can never disagree.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column extra_seats int not null default 0
    check (extra_seats >= 0);

-- ---------------------------------------------------------------------------
-- 5. Existing orgs predate billing. They were hand-created during the pilot,
--    so leave them on 'trial' with no Stripe ids: the account page reads that
--    as "no subscription yet" and offers checkout.
-- ---------------------------------------------------------------------------

comment on column public.organizations.subscription_status is
  'Mirrors the Stripe subscription: trial | active | past_due | canceled. Written only by the billing webhook.';
