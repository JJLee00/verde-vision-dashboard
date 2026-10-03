import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readStored, type StoredBlueprint } from "@/lib/blueprint/stored";

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
    .select("id, name, project_date, status, address, anchor_paths, project_json_updated_at, deleted_at")
    .eq("client_id", account.id)
    .order("created_at", { ascending: false });

  if (error) {
    // A database without migration-018 has no deleted_at. Rather than fail —
    // which would cost the app its whole project list over one column — ask
    // again without it and report everything as live.
    if (/deleted_at/.test(error.message)) {
      const { data: legacy, error: legacyError } = await supabase
        .from("projects")
        .select("id, name, project_date, status, address, project_json_updated_at")
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
          address: p.address,
          has_design: Boolean(p.project_json_updated_at),
          deleted: false,
        })),
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // House outlines picked at a desk (migration 020). Its own query so a
  // database that hasn't run 020 still serves the project list — the outline
  // is a head start, never a reason to fail the list.
  const outlines = new Map<
    string,
    { stored: StoredBlueprint; fetchedAt: string | null; orthoPath: string | null }
  >();
  const { data: outlineRows } = await supabase
    .from("projects")
    .select("id, blueprint_payload, blueprint_ortho_path, blueprint_fetched_at")
    .eq("client_id", account.id)
    .not("blueprint_payload", "is", null);
  for (const row of outlineRows ?? []) {
    const stored = readStored(row.blueprint_payload);
    if (!stored) continue;
    outlines.set(row.id, {
      stored,
      // Normalised to millisecond ISO-8601: the headset compares it with its
      // own copy's date, and Postgres's microsecond form is not one Foundation
      // parses reliably.
      fetchedAt: row.blueprint_fetched_at
        ? new Date(row.blueprint_fetched_at).toISOString()
        : null,
      orthoPath: row.blueprint_ortho_path ?? null,
    });
  }

  // One signing call for every project's photos rather than one per project.
  // Best effort: a project with no photos, or a database without
  // migration-010, simply contributes nothing. Outline tiles ride along in
  // the same call.
  const anchorPhotos: Record<string, Record<string, string>> = {};
  const pathOwner = new Map<string, { id: string; step: string }>();
  const orthoOwner = new Map<string, string>();
  for (const [id, outline] of outlines) {
    if (outline.orthoPath) orthoOwner.set(outline.orthoPath, id);
  }
  const orthoUrls: Record<string, string> = {};
  for (const project of data ?? []) {
    const paths = (project as { anchor_paths?: Record<string, string> | null })
      .anchor_paths;
    if (!paths) continue;
    for (const [step, path] of Object.entries(paths)) {
      if (typeof path === "string") pathOwner.set(path, { id: project.id, step });
    }
  }
  if (pathOwner.size > 0 || orthoOwner.size > 0) {
    const { data: signed } = await supabase.storage
      .from("project-media")
      .createSignedUrls([...pathOwner.keys(), ...orthoOwner.keys()], 60 * 60);
    for (const item of signed ?? []) {
      if (!item.path || !item.signedUrl) continue;
      const ortho = orthoOwner.get(item.path);
      if (ortho) orthoUrls[ortho] = item.signedUrl;
      const owner = pathOwner.get(item.path);
      if (!owner) continue;
      (anchorPhotos[owner.id] ??= {})[owner.step] = item.signedUrl;
    }
  }

  return NextResponse.json({
    projects: (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      project_date: p.project_date,
      status: p.status,
      // Typed at a desk, used in the yard. This is what lets Auto Blueprint
      // fetch a lot outline on site without anyone spelling out a street
      // address on a virtual keyboard in someone's driveway.
      address: p.address,
      // Signed URLs for any marker reference photos, so a photo added at a
      // desk reaches the yard — which is the only place it is any use. The
      // headset cannot take these itself (visionOS main camera access is an
      // enterprise entitlement), so the office is often where they arrive.
      anchor_photos: anchorPhotos[p.id] ?? {},
      // The lot and house outline the office picked, so Blueprint opens on
      // the corner walk with no lookup in the yard. `candidate` is the same
      // shape /api/blueprint returns, minus the image — the tile is a
      // separate signed download, never base64 in a list the headset polls.
      blueprint: (() => {
        const outline = outlines.get(p.id);
        if (!outline) return null;
        return {
          provider: outline.stored.provider,
          candidate: outline.stored.candidate,
          fetched_at: outline.fetchedAt,
          ortho_url: orthoUrls[p.id] ?? null,
        };
      })(),
      // Whether a design has ever been synced. A project created at a desk
      // has none, and the headset treats it as a yard still to be walked.
      has_design: Boolean(p.project_json_updated_at),
      deleted: Boolean(p.deleted_at),
    })),
  });
}
