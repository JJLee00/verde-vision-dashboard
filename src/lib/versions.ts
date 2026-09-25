import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";

// Project versions: the design stops being a column that gets overwritten.
//
// Until now `projects.project_json` was replaced wholesale on every headset
// sync (migration 008). That was fine while the Vision Pro was the only
// writer. The moment the dashboard can edit a design it becomes silent data
// loss — the designer's office work vanishes the next time they open the
// project in the headset, with no error anywhere.
//
// Versions are append-only rows. `projects.project_json` stays as-is and
// keeps meaning "the current published design", so the viewer, the share
// page and the crew link need no changes at all.
//
// The diff below is the other half: the app doesn't re-download a whole
// project and try to work out what moved. It asks what changed since the
// revision it last saw, and applies a change set. Keeping that logic here —
// one implementation, in one language — is deliberate; a second copy in
// Swift would drift and the two would disagree about someone's yard.

export type VersionSource = "headset" | "dashboard";
export type VersionStatus = "draft" | "published";

/** The fields an editor may change on a placed plant. */
export type PlantPatch = {
  id: string;
  plantModelName?: string;
  containerType?: string | null;
  positionX?: number;
  positionY?: number;
  positionZ?: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  rotationW?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  beamTiltDegrees?: number | null;
};

export type ChangeSet = {
  /** Plant ids no longer in the design. */
  removed: string[];
  /** Plants that exist in both, with only the fields that differ. */
  updated: PlantPatch[];
  /** Whole plants that weren't there before. */
  added: PlacedPlantJSON[];
};

export const EMPTY_CHANGES: ChangeSet = {
  removed: [],
  updated: [],
  added: [],
};

// Positions are metres and scales are unit multipliers, so a micrometre of
// float noise is not a change anybody made. Without this, a JSON round trip
// alone can look like the whole yard moved.
const EPSILON = 1e-6;

const NUMERIC_FIELDS = [
  "positionX",
  "positionY",
  "positionZ",
  "rotationX",
  "rotationY",
  "rotationZ",
  "rotationW",
  "scaleX",
  "scaleY",
  "scaleZ",
] as const;

function sameNumber(a: unknown, b: unknown): boolean {
  if (typeof a !== "number" || typeof b !== "number") return a === b;
  return Math.abs(a - b) < EPSILON;
}

/**
 * What changed between two versions of a design, per plant, keyed by the
 * UUID the app has always persisted on `PlacedPlant`.
 */
export function diffPlants(
  base: ProjectFileJSON | null,
  next: ProjectFileJSON | null
): ChangeSet {
  const basePlants = new Map(
    (base?.placements ?? []).map((p) => [p.id, p])
  );
  const nextPlants = new Map(
    (next?.placements ?? []).map((p) => [p.id, p])
  );

  const removed: string[] = [];
  for (const id of basePlants.keys()) {
    if (!nextPlants.has(id)) removed.push(id);
  }

  const added: PlacedPlantJSON[] = [];
  const updated: PlantPatch[] = [];

  for (const [id, plant] of nextPlants) {
    const before = basePlants.get(id);
    if (!before) {
      added.push(plant);
      continue;
    }

    const patch: PlantPatch = { id };
    let changed = false;

    if (plant.plantModelName !== before.plantModelName) {
      patch.plantModelName = plant.plantModelName;
      changed = true;
    }
    // null and undefined both mean "no container recorded"; treating them as
    // different would republish every pre-containerType plant as an edit.
    if ((plant.containerType ?? null) !== (before.containerType ?? null)) {
      patch.containerType = plant.containerType ?? null;
      changed = true;
    }
    if ((plant.beamTiltDegrees ?? null) !== (before.beamTiltDegrees ?? null)) {
      patch.beamTiltDegrees = plant.beamTiltDegrees ?? null;
      changed = true;
    }
    for (const field of NUMERIC_FIELDS) {
      if (!sameNumber(plant[field], before[field])) {
        patch[field] = plant[field];
        changed = true;
      }
    }

    if (changed) updated.push(patch);
  }

  return { removed, updated, added };
}

export function isEmptyChangeSet(changes: ChangeSet): boolean {
  return (
    changes.removed.length === 0 &&
    changes.updated.length === 0 &&
    changes.added.length === 0
  );
}

/**
 * Plain-language summary for the revision list, the client notification and
 * the headset's "edited in the office" banner.
 *
 * A swap and a resize are both "updated" rows in the change set, but they
 * are different events to a designer, so they're counted apart: a changed
 * `plantModelName` is a replacement, anything else is an adjustment.
 */
export function summarize(changes: ChangeSet): string {
  const replaced = changes.updated.filter((p) => p.plantModelName != null).length;
  const adjusted = changes.updated.length - replaced;

  const parts: string[] = [];
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;

  if (changes.added.length) parts.push(`${plural(changes.added.length, "plant")} added`);
  if (replaced) parts.push(`${plural(replaced, "plant")} replaced`);
  if (adjusted) parts.push(`${plural(adjusted, "plant")} adjusted`);
  if (changes.removed.length) parts.push(`${plural(changes.removed.length, "plant")} removed`);

  return parts.length ? parts.join(", ") : "No changes";
}

/* ── Database helpers ─────────────────────────────────────────────────── */

// Both the service-role client (the ingest and change routes) and the
// user-scoped server client (the dashboard editor, next) are SupabaseClient.
type DbClient = SupabaseClient;

export type VersionRow = {
  id: string;
  revision: number;
  source: VersionSource;
  status: VersionStatus;
  summary: string | null;
  created_at: string;
  project_json: ProjectFileJSON | null;
};

/**
 * Appends a version. Returns null — never throws — when the table isn't
 * there yet, so a database that hasn't run migration-015 keeps syncing
 * exactly as it does today rather than failing a designer's upload in the
 * field. That tolerance is the same one every migration-gated read on the
 * dashboard uses.
 */
export async function createVersion(
  db: DbClient,
  params: {
    projectId: string;
    source: VersionSource;
    json: ProjectFileJSON;
    status?: VersionStatus;
    authorId?: string | null;
    summary?: string | null;
  }
): Promise<VersionRow | null> {
  const status = params.status ?? "published";

  // Two syncs landing together would collide on the
  // (project_id, revision) unique index; the loser just takes the next
  // number. One retry is plenty for a per-project counter.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: latest, error: latestError } = await db
      .from("project_versions")
      .select("revision")
      .eq("project_id", params.projectId)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) return null;

    const revision = (latest?.revision ?? 0) + 1;
    const { data, error } = await db
      .from("project_versions")
      .insert({
        project_id: params.projectId,
        revision,
        source: params.source,
        author_id: params.authorId ?? null,
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
        project_json: params.json,
        summary: params.summary ?? null,
      })
      .select("id, revision, source, status, summary, created_at")
      .single();

    if (!error && data) return data as VersionRow;
    // 23505 = unique violation: someone else took this revision number.
    if (error?.code !== "23505") return null;
  }
  return null;
}

/** The newest published version, or null (including on a pre-015 database). */
export async function currentPublishedVersion(
  db: DbClient,
  projectId: string
): Promise<VersionRow | null> {
  const { data, error } = await db
    .from("project_versions")
    .select("id, revision, source, status, summary, created_at, project_json")
    .eq("project_id", projectId)
    .eq("status", "published")
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as VersionRow;
}

/** One specific revision, for diffing against what the app last saw. */
export async function versionAt(
  db: DbClient,
  projectId: string,
  revision: number
): Promise<VersionRow | null> {
  const { data, error } = await db
    .from("project_versions")
    .select("id, revision, source, status, summary, created_at, project_json")
    .eq("project_id", projectId)
    .eq("revision", revision)
    .maybeSingle();
  if (error || !data) return null;
  return data as VersionRow;
}
