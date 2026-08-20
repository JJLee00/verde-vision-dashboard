import Stripe from "stripe";
import type { Interval } from "@/lib/plan";

// Stripe client + the id lookups that depend on it. Server-side only — every
// import site is a route handler; the secret key must never reach the browser
// bundle. Plain plan data (prices, seat counts) lives in lib/plan.ts so client
// components can read it without importing this module.
//
// The price ids live in env rather than in code because test mode and live
// mode have different ones. `scripts/stripe-setup.mjs` creates them and
// prints the block to paste.

// Lazy so importing this module on a deployment without Stripe configured
// (or during `next build`, which evaluates modules) doesn't throw. Callers
// that actually need Stripe get a clear error at request time instead.
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (!cached) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    // apiVersion omitted on purpose: the SDK pins the version it was built
    // against, so the types and the wire format can't drift apart.
    cached = new Stripe(key);
  }
  return cached;
}

// True when billing is configured at all. The account page uses this to
// hide the whole Billing section on a deployment that has no Stripe yet,
// the same way teamEnabled gates the Team section.
export function billingConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_BASE_MONTHLY
  );
}

export function priceIds(interval: Interval) {
  const base =
    interval === "year"
      ? process.env.STRIPE_PRICE_BASE_ANNUAL
      : process.env.STRIPE_PRICE_BASE_MONTHLY;
  const seat =
    interval === "year"
      ? process.env.STRIPE_PRICE_SEAT_ANNUAL
      : process.env.STRIPE_PRICE_SEAT_MONTHLY;
  if (!base || !seat) {
    throw new Error(`Stripe price ids for "${interval}" are not configured`);
  }
  return { base, seat };
}

// Which configured price is which, for reading a subscription back apart.
// Returned as lists because a subscription may be on either interval, and a
// deployment mid-rollout may have only some ids set.
export function basePriceIds(): string[] {
  return [
    process.env.STRIPE_PRICE_BASE_MONTHLY,
    process.env.STRIPE_PRICE_BASE_ANNUAL,
  ].filter((id): id is string => Boolean(id));
}

export function seatPriceIds(): string[] {
  return [
    process.env.STRIPE_PRICE_SEAT_MONTHLY,
    process.env.STRIPE_PRICE_SEAT_ANNUAL,
  ].filter((id): id is string => Boolean(id));
}

// The founding discount: 40% off for the first year, applied to the whole
// subscription so the base ($200 -> $120) and every extra seat ($40 -> $24)
// come out at the advertised founding rate from one coupon.
//
// Two coupons because the durations differ: a monthly sub needs the discount
// repeated across 12 invoices, an annual sub has one invoice to discount and
// `once` leaves no doubt about whether the renewal at month 12 is covered.
export function foundingCouponId(interval: Interval): string {
  const id =
    interval === "year"
      ? process.env.STRIPE_COUPON_FOUNDING_ANNUAL
      : process.env.STRIPE_COUPON_FOUNDING_MONTHLY;
  if (!id) throw new Error("Founding coupon is not configured");
  return id;
}

// Stripe subscription status -> the four values migration 007 allows.
// Anything unmapped is treated as not-entitled rather than silently active.
export function toSubscriptionStatus(
  status: Stripe.Subscription.Status
): "trial" | "active" | "past_due" | "canceled" {
  switch (status) {
    case "trialing":
      return "trial";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      // incomplete, incomplete_expired, canceled, paused
      return "canceled";
  }
}

// Where Stripe sends the customer back to. Set NEXT_PUBLIC_SITE_URL in
// production; the Vercel-provided URL is the fallback so preview deploys work.
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
