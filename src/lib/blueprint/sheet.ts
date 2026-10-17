// The blueprint sheet's geometry: where the yard sits on the page, at what
// scale, where every plant's mark goes and how big, and the plant schedule.
//
// This is the headset's layout (BlueprintExporter.swift in the app), rule
// for rule, kept free of pdfkit so the renderer (src/lib/pdf/blueprint-pdf.ts)
// and the parity check (scripts/check-blueprint-parity.mjs) run the same
// code. The app checks its own copy of these rules against the same cases —
// blueprint-parity.json here and in Test/TestTests — so a sheet printed on
// the dashboard and the preview drawn in the headset cannot quietly part.
//
// Change a rule here → change it in BlueprintExporter.swift, then
// `npm run check:blueprint -- --write` and copy the JSON across.

import { plantForModel, type CatalogPlant, type CatalogSize } from "@/lib/design-edit";
import { surfaceStyle } from "@/lib/surfaces";
import { speciesMeta } from "@/lib/viewer/catalog";
import { symbolFor, type PlanSymbol } from "@/lib/viewer/symbols";
import type { PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";
import { METERS_TO_FEET } from "@/lib/viewer/types";

/** US Letter, landscape, in points — the headset's page. */
export const SHEET = {
  width: 792,
  height: 612,
  margin: 20,
  // 160, not the original 148: the schedule carries each plant's drawing
  // as its key, and the extra 12 pt keeps the names as wide as they were.
  titleColumnWidth: 160,
} as const;

/** One viewer pixel on paper. The viewer's 1 px plan line prints at 0.75 pt. */
export const PX = 0.75;

export type SheetLayout = {
  /** radians the yard is turned by: north up, or none */
  turn: number;
  minRX: number;
  maxRX: number;
  minRZ: number;
  maxRZ: number;
  /** points per meter */
  mapScale: number;
  offX: number;
  offY: number;
  usedW: number;
  usedH: number;
  rotate: (x: number, z: number) => [number, number];
  toPDF: (rx: number, rz: number) => [number, number];
};

/** The dashboard's plan turn (buildScene): north up when there's a heading. */
export function layoutTurn(northHeadingDegrees: number | null | undefined): number {
  return northHeadingDegrees == null ? 0 : ((-90 - northHeadingDegrees) * Math.PI) / 180;
}

const withVerts = <T extends { vertices?: unknown[] | null }>(xs: T[] | null | undefined) =>
  (xs ?? []).filter((x) => (x.vertices ?? []).length > 0);

/** Null for a yard with nothing drawn on it, which prints nothing. */
export function sheetLayout(project: ProjectFileJSON): SheetLayout | null {
  const placements = project.placements ?? [];
  const boundary = project.boundaryPoints ?? [];
  const features = project.featurePolygons ?? [];
  const hardscape = project.hardscapeAreas ?? [];
  const removals = project.removalMarkers ?? [];
  if (
    !placements.length &&
    !boundary.length &&
    !withVerts(features).length &&
    !withVerts(hardscape).length &&
    !removals.length
  ) {
    return null;
  }

  const turn = layoutTurn(project.northHeadingDegrees);
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const rotate = (x: number, z: number): [number, number] => [x * c - z * s, x * s + z * c];

  // The extent: everything drawn except the marker plates, which are mounted
  // wherever the site allows and would shrink the design to fit them.
  const rx: number[] = [];
  const rz: number[] = [];
  const add = (x: number, z: number) => {
    const [a, b] = rotate(x, z);
    rx.push(a);
    rz.push(b);
  };
  for (const p of placements) add(p.positionX, p.positionZ);
  for (const b of boundary) add(b.positionX, b.positionZ);
  for (const r of removals) add(r.positionX, r.positionZ);
  for (const f of features) for (const v of f.vertices ?? []) add(v.positionX, v.positionZ);
  for (const h of hardscape) for (const v of h.vertices ?? []) add(v.positionX, v.positionZ);
  if (!rx.length) {
    rx.push(0);
    rz.push(0);
  }

  const pad = 2;
  const minRX = Math.min(...rx) - pad;
  const maxRX = Math.max(...rx) + pad;
  const minRZ = Math.min(...rz) - pad;
  const maxRZ = Math.max(...rz) + pad;
  const worldW = Math.max(maxRX - minRX, 2);
  const worldD = Math.max(maxRZ - minRZ, 2);

  const { width: W, height: H, margin: M, titleColumnWidth: T } = SHEET;
  const mapLeft = M + 16;
  const mapRight = W - M - T - 16;
  const mapTop = M + 20;
  const mapBottom = H - M - 50; // room for the scale bar
  const mapW = mapRight - mapLeft;
  const mapH = mapBottom - mapTop;
  const mapScale = Math.min(mapW / worldW, mapH / worldD);
  const usedW = worldW * mapScale;
  const usedH = worldD * mapScale;
  const offX = mapLeft + (mapW - usedW) / 2;
  const offY = mapTop + (mapH - usedH) / 2;

  return {
    turn,
    minRX,
    maxRX,
    minRZ,
    maxRZ,
    mapScale,
    offX,
    offY,
    usedW,
    usedH,
    rotate,
    toPDF: (x, z) => [offX + (x - minRX) * mapScale, offY + (z - minRZ) * mapScale],
  };
}

/** A placement's turn about +Y, radians — quatYawDeg in scene.ts. */
export function quatYaw(p: PlacedPlantJSON): number {
  return Math.atan2(
    2 * (p.rotationW * p.rotationY + p.rotationX * p.rotationZ),
    1 - 2 * (p.rotationY * p.rotationY + p.rotationZ * p.rotationZ),
  );
}

export type PlantMark = {
  id: string;
  model: string;
  code: string;
  kind: string;
  /** page point of the plant */
  x: number;
  y: number;
  /** radius in feet, and on the page in points */
  radiusFt: number;
  R: number;
  /** the symbol's turn on the page */
  rot: number;
  scale: number;
  symbol: PlanSymbol | null;
};

/**
 * Every plant's mark: the viewer's symbol at half the catalog's mature
 * spread, never under a foot (a pool prefab is its own 10 x 6 ft footprint),
 * turned with the plant — a +yaw carries the model's +X to (cos, -sin) on
 * the ground, so the yaw comes off the sheet's turn.
 */
export function plantMarks(project: ProjectFileJSON, layout: SheetLayout): PlantMark[] {
  const ptPerFt = layout.mapScale / METERS_TO_FEET;
  return (project.placements ?? []).map((p) => {
    const meta = speciesMeta(p.plantModelName);
    const scale = p.scaleX || 1;
    const half = meta.matureWidthFt / 2;
    const radiusFt = meta.kind === "poolPrefab" ? Math.max(half, 5 * scale) : Math.max(half, 1);
    const [rx, rz] = layout.rotate(p.positionX, p.positionZ);
    const [x, y] = layout.toPDF(rx, rz);
    return {
      id: p.id,
      model: p.plantModelName,
      code: meta.code,
      kind: meta.kind,
      x,
      y,
      radiusFt,
      R: radiusFt * ptPerFt,
      rot: layout.turn - quatYaw(p),
      scale,
      symbol: symbolFor(p.plantModelName, meta.kind),
    };
  });
}

export type ScheduleRow = {
  code: string;
  name: string;
  size: string;
  quantity: number;
  /** the mesh the row's plant is drawn from — its symbol in the key */
  model: string;
};

/**
 * The size the headset restores a placement to on reopen
 * (DesignView.findInventoryItem): among the sizes on this mesh, the one
 * the placement says it is, else the nearest by scale, else the first.
 */
function restoredSize(plant: CatalogPlant, p: PlacedPlantJSON): CatalogSize | null {
  const sizes = plant.sizes.filter((s) => s.modelName === p.plantModelName);
  if (!sizes.length) return null;
  if (p.containerType) {
    const match = sizes.find((s) => s.size === p.containerType);
    if (match) return match;
  }
  const scale = p.scaleX;
  if (scale != null) {
    return sizes.reduce((best, s) =>
      Math.abs(s.heightMultiplier - scale) < Math.abs(best.heightMultiplier - scale) ? s : best,
    );
  }
  return sizes[0];
}

/**
 * One row per plant and container size, keyed by the catalog name — never
 * by the plan code, which once merged different plants into one row. A
 * placement the catalog doesn't know is left off, as the headset leaves it.
 * Sorted by code, then name, then size in the order the plant offers them.
 */
export function plantSchedule(placements: PlacedPlantJSON[]): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow & { rank: number }>();
  for (const p of placements) {
    const plant = plantForModel(p.plantModelName);
    const size = plant ? restoredSize(plant, p) : null;
    if (!plant || !size) continue;
    const key = `${plant.name}|${size.size}`;
    const row = rows.get(key);
    if (row) {
      row.quantity += 1;
      continue;
    }
    rows.set(key, {
      code: speciesMeta(size.modelName).code,
      model: size.modelName,
      name: plant.name,
      size: size.size,
      quantity: 1,
      rank: plant.sizes.findIndex((s) => s.size === size.size),
    });
  }
  // Plain < on strings, not localeCompare: the headset sorts by Swift's
  // String ordering, which for these names is code-unit order.
  const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);
  return [...rows.values()]
    .sort((a, b) => cmp(a.code, b.code) || cmp(a.name, b.name) || cmp(a.rank, b.rank))
    .map(({ code, name, size, quantity, model }) => ({ code, name, size, quantity, model }));
}

// ── Fitting the schedule ──────────────────────────────────────────────────
//
// The title column is fixed: the schedule's heading at SCHEDULE_TOP, the
// title block at TITLE_BLOCK_TOP. A long schedule used to run straight on
// down — over the legends and into the title block — because its row size
// was picked from the row COUNT alone, never from the room.
//
// Now, in order: the largest row size that fits with the legends; then the
// legends go (they only repeat the map, where every feature and surface is
// labelled by name) and the largest size that fits without them; then, at
// the smallest size, as many rows as fit, the last line saying the rest
// continue on the next sheet.

/** The "PLANT SCHEDULE" heading. A fixed line, so the row maths can't hang
 *  on how tall a font happens to set the logo above it. */
export const SCHEDULE_TOP = SHEET.margin + 110;
/** The first schedule row: heading, rule, column heads, rule. */
export const SCHEDULE_FIRST_ROW = SCHEDULE_TOP + 25;
export const TITLE_BLOCK_TOP = SHEET.height - SHEET.margin - 140;
/** Row height and font size, largest first. */
export const SCHEDULE_TIERS: [number, number][] = [
  [11, 7],
  [9, 6.5],
  [8, 6],
  [7, 5.5],
];

/** The legends under the schedule: each a gap, heading, rule and a row per
 *  kind shown — and none at all for a kind the yard doesn't have. */
export function legendsHeight(featureTypes: number, surfaceStyles: number): number {
  const one = (n: number) => (n > 0 ? 14 + 10 + 5 + 14 * n : 0);
  return one(featureTypes) + one(surfaceStyles);
}

export type ScheduleFit = {
  rowHeight: number;
  fontSize: number;
  legends: boolean;
  /** rows on the first sheet; any more continue on the next */
  rowsOnSheet: number;
};

export function scheduleFit(rows: number, featureTypes: number, surfaceStyles: number): ScheduleFit {
  const bottom = TITLE_BLOCK_TOP - 8;
  for (const legends of [true, false]) {
    const room = bottom - SCHEDULE_FIRST_ROW - (legends ? legendsHeight(featureTypes, surfaceStyles) : 0);
    for (const [rowHeight, fontSize] of SCHEDULE_TIERS) {
      if (rows * rowHeight <= room) return { rowHeight, fontSize, legends, rowsOnSheet: rows };
    }
  }
  const [rowHeight, fontSize] = SCHEDULE_TIERS[SCHEDULE_TIERS.length - 1];
  // One slot kept for the "continued" line.
  const fit = Math.floor((bottom - SCHEDULE_FIRST_ROW) / rowHeight) - 1;
  return { rowHeight, fontSize, legends: false, rowsOnSheet: Math.max(0, fit) };
}

/** The continuation sheets: the rest of the schedule in three columns of
 *  11 pt rows, as many sheets as it takes. */
export const CONTINUED = {
  columns: 3,
  top: SHEET.margin + 56,
  rowHeight: 11,
  fontSize: 7,
  bottom: SHEET.height - SHEET.margin - 30,
} as const;

export const CONTINUED_ROWS_PER_COLUMN = Math.floor(
  (CONTINUED.bottom - (CONTINUED.top + 11)) / CONTINUED.rowHeight,
);

/** How many sheets the whole blueprint runs to. */
export function sheetCount(rows: number, fit: ScheduleFit): number {
  const rest = rows - fit.rowsOnSheet;
  return 1 + (rest > 0 ? Math.ceil(rest / (CONTINUED.columns * CONTINUED_ROWS_PER_COLUMN)) : 0);
}

/** The distinct feature kinds and surface styles the legends would show —
 *  every traced shape counts, as on the headset, closed or not. */
export function legendCounts(project: ProjectFileJSON) {
  return {
    featureTypes: new Set((project.featurePolygons ?? []).map((f) => f.featureType)).size,
    surfaceStyles: new Set(
      (project.hardscapeAreas ?? []).map((h) => surfaceStyle(h.style)?.case ?? "concrete"),
    ).size,
  };
}

// ── Plan labels ───────────────────────────────────────────────────────────
//
// A code on every plant, each at a fixed spot off its upper right, turned a
// dense bed into a pile of labels on top of each other. Planting plans don't
// do that, and nor does this:
//
//   • Plants of one kind whose canopies touch are one GROUP, joined by a thin
//     line through their centres, with one label: "6 LAY".
//   • Each label goes where there's room — beside the plant if that's clear,
//     else out in open space with a thin leader back to it.
//   • Lights carry no code. A fixture's mark already says what it is, and the
//     schedule's key names it.
//
// Placement is a search over candidate spots, scored against what's already
// there. It has to come out the same in the headset (BlueprintExporter.swift,
// planLabels), so it measures labels with a fixed width table rather than a
// font, works on positions rounded to a tenth of a point, and breaks every
// tie by order.

export const LABEL_SIZE = 7;
/** A label's box height, and its baseline below the box's centre. */
export const LABEL_BOX_H = 8;
export const LABEL_BASELINE = 2.5;

/** Kinds drawn as trees: lighter, tinted, beneath everything else. */
export const TREE_KINDS = new Set(["tree", "palm"]);

/** A label's width without a font, so both renderers place it alike. */
export function estimateWidth(text: string, size: number = LABEL_SIZE): number {
  let w = 0;
  for (const ch of text) w += ch === " " ? 0.3 : ch >= "0" && ch <= "9" ? 0.58 : 0.7;
  return w * size;
}

export type PlanLabel = {
  text: string;
  /** the box's centre, and its size */
  x: number;
  y: number;
  w: number;
  h: number;
  /** from the box's edge to the plant, or null when the label sits beside it */
  leader: [number, number, number, number] | null;
};

/** A thin line joining two plants of one group. */
export type PlanLink = [number, number, number, number];

const r1 = (n: number) => Math.round(n * 10) / 10;
/** sqrt rather than Math.hypot: a square root is correctly rounded on every
 *  platform, hypot is not — and the headset has to reach the same answers. */
const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));

type Spot = { x: number; y: number; R: number; code: string; kind: string };
type Box = { x: number; y: number; w: number; h: number };

const overlaps = (a: Box, b: Box, pad = 0) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + pad * 2;

const holds = (b: Box, x: number, y: number, pad = 0) =>
  Math.abs(x - b.x) * 2 <= b.w + pad * 2 && Math.abs(y - b.y) * 2 <= b.h + pad * 2;

function boxMeetsCircle(b: Box, x: number, y: number, r: number) {
  const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0);
  const dy = Math.max(Math.abs(y - b.y) - b.h / 2, 0);
  return dx * dx + dy * dy < r * r;
}

/** Whether the segment p→q passes through the box (Liang–Barsky). */
function segmentMeetsBox(px: number, py: number, qx: number, qy: number, b: Box) {
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dy = qy - py;
  const edges: [number, number][] = [
    [-dx, px - (b.x - b.w / 2)],
    [dx, b.x + b.w / 2 - px],
    [-dy, py - (b.y - b.h / 2)],
    [dy, b.y + b.h / 2 - py],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** How far apart two plants of a kind can stand and still be one group, past
 *  their canopies touching: a bed of golden barrels a few feet apart is
 *  "4 GB", as a planting plan would label it. */
export const GROUP_GAP_FT = 3;

/** Plants of one code within GROUP_GAP_FT of each other's canopies, in
 *  placement order. Lights are left out: they carry no label. */
export function plantGroups(marks: PlantMark[], ptPerFt: number): number[][] {
  const gap = r1(GROUP_GAP_FT * ptPerFt);
  const spots = marks.map((m) => ({ x: r1(m.x), y: r1(m.y), R: r1(m.R) }));
  const parent = marks.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].kind === "light") continue;
    for (let j = i + 1; j < marks.length; j++) {
      if (marks[j].kind === "light" || marks[j].code !== marks[i].code) continue;
      const d = dist(spots[i].x, spots[i].y, spots[j].x, spots[j].y);
      if (d <= spots[i].R + spots[j].R + gap) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].kind === "light") continue;
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }
  return [...groups.values()];
}

export function planLabels(
  project: ProjectFileJSON,
  layout: SheetLayout,
  marks: PlantMark[],
): { labels: PlanLabel[]; links: PlanLink[] } {
  const spots: Spot[] = marks.map((m) => ({ x: r1(m.x), y: r1(m.y), R: r1(m.R), code: m.code, kind: m.kind }));
  const groups = plantGroups(marks, layout.mapScale / METERS_TO_FEET);

  // The links: each group's minimum spanning tree, grown from its first plant.
  const links: PlanLink[] = [];
  for (const g of groups) {
    const inTree = [g[0]];
    const rest = g.slice(1);
    while (rest.length) {
      let best: [number, number, number] | null = null; // dist, from, restIndex
      for (const a of inTree) {
        rest.forEach((b, k) => {
          const d = dist(spots[a].x, spots[a].y, spots[b].x, spots[b].y);
          if (!best || d < best[0]) best = [d, a, k];
        });
      }
      const [, a, k] = best!;
      const b = rest.splice(k, 1)[0];
      inTree.push(b);
      links.push([spots[a].x, spots[a].y, spots[b].x, spots[b].y]);
    }
  }

  // What labels must keep clear of, besides each other: the feature and
  // surface names already printed on the map.
  const named: Box[] = [];
  const nameBox = (verts: { positionX: number; positionZ: number }[], text: string) => {
    const pts = verts.map((v) => layout.rotate(v.positionX, v.positionZ));
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const [x, y] = layout.toPDF(cx, cz);
    named.push({ x: r1(x), y: r1(y), w: estimateWidth(text, 9) + 8, h: 9 * 1.15 + 2 });
  };
  for (const f of project.featurePolygons ?? []) {
    if ((f.vertices ?? []).length < 3) continue;
    nameBox(f.vertices, f.featureType === "Other" ? (f.customLabel ?? "Other") : f.featureType);
  }
  for (const h of project.hardscapeAreas ?? []) {
    if ((h.vertices ?? []).length < 3) continue;
    nameBox(h.vertices, `${surfaceStyle(h.style)?.style ?? h.style} · 000 SQ FT`);
  }

  const { margin: M, titleColumnWidth: T, width: W, height: H } = SHEET;
  const map: Box = {
    x: (M + 16 + (W - M - T - 16)) / 2,
    y: (M + 20 + (H - M - 50)) / 2,
    w: W - M - T - 16 - (M + 16),
    h: H - M - 50 - (M + 20),
  };

  // Biggest groups first — they need the room most — then placement order.
  const order = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => b.g.length - a.g.length || a.i - b.i)
    .map(({ g }) => g);

  const labels: PlanLabel[] = [];
  for (const g of order) {
    // The plant nearest the group's middle carries the label.
    const cx = g.reduce((s, i) => s + spots[i].x, 0) / g.length;
    const cy = g.reduce((s, i) => s + spots[i].y, 0) / g.length;
    let anchor = g[0];
    for (const i of g) {
      if (dist(cx, cy, spots[i].x, spots[i].y) < dist(cx, cy, spots[anchor].x, spots[anchor].y)) {
        anchor = i;
      }
    }
    const a = spots[anchor];
    const text = g.length > 1 ? `${g.length} ${a.code}` : a.code;
    const w = r1(estimateWidth(text) + 2);
    const h = LABEL_BOX_H;

    type Candidate = { box: Box; leader: [number, number, number, number] | null; cost: number };
    const candidates: Candidate[] = [];
    // Beside the plant, where the viewer puts it.
    candidates.push({
      box: { x: r1(a.x + a.R * 0.72 + 3 + w / 2), y: r1(a.y - 3 - LABEL_BASELINE), w, h },
      leader: null,
      cost: 0,
    });
    // Out in the open, on rings round the plant, upper right first.
    const base = Math.min(a.R, 24);
    for (const step of [4, 12, 22, 34, 48]) {
      const D = base + step;
      for (let k = 0; k < 16; k++) {
        const ang = -Math.PI / 4 + (k * Math.PI) / 8;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const box = { x: r1(a.x + c * (D + w / 2)), y: r1(a.y + s * (D + h / 2)), w, h };
        // The leader runs to whichever plant of the group is nearest, so it
        // stays short and ends where the group begins.
        let to = g[0];
        for (const i of g) {
          if (dist(box.x, box.y, spots[i].x, spots[i].y) < dist(box.x, box.y, spots[to].x, spots[to].y)) {
            to = i;
          }
        }
        const t = spots[to];
        const ex = Math.min(Math.max(t.x, box.x - w / 2), box.x + w / 2);
        const ey = Math.min(Math.max(t.y, box.y - h / 2), box.y + h / 2);
        candidates.push({ box, leader: [r1(ex), r1(ey), t.x, t.y], cost: 3 + D * 0.2 + k * 0.01 });
      }
    }

    let best: Candidate | null = null;
    for (const cand of candidates) {
      let cost = cand.cost;
      const b = cand.box;
      if (!(b.x - b.w / 2 >= map.x - map.w / 2 && b.x + b.w / 2 <= map.x + map.w / 2 &&
            b.y - b.h / 2 >= map.y - map.h / 2 && b.y + b.h / 2 <= map.y + map.h / 2)) cost += 1000;
      for (const l of labels) {
        if (overlaps(b, l, 1.5)) cost += 1000;
        if (cand.leader && segmentMeetsBox(...cand.leader, l)) cost += 200;
      }
      for (const n of named) if (overlaps(b, n)) cost += 300;
      spots.forEach((p, i) => {
        if (holds(b, p.x, p.y, 1)) cost += 40;
        else if (!TREE_KINDS.has(p.kind) && !g.includes(i) && boxMeetsCircle(b, p.x, p.y, p.R * 0.85)) cost += 6;
      });
      if (!best || cost < best.cost) best = { ...cand, cost };
    }
    labels.push({ text, ...best!.box, leader: best!.leader });
  }
  return { labels, links };
}
