import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/require-owner";
import { billingConfigured } from "@/lib/stripe";
import {
  createSubscriptionCheckout,
  ensureCustomer,
  parseInterval,
  MAX_EXTRA_SEATS,
} from "@/lib/billing";

// Starts a subscription: the owner picks monthly/annual and how many extra
// seats, and gets a Stripe Checkout URL back. Nothing here marks the org as
// paid — only the webhook does that, because a customer who abandons the
// Stripe page must not end up entitled.

export async function POST(request: NextRequest) {
  if (!billingConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured on this deployment" },
      { status: 503 }
    );
  }

  const gate = await requireOwner("billing");
  if ("response" in gate) return gate.response;
  const { membership } = gate;

  let body: { interval?: unknown; extra_seats?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const interval = parseInterval(body.interval);
  const extraSeats = Number(body.extra_seats ?? 0);
  if (
    !Number.isInteger(extraSeats) ||
    extraSeats < 0 ||
    extraSeats > MAX_EXTRA_SEATS
  ) {
    return NextResponse.json(
      {
        error: `Extra seats must be a whole number from 0 to ${MAX_EXTRA_SEATS}`,
      },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, name, stripe_customer_id, stripe_subscription_id, subscription_status")
    .eq("id", membership.orgId)
    .maybeSingle();

  if (orgError || !org) {
    // Selecting the billing columns fails on a database that hasn't run
    // migration-015 — say so rather than returning a bare 500.
    return NextResponse.json(
      { error: "Billing is not enabled yet (run migration-015)" },
      { status: 503 }
    );
  }

  // An org with a live subscription manages it in the portal. Sending them
  // through checkout again would put a second subscription on the same
  // customer and bill them twice.
  if (
    org.stripe_subscription_id &&
    ["trial", "active", "past_due"].includes(org.subscription_status)
  ) {
    return NextResponse.json(
      { error: "This account already has a subscription", use_portal: true },
      { status: 409 }
    );
  }

  try {
    const customerId = await ensureCustomer(admin, org);
    const url = await createSubscriptionCheckout({
      orgId: org.id,
      customerId,
      interval,
      extraSeats,
    });
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
