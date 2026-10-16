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
import { speciesMeta } from "@/lib/viewer/catalog";
import { symbolFor, type PlanSymbol } from "@/lib/viewer/symbols";
import type { PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";
import { METERS_TO_FEET } from "@/lib/viewer/types";

/** US Letter, landscape, in points — the headset's page. */
export const SHEET = {
  width: 792,
  height: 612,
  margin: 20,
  titleColumnWidth: 148,
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

export type ScheduleRow = { code: string; name: string; size: string; quantity: number };

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
    .map(({ code, name, size, quantity }) => ({ code, name, size, quantity }));
}
