// Org membership plumbing for the team feature (migrations 007 + 011).
// Every select is tolerant: on a database that hasn't run a migration yet,
// callers get a degraded-but-working answer instead of an error page —
// same pattern as the migration-gated columns on the dashboard pages.

import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type Membership = {
  orgId: string;
  role: "owner" | "designer";
  orgName: string | null;
  maxDesigners: number;
  // False until migration-011 has been run — gates the whole Team UI
  // and the /api/team endpoint.
  teamEnabled: boolean;
};

export type OrgMember = {
  user_id: string;
  role: "owner" | "designer";
  email: string | null;
  full_name: string | null;
  created_at: string | null;
};

// The caller's org membership, or null if they have none (pre-007
// database, or an auth user created outside the invite flow).
export async function getMembership(
  supabase: ServerClient,
  userId: string
): Promise<Membership | null> {
  const { data: member, error } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !member) return null;

  // Fetched separately so a pre-011 database (no max_designers column)
  // still yields a membership — just with the Team UI disabled.
  const [nameRes, capRes] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", member.org_id)
      .maybeSingle(),
    supabase
      .from("organizations")
      .select("max_designers")
      .eq("id", member.org_id)
      .maybeSingle(),
  ]);

  return {
    orgId: member.org_id,
    role: member.role,
    orgName: nameRes.data?.name ?? null,
    maxDesigners: capRes.data?.max_designers ?? 3,
    teamEnabled: !capRes.error && capRes.data != null,
  };
}

// Everyone in the org, owner first then designers by name. The email and
// full_name columns arrive with migration-011; before that, retry without
// them so the grouped dashboard still renders.
export async function getOrgMembers(
  supabase: ServerClient,
  orgId: string
): Promise<OrgMember[]> {
  const { data, error } = await supabase
    .from("org_members")
    .select("user_id, role, email, full_name, created_at")
    .eq("org_id", orgId);

  let rows: OrgMember[];
  if (!error && data) {
    rows = data as OrgMember[];
  } else {
    const { data: bare } = await supabase
      .from("org_members")
      .select("user_id, role, created_at")
      .eq("org_id", orgId);
    rows = (bare ?? []).map((r) => ({
      ...r,
      email: null,
      full_name: null,
    })) as OrgMember[];
  }

  rows.sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    const an = (a.full_name ?? a.email ?? "").toLowerCase();
    const bn = (b.full_name ?? b.email ?? "").toLowerCase();
    return an.localeCompare(bn);
  });
  return rows;
}

// Display name for a member row.
export function memberName(m: OrgMember): string {
  return m.full_name || m.email || "Team member";
}

export type Billing = {
  status: "trial" | "active" | "past_due" | "canceled";
  plan: "founding" | "standard" | null;
  interval: "month" | "year" | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  extraSeats: number;
  // False when the org has never completed checkout — the account page
  // offers to start a subscription instead of managing one.
  hasSubscription: boolean;
};

// Billing state for the org, or null on a database that hasn't run
// migration-015 — same migration-gated tolerance as getMembership.
export async function getBilling(
  supabase: ServerClient,
  orgId: string
): Promise<Billing | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select(
      "subscription_status, plan, billing_interval, trial_ends_at, current_period_end, extra_seats, stripe_subscription_id"
    )
    .eq("id", orgId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    status: data.subscription_status,
    plan: data.plan ?? null,
    interval: data.billing_interval ?? null,
    trialEndsAt: data.trial_ends_at ?? null,
    currentPeriodEnd: data.current_period_end ?? null,
    extraSeats: data.extra_seats ?? 0,
    hasSubscription: Boolean(data.stripe_subscription_id),
  };
}
