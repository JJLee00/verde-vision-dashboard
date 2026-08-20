import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getStripe,
  toSubscriptionStatus,
  basePriceIds,
  seatPriceIds,
} from "@/lib/stripe";
import { INCLUDED_SEATS, type PlanId } from "@/lib/plan";

// Stripe -> Supabase. This is the ONLY writer of the billing columns, and the
// only thing that can mark an org entitled: the checkout route just opens a
// hosted page, so a customer who closes that page never becomes active.
//
// Auth is the Stripe signature over the raw body, so the route must not read
// the body any other way first. The auth proxy already skips /api.
//
// Local testing:
//   stripe listen --forward-to localhost:3000/api/billing/webhook
//   stripe trigger customer.subscription.created

// Events we act on. Anything else is acknowledged and ignored — returning a
// non-2xx to Stripe would make it retry an event we were never going to use.
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET is not set" },
      { status: 503 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Raw text, not request.json() — the signature covers the exact bytes.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      payload,
      signature,
      secret
    );
  } catch (err) {
    // Bad signature means forged or misconfigured, never a transient fault,
    // so 400 (don't retry) rather than 500.
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      // Nothing to sync until the subscription exists; the
      // customer.subscription.created event does the real work. This branch
      // only records the plan the firm checked out on, which lives in
      // session metadata and isn't derivable from the subscription later.
      const orgId = session.client_reference_id ?? session.metadata?.org_id;
      const plan = session.metadata?.plan;
      if (orgId && (plan === "founding" || plan === "standard")) {
        await createAdminClient()
          .from("organizations")
          .update({ plan })
          .eq("id", orgId);
      }
      return NextResponse.json({ received: true });
    }

    const subscription = event.data.object as Stripe.Subscription;
    await syncSubscription(subscription, event.type);
    return NextResponse.json({ received: true });
  } catch (err) {
    // A 500 tells Stripe to retry with backoff, which is what we want for a
    // transient Supabase failure — the handler is idempotent, so a replay of
    // the same event just rewrites the same row.
    const message = err instanceof Error ? err.message : "Handler failed";
    console.error(`[billing] ${event.type} failed:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function syncSubscription(
  subscription: Stripe.Subscription,
  eventType: string
) {
  const admin = createAdminClient();

  // org_id rides on the subscription metadata (set at checkout). Falling back
  // to the customer id covers subscriptions created directly in the Stripe
  // dashboard, which have no metadata.
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  let orgId = subscription.metadata?.org_id ?? null;
  if (!orgId) {
    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    orgId = data?.id ?? null;
  }
  if (!orgId) {
    // Unknown customer — log and move on. Throwing would make Stripe retry
    // an event that can never succeed.
    console.warn(`[billing] no org for customer ${customerId}`);
    return;
  }

  const deleted = eventType === "customer.subscription.deleted";

  // Extra seats are the quantity on the seat line item; the base item is
  // always quantity 1 and doesn't count toward the cap. Matched by price id
  // rather than by position, since Stripe doesn't promise item order.
  const seats = seatPriceIds();
  const seatItem = subscription.items.data.find((item) =>
    seats.includes(item.price.id)
  );
  const extraSeats = deleted ? 0 : (seatItem?.quantity ?? 0);

  const bases = basePriceIds();
  const baseItem =
    subscription.items.data.find((item) => bases.includes(item.price.id)) ??
    subscription.items.data[0];

  // current_period_end moved onto the items in recent API versions; every
  // item shares the period, so either one is representative.
  const periodEnd = baseItem?.current_period_end ?? null;

  const interval =
    baseItem?.price.recurring?.interval === "year" ? "year" : "month";

  const plan = subscription.metadata?.plan;

  await admin
    .from("organizations")
    .update({
      stripe_customer_id: customerId,
      // Cleared on delete so the checkout route offers a fresh subscription
      // instead of 409-ing on a dead id.
      stripe_subscription_id: deleted ? null : subscription.id,
      subscription_status: deleted
        ? "canceled"
        : toSubscriptionStatus(subscription.status),
      billing_interval: interval,
      trial_ends_at: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
      current_period_end: periodEnd
        ? new Date(periodEnd * 1000).toISOString()
        : null,
      extra_seats: extraSeats,
      // The seat cap and the invoice must agree — this is what migration
      // 011's trigger enforces on invite.
      max_designers: INCLUDED_SEATS + extraSeats,
      ...(plan === "founding" || plan === "standard"
        ? { plan: plan as PlanId }
        : {}),
    })
    .eq("id", orgId);
}
