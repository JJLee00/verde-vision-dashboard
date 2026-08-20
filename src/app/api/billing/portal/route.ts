import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/require-owner";
import { getStripe, billingConfigured, siteUrl } from "@/lib/stripe";

// Hands the owner into Stripe's hosted billing portal — update the card,
// change seats, switch monthly/annual, cancel. Everything they do there
// comes back to us as a webhook, so the portal needs no callbacks of its own.
//
// Portal features (which of those actions are offered) are configured once in
// the Stripe dashboard under Settings -> Billing -> Customer portal.

export async function POST() {
  if (!billingConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured on this deployment" },
      { status: 503 }
    );
  }

  const gate = await requireOwner("billing");
  if ("response" in gate) return gate.response;
  const { membership } = gate;

  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .select("id, stripe_customer_id")
    .eq("id", membership.orgId)
    .maybeSingle();

  if (error || !org) {
    return NextResponse.json(
      { error: "Billing is not enabled yet (run migration-015)" },
      { status: 503 }
    );
  }
  if (!org.stripe_customer_id) {
    return NextResponse.json(
      { error: "This account has no subscription yet" },
      { status: 409 }
    );
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${siteUrl()}/dashboard/account`,
  });

  return NextResponse.json({ url: session.url });
}
