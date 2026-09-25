import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  EMPTY_CHANGES,
  currentPublishedVersion,
  diffPlants,
  isEmptyChangeSet,
  summarize,
  versionAt,
} from "@/lib/versions";

/**
 * What changed on a project since the revision the headset last saw.
 *
 * GET /api/project-changes?project_id={uuid}&since={revision}
 * Header: `x-api-key: <VISION_PRO_API_KEY>` — same key as /api/vision-pro,
 * matching how the app already fetches prices and custom plants.
 *
 * The app calls this when opening a project and applies the change set to
 * its local file. It deliberately does NOT re-download the whole design and
 * work out what moved: the diff lives here, in one language, because a
 * second implementation in Swift would drift and the two would end up
 * disagreeing about someone's yard.
 *
 * Response:
 *   {
 *     "revision": 7,            // current published revision
 *     "since": 5,               // what the caller said it had
 *     "source": "dashboard",    // who wrote the newest version
 *     "summary": "1 plant replaced, 1 plant removed",
 *     "upToDate": false,
 *     "full": false,            // true => `changes.added` is the WHOLE design
 *     "changes": { "removed": [...], "updated": [...], "added": [...] }
 *   }
 *
 * `full: true` is the recovery path: the caller's base revision is gone (or
 * it never had one), so rather than guess, the whole current design comes
 * back and the app replaces its plant list outright.
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.VISION_PRO_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  const sinceRaw = request.nextUrl.searchParams.get("since");
  const since = sinceRaw != null ? Number(sinceRaw) : null;
  if (sinceRaw != null && (!Number.isInteger(since) || since! < 0)) {
    return NextResponse.json({ error: "since must be a revision number" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const current = await currentPublishedVersion(supabase, projectId);
  if (!current) {
    // Either the project has never synced a design, or migration-015 hasn't
    // been run. Both mean the same thing to the app: nothing to apply.
    return NextResponse.json({
      revision: 0,
      since,
      source: null,
      summary: "No changes",
      upToDate: true,
      full: false,
      changes: EMPTY_CHANGES,
    });
  }

  if (since != null && since >= current.revision) {
    return NextResponse.json({
      revision: current.revision,
      since,
      source: current.source,
      summary: "No changes",
      upToDate: true,
      full: false,
      changes: EMPTY_CHANGES,
    });
  }

  const base = since != null ? await versionAt(supabase, projectId, since) : null;

  // No usable base: hand back the whole design rather than a change set the
  // app would be applying to something it can't be sure about.
  if (!base?.project_json) {
    return NextResponse.json({
      revision: current.revision,
      since,
      source: current.source,
      summary: current.summary ?? "Full design",
      upToDate: false,
      full: true,
      changes: {
        ...EMPTY_CHANGES,
        added: current.project_json?.placements ?? [],
      },
    });
  }

  const changes = diffPlants(base.project_json, current.project_json);
  return NextResponse.json({
    revision: current.revision,
    since,
    source: current.source,
    summary: summarize(changes),
    upToDate: isEmptyChangeSet(changes),
    full: false,
    changes,
  });
}
