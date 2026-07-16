import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMembership, type Membership } from "@/lib/org";

// Team management: the org owner invites designer accounts and removes
// them. Auth is the caller's own session (not an API key) — the service
// role is used only after the owner check passes.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireOwner(): Promise<
  | { membership: Membership; userId: string }
  | { response: NextResponse }
> {
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
        { error: "Only the account owner can manage the team" },
        { status: 403 }
      ),
    };
  }
  if (!membership.teamEnabled) {
    return {
      response: NextResponse.json(
        { error: "Team features are not enabled yet (run migration-011)" },
        { status: 503 }
      ),
    };
  }
  return { membership, userId: user.id };
}

export async function POST(request: NextRequest) {
  const gate = await requireOwner();
  if ("response" in gate) return gate.response;
  const { membership } = gate;

  let body: { email?: unknown; full_name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const fullName = String(body.full_name ?? "").trim();
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  }
  if (!fullName || fullName.length > 200) {
    return NextResponse.json({ error: "Enter the designer's name" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Friendly seat check; the DB trigger is the race-proof backstop.
  const { count } = await admin
    .from("org_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", membership.orgId)
    .eq("role", "designer");
  if ((count ?? 0) >= membership.maxDesigners) {
    return NextResponse.json(
      { error: `All ${membership.maxDesigners} designer seats are in use` },
      { status: 409 }
    );
  }

  // 12-char temp password, shown to the owner exactly once. No email is
  // sent — the owner hands the credentials to their designer directly.
  const tempPassword = randomBytes(9).toString("base64url");

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
  if (createError || !created?.user) {
    const duplicate = /already|registered|exists/i.test(
      createError?.message ?? ""
    );
    return NextResponse.json(
      {
        error: duplicate
          ? "An account with this email already exists"
          : (createError?.message ?? "Could not create the account"),
      },
      { status: duplicate ? 409 : 500 }
    );
  }

  const { error: memberError } = await admin.from("org_members").insert({
    user_id: created.user.id,
    org_id: membership.orgId,
    role: "designer",
    email,
    full_name: fullName,
  });
  if (memberError) {
    // Roll back the brand-new auth user (safe — it owns nothing yet) so a
    // failed invite never leaves an org-less login behind.
    await admin.auth.admin.deleteUser(created.user.id);
    const capHit = /designer_seat_limit_reached/.test(memberError.message);
    return NextResponse.json(
      {
        error: capHit
          ? `All ${membership.maxDesigners} designer seats are in use`
          : memberError.message,
      },
      { status: capHit ? 409 : 500 }
    );
  }

  return NextResponse.json(
    {
      user_id: created.user.id,
      email,
      full_name: fullName,
      temp_password: tempPassword,
    },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const gate = await requireOwner();
  if ("response" in gate) return gate.response;
  const { membership } = gate;

  let body: { user_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }
  const targetId = String(body.user_id ?? "").trim();
  if (!targetId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("org_members")
    .select("user_id, org_id, role")
    .eq("user_id", targetId)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "Not a team member" }, { status: 404 });
  }
  if (target.org_id !== membership.orgId || target.role !== "designer") {
    return NextResponse.json(
      { error: "Only designers on your team can be removed" },
      { status: 403 }
    );
  }

  // Removing the membership row cuts all RLS access immediately (every
  // policy routes through user_org_id()). The auth user is banned rather
  // than deleted: projects.client_id cascades on user delete, which would
  // destroy the designer's projects — those stay with the firm.
  const { error: deleteError } = await admin
    .from("org_members")
    .delete()
    .eq("user_id", targetId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }
  await admin.auth.admin.updateUserById(targetId, {
    ban_duration: "876000h",
  });

  return NextResponse.json({ ok: true });
}
