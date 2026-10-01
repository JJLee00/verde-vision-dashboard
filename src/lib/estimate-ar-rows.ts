// Keeping the estimate's plant rows in step with the design.
//
// Two different events can change what is planted: the office publishes a
// revision from the editor, and the headset syncs a design from the yard.
// Both have to leave the estimate saying the same thing, so both call this.
//
// It lived inside the viewer's publish action until Sep 29 2026, which is why
// a headset sync produced a project with a full design and an estimate of
// zero rows — the code to derive them existed and simply never ran on that
// path. Deriving here rather than having the app POST rows is the same
// argument as the diff in versions.ts: one implementation, so the two authors
// cannot drift into disagreeing about someone's bid.

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentSize, plantForModel, unitPrice } from "@/lib/design-edit";
import type { PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";

// Both the service-role client (the Vision Pro ingest route) and the
// user-scoped server client (the dashboard editor) are SupabaseClient — the
// same reasoning as versions.ts.
type DbClient = SupabaseClient;

/**
 * Rewrites the estimate's plant rows to match the design.
 *
 * Only `source='ar'` rows whose key starts `plant:` are touched — hardscape
 * rows still belong to the headset, and every manual row is left completely
 * alone. A price a designer typed over survives too: quantity follows the
 * design, the price stays theirs.
 *
 * Returns how many plant rows the design produced, so a caller can tell
 * "the design has no plants we recognise" apart from "the design is empty".
 */
export async function rebuildPlantRows(
  supabase: DbClient,
  projectId: string,
  design: ProjectFileJSON
): Promise<number> {
  // The org is read from the PROJECT rather than taken as an argument: it is
  // the one answer that cannot be wrong, and both callers already have the
  // project id.
  //
  // Scoping the price lookup explicitly matters because this function is
  // handed two different clients. From the viewer's publish action it gets a
  // cookie-bound one and RLS scopes the read; from the Vision Pro ingest
  // route it gets the SERVICE ROLE, where RLS is never consulted — so until
  // Sep 30 a headset sync built its override map from every organization's
  // plant prices, last row winning by lowercased name. Another firm's price
  // for the same plant could land on this one's bid.
  //
  // Same trap migration 017 part 3 was written about. A function that was
  // safe under RLS stops being safe the moment it is called with a client
  // that bypasses it, and nothing about its signature says so.
  const { data: project } = await supabase
    .from("projects")
    .select("org_id")
    .eq("id", projectId)
    .maybeSingle();
  const orgId = (project as { org_id?: string | null } | null)?.org_id ?? null;

  // No org on the project means no overrides — catalog prices. Falling back
  // to an unfiltered read would be the exact leak this is closing, and a bid
  // at list price is a recoverable kind of wrong; one carrying a competitor's
  // numbers is not.
  const { data: priceRows } = orgId
    ? await supabase
        .from("price_items")
        .select("name, price")
        .eq("category", "plant")
        .eq("org_id", orgId)
    : { data: [] };
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

  return groups.size;
}
