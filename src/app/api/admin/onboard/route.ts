import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingConfigured } from "@/lib/stripe";
import { INCLUDED_SEATS } from "@/lib/plan";
import {
  createSubscriptionCheckout,
  ensureCustomer,
  parseInterval,
  currentPlan,
  MAX_EXTRA_SEATS,
} from "@/lib/billing";

/**
 * Turns an approved founding application into a payable account.
 *
 * The marketing site's form is an application, not a signup — a firm applies,
 * we approve it, then this route creates the org, the owner login and the
 * Stripe Checkout link to send them. It is the only place an organization is
 * created, and it is deliberately not self-serve.
 *
 * POST application/json with header `x-api-key: <ADMIN_API_KEY>`
 *   company     — firm name (required)
 *   owner_email — the owner's login (required)
 *   owner_name  — the owner's full name (required)
 *   interval    — "month" | "year" (default "month")
 *   extra_seats — designers beyond the 3 included (default 0)
 *
 * Returns the temp password and the checkout URL. As with the designer invite
 * flow, no email is sent: the credentials are handed over directly.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || !apiKey || apiKey !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!billingConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured on this deployment" },
      { status: 503 }
    );
  }

  let body: {
    company?: unknown;
    owner_email?: unknown;
    owner_name?: unknown;
    interval?: unknown;
    extra_seats?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const company = String(body.company ?? "").trim();
  const email = String(body.owner_email ?? "").trim().toLowerCase();
  const ownerName = String(body.owner_name ?? "").trim();

  if (!company || company.length > 200) {
    return NextResponse.json({ error: "company is required" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "owner_email is invalid" }, { status: 400 });
  }
  if (!ownerName || ownerName.length > 200) {
    return NextResponse.json({ error: "owner_name is required" }, { status: 400 });
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
        error: `extra_seats must be a whole number from 0 to ${MAX_EXTRA_SEATS}`,
      },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // 1. The org. Stays 'trial' with no Stripe ids until the webhook hears
  //    back from checkout — creating it here does not grant entitlement.
  //    max_designers is set now so the seat cap matches what they're buying.
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: company,
      subscription_status: "trial",
      max_designers: INCLUDED_SEATS + extraSeats,
      plan: currentPlan(),
      billing_interval: interval,
      extra_seats: extraSeats,
    })
    .select("id, name, stripe_customer_id")
    .single();

  if (orgError || !org) {
    const missingColumns = /column .* does not exist/i.test(
      orgError?.message ?? ""
    );
    return NextResponse.json(
      {
        error: missingColumns
          ? "Billing is not enabled yet (run migration-015)"
          : (orgError?.message ?? "Could not create the organization"),
      },
      { status: missingColumns ? 503 : 500 }
    );
  }

  // 2. The owner login. Same convention as the designer invite: a 12-char
  //    temp password shown once, no email sent.
  const tempPassword = randomBytes(9).toString("base64url");
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: ownerName },
    });

  if (createError || !created?.user) {
    // Roll back the org so a failed onboard leaves nothing behind.
    await admin.from("organizations").delete().eq("id", org.id);
    const duplicate = /already|registered|exists/i.test(
      createError?.message ?? ""
    );
    return NextResponse.json(
      {
        error: duplicate
          ? "An account with this email already exists"
          : (createError?.message ?? "Could not create the owner account"),
      },
      { status: duplicate ? 409 : 500 }
    );
  }

  const { error: memberError } = await admin.from("org_members").insert({
    user_id: created.user.id,
    org_id: org.id,
    role: "owner",
    email,
    full_name: ownerName,
  });
  if (memberError) {
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  // 3. The checkout link. If Stripe fails here the account still exists and
  //    is usable — the owner can start checkout themselves from the account
  //    page — so report it without tearing down the org.
  try {
    const customerId = await ensureCustomer(admin, org, email);
    const checkoutUrl = await createSubscriptionCheckout({
      orgId: org.id,
      customerId,
      interval,
      extraSeats,
    });
    return NextResponse.json(
      {
        org_id: org.id,
        company,
        owner_email: email,
        temp_password: tempPassword,
        plan: currentPlan(),
        interval,
        extra_seats: extraSeats,
        checkout_url: checkoutUrl,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe failed";
    return NextResponse.json(
      {
        org_id: org.id,
        company,
        owner_email: email,
        temp_password: tempPassword,
        checkout_url: null,
        warning: `Account created, but the checkout link failed: ${message}. The owner can start checkout from the account page.`,
      },
      { status: 201 }
    );
  }
}
