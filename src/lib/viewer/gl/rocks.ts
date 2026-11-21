// The boulders as the WebGL layer draws them: the AZ Boulder from its scan,
// and the boulders that haven't one as their faceted solid — each grown by
// the grower the canvas uses (see `drawAzBoulderBody` and `drawBoulderBody`
// in LivingBlueprint), its faces drawn in the canvas's far-to-near order
// (see `flat`).

import { AZ_ROCK_COLOURS, AZ_ROCK_GOLD, AZR_CREASES, AZR_F, AZR_FLECKS, AZR_NF, AZR_TONES, azrFleckFace, azrFleckLight, azrFleckSize, growAzRock } from "../bodies/azBoulder";
import { growBoulder } from "../bodies/boulder";
import { symbolFor } from "../symbols";
import { gold, hull3, overPaper, rgba, verde, type Rgba } from "./geom";
import type { Cam, MeshBuilder } from "./mesh";

type V3 = [number, number, number];
type Pal = [Rgba, Rgba];

const pal = (c: string, g: string): Pal => [rgba(c), rgba(g)];

/** The edges of triangles (corner indices, three a triangle), each once,
 *  with the one or two triangles it bounds. */
function edgesOf(tri: ArrayLike<number>) {
  const sides = new Map<string, [number, number, number[]]>();
  for (let f = 0; f < tri.length / 3; f++) {
    for (let k = 0; k < 3; k++) {
      const a = tri[f * 3 + k];
      const b = tri[f * 3 + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const e = sides.get(key);
      if (e) e[2].push(f);
      else sides.set(key, [a, b, [f]]);
    }
  }
  return [...sides.values()];
}
const AZR_EDGES = edgesOf(AZR_F);

/** The AZ Boulder, as scanned. */
export function azBoulder(b: MeshBuilder, x: number, z: number, rw: number, rot: number) {
  // The plan mark's radius is half the rock's length.
  const len = rw * 2;
  const { v, n, c, band, fl } = growAzRock(x, z, len, rot);
  const at = (a: Float32Array, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
  const C = AZ_ROCK_COLOURS;
  const G = AZ_ROCK_GOLD;

  // Its outline first: every edge of a face that shows, at twice the
  // weight it shows at, inked once — the faces then cover its inner half,
  // and every edge inside the rock, so only the rock's edge keeps it.
  const s0 = b.strokes;
  const edge = pal(C.edge, G.edge);
  for (const [p, q, fs] of AZR_EDGES) {
    const f0 = fs[0];
    const f1 = fs[fs.length - 1];
    b.strokeX(at(v, p), at(v, q), [0, 1.6, 0], edge[0], edge[1], { round: true, na: at(n, f0), nb: at(n, f1), pa: at(c, f0), pb: at(c, f1) });
  }
  b.strokeRun(s0, b.once(), undefined, 0, { cull: 1 });

  // The faces that show, far to near.
  const t0 = b.tri.length;
  for (let f = 0; f < AZR_NF; f++) {
    const col = rgba(AZR_TONES[0][band[f]]);
    const gol = rgba(AZR_TONES[1][band[f]]);
    const nf = at(n, f);
    const cf = at(c, f);
    for (let k = 0; k < 3; k++) {
      const p = at(v, AZR_F[f * 3 + k]);
      b.vert(p[0], p[1], p[2], col, gol, nf, cf);
    }
    b.tri.push(b.verts - 3, b.verts - 2, b.verts - 1);
  }
  b.tris(t0, true, true, { flat: true });

  // Over the faces, as the canvas draws them after them all: the creases
  // where two faces that show meet sharply, and close up the granite's
  // grain, dark flecks and light ones never more than a couple of pixels.
  const s1 = b.strokes;
  const crease = pal(C.crease, G.crease);
  for (let e = 0; e < AZR_CREASES.length; e += 4) {
    const [p, q, f0, f1] = [AZR_CREASES[e], AZR_CREASES[e + 1], AZR_CREASES[e + 2], AZR_CREASES[e + 3]];
    b.strokeX(at(v, p), at(v, q), [0, 0.6, 0], crease[0], crease[1], { na: at(n, f0), nb: at(n, f1), pa: at(c, f0), pb: at(c, f1) });
  }
  b.strokeRun(s1, b.once(), undefined, len, { cull: 4, frame: (cam) => ({ show: cam.ft(x, z) * len > 14 }) });
  const grain = (cam: Cam) => {
    const f = cam.ft(x, z);
    return { show: f * len > 60, foot: Math.min(Math.max(f * 0.016, 0.7), 2.2) };
  };
  for (const light of [0, 1]) {
    const s = b.strokes;
    const col = light ? pal(C.light, G.light) : pal(C.dark, G.dark);
    for (let i = 0; i < AZR_FLECKS; i++) {
      if (azrFleckLight[i] !== light) continue;
      const f = azrFleckFace[i];
      const p = at(fl, i);
      b.strokeMode(p, p, [azrFleckSize[i], 0, 0], 4, col[0], col[1], [0, 0, 0, 0], { na: at(n, f), pa: at(c, f) });
    }
    b.strokeRun(s, b.once(), undefined, len, { cull: 1, frame: grain });
  }
}

/** A boulder that hasn't been scanned: its faces paper and tint, each
 *  edged; its silhouette over them all. */
export function boulder(b: MeshBuilder, model: string, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const rock = growBoulder(x, z, rw * 2, h, rot, symbolFor(model, "boulder"), id);
  const { pts, faces } = rock;
  const mean = (vs: number[]): V3 => {
    const s: V3 = [0, 0, 0];
    for (const i of vs) for (let k = 0; k < 3; k++) s[k] += pts[i][k] / vs.length;
    return s;
  };
  const keys = faces.map((f) => mean(f.vs));

  const t0 = b.tri.length;
  faces.forEach((f, i) => {
    const t = 0.05 + 0.2 * (1 - f.lit);
    const col = overPaper(verde(t));
    const gol = overPaper(gold(t));
    const base = b.verts;
    for (const k of f.vs) b.vert(pts[k][0], pts[k][1], pts[k][2], col, gol, undefined, keys[i]);
    for (let k = 1; k + 1 < f.vs.length; k++) b.tri.push(base, base + k, base + k + 1);
  });
  b.tris(t0, true, false, { flat: true });
  // The facet edges, each face's round it, just over it.
  const s0 = b.strokes;
  const edge: Pal = [verde(0.5), gold(0.5)];
  faces.forEach((f, i) => {
    for (let k = 0; k < f.vs.length; k++) {
      const p = pts[f.vs[k]];
      const q = pts[f.vs[(k + 1) % f.vs.length]];
      b.strokeX(p, q, [0, 0.85, 0], edge[0], edge[1], { round: true, pa: keys[i], pb: keys[i] });
    }
  });
  b.strokeRun(s0, 0, undefined, 0.01, { flat: true });

  // The silhouette, at full weight over the facets: the edges of the
  // rock's hull where one side faces the eye and the other doesn't.
  const hull = hull3(pts);
  const tn: V3[] = [];
  const tc: V3[] = [];
  for (let f = 0; f < hull.length; f += 3) {
    const [p, q, r] = [pts[hull[f]], pts[hull[f + 1]], pts[hull[f + 2]]];
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const nn: V3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...nn) || 1;
    tn.push([nn[0] / l, nn[1] / l, nn[2] / l]);
    tc.push([(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3]);
  }
  const s1 = b.strokes;
  const line: Pal = [verde(0.7), rgba("#a87b2f")];
  for (const [p, q, fs] of edgesOf(hull)) {
    if (fs.length !== 2) continue;
    b.strokeX(pts[p], pts[q], [0, 1.2, 0], line[0], line[1], { round: true, na: tn[fs[0]], nb: tn[fs[1]], pa: tc[fs[0]], pb: tc[fs[1]] });
  }
  b.strokeRun(s1, b.once(), undefined, rw * 2, { cull: 3 });
}
