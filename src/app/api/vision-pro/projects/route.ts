import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * The designer's projects, as the headset needs to see them.
 *
 * GET /api/vision-pro/projects?email=…
 * Header: `x-api-key: <VISION_PRO_API_KEY>` — same key as the other three
 * endpoints the app already calls.
 *
 * This is the keystone of two-way project management. The app's list has
 * always been "whatever .json files are in Documents", which meant a project
 * created at a desk could never appear on a headset, and a project deleted at
 * a desk could never leave one.
 *
 * Deleted projects are INCLUDED, carrying `deleted_at`. They are the whole
 * point: without a tombstone the app cannot tell "deleted in the office" from
 * "not mine", and the only safe reading of a missing row is to keep the local
 * file forever. (Tombstones accumulate. At this scale that is fine; if it ever
 * matters, drop the ones deleted more than a month ago — by then every headset
 * has long since caught up.)
 *
 * Scoped to the projects assigned to this designer rather than the whole org.
 * The dashboard shows a firm its team's work; a headset belongs to one person
 * and should offer the yards they are going to walk.
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.VISION_PRO_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = request.nextUrl.searchParams.get("email")?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: usersPage, error: usersError } =
    await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 });
  }
  const account = usersPage.users.find((u) => u.email?.toLowerCase() === email);
  if (!account) {
    return NextResponse.json(
      { error: `No account found for ${email}` },
      { status: 404 }
    );
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, project_date, status, project_json_updated_at, deleted_at")
    .eq("client_id", account.id)
    .order("created_at", { ascending: false });

  if (error) {
    // A database without migration-018 has no deleted_at. Rather than fail —
    // which would cost the app its whole project list over one column — ask
    // again without it and report everything as live.
    if (/deleted_at/.test(error.message)) {
      const { data: legacy, error: legacyError } = await supabase
        .from("projects")
        .select("id, name, project_date, status, project_json_updated_at")
        .eq("client_id", account.id)
        .order("created_at", { ascending: false });
      if (legacyError) {
        return NextResponse.json({ error: legacyError.message }, { status: 500 });
      }
      return NextResponse.json({
        projects: (legacy ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          project_date: p.project_date,
          status: p.status,
          has_design: Boolean(p.project_json_updated_at),
          deleted: false,
        })),
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    projects: (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      project_date: p.project_date,
      status: p.status,
      // Whether a design has ever been synced. A project created at a desk
      // has none, and the headset treats it as a yard still to be walked.
      has_design: Boolean(p.project_json_updated_at),
      deleted: Boolean(p.deleted_at),
    })),
  });
}
