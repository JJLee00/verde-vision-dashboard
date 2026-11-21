// The yard as the WebGL layer draws it, in the canvas's order (see
// `render` in LivingBlueprint): the ground and its grid, paving with its
// hatch or dots, the pool and its rings, flat features, the boundary,
// removal marks, and the house standing up out of it all.
//
// The shapes are laid out once. Their outlines are laid out each frame:
// a dashed line's dashes run on round the shape as the canvas's do, so
// where each side's dashes start depends on how long the sides before it
// are on screen.

import { earcut, rgba, type Rgba } from "./geom";
import { MeshBuilder, type Built } from "./mesh";

export type GLYard = {
  /** The ground's outline, and the square its grid is laid over. */
  ground: { pts: [number, number][]; x0: number; x1: number; z0: number; z1: number };
  boundary: [number, number][];
  features: { kind: string; pts: [number, number][] }[];
  hardscape: { style: string; pts: [number, number][] }[];
  removals: { x: number; z: number; r: number }[];
};

const SAND: Rgba = [235, 224, 203, 255];
const GROUND: Rgba = [228, 216, 188, 255];
const GRID = rgba("rgba(46,93,67,0.09)");
const PAVING = rgba("#e8ddc2");
export const WATER_FILL = rgba("rgba(122,163,178,0.55)");
export const WATER_LINE = rgba("#5e93a8");
const CLAY = rgba("#b0552f");
const WALL = rgba("#ddd0b2");
const ROOF = rgba("#e6dbc0");
const verde = (a: number) => rgba(`rgba(46,93,67,${a})`);
export { SAND, GRID };

const STRUCTURES = ["House", "Garage", "Shed"];

/** A part of the yard: a fill (flat, or standing, in depth), a pattern over
 *  a fill, or an outline. */
type Part =
  | { k: "fill"; first: number; count: number; depth: boolean }
  | { k: "pattern"; first: number; count: number; pts: [number, number][]; dots: boolean; spacing: number; col: Rgba }
  | { k: "line"; pts: [number, number][]; y: number; closed: boolean; width: number; col: Rgba; dash?: [number, number]; depth: boolean }
  | { k: "removal"; x: number; z: number; r: number };

export type YardShapes = {
  built: Built;
  /** The ground: its stencil fan, the square over it, the grid's lines —
   *  first and count, in indices. */
  ground: { fan: [number, number]; cover: [number, number]; grid: [number, number] };
  parts: Part[];
};

const shrink = (pts: [number, number][], f: number): [number, number][] => {
  let sx = 0;
  let sz = 0;
  for (const [x, z] of pts) {
    sx += x;
    sz += z;
  }
  sx /= pts.length;
  sz /= pts.length;
  return pts.map(([x, z]) => [sx + (x - sx) * f, sz + (z - sz) * f]);
};

export function yardKey(y: GLYard) {
  return JSON.stringify(y);
}

export function buildYard(y: GLYard): YardShapes {
  const b = new MeshBuilder();
  const parts: Part[] = [];

  // The ground: a fan of its outline, which the stencil fills even-odd so
  // any shape works; the square over it; the five-foot grid.
  const gr = y.ground;
  const g0 = b.tri.length;
  const gb = b.verts;
  for (const [x, z] of gr.pts) b.vert(x, 0, z, GROUND, GROUND);
  for (let i = 1; i < gr.pts.length - 1; i++) b.tri.push(gb, gb + i, gb + i + 1);
  const g1 = b.tri.length;
  const xs = gr.pts.map((p) => p[0]);
  const zs = gr.pts.map((p) => p[1]);
  const [a, bb, c, d] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const q = b.verts;
  for (const [x, z] of [[a, c], [bb, c], [bb, d], [a, d]]) b.vert(x, 0, z, GROUND, GROUND);
  b.tri.push(q, q + 1, q + 2, q, q + 2, q + 3);
  const g2 = b.tri.length;
  const gx0 = Math.floor(gr.x0 / 5) * 5;
  const gz0 = Math.floor(gr.z0 / 5) * 5;
  const l0 = b.line.length;
  for (let x = gx0; x <= gr.x1; x += 5) b.line.push(b.vert(x, 0, gr.z0, GRID, GRID), b.vert(x, 0, gr.z1, GRID, GRID));
  for (let z = gz0; z <= gr.z1; z += 5) b.line.push(b.vert(gr.x0, 0, z, GRID, GRID), b.vert(gr.x1, 0, z, GRID, GRID));
  const nGrid = b.line.length - l0;

  /** A flat shape on the ground, filled; returns its index range. */
  const flat = (pts: [number, number][], col: Rgba, y0 = 0): [number, number] => {
    const first = b.tri.length;
    const base = b.verts;
    for (const [x, z] of pts) b.vert(x, y0, z, col, col);
    for (const i of earcut(pts)) b.tri.push(base + i);
    return [first, b.tri.length - first];
  };

  for (const hs of y.hardscape) {
    if (hs.style === "pool") {
      const [first, count] = flat(hs.pts, WATER_FILL);
      parts.push({ k: "fill", first, count, depth: false });
    } else {
      const [first, count] = flat(hs.pts, PAVING);
      parts.push({ k: "fill", first, count, depth: false });
      if (hs.style === "turf") parts.push({ k: "pattern", first, count, pts: hs.pts, dots: false, spacing: 5, col: verde(0.18) });
      else if (hs.style === "decomposedGranite" || hs.style === "flagstone")
        parts.push({ k: "pattern", first, count, pts: hs.pts, dots: true, spacing: 9, col: verde(0.22) });
      else parts.push({ k: "pattern", first, count, pts: hs.pts, dots: false, spacing: 8, col: verde(0.13) });
    }
    parts.push({ k: "line", pts: hs.pts, y: 0, closed: true, width: 1, col: verde(0.4), depth: false });
  }

  for (const f of y.features) {
    if (STRUCTURES.includes(f.kind)) continue;
    if (f.kind === "Pool") {
      const [first, count] = flat(f.pts, WATER_FILL);
      parts.push({ k: "fill", first, count, depth: false });
      parts.push({ k: "line", pts: f.pts, y: 0, closed: true, width: 1.2, col: verde(0.4), depth: false });
      for (const s of [0.82, 0.6]) parts.push({ k: "line", pts: shrink(f.pts, s), y: 0, closed: true, width: 1, col: WATER_LINE, depth: false });
    } else if (["Patio", "Driveway", "Walkway", "Deck"].includes(f.kind)) {
      const [first, count] = flat(f.pts, PAVING);
      parts.push({ k: "fill", first, count, depth: false });
      parts.push({ k: "line", pts: f.pts, y: 0, closed: true, width: 1, col: verde(0.35), depth: false });
      if (f.kind === "Walkway") parts.push({ k: "pattern", first, count, pts: f.pts, dots: true, spacing: 8, col: verde(0.2) });
      else parts.push({ k: "pattern", first, count, pts: f.pts, dots: false, spacing: 8, col: verde(0.12) });
    } else {
      parts.push({ k: "line", pts: f.pts, y: 0, closed: true, width: 1.2, col: verde(0.45), dash: [4, 3], depth: false });
    }
  }

  if (y.boundary.length >= 3) parts.push({ k: "line", pts: y.boundary, y: 0, closed: true, width: 1.6, col: verde(0.85), dash: [7, 4], depth: false });
  for (const r of y.removals) parts.push({ k: "removal", ...r });

  // The house, garage and shed: walls and roof in depth, so the plants
  // stand in front of them or behind as they are.
  for (const f of y.features) {
    if (!STRUCTURES.includes(f.kind)) continue;
    const hFt = f.kind === "Shed" ? 8 : 9;
    const first = b.tri.length;
    const n = f.pts.length;
    for (let i = 0; i < n; i++) {
      const [px, pz] = f.pts[i];
      const [qx, qz] = f.pts[(i + 1) % n];
      const w = b.verts;
      b.vert(px, 0, pz, WALL, WALL);
      b.vert(qx, 0, qz, WALL, WALL);
      b.vert(qx, hFt, qz, WALL, WALL);
      b.vert(px, hFt, pz, WALL, WALL);
      b.tri.push(w, w + 1, w + 2, w, w + 2, w + 3);
    }
    const [rf, rc] = flat(f.pts, ROOF, hFt);
    parts.push({ k: "fill", first, count: rf + rc - first, depth: true });
    for (let i = 0; i < n; i++) {
      const p = f.pts[i];
      const q2 = f.pts[(i + 1) % n];
      // Each wall's outline is its own closed path, as the canvas strokes it.
      parts.push({ k: "line", pts: [p, q2], y: -hFt, closed: true, width: 1, col: verde(0.45), depth: true });
    }
    parts.push({ k: "line", pts: f.pts, y: hFt, closed: true, width: 1.1, col: verde(0.5), depth: true });
  }

  return {
    built: b.finish(),
    ground: { fan: [g0, g1 - g0], cover: [g1, g2 - g1], grid: [b.tri.length + l0, nGrid] },
    parts,
  };
}

/** The canvas camera's projection of a point, in CSS pixels. */
export type Project = (x: number, y: number, z: number) => [number, number];

/** One frame of the yard: its outlines as stroke instances, and what to
 *  draw in order. */
export type YardStep =
  | { k: "fill"; first: number; count: number; depth: boolean }
  | { k: "pattern"; first: number; count: number; dots: boolean; spacing: number; col: Rgba; box: [number, number, number] }
  | { k: "strokes"; first: number; count: number; depth: boolean };

export function yardFrame(shapes: YardShapes, P: Project, ftPx: (x: number, z: number, r: number) => number, b: MeshBuilder): YardStep[] {
  const steps: YardStep[] = [];
  for (const p of shapes.parts) {
    if (p.k === "fill") {
      steps.push({ k: "fill", first: p.first, count: p.count, depth: p.depth });
    } else if (p.k === "pattern") {
      let [x0, y0, y1] = [1e9, 1e9, -1e9];
      for (const [x, z] of p.pts) {
        const s = P(x, 0, z);
        x0 = Math.min(x0, s[0]);
        y0 = Math.min(y0, s[1]);
        y1 = Math.max(y1, s[1]);
      }
      steps.push({ k: "pattern", first: p.first, count: p.count, dots: p.dots, spacing: p.spacing, col: p.col, box: [x0, y0, y1 - y0] });
    } else if (p.k === "line") {
      const s0 = b.strokes;
      if (p.y < 0) {
        // A wall: along the foot, up, back along the top, down.
        const h = -p.y;
        const [[ax, az], [bx, bz]] = p.pts;
        const c: [number, number, number][] = [[ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az]];
        for (let i = 0; i < 4; i++) b.stroke(c[i], c[(i + 1) % 4], [0, 0, p.width], p.col, p.col, true);
      } else {
        const n = p.pts.length;
        const segs = p.closed ? n : n - 1;
        let phase = 0;
        for (let i = 0; i < segs; i++) {
          const [ax, az] = p.pts[i];
          const [bx, bz] = p.pts[(i + 1) % n];
          b.stroke([ax, p.y, az], [bx, p.y, bz], [0, 0, p.width], p.col, p.col, !p.dash, p.dash ? [p.dash[0], p.dash[1], phase] : undefined);
          if (p.dash) {
            const sa = P(ax, p.y, az);
            const sb = P(bx, p.y, bz);
            phase += Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
          }
        }
      }
      steps.push({ k: "strokes", first: s0, count: b.strokes - s0, depth: p.depth });
    } else {
      // A removal: a ring on the ground, and a slash across it on screen.
      const s0 = b.strokes;
      const N = 22;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2;
        const a1 = ((k + 1) / N) * Math.PI * 2;
        b.stroke(
          [p.x + Math.cos(a0) * p.r, 0.02, p.z + Math.sin(a0) * p.r],
          [p.x + Math.cos(a1) * p.r, 0.02, p.z + Math.sin(a1) * p.r],
          [0, 0, 1.4],
          CLAY,
          CLAY,
          true,
        );
      }
      const d = ftPx(p.x, p.z, p.r) * 0.7;
      b.strokeMode([p.x, 0.02, p.z], [p.x, 0.02, p.z], [0, 0, 1.4], 2, CLAY, CLAY, [-d, -d * 0.5, d, d * 0.5]);
      steps.push({ k: "strokes", first: s0, count: b.strokes - s0, depth: false });
    }
  }
  return steps;
}
