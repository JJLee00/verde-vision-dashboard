"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/org";
import { buildTracedBlueprint, TraceError, type TracedOutline } from "@/lib/blueprint/trace";

// The House outline card's server side: store the outline the designer
// traced on the aerial, or clear it. The headset picks it up with its next
// project list and opens Blueprint on the corner walk.
//
// Server actions rather than an API route: these run as the signed-in
// designer, so the project row and the storage folder are guarded by the
// same RLS as every other edit on this page.

type Failure = { ok: false; error: string };
type Supabase = Awaited<ReturnType<typeof createClient>>;

const MIGRATION_HINT = "Run migration-020 in Supabase before saving outlines.";

/**
 * The project, if this user may change it.
 *
 * Checked up front rather than left to RLS on the write, so a team member
 * who can see a project but not edit it is told why, instead of getting a
 * row-level-security error after tracing a whole house.
 *
 * The project's own address is not needed: the card finds the property
 * with its own search, and the outline carries what that search found.
 */
async function editableProject(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." } as const;

  const { data: project } = await supabase
    .from("projects")
    .select("id, client_id")
    .eq("id", projectId)
    .single();
  if (!project) return { error: "Project not found." } as const;

  const membership = await getMembership(supabase, user.id);
  if (project.client_id !== user.id && membership?.role !== "owner") {
    return {
      error: "Only the project's designer or the firm's owner can change its outline.",
    } as const;
  }

  return { supabase } as const;
}

/**
 * Stores the traced outline on the project, replacing whatever was there.
 * `address` is what the card's search found it by (may be empty, if the
 * designer just panned there). `blueprint_fetched_at` is what tells a
 * headset this outline is newer than its copy, so a re-trace reaches every
 * headset that hasn't placed one yet.
 */
export async function saveTracedOutline(
  projectId: string,
  outline: TracedOutline,
  address: string
): Promise<{ ok: true } | Failure> {
  const access = await editableProject(projectId);
  if ("error" in access) return { ok: false, error: access.error! };
  const { supabase } = access;

  let stored;
  try {
    stored = buildTracedBlueprint(address, outline);
  } catch (err) {
    if (err instanceof TraceError) return { ok: false, error: err.message };
    throw err;
  }

  const oldTile = await tilePath(supabase, projectId);
  const { error } = await supabase
    .from("projects")
    .update({
      blueprint_payload: stored,
      // A trace has no tile of its own: the headset's corner map draws the
      // lines on paper, and Esri's imagery isn't licensed for offline copies.
      blueprint_ortho_path: null,
      blueprint_fetched_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (error) {
    return {
      ok: false,
      error: /blueprint_/.test(error.message) ? MIGRATION_HINT : error.message,
    };
  }

  await removeTile(supabase, oldTile);
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
}

/**
 * Clears the outline from the project. A headset that already has it keeps
 * its copy — this stops it reaching any that don't.
 */
export async function removeHouseOutline(
  projectId: string
): Promise<{ ok: true } | Failure> {
  const access = await editableProject(projectId);
  if ("error" in access) return { ok: false, error: access.error! };
  const { supabase } = access;

  const oldTile = await tilePath(supabase, projectId);
  const { error } = await supabase
    .from("projects")
    .update({
      blueprint_payload: null,
      blueprint_ortho_path: null,
      blueprint_fetched_at: null,
    })
    .eq("id", projectId);
  if (error) {
    return {
      ok: false,
      error: /blueprint_/.test(error.message) ? MIGRATION_HINT : error.message,
    };
  }

  await removeTile(supabase, oldTile);
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
}

/**
 * The aerial tile an outline from the old county lookup left in
 * project-media, if any. Its own select, so a database without migration
 * 020 fails on the write with the migration hint, not here as "not found".
 */
async function tilePath(supabase: Supabase, projectId: string): Promise<string | null> {
  const { data } = await supabase
    .from("projects")
    .select("blueprint_ortho_path")
    .eq("id", projectId)
    .single();
  const path = (data as { blueprint_ortho_path?: string | null } | null)?.blueprint_ortho_path;
  return path || null;
}

/**
 * Best effort: an orphaned tile costs half a megabyte, and failing to remove
 * it should not undo the change the designer asked for.
 */
async function removeTile(supabase: Supabase, path: string | null) {
  if (path) await supabase.storage.from("project-media").remove([path]);
}
