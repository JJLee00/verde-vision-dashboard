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

/** The four things a project is described by, from the details dialog. */
export type ProjectDetailsInput = {
  name: string;
  customerName: string;
  address: string;
  contactEmail: string;
};

// Blank inputs are stored as null, not "". A project with no address should
// read as having none, and `address is null` is the check every caller
// reaches for — including the headset, which will use it to decide whether
// it can fetch a lot outline at all.
const orNull = (value: string) => value.trim() || null;

export async function createProject(
  input: ProjectDetailsInput
): Promise<Result> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the project a name." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Assigned to whoever is creating it. `org_id` is derived from this by the
  // projects_set_org trigger (007), and the insert policy added in 018
  // checks the same column.
  //
  // There is deliberately no designer picker: a project belongs to the
  // account it was made from. The cost is that an owner cannot set one up
  // for someone else on the team — it would land on their own headset — so
  // if that ever becomes a real workflow this is where it comes back.
  const clientId = user.id;

  const { data, error } = await supabase
    .from("projects")
    .insert({
      client_id: clientId,
      name,
      customer_name: orNull(input.customerName),
      address: orNull(input.address),
      contact_email: orNull(input.contactEmail),
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

export async function updateProjectDetails(
  projectId: string,
  input: ProjectDetailsInput
): Promise<Result> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the project a name." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({
      name,
      customer_name: orNull(input.customerName),
      address: orNull(input.address),
      contact_email: orNull(input.contactEmail),
    })
    .eq("id", projectId);

  if (error) {
    return {
      ok: false,
      error: /customer_name/.test(error.message)
        ? "Run migration-019 before editing project details."
        : error.message,
    };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true };
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
