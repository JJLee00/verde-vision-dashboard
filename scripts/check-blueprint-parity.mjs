#!/usr/bin/env node
// Checks the blueprint sheet's geometry against src/lib/blueprint/blueprint-parity.json
// — the cases the headset app checks its own copy of the same rules against
// (Test/TestTests/BlueprintParityTests.swift in the Verde-Vision repo).
//
// The sheet is drawn in two places: here, for every download and share link,
// and in the headset, for the offline preview on site. Both must put the yard
// on the page at the same scale, every plant at the same place, size and
// turn, and list the same schedule. If either drifts, its check fails.
// Change a rule → change it in both (src/lib/blueprint/sheet.ts,
// BlueprintExporter.swift), then the expectations.
//
//   npm run check:blueprint            check every case
//   npm run check:blueprint -- --write regenerate the expectations from the
//                                      current code (review the diff!), and
//                                      seed the cases if the file is missing
//
// Copy the file to the app afterwards; this check fails while the copies differ.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const { sheetLayout, plantMarks, plantSchedule } = await jiti.import(join(root, "src/lib/blueprint/sheet.ts"));
const { FIXTURE_PROJECT } = await jiti.import(join(root, "src/lib/viewer/fixture.ts"));

const FILE = join(root, "src/lib/blueprint/blueprint-parity.json");
const APP_COPY = join(process.env.HOME ?? "", "Verde-Vision/Test/TestTests/blueprint-parity.json");
const write = process.argv.includes("--write");

const r4 = (n) => Math.round(n * 1e4) / 1e4 + 0;
const wrap = (a) => {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
};

function expectFor(project) {
  const layout = sheetLayout(project);
  if (!layout) return null;
  return {
    mapScale: r4(layout.mapScale),
    offX: r4(layout.offX),
    offY: r4(layout.offY),
    minRX: r4(layout.minRX),
    minRZ: r4(layout.minRZ),
    marks: plantMarks(project, layout).map((m) => ({
      id: m.id,
      code: m.code,
      x: r4(m.x),
      y: r4(m.y),
      R: r4(m.R),
      rot: r4(wrap(m.rot)),
    })),
    schedule: plantSchedule(project.placements ?? []),
  };
}

// ── Seed cases (only when the file doesn't exist yet) ──────────────────────
function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
function turnedYard() {
  let n = 1000;
  const FT = 0.3048;
  const turn = (25 * Math.PI) / 180;
  const at = (xFt, zFt) => {
    const x = xFt * FT;
    const z = zFt * FT;
    return { x: x * Math.cos(turn) - z * Math.sin(turn), z: x * Math.sin(turn) + z * Math.cos(turn) };
  };
  const pt = (xFt, zFt) => {
    const p = at(xFt, zFt);
    return { id: uuid(n++), positionX: p.x, positionY: 0, positionZ: p.z };
  };
  const place = (model, xFt, zFt, yawDeg, containerType, scale = 1) => {
    const p = at(xFt, zFt);
    const h = (yawDeg * Math.PI) / 360;
    return {
      id: uuid(n++), plantModelName: model,
      positionX: p.x, positionY: 0, positionZ: p.z,
      rotationX: 0, rotationY: Math.sin(h), rotationZ: 0, rotationW: Math.cos(h),
      scaleX: scale, scaleY: scale, scaleZ: scale,
      ...(containerType ? { containerType } : {}),
    };
  };
  return {
    projectName: "Turned yard",
    northHeadingDegrees: 30,
    boundaryPoints: [pt(-20, -15), pt(20, -15), pt(20, 15), pt(-20, 15)],
    featurePolygons: [{ id: uuid(n++), featureType: "House", vertices: [pt(-20, -15), pt(0, -15), pt(0, -8), pt(-20, -8)] }],
    hardscapeAreas: [{ id: uuid(n++), style: "Pavers", vertices: [pt(2, -14), pt(12, -14), pt(12, -6), pt(2, -6)] }],
    removalMarkers: [{ id: uuid(n++), positionX: at(15, 10).x, positionY: 0, positionZ: at(15, 10).z, radiusMeters: 0.4, heightMeters: 0.5 }],
    placements: [
      place("HoneyMesquite", -10, 6, 40, '36" Box'),
      place("AgaveAmericana", 5, 2, 135, "15g"),
      place("AgaveAmericana", 8, 4, -70, "5g"),
      // No containerType: the size is matched on scale, as the headset does.
      place("TexasEbonyMd", 14, 9, 10, null, 6.5),
      place("Jojoba", -16, -4, 0, "5g"),
      place("TexasSage", -12, -2, 200, "5g"),
      place("YellowBells", -8, -4, 90, "5g"),
      place("HesperaloeMd", 0, 10, 15, "5g"),
      place("NightUplight", 3, 12, 160, "Small"),
      place("NightFloodlight", -3, 12, -45, "Small"),
      place("NightPathlight", 6, 0, 0, "Small"),
      place("WhiteDawnLantana", 16, -10, 30, "5g"),
      // Not in the catalog: drawn as the stand-in, left off the schedule.
      place("MysteryShrub", -18, 12, 0, "5g"),
      place("SwimmingPool", 10, -2, 20, "Large", 1.2),
    ],
  };
}

function seed() {
  const subset = (p) => ({
    projectName: p.projectName,
    northHeadingDegrees: p.northHeadingDegrees ?? null,
    boundaryPoints: p.boundaryPoints ?? [],
    featurePolygons: p.featurePolygons ?? [],
    hardscapeAreas: p.hardscapeAreas ?? [],
    removalMarkers: p.removalMarkers ?? [],
    placements: p.placements ?? [],
  });
  return { cases: [{ name: "sample yard", project: subset(FIXTURE_PROJECT) }, { name: "turned yard", project: subset(turnedYard()) }] };
}

// ── Run ───────────────────────────────────────────────────────────────────
const fixture = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : write ? seed() : null;
if (!fixture) {
  console.log(`FAIL   no ${FILE} — run with --write to seed it`);
  process.exit(1);
}

let failed = 0;
for (const c of fixture.cases) {
  const got = expectFor(c.project);
  if (write) {
    c.expect = got;
    console.log(`wrote  ${c.name}: ${got?.marks.length ?? 0} marks, ${got?.schedule.length ?? 0} schedule rows`);
  } else if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
    failed++;
    console.log(`FAIL   ${c.name}\n  expected ${JSON.stringify(c.expect).slice(0, 400)}\n  got      ${JSON.stringify(got).slice(0, 400)}`);
  } else {
    console.log(`ok     ${c.name}`);
  }
}

if (write) {
  writeFileSync(FILE, JSON.stringify(fixture, null, 1) + "\n");
} else {
  if (!existsSync(APP_COPY) || readFileSync(APP_COPY, "utf8") !== readFileSync(FILE, "utf8")) {
    failed++;
    console.log(`FAIL   the app's copy is missing or differs: ${APP_COPY}`);
  }
  console.log(failed ? `${failed} failed` : "all blueprint parity cases pass");
  process.exit(failed ? 1 : 0);
}
