"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/org";
import { rebuildPlantRows } from "@/lib/estimate-ar-rows";
import {
  finishPlan,
  headsetFeatures,
  headsetPlants,
  headsetSurfaces,
  parseDraft,
  PlanError,
  readPlan,
  type SitePlan,
} from "@/lib/site-plan/plan";
import { sheetDesign } from "@/lib/site-plan/sheet-design";
import type { ProjectFileJSON } from "@/lib/viewer/types";

// The site plan builder's server side: save the plan, or clear it. Server
// actions rather than an API route: these run as the signed-in designer, so
// the project row and the storage folder are guarded by the same RLS as
// every other edit on the project page.

type Failure = { ok: false; error: string };
type Supabase = Awaited<ReturnType<typeof createClient>>;

const MIGRATION_HINT = "Run migration-020 in Supabase before saving site plans.";
const PLACED =
  "This plan has been placed on site, so the headset holds it now. Edit its shapes on the headset for now.";

/**
 * The project, if this user may change its plan and it hasn't been placed.
 *
 * Checked up front rather than left to RLS on the write, so a team member
 * who can see a project but not edit it is told why, instead of getting a
 * row-level-security error after tracing a whole yard.
 */
async function editableProject(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." } as const;

  const [{ data: project }, { data: json }, membership] = await Promise.all([
    supabase.from("projects").select("id, client_id").eq("id", projectId).single(),
    supabase.from("projects").select("project_json").eq("id", projectId).single(),
    getMembership(supabase, user.id),
  ]);
  if (!project) return { error: "Project not found." } as const;
  if (project.client_id !== user.id && membership?.role !== "owner") {
    return {
      error: "Only the project's designer or the firm's owner can change its site plan.",
    } as const;
  }
  // After the corner walk the project's own shapes are the plan, and the
  // headset edits them; a second copy edited here would drift from them.
  if ((json?.project_json as ProjectFileJSON | null)?.outlinePlacement) {
    return { error: PLACED } as const;
  }
  return { supabase, design: (json?.project_json as ProjectFileJSON | null) ?? null } as const;
}

/**
 * Stores the plan, replacing whatever was there. `blueprint_fetched_at` is
 * what tells a headset the plan is newer than its copy, so it moves only
 * when something a headset reads changed — not for the photo's opacity.
 */
export async function saveSitePlan(
  projectId: string,
  draft: unknown
): Promise<{ ok: true } | Failure> {
  const access = await editableProject(projectId);
  if ("error" in access) return { ok: false, error: access.error! };
  const { supabase, design } = access;

  let plan;
  try {
    plan = finishPlan(parseDraft(draft));
  } catch (err) {
    if (err instanceof PlanError) return { ok: false, error: err.message };
    throw err;
  }
  // The uploaded plan lives in this project's own folder, nowhere else.
  if (plan.planImage && !plan.planImage.path.includes(`/${projectId}/`)) {
    return { ok: false, error: "The uploaded plan isn't this project's. Upload it again." };
  }

  const { data: before } = await supabase
    .from("projects")
    .select("blueprint_payload, blueprint_ortho_path")
    .eq("id", projectId)
    .single();
  const old = readPlan(before?.blueprint_payload);
  const headsetSees = (p: typeof plan | null) =>
    p ? JSON.stringify([p.candidate, headsetFeatures(p), headsetPlants(p), headsetSurfaces(p)]) : null;
  const changed = headsetSees(old) !== headsetSees(plan);
  const designed = (p: SitePlan | null) => JSON.stringify([p?.plants ?? [], p?.surfaces ?? []]);

  const { error } = await supabase
    .from("projects")
    .update({
      blueprint_payload: plan,
      // A traced plan has no tile of its own: Esri's imagery isn't licensed
      // for offline copies, and the headset's corner map draws on paper.
      blueprint_ortho_path: null,
      ...(changed ? { blueprint_fetched_at: new Date().toISOString() } : {}),
    })
    .eq("id", projectId);
  if (error) {
    return { ok: false, error: /blueprint_/.test(error.message) ? MIGRATION_HINT : error.message };
  }

  await removeTile(supabase, before?.blueprint_ortho_path ?? null);
  // A plan replaced by another, or taken off, leaves its picture behind.
  if (old?.planImage && old.planImage.path !== plan.planImage?.path) await removeTile(supabase, old.planImage.path);

  // The estimate follows the design drawn here, as it follows one published
  // from the viewer or synced from the yard — the same rows, by the same
  // rules, so the plants keep their lines (and prices) through the walk.
  if (designed(old) !== designed(plan)) {
    const drawn = sheetDesign(design, plan, "");
    if (drawn && drawn !== design) {
      try {
        await rebuildPlantRows(supabase, projectId, drawn);
      } catch (err) {
        console.error("[site-plan] refreshing the estimate failed", err);
      }
    }
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
}

/**
 * Clears the plan from the project. A headset that already has it keeps its
 * copy — this stops it reaching any that don't.
 */
export async function clearSitePlan(projectId: string): Promise<{ ok: true } | Failure> {
  const access = await editableProject(projectId);
  if ("error" in access) return { ok: false, error: access.error! };
  const { supabase } = access;

  const { data: before } = await supabase
    .from("projects")
    .select("blueprint_ortho_path, blueprint_payload")
    .eq("id", projectId)
    .single();
  const { error } = await supabase
    .from("projects")
    .update({ blueprint_payload: null, blueprint_ortho_path: null, blueprint_fetched_at: null })
    .eq("id", projectId);
  if (error) {
    return { ok: false, error: /blueprint_/.test(error.message) ? MIGRATION_HINT : error.message };
  }

  await removeTile(supabase, before?.blueprint_ortho_path ?? null);
  await removeTile(supabase, readPlan(before?.blueprint_payload)?.planImage?.path ?? null);
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
}

/**
 * Best effort: the aerial tile an outline from the old county lookup left in
 * project-media costs half a megabyte (an uploaded plan more), and failing
 * to remove it should not undo the change the designer asked for.
 */
async function removeTile(supabase: Supabase, path: string | null) {
  if (path) await supabase.storage.from("project-media").remove([path]);
}
