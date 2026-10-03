import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readStored, type StoredBlueprint } from "@/lib/blueprint/stored";
import { ANCHOR_STEPS } from "@/lib/markers";

/**
 * `anchor_notes` as the headset reads it — text and a timestamp per step,
 * nothing else.
 *
 * Read defensively because this is jsonb: it holds whatever was last written
 * to it, and a malformed entry must cost that one note rather than the
 * designer's whole project list. Timestamps are normalised to millisecond
 * ISO-8601 for the same reason `blueprint_fetched_at` is — the headset
 * compares them with its own files' dates, and Postgres's microsecond form is
 * not one Foundation parses reliably.
 */
function readAnchorNotes(
  raw: unknown
): Record<string, { text: string; updated_at: string | null }> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, { text: string; updated_at: string | null }> = {};
  for (const step of ANCHOR_STEPS) {
    const entry = (raw as Record<string, unknown>)[step];
    if (typeof entry !== "object" || entry === null) continue;
    const { text, updated_at: updatedAt } = entry as Record<string, unknown>;
    if (typeof text !== "string") continue;
    const stamp = typeof updatedAt === "string" ? new Date(updatedAt) : null;
    const valid = stamp && !Number.isNaN(stamp.getTime()) ? stamp : null;
    // An empty note WITH a timestamp is a tombstone — somebody deleted it —
    // and the headset needs it to clear its own copy. An empty note with no
    // timestamp says nothing and is left out.
    if (text.trim() === "" && !valid) continue;
    out[step] = { text, updated_at: valid ? valid.toISOString() : null };
  }
  return out;
}

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

  // The record fields the office owns: whose yard this is, what the card
  // looks like, and what somebody wrote down about each plate.
  //
  // Their own queries, like the outline above — a database missing one of
  // these columns must still serve the project list, because the list is how
  // a headset finds any work at all. Split in two so the fields that have
  // worked for months do not go dark waiting on migration 021.
  type RecordRow = {
    id: string;
    customer_name: string | null;
    contact_email: string | null;
    notes: string | null;
    cover_path: string | null;
  };
  const records = new Map<string, RecordRow>();
  const { data: recordRows } = await supabase
    .from("projects")
    .select("id, customer_name, contact_email, notes, cover_path")
    .eq("client_id", account.id);
  for (const row of recordRows ?? []) records.set(row.id, row as RecordRow);

  type SyncRow = {
    id: string;
    cover_updated_at: string | null;
    anchor_notes: Record<string, unknown> | null;
  };
  const syncRows = new Map<string, SyncRow>();
  const { data: syncColumns } = await supabase
    .from("projects")
    .select("id, cover_updated_at, anchor_notes")
    .eq("client_id", account.id);
  for (const row of syncColumns ?? []) syncRows.set(row.id, row as SyncRow);

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
  // Cover photos ride the same batch. One signed URL per project is the whole
  // cost of the headset's project cards matching the dashboard's — but only
  // for the projects actually being returned: the record queries above are not
  // filtered by deleted_at, and signing a tombstoned project's cover is work
  // nobody will ever look at, repeated every twenty seconds a headset polls.
  const liveIDs = new Set((data ?? []).map((p) => p.id));
  const coverOwner = new Map<string, string>();
  for (const [id, record] of records) {
    if (record.cover_path && liveIDs.has(id)) coverOwner.set(record.cover_path, id);
  }
  const coverUrls: Record<string, string> = {};
  for (const project of data ?? []) {
    const paths = (project as { anchor_paths?: Record<string, string> | null })
      .anchor_paths;
    if (!paths) continue;
    for (const [step, path] of Object.entries(paths)) {
      if (typeof path === "string") pathOwner.set(path, { id: project.id, step });
    }
  }
  if (pathOwner.size > 0 || orthoOwner.size > 0 || coverOwner.size > 0) {
    const { data: signed } = await supabase.storage
      .from("project-media")
      .createSignedUrls(
        [...pathOwner.keys(), ...orthoOwner.keys(), ...coverOwner.keys()],
        60 * 60
      );
    for (const item of signed ?? []) {
      if (!item.path || !item.signedUrl) continue;
      const ortho = orthoOwner.get(item.path);
      if (ortho) orthoUrls[ortho] = item.signedUrl;
      const cover = coverOwner.get(item.path);
      if (cover) coverUrls[cover] = item.signedUrl;
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
      // Whose yard it is. Entered at a desk and never in the headset — the
      // app displays these, it does not collect them.
      customer_name: records.get(p.id)?.customer_name ?? null,
      contact_email: records.get(p.id)?.contact_email ?? null,
      // The designer's own notes on the job: gate code, dog's name, which
      // hose bib works. Desk-owned, and read-only in the headset.
      notes: records.get(p.id)?.notes ?? null,
      // The project card's photo, so the headset's cards and the dashboard's
      // show the same yard. `updated_at` is what makes two-way safe: the
      // headset keeps its covers as plain files and compares this against the
      // local file's modification date. Null means no claim has been
      // recorded (a cover uploaded before migration 021), and the headset
      // then takes it only if it has none of its own.
      cover: (() => {
        const url = coverUrls[p.id] ?? null;
        const updatedAt = syncRows.get(p.id)?.cover_updated_at ?? null;
        // Carried with NO url when the cover was deleted: that is a
        // tombstone, and the timestamp is the only thing that tells a headset
        // still holding the photo that it was removed on purpose rather than
        // never synced.
        if (!url && !updatedAt) return null;
        return { url, updated_at: updatedAt };
      })(),
      // What the designer wrote about each plate, keyed by step like the
      // photos. Editable on both sides; each entry carries the time it was
      // written so the newer one wins.
      anchor_notes: readAnchorNotes(syncRows.get(p.id)?.anchor_notes),
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
