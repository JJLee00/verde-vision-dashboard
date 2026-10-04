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
import { isMissingColumn, round2 } from "@/lib/estimate";
import { loadPriceBook, type PriceBook } from "@/lib/price-book";
import { surfaceRates, surfaceSqFt, surfaceStyle } from "@/lib/surfaces";
import type { PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";

/**
 * The single "Installation labor" line a design's labor used to land in,
 * before every line carried its own (migration 023). Removed on the first
 * rebuild that can write labor per line.
 */
const LEGACY_LABOR_AR_KEY = "labor:install";

/**
 * Labor per item for a placement: the org's rate for its container size, or
 * $0 — the rule the headset applies too (InventoryStore.laborCost).
 *
 * A placement the catalog doesn't know (a placeholder plant) still has a
 * container size, and "a 5-gallon plant takes the same work no matter the
 * species", so the org's rate applies to it as well.
 */
export function placementLaborRate(placement: PlacedPlantJSON, book: PriceBook): number {
  const plant = plantForModel(placement.plantModelName);
  const size = plant ? currentSize(plant, placement) : null;
  const sizeName = size?.size ?? placement.containerType ?? null;
  return sizeName ? (book.laborRates[sizeName] ?? 0) : 0;
}

// Both the service-role client (the Vision Pro ingest route) and the
// user-scoped server client (the dashboard editor) are SupabaseClient — the
// same reasoning as versions.ts.
type DbClient = SupabaseClient;

/**
 * Only the fields that would actually change. The estimate page rebuilds the
 * design rows every time it opens (so a price changed on the Prices pages
 * shows at once), and rewriting forty unchanged rows on every look is forty
 * round trips for nothing. numeric columns arrive as strings ("60.00").
 */
function changedFields(
  existing: Record<string, unknown>,
  wanted: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(wanted)) {
    const current = existing[key];
    const same =
      typeof value === "number" ? Number(current) === value : current === value;
    if (!same) patch[key] = value;
  }
  return patch;
}

type ExistingRow = {
  id: string;
  ar_key: string | null;
  description: string;
  quantity: number | string;
  unit_price: number | string;
  price_overridden: boolean;
  labor_unit_price?: number | string | null;
  labor_overridden?: boolean | null;
};

/**
 * A line's price is set ONCE (Oct 4 2026). Changing a plant price or a labor
 * rate on the Prices pages must never reprice a bid that already exists —
 * it applies to lines added from then on: a new plant, a new size, a new
 * surface. The one exception: a line still at $0 because its grid cell was
 * blank picks the price up once one is entered. That's filling a gap, not
 * changing a price — without it, every estimate synced before the grid was
 * filled in would sit at $0 forever.
 */
const unpricedNumber = (value: number | string | null | undefined) =>
  value == null || Number(value) === 0;

/**
 * The labor columns a design row should be written with.
 *
 *   • Labor off for this project → no labor on any design line, and any
 *     override is cleared: "labor off" means none, not "none unless typed".
 *   • Labor on, someone typed over this line's labor → leave it alone.
 *   • Labor on, the line already has labor → leave it alone: a rate changed
 *     on the Prices page doesn't reach a line that's already priced.
 *   • Otherwise (a new line, or one still at $0) → the current rate.
 *
 * Empty before migration 023 — writing a column the table doesn't have would
 * fail the whole row, so until it runs the design simply writes no labor.
 */
function laborFields(
  perLine: boolean,
  includeLabor: boolean,
  rate: number,
  existing: { labor_overridden?: boolean | null; labor_unit_price?: number | string | null } | null
): Record<string, unknown> {
  if (!perLine) return {};
  if (!includeLabor) return { labor_unit_price: 0, labor_overridden: false };
  if (existing?.labor_overridden) return {};
  if (existing && !unpricedNumber(existing.labor_unit_price)) return {};
  return { labor_unit_price: rate };
}

/**
 * Rewrites the estimate's design rows to match the design.
 *
 * Only `source='ar'` rows are touched — `plant:…` and one `hardscape:<area
 * id>` per traced surface, each carrying its own labor beside its price when
 * the project has labor switched on. Every manual row is left completely
 * alone. Quantity follows the design; price and labor are set once, when a
 * line first appears (or first gets a price), and never move after that —
 * not for a price-book change, and not over anything a designer typed.
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

  // Can lines carry their own labor yet? (migration 023)
  const { error: probeError } = await supabase
    .from("estimate_items")
    .select("labor_unit_price")
    .eq("project_id", projectId)
    .limit(1);
  const perLine = !isMissingColumn(probeError?.code);
  const includeLabor = design.includeLabor === true;
  const rowColumns = perLine
    ? "id, ar_key, description, quantity, unit_price, price_overridden, labor_unit_price, labor_overridden"
    : "id, ar_key, description, quantity, unit_price, price_overridden";

  // Group identical plant-and-size pairs into one line, the way a bid reads.
  type Group = { description: string; qty: number; price: number; labor: number };
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
        labor: placementLaborRate(p as PlacedPlantJSON, book),
      });
    }
  }

  const { data: existingRows } = await supabase
    .from("estimate_items")
    .select(rowColumns)
    .eq("project_id", projectId)
    .eq("source", "ar")
    .like("ar_key", "plant:%")
    .returns<ExistingRow[]>();

  const byKey = new Map(
    (existingRows ?? []).map((r) => [String(r.ar_key), r])
  );

  for (const [arKey, group] of groups) {
    const existing = byKey.get(arKey) ?? null;
    const labor = laborFields(perLine, includeLabor, group.labor, existing);
    if (existing) {
      // Quantity follows the design. The price is the line's own once set —
      // only a line still at $0 (its grid cell was blank) takes one now.
      const fillPrice = !existing.price_overridden && unpricedNumber(existing.unit_price);
      const patch = changedFields(existing, {
        quantity: group.qty,
        ...labor,
        ...(fillPrice ? { unit_price: group.price } : {}),
      });
      if (Object.keys(patch).length > 0) {
        await supabase.from("estimate_items").update(patch).eq("id", existing.id);
      }
      byKey.delete(arKey);
    } else {
      await supabase.from("estimate_items").insert({
        project_id: projectId,
        description: group.description,
        category: "plant",
        quantity: group.qty,
        unit: "each",
        unit_price: group.price,
        ...labor,
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

  await syncSurfaceRows(supabase, projectId, design, book, perLine, rowColumns);

  // Labor lives on the lines now, so the old single labor line goes — but
  // only once the lines can carry it, or labor would vanish from the bid.
  if (perLine) {
    await supabase
      .from("estimate_items")
      .delete()
      .eq("project_id", projectId)
      .eq("source", "ar")
      .eq("ar_key", LEGACY_LABOR_AR_KEY);
  }

  // The same arithmetic as computeTotals in src/lib/estimate.ts: every line's
  // total, plus tax on the MATERIAL part of the taxable ones (labor is never
  // taxed).
  const { data: allRows } = await supabase
    .from("estimate_items")
    .select("quantity, unit_price, total, taxable")
    .eq("project_id", projectId);
  if (allRows) {
    const { data: settings } = await supabase
      .from("projects")
      .select("tax_rate, estimate_amount")
      .eq("id", projectId)
      .maybeSingle();
    const subtotal = allRows.reduce((s, r) => s + Number(r.total ?? 0), 0);
    const taxable = allRows.reduce(
      (s, r) =>
        s + (r.taxable ? round2(Number(r.quantity) * Number(r.unit_price)) : 0),
      0
    );
    const rate = Number(settings?.tax_rate ?? 0);
    const total = round2(round2(subtotal) + round2((round2(taxable) * rate) / 100));
    if (settings?.estimate_amount == null || Number(settings.estimate_amount) !== total) {
      await supabase
        .from("projects")
        .update({ estimate_amount: total })
        .eq("id", projectId);
    }
  }

  return groups.size;
}

/**
 * One row per traced surface — pavers, turf, decomposed granite — keyed by
 * the area's id (the 'hardscape:<area id>' that migration 016 reserved).
 * Quantity is its square footage; price and labor are the org's per-ft²
 * numbers for its style ($0 if blank), exactly as the headset quotes them.
 *
 * Same contract as a plant row: the footage follows the design and a price
 * or labor someone typed over survives. Except across a change of material —
 * a price typed for pavers says nothing about turf — so a re-styled area
 * takes the new style's description and numbers, and loses its overrides.
 */
async function syncSurfaceRows(
  supabase: DbClient,
  projectId: string,
  design: ProjectFileJSON,
  book: PriceBook,
  perLine: boolean,
  rowColumns: string
): Promise<void> {
  const includeLabor = design.includeLabor === true;
  type Wanted = { description: string; sqFt: number; price: number; labor: number };
  const wanted = new Map<string, Wanted>();
  for (const area of design.hardscapeAreas ?? []) {
    const style = surfaceStyle(area.style);
    const sqFt = Math.round(surfaceSqFt(area) * 100) / 100;
    if (!style || sqFt <= 0) continue;
    const rates = surfaceRates(style, book);
    wanted.set(`hardscape:${area.id}`, {
      description: `${style.style} surface`,
      sqFt,
      price: rates.price,
      labor: rates.labor,
    });
  }

  const { data: existingRows } = await supabase
    .from("estimate_items")
    .select(rowColumns)
    .eq("project_id", projectId)
    .eq("source", "ar")
    .like("ar_key", "hardscape:%")
    .returns<ExistingRow[]>();
  const byKey = new Map(
    (existingRows ?? []).map((r) => [String(r.ar_key), r])
  );

  for (const [arKey, row] of wanted) {
    const existing = byKey.get(arKey) ?? null;
    if (existing) {
      const restyled = existing.description !== row.description;
      const wanted: Record<string, unknown> = {
        quantity: row.sqFt,
        // A new material starts from its own labor, override or not.
        ...laborFields(perLine, includeLabor, row.labor, restyled ? null : existing),
      };
      if (restyled) {
        // A different material is a different line: today's prices.
        wanted.description = row.description;
        wanted.unit_price = row.price;
        wanted.price_overridden = false;
        if (perLine) wanted.labor_overridden = false;
      } else if (!existing.price_overridden && unpricedNumber(existing.unit_price)) {
        // Same rule as a plant line: only a $0 line takes a price now.
        wanted.unit_price = row.price;
      }
      const patch = changedFields(existing, wanted);
      if (Object.keys(patch).length > 0) {
        await supabase.from("estimate_items").update(patch).eq("id", existing.id);
      }
      byKey.delete(arKey);
    } else {
      await supabase.from("estimate_items").insert({
        project_id: projectId,
        description: row.description,
        category: "hardscape",
        quantity: row.sqFt,
        unit: "ft²",
        unit_price: row.price,
        ...laborFields(perLine, includeLabor, row.labor, null),
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
