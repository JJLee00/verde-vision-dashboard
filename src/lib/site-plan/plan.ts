// The site plan: everything already in the yard — house, pool, patio,
// fences, the lot — traced at a desk over the satellite photo. Stored in
// `projects.blueprint_payload` as version 2 (version 1 was a house and a
// lot, from the House outline card). Pure data; no React, no Node.
//
// Coordinates are the app's geo frame: metres from `origin`, x east,
// z south (see BlueprintCandidate.parcelXZ). The origin is set once, when
// the designer locks the view, and never recomputed — moving a shape never
// moves the frame, so nothing placed against it can shift.
//
// On site the headset's corner walk fits this frame into the yard and every
// shape becomes an ordinary feature there (OutlinePlacement.swift). Headsets
// that predate `features` read `candidate`, derived here, and get the house
// and the lot exactly as before.

import type { StoredBlueprint } from "@/lib/blueprint/stored";
import type { BlueprintCandidate, LatLng } from "@/lib/blueprint/types";
import type { MapOffset } from "@/lib/blueprint/trace";

/** The headset's FeatureType raw values (Boundarypoint.swift), in its order. */
export const FEATURE_TYPES = [
  "House",
  "Pool",
  "Driveway",
  "Patio",
  "Fence",
  "Shed",
  "Garage",
  "Walkway",
  "Deck",
  "AC Unit",
  "Retaining Wall",
  "Fire Pit",
  "Other",
] as const;
export type FeatureType = (typeof FEATURE_TYPES)[number];

/** Fences and retaining walls are runs, not areas: drawn and kept open. */
export const LINE_TYPES: readonly FeatureType[] = ["Fence", "Retaining Wall"];
export const isLineType = (t: FeatureType) => LINE_TYPES.includes(t);

export type XZ = [number, number];

/**
 * area   — a closed shape, corners in order
 * line   — an open run, two or more points
 * circle — `points` is [centre], with `radius`
 */
export type PlanShape = "area" | "line" | "circle";

export interface PlanFeature {
  /** A UUID. On the walk it becomes the headset feature's id, so both
   *  sides name the shape the same way. */
  id: string;
  type: FeatureType;
  /** Only for "Other": what it is. */
  label?: string;
  shape: PlanShape;
  points: XZ[];
  radius?: number;
  /** Which corners are smooth — the outline curves through them rather
   *  than turning there — one per point; absent is all sharp. See
   *  `edgeCurves`. */
  smooth?: boolean[];
  /** Locked at the desk so it can't be moved by accident. Dashboard-only. */
  locked?: boolean;
}

/** The locked picture: the rectangle of photo the plan is traced on,
 *  centred at (cx, cz) in plan metres. */
export interface PlanFrame {
  cx: number;
  cz: number;
  halfWidth: number;
  halfHeight: number;
}

export type UnderlayKind = "satellite" | "map" | "none";

export interface SitePlan {
  version: 2;
  /** "trace", or the v1 provider the plan was upgraded from. */
  provider: string;
  /** What the address search found; may be empty. */
  lookupAddress: string;
  origin: LatLng;
  frame: PlanFrame;
  underlay: { kind: UnderlayKind; opacity: number };
  /** How far the Map view is shifted to agree with the satellite here
   *  (trace.ts MapOffset). Dashboard-only. */
  mapOffset?: MapOffset;
  /** The lot, as a closed shape; empty when not traced. */
  boundary: XZ[];
  /** The lot's smooth corners, like a feature's `smooth`. */
  boundarySmooth?: boolean[];
  boundaryLocked?: boolean;
  features: PlanFeature[];
  /** The House the headset walks, when there's more than one. Absent:
   *  the first House. */
  mainHouseId?: string;
  /** Derived from the rest for headsets that predate `features`. */
  candidate: BlueprintCandidate;
}

/** What the builder edits; the rest of SitePlan is derived or fixed. */
export type PlanDraft = Omit<SitePlan, "version" | "candidate">;

/* ── Limits ──────────────────────────────────────────────────────── */

/** A shape this far from the origin is a stray click, not a yard. */
export const MAX_REACH_M = 1000;
const MAX_FEATURES = 300;
const MAX_POINTS = 200;
/** Corners closer than this are a double click, not two corners. */
const MIN_EDGE_M = 0.1;
const MIN_RADIUS_M = 0.15;
/** Circles reach the headset, which only knows corners, as this many. */
const CIRCLE_SIDES = 24;
/** Curves reach it as corners about this far apart, in metres. */
const CURVE_STEP_M = 0.5;

export const SQ_FT_PER_SQ_M = 10.7639;
export const FEET_PER_METER = 3.28084;

/* ── Geometry ────────────────────────────────────────────────────── */

export function polygonArea(points: XZ[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[(i + 1) % points.length];
    twice += x0 * z1 - x1 * z0;
  }
  return Math.abs(twice) / 2;
}

export function pathLength(points: XZ[], closed: boolean): number {
  let total = 0;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[(i + 1) % points.length];
    total += Math.hypot(x1 - x0, z1 - z0);
  }
  return total;
}

/** Area centroid, or the corner average for a sliver. */
export function centroid(points: XZ[]): XZ {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[(i + 1) % points.length];
    const f = x0 * z1 - x1 * z0;
    a += f;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = points.length || 1;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

/** Whether any two non-adjacent edges cross. */
export function crosses(points: XZ[], closed: boolean): boolean {
  const n = points.length;
  const edges = closed ? n : n - 1;
  const side = (a: XZ, b: XZ, c: XZ) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < edges; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    for (let j = i + 1; j < edges; j++) {
      // Edges that share a corner always "touch" there.
      if (j === i + 1 || (closed && i === 0 && j === edges - 1)) continue;
      const c = points[j];
      const d = points[(j + 1) % n];
      const d1 = side(a, b, c);
      const d2 = side(a, b, d);
      const d3 = side(c, d, a);
      const d4 = side(c, d, b);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
      }
    }
  }
  return false;
}

/** A circle as the corners the headset can take. */
export function circleCorners(centre: XZ, radius: number, sides = CIRCLE_SIDES): XZ[] {
  return Array.from({ length: sides }, (_, i) => {
    const t = (i / sides) * Math.PI * 2;
    return [centre[0] + radius * Math.cos(t), centre[1] + radius * Math.sin(t)] as XZ;
  });
}

/**
 * The curve along each edge of a run whose corners may be smooth: null for
 * a straight edge, else the edge's two cubic Bézier control points. The
 * curve passes through a smooth corner square to the bisector of its two
 * edges, so there's no kink there; a sharp corner keeps its point. An edge
 * with one smooth end leaves its sharp end at the mirror angle, so three
 * points — sharp, smooth, sharp — make an even arc. An open run's ends are
 * always sharp. Works on screen pixels the same way.
 */
export function edgeCurves(points: XZ[], smooth: boolean[] | undefined, closed: boolean): ([XZ, XZ] | null)[] {
  const n = points.length;
  const edges = closed ? n : n - 1;
  if (!smooth?.some(Boolean)) return Array(Math.max(0, edges)).fill(null);
  const isSmooth = (i: number) => !!smooth[i] && (closed || (i > 0 && i < n - 1));
  const unit = ([x, z]: XZ): XZ => {
    const l = Math.hypot(x, z);
    return l < 1e-9 ? [0, 0] : [x / l, z / l];
  };
  const tangent = (i: number): XZ => {
    const p = points[i];
    const a = unit([p[0] - points[(i - 1 + n) % n][0], p[1] - points[(i - 1 + n) % n][1]]);
    const b = unit([points[(i + 1) % n][0] - p[0], points[(i + 1) % n][1] - p[1]]);
    const t = unit([a[0] + b[0], a[1] + b[1]]);
    // A corner that doubles straight back has no bisector: go on along the next edge.
    return t[0] === 0 && t[1] === 0 ? b : t;
  };
  // The direction mirrored across the edge's own line.
  const mirror = (d: XZ, c: XZ): XZ => {
    const k = 2 * (d[0] * c[0] + d[1] * c[1]);
    return [k * c[0] - d[0], k * c[1] - d[1]];
  };
  return Array.from({ length: edges }, (_, i) => {
    const j = (i + 1) % n;
    if (!isSmooth(i) && !isSmooth(j)) return null;
    const a = points[i];
    const b = points[j];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) return null;
    const c: XZ = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let da = isSmooth(i) ? tangent(i) : null;
    let db = isSmooth(j) ? tangent(j) : null;
    da ??= mirror(db!, c);
    db ??= mirror(da, c);
    const k = len / 3;
    return [
      [a[0] + da[0] * k, a[1] + da[1] * k],
      [b[0] - db[0] * k, b[1] - db[1] * k],
    ];
  });
}

/** The point a share `t` along a cubic Bézier. */
export function bezierAt(a: XZ, c1: XZ, c2: XZ, b: XZ, t: number): XZ {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [
    w[0] * a[0] + w[1] * c1[0] + w[2] * c2[0] + w[3] * b[0],
    w[0] * a[1] + w[1] * c1[1] + w[2] * c2[1] + w[3] * b[1],
  ];
}

/** Each edge as the corners it's drawn through, both ends included: two
 *  for a straight edge, a piece at most `step` long along a curve. */
export function edgeRuns(points: XZ[], smooth: boolean[] | undefined, closed: boolean, step = CURVE_STEP_M): XZ[][] {
  return edgeCurves(points, smooth, closed).map((curve, i) => {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!curve) return [a, b];
    const n = Math.min(32, Math.max(4, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)));
    return Array.from({ length: n + 1 }, (_, k) => (k === 0 ? a : k === n ? b : bezierAt(a, curve[0], curve[1], b, k / n)));
  });
}

/** The corners of a run with its curves filled in. */
export function withCurves(points: XZ[], smooth: boolean[] | undefined, closed: boolean, step = CURVE_STEP_M): XZ[] {
  if (!smooth?.some(Boolean)) return points;
  const runs = edgeRuns(points, smooth, closed, step);
  const out = runs.flatMap((run) => run.slice(0, -1));
  if (!closed) out.push(points[points.length - 1]);
  return out;
}

/** The House the headset walks: the chosen one, else the first. */
export function mainHouse(plan: Pick<PlanDraft, "features" | "mainHouseId">): PlanFeature | null {
  const houses = plan.features.filter((f) => f.type === "House" && f.shape !== "line");
  return houses.find((f) => f.id === plan.mainHouseId) ?? houses[0] ?? null;
}

/** A feature's corners as an outline: a circle as its 24 corners, a
 *  curve as a corner every half metre or so. */
export function outlineOf(f: Pick<PlanFeature, "shape" | "points" | "radius" | "smooth">): XZ[] {
  return f.shape === "circle" ? circleCorners(f.points[0], f.radius ?? 0) : withCurves(f.points, f.smooth, f.shape === "area");
}

/** The lot's outline, curves and all. */
export const boundaryOutline = (plan: Pick<PlanDraft, "boundary" | "boundarySmooth">): XZ[] =>
  withCurves(plan.boundary, plan.boundarySmooth, true);

/* ── Building and reading ────────────────────────────────────────── */

/** The candidate today's headsets read: the main house and the lot. */
export function candidateFor(draft: PlanDraft): BlueprintCandidate {
  const house = mainHouse(draft);
  const houseXZ = house ? outlineOf(house) : null;
  const label = draft.lookupAddress;
  return {
    // No parcel number: nothing was looked up. The headset only ever
    // displays it, and an empty one reads as absent there.
    apn: "",
    address: label,
    centroid: draft.origin,
    parcelXZ: boundaryOutline(draft),
    // Required by the headset's decoder; a trace knows no county facts.
    attributes: {},
    houseXZ,
    houseAreaSqFt: houseXZ ? Math.round(polygonArea(houseXZ) * SQ_FT_PER_SQ_M) : null,
    imagery: null,
    warnings: [],
  };
}

export function finishPlan(draft: PlanDraft): SitePlan {
  return { version: 2, ...draft, candidate: candidateFor(draft) };
}

/** A shape the server refused, with a message for the designer. */
export class PlanError extends Error {}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parsePoints(raw: unknown, what: string): XZ[] {
  if (!Array.isArray(raw) || raw.length > MAX_POINTS) {
    throw new PlanError(`${what} has too many corners.`);
  }
  const out: XZ[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || !num(p[0]) || !num(p[1])) throw new PlanError(`${what} has a bad corner.`);
    if (Math.hypot(p[0], p[1]) > MAX_REACH_M) {
      throw new PlanError(`A corner of the ${what.toLowerCase()} landed far from the rest. Check for a stray click.`);
    }
    const prev = out[out.length - 1];
    // A double click, not two corners.
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < MIN_EDGE_M) continue;
    out.push([p[0], p[1]]);
  }
  return out;
}

/** Which corners are smooth, or undefined when none are. An open run's
 *  ends are always sharp. */
function parseSmooth(raw: unknown, points: XZ[], closed: boolean, what: string): boolean[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw) || raw.length !== points.length || !raw.every((b) => typeof b === "boolean")) {
    throw new PlanError(`${what} has a bad curve.`);
  }
  const out = raw.map((b, i) => b && (closed || (i > 0 && i < points.length - 1)));
  return out.some(Boolean) ? out : undefined;
}

/** Checks a draft from the browser, shape by shape, into a clean plan. */
export function parseDraft(raw: unknown): PlanDraft {
  const d = raw as Partial<PlanDraft> | null;
  if (!d || typeof d !== "object") throw new PlanError("Nothing to save.");
  if (!d.origin || !num(d.origin.lat) || !num(d.origin.lng) || Math.abs(d.origin.lat) > 90 || Math.abs(d.origin.lng) > 180) {
    throw new PlanError("The plan has no place on the map. Lock the view first.");
  }
  const f = d.frame as Partial<PlanFrame> | undefined;
  if (!f || ![f.cx, f.cz, f.halfWidth, f.halfHeight].every(num) || f.halfWidth! <= 0 || f.halfHeight! <= 0) {
    throw new PlanError("The plan's view is missing. Lock the view again.");
  }
  if (Math.abs(f.cx!) + f.halfWidth! > MAX_REACH_M || Math.abs(f.cz!) + f.halfHeight! > MAX_REACH_M) {
    throw new PlanError("The photo frame reaches too far. Drag its edges in.");
  }
  const kind: UnderlayKind = (["satellite", "map", "none"] as const).find((k) => k === d.underlay?.kind) ?? "satellite";
  const opacity = num(d.underlay?.opacity) ? Math.min(1, Math.max(0, d.underlay!.opacity)) : 1;

  let boundary = parsePoints(d.boundary ?? [], "Yard boundary");
  if (boundary.length > 0 && boundary.length < 3) boundary = [];
  // A dropped corner shifts every one after it, so the curves only hold
  // when every corner came through.
  const boundarySmooth =
    boundary.length >= 3 && boundary.length === (d.boundary ?? []).length
      ? parseSmooth(d.boundarySmooth, boundary, true, "Yard boundary")
      : undefined;
  if (boundary.length >= 3 && crosses(withCurves(boundary, boundarySmooth, true), true)) {
    throw new PlanError("The yard boundary crosses itself. Drag the corners so the edges don't cross.");
  }

  if (!Array.isArray(d.features) || d.features.length > MAX_FEATURES) {
    throw new PlanError("The plan has too many shapes.");
  }
  const seen = new Set<string>();
  const features: PlanFeature[] = [];
  for (const raw of d.features as Partial<PlanFeature>[]) {
    const type = FEATURE_TYPES.find((t) => t === raw?.type);
    if (!type) throw new PlanError("A shape has an unknown type.");
    const name = type === "Other" ? (raw.label?.trim() || "Other") : type;
    if (typeof raw.id !== "string" || !/^[0-9a-f-]{36}$/i.test(raw.id) || seen.has(raw.id)) {
      throw new PlanError(`The ${name.toLowerCase()} has a bad id.`);
    }
    seen.add(raw.id);
    const shape: PlanShape | undefined = (["area", "line", "circle"] as const).find((s) => s === raw.shape);
    if (!shape || (isLineType(type) !== (shape === "line"))) {
      throw new PlanError(`The ${name.toLowerCase()} is the wrong kind of shape.`);
    }
    const points = parsePoints(raw.points, name);
    const feature: PlanFeature = { id: raw.id.toLowerCase(), type, shape, points };
    if (type === "Other" && raw.label?.trim()) feature.label = raw.label.trim().slice(0, 60);
    if (raw.locked === true) feature.locked = true;
    if (shape !== "circle" && points.length === (raw.points as unknown[]).length) {
      const smooth = parseSmooth(raw.smooth, points, shape === "area", name);
      if (smooth) feature.smooth = smooth;
    }
    if (shape === "circle") {
      if (points.length !== 1 || !num(raw.radius) || raw.radius < MIN_RADIUS_M || raw.radius > 100) {
        throw new PlanError(`The ${name.toLowerCase()} needs a centre and a size.`);
      }
      feature.radius = raw.radius;
    } else if (shape === "line") {
      if (points.length < 2) throw new PlanError(`The ${name.toLowerCase()} needs two points or more.`);
      if (crosses(outlineOf(feature), false)) throw new PlanError(`The ${name.toLowerCase()} crosses itself.`);
    } else {
      if (points.length < 3) throw new PlanError(`The ${name.toLowerCase()} needs three corners or more.`);
      if (crosses(outlineOf(feature), true)) {
        throw new PlanError(`The ${name.toLowerCase()} crosses itself. Drag the corners so the edges don't cross.`);
      }
    }
    features.push(feature);
  }

  const mainHouseId =
    typeof d.mainHouseId === "string" && features.some((x) => x.id === d.mainHouseId && x.type === "House")
      ? d.mainHouseId
      : undefined;
  const offset = d.mapOffset;
  const mapOffset =
    offset && num(offset.east) && num(offset.north) && Math.hypot(offset.east, offset.north) <= 100
      ? { east: offset.east, north: offset.north }
      : undefined;

  return {
    provider: typeof d.provider === "string" && d.provider ? d.provider.slice(0, 40) : "trace",
    lookupAddress: typeof d.lookupAddress === "string" ? d.lookupAddress.trim().slice(0, 300) : "",
    origin: { lat: d.origin.lat, lng: d.origin.lng },
    frame: { cx: f.cx!, cz: f.cz!, halfWidth: f.halfWidth!, halfHeight: f.halfHeight! },
    underlay: { kind, opacity },
    ...(mapOffset ? { mapOffset } : {}),
    boundary,
    ...(boundarySmooth ? { boundarySmooth } : {}),
    ...(boundary.length >= 3 && d.boundaryLocked === true ? { boundaryLocked: true } : {}),
    features,
    ...(mainHouseId ? { mainHouseId } : {}),
  };
}

/** The House of an upgraded version-1 outline. Fixed, so the plan reads
 *  the same on every load until it's saved as version 2; ids only need to
 *  be unique within a project. */
const V1_HOUSE_ID = "00000000-0000-4000-8000-000000000001";

/** Room around the shapes when a plan has to frame itself. */
const FRAME_MARGIN_M = 12;

/** A frame around these points, or a plain 60 m square at the origin. */
export function frameAround(points: XZ[]): PlanFrame {
  if (points.length === 0) return { cx: 0, cz: 0, halfWidth: 30, halfHeight: 30 };
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return {
    cx: (x0 + x1) / 2,
    cz: (z0 + z1) / 2,
    halfWidth: (x1 - x0) / 2 + FRAME_MARGIN_M,
    halfHeight: (z1 - z0) / 2 + FRAME_MARGIN_M,
  };
}

/**
 * The stored column as a plan: version 2 as it is, a version 1 outline (a
 * house and a lot) as a plan of one House and that lot — on its own
 * centroid, so nothing already placed from it shifts. Null for none or
 * a malformed one.
 */
export function readPlan(raw: unknown): SitePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<SitePlan> & Partial<StoredBlueprint>;
  if (value.version === 2) {
    try {
      return finishPlan(parseDraft(value));
    } catch {
      return null;
    }
  }
  const c = value.candidate;
  if (typeof value.provider !== "string" || !c || !Array.isArray(c.parcelXZ) || !c.centroid) return null;
  const house = c.houseXZ && c.houseXZ.length >= 3 ? c.houseXZ : null;
  const boundary = c.parcelXZ.length >= 3 ? c.parcelXZ : [];
  const draft: PlanDraft = {
    provider: value.provider,
    lookupAddress: value.lookupAddress ?? c.address ?? "",
    origin: c.centroid,
    frame: frameAround([...(house ?? []), ...boundary]),
    underlay: { kind: "satellite", opacity: 1 },
    ...(value.mapOffset ? { mapOffset: value.mapOffset } : {}),
    boundary,
    features: house ? [{ id: V1_HOUSE_ID, type: "House", shape: "area", points: house }] : [],
  };
  return finishPlan(draft);
}

/* ── For the headset ─────────────────────────────────────────────── */

/** A plan shape as the headset takes it: corners only, open or closed. */
export interface HeadsetFeature {
  id: string;
  featureType: FeatureType;
  customLabel: string | null;
  /** Geo-frame metres, like candidate.houseXZ. */
  pointsXZ: XZ[];
  isClosed: boolean;
}

/** Every shape on the plan for `/api/vision-pro/projects`, circles and
 *  curves as corners. The main house is first, the shape the walk is made on. */
export function headsetFeatures(plan: SitePlan): HeadsetFeature[] {
  const main = mainHouse(plan);
  const ordered = main ? [main, ...plan.features.filter((f) => f !== main)] : plan.features;
  return ordered.map((f) => ({
    id: f.id,
    featureType: f.type,
    customLabel: f.type === "Other" ? (f.label ?? null) : null,
    pointsXZ: outlineOf(f),
    isClosed: f.shape !== "line",
  }));
}
