"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentPublishedVersion, diffPlants, summarize } from "@/lib/versions";
import { currentSize, plantForModel, unitPrice } from "@/lib/design-edit";
import type { PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";

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
          ? "Run migration-015 before publishing revisions."
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

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Rewrites the estimate's plant rows to match the design.
 *
 * This is the half of "the estimate updates itself" that only the dashboard
 * can do: once a plant is swapped from a desk, the headset isn't in the loop
 * to recompute anything. Only `source='ar'` rows whose key starts `plant:`
 * are touched — hardscape rows still belong to the headset, and every
 * manual row is left completely alone.
 */
async function rebuildPlantRows(
  supabase: ServerClient,
  projectId: string,
  design: ProjectFileJSON
) {
  const { data: priceRows } = await supabase
    .from("price_items")
    .select("name, price")
    .eq("category", "plant");
  const overrides: Record<string, number> = {};
  for (const row of priceRows ?? []) {
    overrides[String(row.name).toLowerCase()] = Number(row.price);
  }

  // Group identical plant-and-size pairs into one line, the way a bid reads.
  type Group = { description: string; qty: number; price: number };
  const groups = new Map<string, Group>();
  for (const p of design.placements ?? []) {
    const plant = plantForModel(p.plantModelName);
    if (!plant) continue;
    const size = currentSize(plant, p as PlacedPlantJSON);
    const sizeName = size?.size ?? p.containerType ?? "each";
    const key = `plant:${plant.key}:${sizeName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.qty += 1;
    } else {
      groups.set(key, {
        description: `(${sizeName}) ${plant.name}`,
        qty: 1,
        price: unitPrice(p as PlacedPlantJSON, overrides) ?? 0,
      });
    }
  }

  const { data: existingRows } = await supabase
    .from("estimate_items")
    .select("id, ar_key, price_overridden")
    .eq("project_id", projectId)
    .eq("source", "ar")
    .like("ar_key", "plant:%");

  const byKey = new Map(
    (existingRows ?? []).map((r) => [String(r.ar_key), r])
  );

  for (const [arKey, group] of groups) {
    const existing = byKey.get(arKey);
    if (existing) {
      // A price a designer typed over survives: quantity follows the design,
      // the price stays theirs.
      const patch: Record<string, unknown> = { quantity: group.qty };
      if (!existing.price_overridden) patch.unit_price = group.price;
      await supabase.from("estimate_items").update(patch).eq("id", existing.id);
      byKey.delete(arKey);
    } else {
      await supabase.from("estimate_items").insert({
        project_id: projectId,
        description: group.description,
        category: "plant",
        quantity: group.qty,
        unit: "each",
        unit_price: group.price,
        taxable: true,
        source: "ar",
        ar_key: arKey,
      });
    }
  }

  // Whatever is left was in the estimate and is no longer in the design.
  const stale = [...byKey.values()].map((r) => r.id);
  if (stale.length > 0) {
    await supabase.from("estimate_items").delete().in("id", stale);
  }

  const { data: allRows } = await supabase
    .from("estimate_items")
    .select("total, taxable")
    .eq("project_id", projectId);
  if (allRows) {
    const { data: settings } = await supabase
      .from("projects")
      .select("tax_rate")
      .eq("id", projectId)
      .maybeSingle();
    const subtotal = allRows.reduce((s, r) => s + Number(r.total ?? 0), 0);
    const taxable = allRows.reduce(
      (s, r) => s + (r.taxable ? Number(r.total ?? 0) : 0),
      0
    );
    const rate = Number(settings?.tax_rate ?? 0);
    const total = Math.round((subtotal + (taxable * rate) / 100) * 100) / 100;
    await supabase
      .from("projects")
      .update({ estimate_amount: total })
      .eq("id", projectId);
  }
}
