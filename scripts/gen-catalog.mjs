#!/usr/bin/env node
// Regenerates src/lib/catalog.json from the Vision Pro app's hardcoded
// catalog (PlantItem.sampleCatalog). The app repo is the source of truth
// for which plants exist and what sizes they come in; this script keeps
// the dashboard's Prices grid and Plant Library in sync with it.
//
//   node scripts/gen-catalog.mjs [path/to/PlantItem.swift]
//
// Rerun (and commit the JSON) whenever a plant is added to the app.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SWIFT_PATH =
  process.argv[2] ??
  join(
    process.env.HOME ?? "",
    "Verde-Vision/Test/Test/Models/PlantItem.swift"
  );

// Mirrors ContainerSize.SizeType in PlantItem.swift. An unknown case must
// fail the run — silent drops would silently drop grid rows.
const SIZE_RAW = {
  oneGallon: "1g",
  fiveGallon: "5g",
  fifteenGallon: "15g",
  twentyFourBox: '24" Box',
  thirtySixBox: '36" Box',
  fortyEightBox: '48" Box',
  sixtyBox: '60" Box',
  small: "Small",
  medium: "Medium",
  large: "Large",
};

// Canonical column order for the Prices grid.
const SIZE_ORDER = Object.values(SIZE_RAW);

// Mirrors PlantItem.Category.
const CATEGORY_RAW = {
  tree: "Tree",
  shrub: "Shrub",
  flower: "Flower",
  grass: "Grass",
  succulent: "Succulent",
  groundcover: "Groundcover",
  hardscape: "Hardscape",
};

// Matches the app's InventoryStore.normalizePriceKey so keys line up on
// both ends: lowercase, alphanumeric words, single-space joined.
function plantKey(name) {
  return (name.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ");
}

const swift = readFileSync(SWIFT_PATH, "utf8");

const start = swift.indexOf("static let sampleCatalog");
if (start === -1) throw new Error("sampleCatalog not found in " + SWIFT_PATH);
const endMarker = swift.indexOf("extension SIMD3", start);
const body = swift.slice(start, endMarker === -1 ? undefined : endMarker);

const chunks = body.split(/PlantItem\(\s*\n/).slice(1);
if (chunks.length === 0) throw new Error("No PlantItem entries parsed");

const plants = chunks.map((chunk) => {
  const name = chunk.match(/name:\s*"([^"]+)"/)?.[1];
  if (!name) throw new Error("PlantItem entry without a name");
  const botanicalName = chunk.match(/botanicalName:\s*"([^"]+)"/)?.[1] ?? null;
  const categoryCase = chunk.match(/category:\s*\.(\w+)/)?.[1];
  const category = CATEGORY_RAW[categoryCase];
  if (!category) throw new Error(`${name}: unknown category .${categoryCase}`);
  const thumbnail = chunk.match(/thumbnailName:\s*"([^"]+)"/)?.[1] ?? null;

  const sizes = [
    ...chunk.matchAll(
      /ContainerSize\(type:\s*\.(\w+),\s*price:\s*([\d.]+),\s*heightMultiplier:\s*[\d.]+,\s*modelName:\s*"[^"]*",\s*laborCost:\s*([\d.]+)/g
    ),
  ].map(([, typeCase, price, laborCost]) => {
    const size = SIZE_RAW[typeCase];
    if (!size) throw new Error(`${name}: unknown size .${typeCase}`);
    return { size, price: Number(price), laborCost: Number(laborCost) };
  });
  if (sizes.length === 0) throw new Error(`${name}: no ContainerSize entries`);

  return { key: plantKey(name), name, botanicalName, category, thumbnail, sizes };
});

const dupes = plants.map((p) => p.key).filter((k, i, a) => a.indexOf(k) !== i);
if (dupes.length > 0) throw new Error("Duplicate plant keys: " + dupes);

// Default labor rate per size = the catalog's most common laborCost for
// that size (ghost placeholder in the Labor rates card).
const laborBysize = new Map();
for (const p of plants)
  for (const s of p.sizes) {
    const counts = laborBysize.get(s.size) ?? new Map();
    counts.set(s.laborCost, (counts.get(s.laborCost) ?? 0) + 1);
    laborBysize.set(s.size, counts);
  }
const laborDefaults = Object.fromEntries(
  [...laborBysize.entries()]
    .sort((a, b) => SIZE_ORDER.indexOf(a[0]) - SIZE_ORDER.indexOf(b[0]))
    .map(([size, counts]) => [
      size,
      [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0],
    ])
);

const usedSizes = SIZE_ORDER.filter((s) => laborBysize.has(s));

const out = {
  source: "Verde-Vision app PlantItem.sampleCatalog",
  generatedAt: new Date().toISOString().slice(0, 10),
  sizeOrder: usedSizes,
  laborDefaults,
  plants,
};

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/lib/catalog.json"
);
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(
  `Wrote ${plants.length} plants (${usedSizes.length} sizes) to ${outPath}`
);
