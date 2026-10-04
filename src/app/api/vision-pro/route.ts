import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createVersion,
  currentPublishedVersion,
  diffPlants,
  sameDesign,
  summarize,
} from "@/lib/versions";
import { rebuildPlantRows } from "@/lib/estimate-ar-rows";
import type { ProjectFileJSON } from "@/lib/viewer/types";
import { ANCHOR_STEPS } from "@/lib/markers";

/** An ISO-8601 stamp the app sent, or null if it sent nothing usable. */
function parseStamp(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Ingest endpoint for the Verde Vision Pro app.
 *
 * POST multipart/form-data with header `x-api-key: <VISION_PRO_API_KEY>`
 * Fields:
 *   client_email    — email of the client account (required for new projects)
 *   project_id      — existing project to update (optional; omit to create)
 *   name            — project name (required when creating)
 *   project_date    — YYYY-MM-DD (optional)
 *   estimate_amount — number, e.g. 12400.50 (optional)
 *   status          — pending | approved | installed | declined (optional)
 *   blueprint       — PDF file (optional)
 *   project_json    — full ProjectFile JSON saved by the app (optional);
 *                     drives the living-blueprint 3D viewer. Replaced
 *                     wholesale on every sync.
 *   cover           — project card photo, JPEG (optional)
 *   cover_at        — when that cover was chosen, ISO-8601 (optional)
 *   cover_cleared   — "1" to remove the cover (optional)
 *   anchor_note_{origin,first,second}      — plate reference note (optional)
 *   anchor_note_{…}_at                     — when it was written, ISO-8601
 *
 * Those last ones are RECORD fields, which both sides may edit, so they are
 * last-write-wins on the timestamp sent beside them. A sync carrying only
 * record fields creates no version and is never revision-blocked, which is
 * what lets the app push a cover the moment the designer picks one. An empty
 * anchor_note is a deletion and is stored as an empty entry, not dropped —
 * see the write below.
 */
const VALID_STATUSES = ["draft", "pending", "approved", "installed", "declined"];
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.VISION_PRO_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const projectId = form.get("project_id")?.toString() || null;
  const clientEmail = form.get("client_email")?.toString().toLowerCase() || null;
  const name = form.get("name")?.toString() || null;
  const projectDate = form.get("project_date")?.toString() || null;
  const estimateRaw = form.get("estimate_amount")?.toString() || null;
  const status = form.get("status")?.toString() || null;
  const blueprint = form.get("blueprint");
  const estimatePdf = form.get("estimate");
  const plantsRaw = form.get("plants")?.toString() || null;
  const projectJsonPart = form.get("project_json");
  // The revision the app's design is based on. Absent from older builds,
  // which keep the previous last-writer-wins behaviour.
  const baseRevisionRaw = form.get("base_revision")?.toString() || null;
  const anchorParts: Record<string, FormDataEntryValue | null> = {
    origin: form.get("anchor_origin"),
    first: form.get("anchor_first"),
    second: form.get("anchor_second"),
  };
  // When each plate photo was taken, and which ones were deleted (022).
  const photoAtSent: Record<string, string | null> = {};
  const photoCleared: Record<string, boolean> = {};
  for (const step of ANCHOR_STEPS) {
    photoAtSent[step] = form.get(`anchor_photo_${step}_at`)?.toString() || null;
    photoCleared[step] =
      form.get(`anchor_photo_${step}_cleared`)?.toString() === "1";
  }
  const coverPart = form.get("cover");
  const coverAtRaw = form.get("cover_at")?.toString() || null;
  const coverCleared = form.get("cover_cleared")?.toString() === "1";
  // A note the app did not send is absent; a note it sent EMPTY is a
  // deletion, so presence is what's tested here, never truthiness.
  const notePartsSent: Record<string, { text: string; at: string | null }> = {};
  for (const step of ANCHOR_STEPS) {
    const part = form.get(`anchor_note_${step}`);
    if (part == null) continue;
    notePartsSent[step] = {
      text: part.toString(),
      at: form.get(`anchor_note_${step}_at`)?.toString() || null,
    };
  }

  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const estimateAmount = estimateRaw ? Number(estimateRaw) : null;
  if (estimateRaw && Number.isNaN(estimateAmount)) {
    return NextResponse.json(
      { error: "estimate_amount must be a number" },
      { status: 400 }
    );
  }

  const baseRevision = baseRevisionRaw != null ? Number(baseRevisionRaw) : null;
  if (
    baseRevisionRaw != null &&
    (!Number.isInteger(baseRevision) || baseRevision! < 0)
  ) {
    return NextResponse.json(
      { error: "base_revision must be a revision number" },
      { status: 400 }
    );
  }

  // Plant usage summary: [{ key: "aloe vera", size: "5g", count: 12 }].
  // Replaces the project's previous summary wholesale on every sync.
  let plantUsage: { key: string; size: string; count: number }[] | null = null;
  if (plantsRaw) {
    try {
      const parsed: unknown = JSON.parse(plantsRaw);
      if (!Array.isArray(parsed) || parsed.length > 500) throw new Error();
      plantUsage = parsed.map((row) => {
        const { key, size, count } = row as Record<string, unknown>;
        if (
          typeof key !== "string" ||
          typeof size !== "string" ||
          typeof count !== "number" ||
          !Number.isFinite(count) ||
          count < 0
        ) {
          throw new Error();
        }
        return { key, size, count: Math.round(count) };
      });
    } catch {
      return NextResponse.json(
        { error: "plants must be a JSON array of {key, size, count}" },
        { status: 400 }
      );
    }
  }

  // Full ProjectFile from the app. Arrives as a file part (the Swift
  // uploader sends it as project.json) but a plain text field also works.
  // Parsed only to validate + strip whitespace; stored as jsonb.
  const PROJECT_JSON_MAX_BYTES = 5 * 1024 * 1024;
  let projectJson: unknown = null;
  if (projectJsonPart) {
    const size =
      projectJsonPart instanceof File ? projectJsonPart.size : projectJsonPart.length;
    if (size > PROJECT_JSON_MAX_BYTES) {
      return NextResponse.json(
        { error: "project_json exceeds 5 MB" },
        { status: 400 }
      );
    }
    const text =
      projectJsonPart instanceof File
        ? await projectJsonPart.text()
        : projectJsonPart.toString();
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error();
      }
      projectJson = parsed;
    } catch {
      return NextResponse.json(
        { error: "project_json must be a JSON object" },
        { status: 400 }
      );
    }
  }

  let project: { id: string; client_id: string };

  if (projectId) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, client_id")
      .eq("id", projectId)
      // Deleted on the dashboard: this sync is from a headset that has not
      // caught up yet. Answering 404 keeps it deleted — accepting the push
      // would file fresh work against a project nobody can see. Its own
      // select so a database without migration-018 still syncs.
      .is("deleted_at", null)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    project = data;
  } else {
    if (!clientEmail || !name) {
      return NextResponse.json(
        { error: "client_email and name are required to create a project" },
        { status: 400 }
      );
    }

    // Look up the client account by email.
    const { data: usersPage, error: usersError } =
      await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }
    const client = usersPage.users.find(
      (u) => u.email?.toLowerCase() === clientEmail
    );
    if (!client) {
      return NextResponse.json(
        { error: `No client account found for ${clientEmail}` },
        { status: 404 }
      );
    }

    const { data, error } = await supabase
      .from("projects")
      .insert({ client_id: client.id, name })
      .select("id, client_id")
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Could not create project" },
        { status: 500 }
      );
    }
    project = data;

    // A project that has just been created is a draft, not a bid waiting on
    // the client. Since the app started announcing projects at creation
    // rather than at first export, the default 'pending' would file every
    // yard a designer so much as starts under "awaiting approval".
    //
    // Written as its own ignorable update rather than folded into the insert
    // above: on a database that has not run migration-018 the status check
    // rejects 'draft', and a project must still be creatable there. Same
    // guard the anchor_paths write uses for migration-010.
    //
    // Nothing promotes this from here. Moving a project to 'pending' is a
    // dashboard action, taken when the proposal actually reaches the client
    // — and migration 013's rule still holds: headset syncs never send
    // status, or a sync would resurrect a deal the client already declined.
    if (!status) {
      const { error: draftError } = await supabase
        .from("projects")
        .update({ status: "draft" })
        .eq("id", project.id);
      if (draftError && !/check constraint/i.test(draftError.message)) {
        console.warn(
          `[vision-pro] could not mark ${project.id} draft: ${draftError.message}`
        );
      }
    }
  }

  // Refuse to publish a design over a newer one.
  //
  // The app applies office edits when a project opens, so a sync normally
  // carries them. The case this exists for is a headset that opened with no
  // signal: the pull failed silently — by design, a dead network must not
  // cost a designer their session — and the design it is now pushing has
  // never seen what the office did. Accepting it would republish the old
  // plants as the newest revision and the office work would be gone, with no
  // error anywhere. That is the §0 data-loss bug one layer further in.
  //
  // Deliberately before the writes and the file uploads, so a rejected sync
  // changes nothing at all. Only a design push can clobber, so a sync with no
  // project_json (a project being created, an estimate total on its own) is
  // never blocked. A build that sends no base_revision keeps the previous
  // behaviour rather than being locked out mid-rollout.
  if (projectJson && baseRevision != null) {
    const current = await currentPublishedVersion(supabase, project.id);
    if (current && current.revision > baseRevision) {
      return NextResponse.json(
        {
          error:
            "This design is based on an older revision. Pull the changes and sync again.",
          revision: current.revision,
          base_revision: baseRevision,
          source: current.source,
        },
        { status: 409 }
      );
    }
  }

  const updates: Record<string, unknown> = {};
  if (name && projectId) updates.name = name;
  if (projectDate) updates.project_date = projectDate;
  if (estimateAmount != null) updates.estimate_amount = estimateAmount;
  if (status) updates.status = status;
  if (plantUsage) updates.plant_usage = plantUsage;
  if (projectJson) {
    updates.project_json = projectJson;
    updates.project_json_updated_at = new Date().toISOString();
  }

  // Upload the blueprint PDF to the private bucket.
  //
  // ONE path per project, overwritten. These used to be timestamped —
  // {now}-blueprint.pdf — with blueprint_path pointing at the newest and
  // nothing ever deleting the rest, so a design exported eight times left a
  // client's folder holding eight PDFs, seven of them wrong and all of them
  // billed for. That is what always happens when a derived document is
  // stored as though it were data.
  //
  // Safe because nothing links to these paths directly: every reader mints a
  // fresh signed URL (createSignedUrls) when the page renders, so there is no
  // stale link to break. cacheControl is kept short anyway — upsert
  // invalidates the CDN, but a minute of staleness is a cheaper failure than
  // an hour of a client reading last week's bid.
  //
  // scripts/prune-blueprint-orphans.mjs clears the ones already there.
  const PDF_UPLOAD = {
    contentType: "application/pdf",
    upsert: true,
    cacheControl: "60",
  };

  if (blueprint instanceof File && blueprint.size > 0) {
    const path = `${project.client_id}/${project.id}/blueprint.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("blueprints")
      .upload(path, blueprint, PDF_UPLOAD);
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    updates.blueprint_path = path;
  }

  // The itemized estimate PDF lives in the same bucket + folder as the
  // blueprint, so the existing client read policy covers it.
  if (estimatePdf instanceof File && estimatePdf.size > 0) {
    const path = `${project.client_id}/${project.id}/estimate.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("blueprints")
      .upload(path, estimatePdf, PDF_UPLOAD);
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    updates.estimate_path = path;
  }

  // The record columns, read ONCE: the plate photos, their times, the plate
  // notes and the cover all merge into what is already there, and reading the
  // row per field would let two of those writes race each other.
  const { data: recordRow } = await supabase
    .from("projects")
    .select("cover_updated_at, anchor_notes, anchor_paths, anchor_photo_times")
    .eq("id", project.id)
    .maybeSingle();
  const readMap = (value: unknown): Record<string, string> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...(value as Record<string, string>) }
      : {};
  const mergedPaths = readMap(
    (recordRow as { anchor_paths?: unknown } | null)?.anchor_paths
  );
  const mergedPhotoTimes = readMap(
    (recordRow as { anchor_photo_times?: unknown } | null)?.anchor_photo_times
  );
  let anchorsChanged = false;

  // Anchor reference photos → project-media bucket, one stable path per step
  // (upsert so re-syncs replace rather than pile up).
  //
  // MERGED into what is already recorded, never replacing it. The whole map
  // used to be overwritten, which was harmless only while every sync carried
  // all three photos; the app now pushes the ONE plate a designer just
  // changed, and a wholesale write would take the other two plates' photos
  // off the project.
  //
  // Each step is also time-checked before anything is uploaded, so a headset
  // that has been carrying an old photo around cannot overwrite the file a
  // desk replaced it with.
  for (const [step, part] of Object.entries(anchorParts)) {
    const storedAt = parseStamp(mergedPhotoTimes[step]);

    if (photoCleared[step]) {
      const sentAt = parseStamp(photoAtSent[step]) ?? new Date();
      if (storedAt && storedAt > sentAt) continue;
      const stale = mergedPaths[step];
      if (stale) await supabase.storage.from("project-media").remove([stale]);
      delete mergedPaths[step];
      mergedPhotoTimes[step] = sentAt.toISOString();
      anchorsChanged = true;
      continue;
    }

    if (!(part instanceof File) || part.size === 0) continue;
    const sentAt = parseStamp(photoAtSent[step]) ?? new Date();
    if (storedAt && storedAt > sentAt) {
      console.log(
        `[vision-pro] ${step} photo for ${project.id} is older than the stored one — kept`
      );
      continue;
    }
    const path = `${project.client_id}/${project.id}/anchors/${step}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("project-media")
      .upload(path, part, { contentType: "image/jpeg", upsert: true });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    mergedPaths[step] = path;
    mergedPhotoTimes[step] = sentAt.toISOString();
    anchorsChanged = true;
  }
  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", project.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Record this sync as a version, so the design has a history instead of
  // being overwritten in place (migration-016). `projects.project_json`
  // above still holds the current published design and every existing
  // reader keeps working unchanged.
  //
  // Deliberately after the update and deliberately silent on failure: on a
  // database that hasn't run migration-016 there is no project_versions
  // table, and a designer standing in a yard must not have their sync
  // rejected over a history row. createVersion() returns null there.
  let syncedRevision: number | null = null;
  if (projectJson) {
    const previous = await currentPublishedVersion(supabase, project.id);

    if (previous && sameDesign(previous.project_json, projectJson as ProjectFileJSON)) {
      // Nothing changed. Since the app started syncing when a designer LEAVES
      // a project, this is the common case — opened, looked at, walked away —
      // and a version row carries the whole design, so appending one here
      // would fill the history with copies that say nothing. The project's
      // stored design is still refreshed above; only the history is spared.
      syncedRevision = previous.revision;
    } else {
      const version = await createVersion(supabase, {
        projectId: project.id,
        source: "headset",
        json: projectJson as ProjectFileJSON,
        // Headset syncs publish immediately. The designer was standing in the
        // yard when they made the change; there is nothing to review.
        status: "published",
        summary: summarize(
          diffPlants(previous?.project_json ?? null, projectJson as ProjectFileJSON)
        ),
      });
      if (version) {
        await supabase
          .from("projects")
          .update({ current_version_id: version.id })
          .eq("id", project.id);
        syncedRevision = version.revision;
      }
    }

    // The estimate's plant rows follow the design, exactly as they do when
    // the office publishes a revision. Until Sep 29 2026 this ran only on the
    // publish path, so a project synced from the headset arrived with a full
    // design and an estimate of zero rows — the derivation existed and simply
    // never ran on this side. Manual rows, hardscape rows and prices a
    // designer typed over are all left alone; see the function.
    // Read BEFORE the rebuild: it writes estimate_amount itself, so asking
    // afterwards would only ever hand back the number being guarded against.
    const { data: priorTotal } = await supabase
      .from("projects")
      .select("estimate_amount")
      .eq("id", project.id)
      .maybeSingle();

    const plantRows = await rebuildPlantRows(
      supabase,
      project.id,
      projectJson as ProjectFileJSON
    );

    // rebuildPlantRows also recomputed `estimate_amount` from every row on
    // the project — plants, manual lines and tax — which is the number the
    // proposal actually prints, so the card and the estimate page now agree.
    // The one case where that is wrong: a design whose plants this catalog
    // doesn't know yet (gen-catalog hasn't been re-run since the app added
    // them) produces no rows at all, and writing the derived zero would blank
    // a real bid. There, keep the total the headset sent.
    if (plantRows === 0) {
      // Fall back to the total the app sent, or failing that the one already
      // on the project. A leave-sync sends no estimate at all, so without the
      // second half a design whose plants this catalog doesn't know yet would
      // quietly zero a real bid every time the designer walked away from it.
      const fallback = estimateAmount ?? priorTotal?.estimate_amount ?? null;
      if (fallback != null) {
        await supabase
          .from("projects")
          .update({ estimate_amount: fallback })
          .eq("id", project.id);
      }
    }
  }

  // Cover photo and plate notes (migration 021).
  //
  // Both are editable at a desk AND in the headset, so the newer write wins
  // on the timestamp the app sends beside them. The comparison happens here
  // as well as in the app because the app's half can only compare against
  // what it last SAW: a headset that has been out of signal for a week is
  // carrying a cover it believes is current, and without this check it would
  // land on top of newer office work the moment it reconnects.
  //
  // Last, and in its own update, for the same reason anchor_paths is: a
  // database that hasn't run 021 yet must still accept the sync rather than
  // lose a designer their design over a cover photo.
  {
    const storedCoverAt = parseStamp(
      (recordRow as { cover_updated_at?: string | null } | null)?.cover_updated_at
    );
    const rawNotes = (recordRow as { anchor_notes?: unknown } | null)?.anchor_notes;
    const storedNotes: Record<string, { text?: string; updated_at?: string }> =
      rawNotes && typeof rawNotes === "object" && !Array.isArray(rawNotes)
        ? { ...(rawNotes as Record<string, { text?: string; updated_at?: string }>) }
        : {};

    const recordUpdates: Record<string, unknown> = {};
    if (anchorsChanged) {
      recordUpdates.anchor_paths = mergedPaths;
      recordUpdates.anchor_photo_times = mergedPhotoTimes;
    }

    if (coverCleared) {
      // The designer deleted the cover in the headset. Without this leg the
      // next project-list refresh would hand the office's copy straight back
      // and the photo they just removed would return.
      const sentAt = parseStamp(coverAtRaw) ?? new Date();
      if (storedCoverAt && storedCoverAt > sentAt) {
        console.log(
          `[vision-pro] cover clear for ${project.id} is older than the stored cover — kept`
        );
      } else {
        const { data: existing } = await supabase
          .from("projects")
          .select("cover_path")
          .eq("id", project.id)
          .maybeSingle();
        const stale = (existing as { cover_path?: string | null } | null)?.cover_path;
        // Best effort: the column is what every reader goes through, so a
        // leftover object is wasted bytes rather than a wrong cover.
        if (stale) {
          await supabase.storage.from("project-media").remove([stale]);
        }
        recordUpdates.cover_path = null;
        recordUpdates.cover_updated_at = sentAt.toISOString();
      }
    } else if (coverPart instanceof File && coverPart.size > 0) {
      const sentAt = parseStamp(coverAtRaw) ?? new Date();
      if (storedCoverAt && storedCoverAt > sentAt) {
        console.log(
          `[vision-pro] cover for ${project.id} is older than the stored one — kept`
        );
      } else {
        // ONE path per project, overwritten — the same argument as the
        // blueprint PDF above. The dashboard's own uploader timestamps its
        // filenames and leaves the old ones behind; a cover is a single
        // current fact about a project, not a document set.
        const path = `${project.client_id}/${project.id}/cover.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("project-media")
          .upload(path, coverPart, {
            contentType: "image/jpeg",
            upsert: true,
            cacheControl: "60",
          });
        if (uploadError) {
          return NextResponse.json({ error: uploadError.message }, { status: 500 });
        }
        recordUpdates.cover_path = path;
        recordUpdates.cover_updated_at = sentAt.toISOString();
      }
    }

    let notesChanged = false;
    for (const [step, part] of Object.entries(notePartsSent)) {
      const sentAt = parseStamp(part.at) ?? new Date();
      const storedAt = parseStamp(storedNotes[step]?.updated_at);
      if (storedAt && storedAt > sentAt) continue;
      // An empty note is kept as an entry rather than deleted: the timestamp
      // is the only thing that stops the next headset to sync — still
      // holding its own copy of the note, written before the deletion —
      // from writing it straight back.
      storedNotes[step] = { text: part.text.trim(), updated_at: sentAt.toISOString() };
      notesChanged = true;
    }
    if (notesChanged) recordUpdates.anchor_notes = storedNotes;

    if (Object.keys(recordUpdates).length > 0) {
      const { error } = await supabase
        .from("projects")
        .update(recordUpdates)
        .eq("id", project.id);
      if (error) {
        // Pre-021/022: drop the new columns and keep what the older schema
        // can hold — the cover (projects.cover_path, migration 009) and the
        // plate photo paths (anchor_paths, migration 010). Both files are
        // already uploaded by this point.
        if (/column .*(cover_updated_at|anchor_notes|anchor_photo_times).* does not exist/i.test(error.message)) {
          delete recordUpdates.cover_updated_at;
          delete recordUpdates.anchor_notes;
          delete recordUpdates.anchor_photo_times;
          if (Object.keys(recordUpdates).length > 0) {
            const { error: retryError } = await supabase
              .from("projects")
              .update(recordUpdates)
              .eq("id", project.id);
            if (retryError) {
              return NextResponse.json({ error: retryError.message }, { status: 500 });
            }
          }
        } else {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    }
  }

  // `revision` is null on a database that hasn't run migration-016; the app
  // treats that as "no version history" and simply doesn't ask for changes.
  return NextResponse.json({
    ok: true,
    project_id: project.id,
    revision: syncedRevision,
  });
}

/**
 * Deleting a project from the headset.
 *
 * DELETE /api/vision-pro?project_id=…
 * Header: `x-api-key: <VISION_PRO_API_KEY>`
 *
 * Soft, like the dashboard's own delete: a project row owns the client's
 * blueprint PDFs, their estimate and its line items, the anchor photos and
 * the whole version history. Tidying up a headset's project list must not
 * destroy a signed bid, so the row is marked and hidden and an owner can put
 * it back from the project page.
 *
 * Idempotent — deleting an already-deleted project succeeds. The app calls
 * this after it has already removed the local file, so a retry must never
 * become an error the designer has to think about.
 */
export async function DELETE(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.VISION_PRO_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { error } = await supabase
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", projectId);

  if (error) {
    return NextResponse.json(
      {
        error: /deleted_at/.test(error.message)
          ? "Run migration-018 before deleting projects."
          : error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
