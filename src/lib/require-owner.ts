import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembership, type Membership } from "@/lib/org";

// The owner gate shared by /api/team and /api/billing. Auth is the caller's
// own session (not an API key); the service role is only ever used after
// this passes.
//
// Deliberately does NOT check membership.teamEnabled — that's a migration-011
// concern specific to the team endpoints, which layer it on top.

export type OwnerGate =
  | { membership: Membership; userId: string }
  | { response: NextResponse };

// `subject` completes the sentence "Only the account owner can manage …",
// so each endpoint keeps the wording its UI already surfaces.
export async function requireOwner(subject = "this"): Promise<OwnerGate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      response: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }

  const membership = await getMembership(supabase, user.id);
  if (!membership || membership.role !== "owner") {
    return {
      response: NextResponse.json(
        { error: `Only the account owner can manage ${subject}` },
        { status: 403 }
      ),
    };
  }
  return { membership, userId: user.id };
}
