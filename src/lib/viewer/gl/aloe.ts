// Aloe vera as the WebGL layer draws it: grown by the grower the canvas
// uses (see `drawAloeBody` in LivingBlueprint) and laid out in its order.
//
// The canvas sorts every face of every leaf, every piece of the flower
// stalks and every flower far to near, and paints each whole — paper, its
// tint, its flecks and edges. Here each is drawn at the depth of its middle
// (see `flat`), so they stack the way that sort lays them.

import { ALOE_BLOOM, ALOE_BUD, growAloe } from "../bodies/aloe";
import { gold, overPaper, rgba, verde, type Rgba } from "./geom";
import type { MeshBuilder } from "./mesh";

type V3 = [number, number, number];
type Pal = [Rgba, Rgba];

const ink = (a: number): Pal => [verde(a), gold(a)];
const FLECK = rgba("rgba(246,240,226,0.85)");
// The plant's own stroke: the ink at 0.85, or the gold whole.
const STROKE: Pal = [verde(0.85), rgba("#a87b2f")];
const BLOOM: Pal = [overPaper(rgba(ALOE_BLOOM)), overPaper(gold(0.3))];
const BUD: Pal = [overPaper(rgba(ALOE_BUD)), overPaper(gold(0.22))];

const mean = (pts: V3[]): V3 => {
  const s: V3 = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) s[k] += p[k] / pts.length;
  return s;
};

export function aloeVera(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const g = growAloe(x, z, h, rw, rot, id);
  // Each face at the depth of its middle: the mean of its points, as the
  // canvas sorts it.
  const keys = g.faces.map((f) => mean([...f.a, ...f.b]));

  // The faces: paper, and the tint over it as lit, in one fill.
  const t0 = b.tri.length;
  g.faces.forEach((f, i) => {
    const t = 0.04 + 0.42 * (1 - f.lit);
    const col = overPaper(verde(t));
    const gol = overPaper(gold(t));
    const base = b.verts;
    for (let j = 0; j < f.a.length; j++) {
      b.vert(f.a[j][0], f.a[j][1], f.a[j][2], col, gol, undefined, keys[i]);
      b.vert(f.b[j][0], f.b[j][1], f.b[j][2], col, gol, undefined, keys[i]);
    }
    for (let j = 0; j + 1 < f.a.length; j++) {
      const v = base + j * 2;
      b.tri.push(v, v + 2, v + 3, v, v + 3, v + 1);
    }
  });
  b.tris(t0, true, false, { flat: true });

  // On each face its flecks, then its edges, just over it: each line of
  // edges inking once, as the canvas strokes it (the margin twice, once
  // with each face it bounds).
  const over = 0.01;
  const s0 = b.strokes;
  g.faces.forEach((f, i) => {
    for (const [p, q] of f.flecks) b.strokeX(p, q, [0, 0.8, 1], FLECK, FLECK, { round: true, pa: keys[i], pb: keys[i] });
  });
  b.strokeRun(s0, 0, undefined, over, { flat: true });
  // The upper faces are the even ones, edged by fold and margin; the
  // under faces by keel and margin.
  for (const [half, which] of [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]) {
    const s = b.strokes;
    g.faces.forEach((f, i) => {
      if (i % 2 !== half) return;
      const e = f.edges[which];
      const c = e.a === null ? STROKE : ink(e.a);
      for (let j = 1; j < e.line.length; j++) b.strokeX(e.line[j - 1], e.line[j], [0, e.w, 0], c[0], c[1], { round: true, pa: keys[i], pb: keys[i] });
    });
    b.strokeRun(s, b.once(), undefined, over, { flat: true });
  }

  // The blooms: the ink round each flower first, written in depth, then
  // the flower over it — paper and colour in one, a touch nearer — so each
  // flower's soft edge lies on its own ink as the canvas paints it, and a
  // near flower still hides a far one's.
  const tubes = g.stalks.flatMap((st) => st.tubes);
  const s1 = b.strokes;
  const edge = ink(0.6);
  for (const tb of tubes) {
    const m = mean([tb.base, tb.tip]);
    // The tube's width and then 0.7 of a line width more.
    b.strokeX(tb.base, tb.tip, [0.035, -0.7, 1.6], edge[0], edge[1], { round: true, pa: m, pb: m });
  }
  b.strokeRun(s1, 0, undefined, 0, { flat: true, depth: true });
  const s2 = b.strokes;
  for (const tb of tubes) {
    const m = mean([tb.base, tb.tip]);
    const c = tb.open ? BLOOM : BUD;
    b.strokeX(tb.base, tb.tip, [0.035, 0, 1.6], c[0], c[1], { round: true, pa: m, pb: m });
  }
  b.strokeRun(s2, 0, undefined, 0.02, { flat: true, depth: true });
  // Then each stalk, in butt-ended pieces (round caps on its translucent
  // ink would bead every joint): over the flowers behind it, under those in
  // front, as the canvas's sort lays it through the flower head.
  const s3 = b.strokes;
  const stalk = ink(0.7);
  for (const st of g.stalks) {
    for (const pc of st.pieces) {
      const m = mean([pc.a, pc.b]);
      b.strokeX(pc.a, pc.b, [0.04 * pc.w, 0.9 * pc.w, 0], stalk[0], stalk[1], { pa: m, pb: m });
    }
  }
  b.strokeRun(s3, 0, undefined, 0, { flat: true });
}
