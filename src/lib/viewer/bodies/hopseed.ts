// Green hopseed's body, grown as stems and sprays of narrow leaves in the
// scene's feet. Shared by the canvas viewer and its WebGL pilot, so both
// draw the same leaves.

import { rngFor } from "../symbols";

/** Shrub foliage, on the same terms: muted, 3D only, gold under selection.
 *  A shrub is a mass of leaves, and in ink alone one shrub is every shrub —
 *  the green, and how it goes from lit to shadow, is most of what tells a
 *  hopseed from a sage at a glance. RGB, mixed per spray by its light. */
export const HOPSEED_LEAF = {
  lit: [118, 148, 88],
  shade: [50, 82, 54],
  fresh: [160, 182, 104], // the paler new growth at the top
  core: [36, 60, 42], // the shadow inside the mass
};
export const HOPSEED_GOLD = {
  lit: [226, 192, 120],
  shade: [152, 114, 54],
  fresh: [236, 212, 146],
  core: [118, 86, 40],
};

// A hopseed's leaves don't move when the camera does, so they are grown
// once per plant and kept: hundreds of sprays of rng and vector maths
// every frame was most of what a hedge of them cost.
export type HopseedSpray = {
  c: [number, number, number];
  /** leaf corners, as offsets from c: 5 leaves x 6 corners x xyz */
  off: Float32Array;
  inner: boolean;
  col: string;
  gold: string;
};

export function growHopseed(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
  const rng = rngFor("hopseed:" + seed);
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const smooth = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  type V3 = [number, number, number];
  const nrm = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const crs = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  // The column, as a radius of its spread at each fraction of its
  // height: pinched where the stems gather, full and nearly straight-
  // sided through the middle, rounding off over the top quarter. Rounding
  // from a third of the way down made an egg; the model is a column.
  const prof = (u: number) =>
    (0.42 + 0.58 * smooth(0.05, 0.24, u)) *
    (u > 0.72 ? Math.pow(Math.max(0, 1 - ((u - 0.72) / 0.28) ** 2), 0.4) : 1);

  const stems: V3[][] = [];
  for (let k = 0; k < 5; k++) {
    const a = rot + k * 2.399963 + rng() * 0.5;
    stems.push([
      [x + Math.cos(a) * rw * 0.04, 0, z + Math.sin(a) * rw * 0.04],
      [x + Math.cos(a) * rw * 0.3, h * 0.24, z + Math.sin(a) * rw * 0.3],
    ]);
  }

  // Two layers: an inner one in shadow, which is what you see through
  // the gaps, and the outer skin. Depth from leaves, not from a shape —
  // a filled hull behind them read as a dark can, however small. Placed
  // by area (fewer where the column is narrow), with a little lumpiness
  // round it so the outline is tufted, not turned.
  const NI = 140;
  const NS = 240;
  const s1 = rng() * 6.28;
  const s2 = rng() * 6.28;
  const sprays: HopseedSpray[] = [];
  for (let tries = 0; sprays.length < NS + NI && tries < (NS + NI) * 4; tries++) {
    const inner = sprays.length < NI;
    const u = 0.1 + 0.88 * rng();
    if (rng() > prof(u)) continue;
    const th = rng() * Math.PI * 2;
    const tuft = 1 + 0.07 * Math.sin(4 * th + 9 * u + s1) + 0.05 * Math.sin(7 * th - 5 * u + s2);
    const r = rw * prof(u) * (inner ? 0.5 + 0.3 * rng() : 0.86 + 0.16 * rng()) * tuft;
    const c: V3 = [x + Math.cos(th) * r, u * h, z + Math.sin(th) * r];
    const n = nrm([Math.cos(th), (u - 0.45) * 1.2, Math.sin(th)]); // tipped up toward the crown
    const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
    const shade = (0.3 + 0.7 * lit) * (0.5 + 0.5 * smooth(0.05, 0.75, u));
    const fresh = !inner && u > 0.6 && rng() < 0.3;
    const tone = (pal: typeof HOPSEED_LEAF) => {
      let col = mix(pal.shade, pal.lit, shade);
      if (inner) col = mix(pal.core, col, 0.35);
      else if (fresh) col = mix(col, pal.fresh, 0.55);
      return rgb(col);
    };
    // A spray points up and a little out; its leaves alternate up it and
    // one finishes it. Each is a lance, widest a third of the way out and
    // drawn to a point — four corners made a diamond, which is a privet.
    const tw = nrm([n[0] * 0.35 + (rng() - 0.5) * 0.3, 1, n[2] * 0.35 + (rng() - 0.5) * 0.3]);
    const side = nrm(crs(tw, n));
    const L = rw * 0.2 * (0.85 + 0.3 * rng());
    const twig = rw * 0.32;
    const w = L * 0.14; // narrow, willow-like
    const off = new Float32Array(5 * 6 * 3);
    let o = 0;
    [0.15, 0.35, 0.55, 0.75, 1].forEach((t, j) => {
      const sg = j % 2 ? 1 : -1;
      const a = j === 4 ? 1 : 0.7071;
      const b = j === 4 ? 0 : 0.7071 * sg;
      const dir = nrm([
        tw[0] * a + side[0] * b + n[0] * 0.15,
        tw[1] * a + side[1] * b + n[1] * 0.15,
        tw[2] * a + side[2] * b + n[2] * 0.15,
      ]);
      const perp = nrm(crs(dir, n));
      for (const [f, q] of [[0, 0], [0.3, 1], [0.7, 0.5], [1, 0], [0.7, -0.5], [0.3, -1]]) {
        for (let i = 0; i < 3; i++) off[o++] = tw[i] * twig * t + dir[i] * L * f + perp[i] * w * q;
      }
    });
    sprays.push({ c, off, inner, col: tone(HOPSEED_LEAF), gold: tone(HOPSEED_GOLD) });
  }
  return { stems, sprays };
}
