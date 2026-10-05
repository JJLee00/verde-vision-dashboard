#!/usr/bin/env node
// Checks the estimate rules against src/lib/estimate-parity.json — the cases
// the headset app checks its own copy of the same rules against
// (Test/TestTests/EstimateParityTests.swift in the Verde-Vision repo).
//
// The pricing rules live in two codebases: rebuildPlantRows here, and the
// headset's estimate panel, which shows this bid with the yard's unsynced
// changes on top (Oct 5 2026). Both run these cases; if either drifts, its
// check fails. Change a rule → change it in both, then the expectations.
//
//   npm run check:estimate            check every case
//   npm run check:estimate -- --write  regenerate the expectations from the
//                                      current code (review the diff!)
//
// Runs the REAL rebuildPlantRows and computeTotals against an in-memory
// stand-in for the database — no Supabase, no network.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const { rebuildPlantRows } = await jiti.import(join(root, "src/lib/estimate-ar-rows.ts"));
const { computeTotals, fromRow, sortItems } = await jiti.import(join(root, "src/lib/estimate.ts"));

const FIXTURE = join(root, "src/lib/estimate-parity.json");
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
const write = process.argv.includes("--write");

// ── An in-memory stand-in for the Supabase client ─────────────────────────
function fakeDb(seed) {
  const tables = seed;
  let next = 1;
  const from = (table) => {
    const s = { op: "select", filters: [] };
    const q = {
      select() { return q; },
      eq(c, v) { s.filters.push((r) => r[c] === v); return q; },
      like(c, p) { const pre = p.replace("%", ""); s.filters.push((r) => String(r[c] ?? "").startsWith(pre)); return q; },
      in(c, vs) { s.filters.push((r) => vs.includes(r[c])); return q; },
      limit() { return q; },
      maybeSingle() { s.single = true; return q; },
      returns() { return q; },
      update(p) { s.op = "update"; s.patch = p; return q; },
      delete() { s.op = "delete"; return q; },
      insert(r) { s.op = "insert"; s.row = r; return q; },
      then(resolve, reject) {
        try {
          const rows = (tables[table] ??= []);
          const hit = (r) => s.filters.every((f) => f(r));
          if (s.op === "insert") {
            rows.push({ id: `new-${next++}`, sort_order: 1000 + next, note: null,
              labor_unit_price: 0, price_overridden: false, labor_overridden: false, ...s.row });
            return resolve({ data: null, error: null });
          }
          if (s.op === "update") { rows.filter(hit).forEach((r) => Object.assign(r, s.patch)); return resolve({ data: null, error: null }); }
          if (s.op === "delete") { tables[table] = rows.filter((r) => !hit(r)); return resolve({ data: null, error: null }); }
          const found = rows.filter(hit).map((r) => table === "estimate_items"
            ? { ...r, total: Math.round(Number(r.quantity) * (Number(r.unit_price) + Number(r.labor_unit_price ?? 0)) * 100) / 100 }
            : r);
          resolve({ data: s.single ? found[0] ?? null : found, error: null });
        } catch (e) { reject(e); }
      },
    };
    return q;
  };
  return { from, tables };
}

const rect = (w, d) => [
  { id: "a", positionX: 0, positionY: 0, positionZ: 0 },
  { id: "b", positionX: w, positionY: 0, positionZ: 0 },
  { id: "c", positionX: w, positionY: 0, positionZ: d },
  { id: "d", positionX: 0, positionY: 0, positionZ: d },
];

// A line's identity across both codebases: its design key, or — for a line
// typed by hand — its description.
const lineKey = (row) => (row.source === "ar" ? row.ar_key : `manual:${row.description}`);
const round2 = (n) => Math.round(n * 100) / 100;

async function run(c) {
  const db = fakeDb({
    projects: [{ id: "p", org_id: "org", tax_rate: c.taxRate, estimate_amount: null }],
    plant_prices: Object.entries(c.prices).map(([cell, price]) => {
      const [plant_key, size] = cell.split("|");
      return { org_id: "org", plant_key, size, price };
    }),
    labor_rates: Object.entries(c.laborRates).map(([size, rate]) => ({ org_id: "org", size, rate })),
    estimate_items: c.bid.map((l, i) => ({
      id: `bid-${i}`, project_id: "p", ar_key: l.ar_key, description: l.description, note: l.note ?? null,
      category: l.source === "ar" ? "plant" : "other", quantity: l.quantity, unit: l.unit ?? "each",
      unit_price: l.unit_price, labor_unit_price: l.labor_unit_price, taxable: l.taxable,
      source: l.source, price_overridden: l.price_overridden, labor_overridden: l.labor_overridden,
      sort_order: l.sort_order,
    })),
  });
  const design = {
    projectName: c.name,
    includeLabor: c.includeLabor,
    placements: c.plants.flatMap((p, i) =>
      Array.from({ length: p.count }, (_, n) => ({
        id: `pl-${i}-${n}`, plantModelName: p.modelName, containerType: p.size, scaleX: 1,
      }))),
    hardscapeAreas: c.surfaces.map((s) => ({ id: s.id, style: s.style, vertices: rect(s.width, s.depth) })),
  };
  await rebuildPlantRows(db, "p", design);
  const items = sortItems(db.tables.estimate_items.map((r) => fromRow({
    ...r, total: round2(Number(r.quantity) * (Number(r.unit_price) + Number(r.labor_unit_price ?? 0))),
  })));
  const totals = computeTotals(items, { taxRate: c.taxRate, depositPercent: 0 });
  return {
    lines: db.tables.estimate_items
      .map((r) => ({ key: lineKey(r), quantity: Number(r.quantity), unitPrice: Number(r.unit_price), laborUnitPrice: Number(r.labor_unit_price ?? 0) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    subtotal: totals.subtotal,
    laborSubtotal: totals.laborSubtotal,
    tax: totals.tax,
    total: totals.total,
  };
}

let failed = 0;
for (const c of fixture.cases) {
  const got = await run(c);
  if (write) {
    c.expect = got;
    console.log(`wrote  ${c.name}: total ${got.total}`);
    continue;
  }
  const ok = JSON.stringify(got) === JSON.stringify(c.expect);
  if (!ok) {
    failed++;
    console.log(`FAIL   ${c.name}\n  expected ${JSON.stringify(c.expect)}\n  got      ${JSON.stringify(got)}`);
  } else {
    console.log(`ok     ${c.name}`);
  }
}

if (write) {
  writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2) + "\n");
} else {
  // The headset checks its own copy; they must be the same file.
  const appCopy = join(process.env.HOME ?? "", "Verde-Vision/Test/TestTests/estimate-parity.json");
  if (existsSync(appCopy) && readFileSync(appCopy, "utf8") !== readFileSync(FIXTURE, "utf8")) {
    failed++;
    console.log(`FAIL   the app's copy differs: ${appCopy}`);
  }
  console.log(failed ? `${failed} failed` : "all estimate parity cases pass");
  process.exit(failed ? 1 : 0);
}
