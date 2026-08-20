import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe, priceIds, foundingCouponId, siteUrl } from "@/lib/stripe";
import {
  INCLUDED_SEATS,
  TRIAL_DAYS,
  type Interval,
  type PlanId,
} from "@/lib/plan";

// Subscription checkout, shared by the owner-facing /api/billing/checkout and
// the admin /api/admin/onboard route that turns an approved founding
// application into a payable link.

// Founding pricing closes with the applications, per the pricing page. After
// this date a founding request is served the standard rate rather than a 40%
// discount that was never meant to be open-ended.
export const FOUNDING_CLOSES = new Date("2026-12-02T00:00:00Z");

// Cap on seats bought in one go. Not a business limit — a guard so a
// fat-fingered or forged quantity can't create a five-figure invoice.
export const MAX_EXTRA_SEATS = 50;

export function currentPlan(now = new Date()): PlanId {
  return now < FOUNDING_CLOSES ? "founding" : "standard";
}

export function parseInterval(value: unknown): Interval {
  return value === "year" ? "year" : "month";
}

// Reuses the org's Stripe customer if it has one, so a firm that cancelled
// and came back keeps its invoice history and saved payment methods.
export async function ensureCustomer(
  admin: SupabaseClient,
  org: { id: string; name: string | null; stripe_customer_id: string | null },
  email?: string
): Promise<string> {
  if (org.stripe_customer_id) return org.stripe_customer_id;

  const customer = await getStripe().customers.create({
    name: org.name ?? undefined,
    email,
    metadata: { org_id: org.id },
  });
  await admin
    .from("organizations")
    .update({ stripe_customer_id: customer.id })
    .eq("id", org.id);
  return customer.id;
}

export async function createSubscriptionCheckout(opts: {
  orgId: string;
  customerId: string;
  interval: Interval;
  extraSeats: number;
  plan?: PlanId;
}): Promise<string> {
  const { orgId, customerId, interval, extraSeats } = opts;
  const plan = opts.plan ?? currentPlan();
  const { base, seat } = priceIds(interval);

  const lineItems = [{ price: base, quantity: 1 }];
  // Only add the seat item when they're buying extras — Checkout rejects a
  // zero quantity, and seats bought later through the portal add the item
  // then, which the webhook picks up.
  if (extraSeats > 0) lineItems.push({ price: seat, quantity: extraSeats });

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    // Card up front, then 30 free days — "cancel before day 30 and pay
    // nothing" on the pricing page.
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata: { org_id: orgId, plan },
    },
    ...(plan === "founding"
      ? { discounts: [{ coupon: foundingCouponId(interval) }] }
      : {}),
    // Both carry org_id so the webhook can find the org even if subscription
    // metadata is ever lost.
    client_reference_id: orgId,
    metadata: { org_id: orgId, plan, included_seats: String(INCLUDED_SEATS) },
    success_url: `${siteUrl()}/dashboard/account?checkout=success`,
    cancel_url: `${siteUrl()}/dashboard/account?checkout=cancelled`,
  });

  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return session.url;
}
