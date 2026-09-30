"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentPublishedVersion, diffPlants, summarize } from "@/lib/versions";
import { rebuildPlantRows } from "@/lib/estimate-ar-rows";
import type { ProjectFileJSON } from "@/lib/viewer/types";

// Publishing a design revision.
//
// A server action rather than client calls because it is four writes that
// have to agree with each other: the draft becomes the newest revision, the
// project's current design moves with it, the estimate's AR rows are rebuilt
// from the new design, and the total is recomputed. Half of that landing
// would leave a client looking at a bid that doesn't match the plan.

type Result = { ok: true; revision: number } | { ok: false; error: string };

export async function publishRevision(
  projectId: string,
  design: ProjectFileJSON
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Server actions are reachable by direct POST, not just through the UI.
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, org_id")
    .eq("id", projectId)
    .single();
  if (projectError || !project) return { ok: false, error: "Project not found" };

  const previous = await currentPublishedVersion(supabase, projectId);
  const summary = summarize(diffPlants(previous?.project_json ?? null, design));

  // The revision is assigned HERE, not when the draft was created. A headset
  // sync may have published while the draft sat open, and a revision that
  // numbers itself behind a design published after it would order wrongly
  // in the history.
  const { data: latest } = await supabase
    .from("project_versions")
    .select("revision")
    .eq("project_id", projectId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  const revision = (latest?.revision ?? 0) + 1;

  const { data: version, error: versionError } = await supabase
    .from("project_versions")
    .insert({
      project_id: projectId,
      org_id: project.org_id,
      revision,
      source: "dashboard",
      author_id: user.id,
      status: "published",
      published_at: new Date().toISOString(),
      project_json: design,
      summary,
    })
    .select("id, revision")
    .single();
  if (versionError || !version) {
    return {
      ok: false,
      error:
        versionError?.code === "42P01"
          ? "Run migration-016 before publishing revisions."
          : (versionError?.message ?? "Could not publish"),
    };
  }

  // The published design is what every existing reader already looks at —
  // the viewer, the share link, the crew link. Moving it is what makes the
  // revision visible.
  await supabase
    .from("projects")
    .update({
      project_json: design,
      project_json_updated_at: new Date().toISOString(),
      current_version_id: version.id,
    })
    .eq("id", projectId);

  await rebuildPlantRows(supabase, projectId, design);

  // Clear any open drafts for this project: their content is now published.
  await supabase
    .from("project_versions")
    .delete()
    .eq("project_id", projectId)
    .eq("status", "draft");

  revalidatePath(`/viewer/${projectId}`);
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true, revision: version.revision };
}

