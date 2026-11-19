// The builder's geometry: plan metres ↔ screen pixels, snapping, squaring
// up, and typed lengths. Pure functions.

import { FEET_PER_METER, type XZ } from "@/lib/site-plan/plan";
import type { Pt } from "./drawing";

/** Where the sheet looks: the plan point at the centre of the screen, and
 *  how many pixels a metre is. North is up (z south is down the screen). */
export type View = { cx: number; cz: number; ppm: number };
export type Size = { w: number; h: number };

export const MIN_PPM = 0.6;
export const MAX_PPM = 60;

export const toScreen = (v: View, s: Size, [x, z]: XZ): Pt => [
  (x - v.cx) * v.ppm + s.w / 2,
  (z - v.cz) * v.ppm + s.h / 2,
];
export const toPlan = (v: View, s: Size, [sx, sy]: Pt): XZ => [
  (sx - s.w / 2) / v.ppm + v.cx,
  (sy - s.h / 2) / v.ppm + v.cz,
];

/** A view that shows the whole of a box, with a little room. */
export function fitView(box: { cx: number; cz: number; halfWidth: number; halfHeight: number }, s: Size): View {
  const ppm = Math.min(s.w / (box.halfWidth * 2.15), s.h / (box.halfHeight * 2.15));
  return { cx: box.cx, cz: box.cz, ppm: Math.min(MAX_PPM, Math.max(MIN_PPM, ppm)) };
}

/* ── Plane geometry ──────────────────────────────────────────────── */

const sub = (a: XZ, b: XZ): XZ => [a[0] - b[0], a[1] - b[1]];
const dot = (a: XZ, b: XZ) => a[0] * b[0] + a[1] * b[1];
export const dist = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The nearest point to p on segment a–b, and how far it is. */
export function nearestOnSegment(p: XZ, a: XZ, b: XZ): { q: XZ; d: number } {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
  const q: XZ = [a[0] + ab[0] * t, a[1] + ab[1] * t];
  return { q, d: dist(p, q) };
}

export function pointInPolygon(p: XZ, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function rotateAbout(points: XZ[], c: XZ, angle: number): XZ[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map(([x, z]) => {
    const dx = x - c[0];
    const dz = z - c[1];
    return [c[0] + dx * cos - dz * sin, c[1] + dx * sin + dz * cos];
  });
}

/** Where two lines (point + direction) meet, or null when near parallel. */
function meet(p: XZ, u: XZ, q: XZ, v: XZ): XZ | null {
  const den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 0.05) return null;
  const t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den;
  return [p[0] + u[0] * t, p[1] + u[1] * t];
}

/* ── Snapping ────────────────────────────────────────────────────── */

/** Directions to square up to: each mod a quarter turn, in radians. */
export function referenceAngles(runs: XZ[][], closed: boolean[]): number[] {
  const out: number[] = [0];
  runs.forEach((pts, r) => {
    const n = closed[r] ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (dist(a, b) < 1) continue; // short edges are corner noise
      const ang = mod(Math.atan2(b[1] - a[1], b[0] - a[0]), Math.PI / 2);
      if (!out.some((o) => angleGap(o, ang) < (0.5 * Math.PI) / 180)) out.push(ang);
    }
  });
  return out;
}

const mod = (a: number, m: number) => ((a % m) + m) % m;
/** The gap between two directions, each mod a quarter turn. */
const angleGap = (a: number, b: number) => {
  const d = mod(a - b, Math.PI / 2);
  return Math.min(d, Math.PI / 2 - d);
};

export type SnapKind = "corner" | "edge" | "square" | "square+edge" | null;
export type Snapped = { p: XZ; kind: SnapKind; guide?: [XZ, XZ] };

export interface SnapContext {
  corners: XZ[];
  edges: [XZ, XZ][];
  angles: number[];
  /** Pixels per metre, so the reach is the same on screen at any zoom. */
  ppm: number;
}

const CORNER_PX = 10;
const EDGE_PX = 7;
const SQUARE_DEG = 3;

/**
 * Where a click at `p` lands: on a corner if one is close; on a square
 * line from `from` (the last corner) where the new edge is within a few
 * degrees of square to the house or the lot — onto an edge too, where
 * that line crosses one; else on an edge.
 */
export function snap(p: XZ, from: XZ | null, ctx: SnapContext): Snapped {
  const reachC = CORNER_PX / ctx.ppm;
  const reachE = EDGE_PX / ctx.ppm;
  let best: XZ | null = null;
  let bestD = reachC;
  for (const c of ctx.corners) {
    const d = dist(p, c);
    if (d < bestD) [best, bestD] = [c, d];
  }
  if (best) return { p: best, kind: "corner" };

  let edgeHit: { q: XZ; a: XZ; b: XZ } | null = null;
  let edgeD = reachE;
  for (const [a, b] of ctx.edges) {
    const { q, d } = nearestOnSegment(p, a, b);
    if (d < edgeD) [edgeHit, edgeD] = [{ q, a, b }, d];
  }

  if (from && dist(p, from) * ctx.ppm > 15) {
    const ang = Math.atan2(p[1] - from[1], p[0] - from[0]);
    let snapAng: number | null = null;
    let gap = (SQUARE_DEG * Math.PI) / 180;
    for (const ref of ctx.angles) {
      const g = angleGap(ang, ref);
      if (g < gap) {
        gap = g;
        // The ref direction (mod a quarter turn) nearest the cursor's.
        const k = Math.round((ang - ref) / (Math.PI / 2));
        snapAng = ref + (k * Math.PI) / 2;
      }
    }
    if (snapAng != null) {
      const u: XZ = [Math.cos(snapAng), Math.sin(snapAng)];
      const t = dot(sub(p, from), u);
      const q: XZ = [from[0] + u[0] * t, from[1] + u[1] * t];
      if (edgeHit) {
        const x = meet(from, u, edgeHit.a, sub(edgeHit.b, edgeHit.a));
        if (x && dist(x, p) < reachE * 1.5) return { p: x, kind: "square+edge", guide: [from, x] };
      }
      return { p: q, kind: "square", guide: [from, q] };
    }
  }
  if (edgeHit) return { p: edgeHit.q, kind: "edge" };
  return { p, kind: null };
}

/**
 * Squares a traced shape: every edge within 15° of square to the longest
 * edge is turned to exactly square, about its own middle, and the corners
 * are where the new edges meet. Edges further off (a bay, a angled wing)
 * are kept as drawn.
 */
export function squareUp(points: XZ[], closed: boolean): XZ[] {
  const n = points.length;
  if (n < 3 && closed) return points;
  const edges = closed ? n : n - 1;
  let longest = 0;
  let base = 0;
  for (let i = 0; i < edges; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const l = dist(a, b);
    if (l > longest) [longest, base] = [l, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }
  const lines = Array.from({ length: edges }, (_, i) => {
    const a = points[i];
    const b = points[(i + 1) % n];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const k = Math.round((ang - base) / (Math.PI / 2));
    const square = base + (k * Math.PI) / 2;
    const use = Math.abs(ang - square) < (15 * Math.PI) / 180 ? square : ang;
    const mid: XZ = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return { mid, u: [Math.cos(use), Math.sin(use)] as XZ };
  });
  return points.map((p, i) => {
    const before = closed ? lines[(i - 1 + edges) % edges] : lines[i - 1];
    const after = lines[i];
    if (!before || !after) {
      // An open run's ends slide onto their one edge.
      const line = before ?? after;
      const t = dot(sub(p, line.mid), line.u);
      return [line.mid[0] + line.u[0] * t, line.mid[1] + line.u[1] * t];
    }
    return meet(before.mid, before.u, after.mid, after.u) ?? p;
  });
}

/* ── Lengths ─────────────────────────────────────────────────────── */

/**
 * A typed length in feet and inches, as metres: 42, 42.5, 42', 42'6,
 * 42' 6", 42 6, 6". Null when it doesn't read as a length.
 */
export function parseLength(text: string): number | null {
  const t = text.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  let feet = 0;
  let inches = 0;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*"$/))) inches = Number(m[1]);
  else if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?$/))) feet = Number(m[1]);
  else if ((m = t.match(/^(\d+)\s*(?:'|ft)?\s+(\d+(?:\.\d+)?)\s*(?:"|in)?$/)) || (m = t.match(/^(\d+)\s*'\s*(\d+(?:\.\d+)?)\s*"?$/))) {
    feet = Number(m[1]);
    inches = Number(m[2]);
  } else return null;
  const total = feet + inches / 12;
  return total > 0 ? total / FEET_PER_METER : null;
}

export function feetInches(meters: number): string {
  const totalInches = Math.round(meters * FEET_PER_METER * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return inches === 0 ? `${feet}′` : `${feet}′ ${inches}″`;
}

export function sqFt(m2: number): string {
  return `${Math.round(m2 * 10.7639).toLocaleString("en-US")} sq ft`;
}
