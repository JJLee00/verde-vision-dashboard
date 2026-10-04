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
import { loadPriceBook, type PriceBook } from "@/lib/price-book";
import { surfaceRates, surfaceSqFt, surfaceStyle } from "@/lib/surfaces";
import type { PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";

/** The one estimate row a design's labor lands in, like the headset's line. */
export const LABOR_AR_KEY = "labor:install";

/**
 * Installation labor for a design: every placement at the org's labor rate
 * for its container size, plus every surface at the org's labor per ft² for
 * its style. A blank rate is $0 — the same rule the headset applies
 * (InventoryStore.laborCost and surfaceLabor), which is the only reason the
 * two agree.
 *
 * A placement the catalog doesn't know (a placeholder plant) still has a
 * container size, and "a 5-gallon plant takes the same work no matter the
 * species", so the org's rate applies to it too.
 */
export function designLabor(design: ProjectFileJSON, book: PriceBook): number {
  let total = 0;
  for (const p of design.placements ?? []) {
    const plant = plantForModel(p.plantModelName);
    const size = plant ? currentSize(plant, p as PlacedPlantJSON) : null;
    const sizeName = size?.size ?? p.containerType ?? null;
    if (!sizeName) continue;
    total += book.laborRates[sizeName] ?? 0;
  }
  for (const area of design.hardscapeAreas ?? []) {
    const style = surfaceStyle(area.style);
    if (style) total += surfaceSqFt(area) * surfaceRates(style, book).labor;
  }
  return Math.round(total * 100) / 100;
}

// Both the service-role client (the Vision Pro ingest route) and the
// user-scoped server client (the dashboard editor) are SupabaseClient — the
// same reasoning as versions.ts.
type DbClient = SupabaseClient;

/**
 * Rewrites the estimate's plant rows to match the design.
 *
 * Only `source='ar'` rows are touched — `plant:…`, one `hardscape:<area id>`
 * per traced surface, and the one `labor:install` row when the design has
 * labor switched on. Every manual row is left completely alone. A price a designer typed over survives too: quantity follows the
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

  // The Plant Prices / Hardscape Prices grids, scoped to this org (see
  // loadPriceBook). Until Oct 4 2026 this read the legacy name-only
  // price_items and fell back to catalog prices, so a price typed in the
  // grid never reached the estimate. No org means an empty book: $0, never
  // an unfiltered read — a bid carrying a competitor's numbers is the one
  // kind of wrong that can't be walked back.
  const book = await loadPriceBook(supabase, orgId);

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
        price: unitPrice(p as PlacedPlantJSON, book.prices) ?? 0,
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

  await syncSurfaceRows(supabase, projectId, design, book);
  await syncLaborRow(supabase, projectId, design, book);

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

/**
 * One row per traced surface — pavers, turf, decomposed granite — keyed by
 * the area's id (the 'hardscape:<area id>' that migration 016 reserved).
 * Quantity is its square footage and the price the org's per-ft² price for
 * its style ($0 if blank), both exactly as the headset quotes them.
 *
 * Same contract as a plant row: the footage follows the design and a price
 * someone typed over survives. Except across a change of material — a price
 * typed for pavers says nothing about turf — so a re-styled area takes the
 * new style's description and price, and loses the override.
 */
async function syncSurfaceRows(
  supabase: DbClient,
  projectId: string,
  design: ProjectFileJSON,
  book: PriceBook
): Promise<void> {
  type Wanted = { description: string; sqFt: number; price: number };
  const wanted = new Map<string, Wanted>();
  for (const area of design.hardscapeAreas ?? []) {
    const style = surfaceStyle(area.style);
    const sqFt = Math.round(surfaceSqFt(area) * 100) / 100;
    if (!style || sqFt <= 0) continue;
    wanted.set(`hardscape:${area.id}`, {
      description: `${style.style} surface`,
      sqFt,
      price: surfaceRates(style, book).price,
    });
  }

  const { data: existingRows } = await supabase
    .from("estimate_items")
    .select("id, ar_key, description, price_overridden")
    .eq("project_id", projectId)
    .eq("source", "ar")
    .like("ar_key", "hardscape:%");
  const byKey = new Map(
    (existingRows ?? []).map((r) => [String(r.ar_key), r])
  );

  for (const [arKey, row] of wanted) {
    const existing = byKey.get(arKey);
    if (existing) {
      const patch: Record<string, unknown> = { quantity: row.sqFt };
      if (existing.description !== row.description) {
        patch.description = row.description;
        patch.unit_price = row.price;
        patch.price_overridden = false;
      } else if (!existing.price_overridden) {
        patch.unit_price = row.price;
      }
      await supabase.from("estimate_items").update(patch).eq("id", existing.id);
      byKey.delete(arKey);
    } else {
      await supabase.from("estimate_items").insert({
        project_id: projectId,
        description: row.description,
        category: "hardscape",
        quantity: row.sqFt,
        unit: "ft²",
        unit_price: row.price,
        taxable: true,
        source: "ar",
        ar_key: arKey,
      });
    }
  }

  // Surfaces erased from the design leave the estimate with them.
  const stale = [...byKey.values()].map((r) => r.id);
  if (stale.length > 0) {
    await supabase.from("estimate_items").delete().in("id", stale);
  }
}

/**
 * Keeps the Labor line in step with the design: there while the project has
 * labor switched on, gone when it doesn't. Same contract as a plant row — the
 * amount follows the design until someone types over the price, and then the
 * price is theirs. Manual labor lines are never touched.
 */
async function syncLaborRow(
  supabase: DbClient,
  projectId: string,
  design: ProjectFileJSON,
  book: PriceBook
): Promise<void> {
  const { data: existingRows } = await supabase
    .from("estimate_items")
    .select("id, price_overridden")
    .eq("project_id", projectId)
    .eq("source", "ar")
    .eq("ar_key", LABOR_AR_KEY);
  const [existing, ...duplicates] = existingRows ?? [];
  // Two syncs landing together could each have inserted one. Keep the first.
  if (duplicates.length > 0) {
    await supabase
      .from("estimate_items")
      .delete()
      .in("id", duplicates.map((r) => r.id));
  }

  if (design.includeLabor !== true) {
    if (existing) {
      await supabase.from("estimate_items").delete().eq("id", existing.id);
    }
    return;
  }

  const amount = designLabor(design, book);

  if (existing) {
    if (!existing.price_overridden) {
      await supabase
        .from("estimate_items")
        .update({ unit_price: amount })
        .eq("id", existing.id);
    }
    return;
  }
  await supabase.from("estimate_items").insert({
    project_id: projectId,
    description: "Installation labor",
    category: "labor",
    quantity: 1,
    unit: "ls",
    unit_price: amount,
    // Labor is untaxed everywhere else on the dashboard (the Saved Items
    // picker sets taxable = category !== "labor").
    taxable: false,
    source: "ar",
    ar_key: LABOR_AR_KEY,
  });
}
