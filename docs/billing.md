# Billing (Stripe)

How a landscape firm goes from an application on the marketing site to a
paying account with working logins.

## The flow

The marketing site's pricing form is an **application, not a signup** — it
posts to Formspree and lands in email. Nothing on that static site talks to
Stripe, and nothing should: it has no server to hold a secret key.

1. A firm applies at `useverdevision.com/#pricing`.
2. You approve it and call `POST /api/admin/onboard` (below). That creates
   the organization, the owner login, and a Stripe Checkout link.
3. You send the firm its temporary password and the checkout link.
4. They enter a card. The 30-day trial starts; nothing is charged yet.
5. Stripe calls `/api/billing/webhook`, which flips
   `organizations.subscription_status` to `trial` and syncs the seat cap.
6. From then on the owner manages everything at **Account → Billing**, which
   hands off to Stripe's hosted portal.

The webhook is the **only** thing that marks an org entitled. The checkout
route just opens a hosted page, so a firm that abandons Stripe never ends up
with an active account.

## Plans

Every plan bundles 3 designer seats plus a free owner account, and starts
with a 30-day trial (card up front).

|          | Monthly | Annual  | Extra seat |
| -------- | ------- | ------- | ---------- |
| Standard | $200    | $2,000  | $40/mo     |
| Founding | $120    | $1,200  | $24/mo     |

**Founding is not a separate product.** It's the standard prices with a 40%
coupon — $200→$120 and $40→$24 are both exactly 40% off, so one coupon covers
the base and every seat. When the coupon expires after 12 months the firm
rolls onto the standard rate on its own, which is what the pricing page
promises. There is no migration job and no second set of prices to keep in
sync.

Two coupons exist because the durations differ: monthly repeats across 12
invoices, annual is `once` (one invoice already covers the founding year).

`currentPlan()` in `src/lib/billing.ts` returns `founding` until
**Dec 2 2026**, matching the application deadline on the pricing page, and
`standard` after. Move that date if the offer is extended.

## Setup

```bash
npm install
STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
```

The script creates the products, prices and coupons and prints the env block
to paste into `.env.local`. It's idempotent — re-running finds what it made
last time. Run it again with a live key when you're ready to charge real
cards; test and live mode have separate objects and separate ids.

Then, in the Supabase SQL editor, run `supabase/migration-015-billing.sql`.

### Tax codes and Managed Payments

New Stripe accounts have **Managed Payments** on by default: Stripe is the
merchant of record and calculates sales tax, and it refuses to create a
checkout session for a product with no tax code. Without one you get
`Invalid line_items[0]: the product tax code is missing`.

Both products are therefore created with `txcd_10103001` — *Software as a
service (SaaS), business use* — which is what we sell: a cloud subscription
to design firms. The setup script sets it on create and repairs it on re-run,
since products (unlike prices) are mutable.

Because Stripe handles tax, customers may be charged sales tax **on top of**
the listed price depending on where they are. The pricing page quotes
pre-tax figures.

Finally, configure the customer portal once at **Stripe → Settings → Billing
→ Customer portal**: allow updating payment methods, changing quantities on
the seat price, switching between the monthly and annual base prices, and
cancelling.

### Local webhooks

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

That prints a `whsec_…` — put it in `STRIPE_WEBHOOK_SECRET`. Then:

```bash
stripe trigger customer.subscription.created
```

### Production webhook

Add an endpoint at `https://dashboard.useverdevision.com/api/billing/webhook`
subscribed to `checkout.session.completed` and
`customer.subscription.created|updated|deleted`, and copy its signing secret
into the Vercel environment.

## Onboarding an approved firm

```bash
curl -X POST https://dashboard.useverdevision.com/api/admin/onboard \
  -H "x-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "Sonoran Studio",
    "owner_email": "maya@sonoranstudio.com",
    "owner_name": "Maya Reyes",
    "interval": "month",
    "extra_seats": 0
  }'
```

Returns the org id, a one-time `temp_password`, and `checkout_url`. As with
the designer invite flow, **no email is sent** — you hand the credentials over
directly. The password is not recoverable afterwards; if it's lost, use the
owner reset path rather than re-running this.

If Stripe fails at the last step the account is still created and returned
with a `warning` — the owner can start checkout themselves from Account →
Billing.

## Seats

Extra seats are a second subscription item whose quantity is the number of
designers beyond the included 3. The webhook writes
`max_designers = 3 + extra_seats`, and migration 011's trigger enforces that
cap when the owner invites a designer — so the seat cap and the invoice can
never disagree.

Seats bought later go through the portal; Stripe prorates mid-term changes
itself, which is what the pricing page promises for annual plans.

## What the columns mean

Everything in migration 015 is written **only** by the webhook, and mirrors
Stripe rather than replacing it. `stripe_customer_id` deliberately survives
cancellation so a firm that resubscribes keeps its invoice history and saved
cards; `stripe_subscription_id` is cleared on delete so the account page
offers a fresh subscription instead of erroring on a dead id.
