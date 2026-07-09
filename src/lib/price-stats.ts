// Shared types and pure helpers for the Plant Prices / Hardscape Prices
// pages: catalog slicing (gallon-sized plants vs Small/Medium/Large
// hardscape + specimen items) and stat-tile aggregation.

import catalog from "@/lib/catalog.json";

export type CatalogSize = { size: string; price: number; laborCost: number };
export type CatalogPlant = {
  key: string;
  name: string;
  botanicalName: string | null;
  category: string;
  thumbnail: string | null;
  sizes: CatalogSize[];
};

export type UsageRow = { key: string; size: string; count: number };

const SML = new Set(["Small", "Medium", "Large"]);

const plants = catalog.plants as CatalogPlant[];

// An item is "hardscape-priced" when it's sold Small/Medium/Large —
// boulders, pools, and specimen plants like Saguaro — regardless of its
// botanical category.
export function splitCatalog() {
  return {
    plantItems: plants.filter((p) => !p.sizes.some((s) => SML.has(s.size))),
    hardscapeItems: plants.filter((p) => p.sizes.some((s) => SML.has(s.size))),
    plantSizes: catalog.sizeOrder.filter((s) => !SML.has(s)),
    hardscapeSizes: catalog.sizeOrder.filter((s) => SML.has(s)),
  };
}

// Aggregates per-project usage summaries (projects.plant_usage) into the
// slice's favorite item and most-used size. Returns nulls until at least
// one project has synced usage data from the headset.
export function aggregateUsage(
  usageLists: (UsageRow[] | null)[],
  items: CatalogPlant[],
  sizes: string[]
) {
  const keys = new Map(items.map((p) => [p.key, p.name]));
  const sizeSet = new Set(sizes);
  const byKey = new Map<string, number>();
  const bySize = new Map<string, number>();

  for (const rows of usageLists) {
    for (const row of rows ?? []) {
      if (!keys.has(row.key)) continue;
      byKey.set(row.key, (byKey.get(row.key) ?? 0) + row.count);
      if (sizeSet.has(row.size)) {
        bySize.set(row.size, (bySize.get(row.size) ?? 0) + row.count);
      }
    }
  }

  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const favoriteKey = top(byKey);
  return {
    favorite: favoriteKey ? (keys.get(favoriteKey) ?? null) : null,
    mostUsedSize: top(bySize),
    hasData: byKey.size > 0,
  };
}

// Coverage: how many items in the slice the designer has priced.
export function coverage(
  items: CatalogPlant[],
  pricedCells: string[] // "plant_key|size" keys with a saved price
) {
  const itemKeys = new Set(items.map((p) => p.key));
  const pricedItems = new Set(
    pricedCells
      .map((cell) => cell.split("|")[0])
      .filter((key) => itemKeys.has(key))
  );
  return { itemsPriced: `${pricedItems.size} of ${items.length}` };
}
