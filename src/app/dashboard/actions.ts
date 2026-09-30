"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Creating and removing projects from the dashboard.
//
// Until now the headset was the only thing that could bring a project into
// existence, and nothing at all could remove one: deleting on the headset
// dropped a local JSON file and left the row orphaned here forever.
//
// Removal is a soft delete. A project row owns the client's blueprint PDFs,
// their estimate and its line items, the anchor photos and the whole version
// history; tidying up a project list must not destroy a signed bid. The row
// is marked and hidden, and an owner can put it back. See migration 018.

type Result = { ok: true; id?: string } | { ok: false; error: string };

export async function createProject(input: {
  name: string;
  projectDate: string | null;
  designerId: string | null;
}): Promise<Result> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the project a name." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Assigned to the chosen designer, or to whoever is creating it. `org_id`
  // is derived from this by the projects_set_org trigger (007), and the
  // insert policy added in 018 checks the same column — a project can only
  // be created for someone in your own org.
  const clientId = input.designerId ?? user.id;

  const { data, error } = await supabase
    .from("projects")
    .insert({
      client_id: clientId,
      name,
      project_date: input.projectDate || null,
      // A project nobody has seen is not a bid awaiting an answer. Same rule
      // the headset follows: draft at creation, promoted only when the
      // proposal actually reaches the client.
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error:
        error?.code === "42501"
          ? "You can only create projects for your own team."
          : (error?.message ?? "Could not create the project."),
    };
  }

  revalidatePath("/dashboard");
  return { ok: true, id: data.id };
}

export async function deleteProject(projectId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", projectId);

  if (error) {
    return {
      ok: false,
      error:
        // 018 has not been run: the column the whole feature rests on does
        // not exist yet. Say that rather than "could not delete".
        /deleted_at/.test(error.message)
          ? "Run migration-018 before deleting projects."
          : error.message,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
}

export async function restoreProject(projectId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ deleted_at: null })
    .eq("id", projectId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
}
