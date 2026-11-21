// Blue Glow agave's body, grown as keeled lance leaves in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Blue Glow agave as the app's scan is: the standing leaves blue-grey, the
 *  old outer ones sage, their backs a yellower green, the oldest dead brown;
 *  a thin red margin and a dark red-brown spine. Measured off the model's
 *  render. */
export const BLUE_GLOW_COLOURS = {
  blue: [[40, 50, 50], [134, 152, 142]],
  sage: [[50, 58, 38], [164, 170, 112]],
  under: [[46, 54, 36], [152, 158, 102]],
  dead: [[64, 50, 38], [140, 112, 84]],
  core: "rgb(50,60,52)",
  margin: "rgba(132,58,48,0.55)",
  spine: "rgb(84,38,32)",
};
export const BLUE_GLOW_GOLD = {
  blue: [[140, 100, 46], [236, 200, 128]],
  sage: [[146, 104, 50], [240, 206, 140]],
  under: [[126, 90, 42], [214, 178, 112]],
  dead: [[110, 76, 36], [200, 160, 96]],
  core: "rgb(100,70,30)",
  margin: "rgba(140,90,36,0.6)",
  spine: "rgb(96,62,22)",
};

// Blue Glow's leaves, the same on every plant as in the headset, from the
// app's scan: sixty-six on the golden angle, oldest outermost. The scan's
// tips: the old outer leaves splay low (the oldest dead and brown on the
// ground), then a gap, then the rest stand from 35° to near upright —
// a vase, widest two-thirds up — round a tight cone of young leaves. A
// leaf is a broad lance, stiff and nearly straight, smooth-edged:
// channelled down its middle, keeled beneath. Each station holds the
// midrib, left margin, right margin, keel, as (x, y, z).
export const BG_LEAVES = 66;
export const BG_ALONG = [0, 0.1, 0.24, 0.4, 0.58, 0.78, 1];
// Narrower where it leaves the stem, widest two-fifths out, the sides
// full almost to the end, then drawn in to the spine.
export const BG_WIDE = [0.6, 0.85, 0.98, 1, 0.9, 0.62, 0];
export const BG_PTS = BG_ALONG.length;
// Every face in two halves, split two-fifths out: the inner half, deep
// in the rosette, in its neighbours' shade.
export const BG_SPLIT = 3;
export const BG_FACES = BG_LEAVES * 8;
export const BG_FACE_LINES = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
];
export const BG_LEVELS = 8;
// By age along the list (0 the oldest, 1 the youngest): the tip's
// elevation off the base, degrees, and the leaf's length, metres in the
// scan.
export const BG_RISE = [
  [0, 2],
  [0.06, 4],
  [0.07, 10],
  [0.4, 32],
  [0.41, 38],
  [0.62, 54],
  [0.8, 82],
  [1, 88],
];
export const BG_LEN = [
  [0, 0.34],
  [0.06, 0.4],
  [0.07, 0.62],
  [0.4, 0.76],
  [0.41, 0.96],
  [0.62, 1.02],
  [0.8, 1],
  [1, 0.7],
];
export const BG_DEAD = 0.06;
export const bgRamp = (lo: number[], hi: number[]) =>
  Array.from({ length: BG_LEVELS }, (_, i) => {
    const t = i / (BG_LEVELS - 1);
    return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
  });
// Blue upper, sage upper, under, dead — the sheet's and gold.
export const BG_TONES = [BLUE_GLOW_COLOURS, BLUE_GLOW_GOLD].map((pal) => [
  ...bgRamp(pal.blue[0], pal.blue[1]),
  ...bgRamp(pal.sage[0], pal.sage[1]),
  ...bgRamp(pal.under[0], pal.under[1]),
  ...bgRamp(pal.dead[0], pal.dead[1]),
]);
export const BG_MODEL = (() => {
  const rng = rngFor("blue-glow-agave");
  const deg = Math.PI / 180;
  const at = (table: number[][], t: number) => {
    let k = 0;
    while (k < table.length - 2 && table[k + 1][0] < t) k++;
    const f = (t - table[k][0]) / (table[k + 1][0] - table[k][0]);
    return table[k][1] + (table[k + 1][1] - table[k][1]) * f;
  };
  const leaf = new Float32Array(BG_LEAVES * BG_PTS * 12);
  // Each leaf's tip, and the end of the spine past it.
  const spine = new Float32Array(BG_LEAVES * 6);
  // Which tones its upper face takes: 0 blue, 1 sage, 3 dead.
  const kind = new Uint8Array(BG_LEAVES);
  let top = 0;
  let reach = 0;
  for (let i = 0; i < BG_LEAVES; i++) {
    const t = i / (BG_LEAVES - 1);
    const dead = t < BG_DEAD;
    const el = (at(BG_RISE, t) + (rng() - 0.5) * (t < 0.4 ? 16 : 8)) * deg;
    const len = at(BG_LEN, t) * (0.86 + 0.28 * rng());
    // The old outer leaves arch over a little at their ends; the young
    // ones stand straight.
    const bend = dead ? 0 : (4 + 26 * (1 - t) * (1 - t) + rng() * 5) * deg;
    const e0 = el + bend * 0.38;
    const hw = (dead ? 0.06 : 0.12 * (1 - 0.2 * t)) * (0.85 + 0.3 * rng());
    const fold = (0.22 + 0.2 * t) * (dead ? 0.4 : 1);
    const keel = 0.18;
    const az = i * 2.39996 + (rng() - 0.5) * (t < 0.4 ? 0.7 : 0.3);
    const sway = (rng() - 0.5) * (dead ? 30 : 14) * deg;
    kind[i] = dead ? 3 : rng() < Math.max(0, Math.min(1, (0.7 - t) / 0.4)) ? 1 : 0;
    // Each blade turned a little about its own length, so some face
    // the eye and some are edge on.
    const roll = (rng() - 0.5) * 50 * deg;
    const cl = Math.cos(roll);
    const sl0 = Math.sin(roll);
    const r0 = 0.04 + 0.14 * (1 - t);
    let px = Math.cos(az) * r0;
    let py = 0.04 + 0.2 * t;
    let pz = Math.sin(az) * r0;
    let prev = 0;
    let T = [0, 1, 0];
    for (let j = 0; j < BG_PTS; j++) {
      const s = BG_ALONG[j];
      const angle = (u: number) => e0 - bend * Math.pow(u, 1.6);
      if (j > 0) {
        const sm = (prev + s) / 2;
        const e = angle(sm);
        const ps = az + sway * sm;
        const step = (s - prev) * len;
        px += Math.cos(e) * Math.cos(ps) * step;
        py = Math.max(0.008, py + Math.sin(e) * step);
        pz += Math.cos(e) * Math.sin(ps) * step;
      }
      prev = s;
      // Along the leaf; across it, level; up off its upper face.
      const e = angle(s);
      const ps = az + sway * s;
      T = [Math.cos(e) * Math.cos(ps), Math.sin(e), Math.cos(e) * Math.sin(ps)];
      const S0 = [-Math.sin(ps), 0, Math.cos(ps)];
      const N0 = [-Math.cos(ps) * Math.sin(e), Math.cos(e), -Math.sin(ps) * Math.sin(e)];
      const S = [S0[0] * cl + N0[0] * sl0, S0[1] * cl + N0[1] * sl0, S0[2] * cl + N0[2] * sl0];
      const N = [N0[0] * cl - S0[0] * sl0, N0[1] * cl - S0[1] * sl0, N0[2] * cl - S0[2] * sl0];
      const w = hw * BG_WIDE[j];
      const fw = fold * w;
      const kw = keel * w;
      leaf.set(
        [
          px, py, pz,
          px + S[0] * w + N[0] * fw, py + S[1] * w + N[1] * fw, pz + S[2] * w + N[2] * fw,
          px - S[0] * w + N[0] * fw, py - S[1] * w + N[1] * fw, pz - S[2] * w + N[2] * fw,
          px - N[0] * kw, py - N[1] * kw, pz - N[2] * kw,
        ],
        (i * BG_PTS + j) * 12,
      );
      top = Math.max(top, py);
      reach = Math.max(reach, Math.hypot(px, pz));
    }
    // A short dark spine on along the last stretch.
    const tip = (i * BG_PTS + BG_PTS - 1) * 12;
    const sl = 0.035 * len;
    spine.set([leaf[tip], leaf[tip + 1], leaf[tip + 2], leaf[tip] + T[0] * sl, leaf[tip + 1] + T[1] * sl, leaf[tip + 2] + T[2] * sl], i * 6);
  }
  // To the plant's measure: its height 1 up, its half-spread 1 across.
  for (const a of [leaf, spine]) {
    for (let k = 0; k < a.length; k += 3) {
      a[k] /= reach;
      a[k + 1] /= top;
      a[k + 2] /= reach;
    }
  }
  return { leaf, spine, kind };
})();

// Grown once per plant and kept: the leaves turned and scaled, every
// face's normal, middle and tone.
export type BlueGlowPlant = {
  leaf: Float32Array;
  spine: Float32Array;
  faceN: Float32Array;
  faceMid: Float32Array;
  faceTone: Uint8Array;
};

export function growBlueGlow(h: number, rw: number, rot: number): BlueGlowPlant {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  const unit = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const level = (n: V3) =>
    Math.max(0, Math.min(BG_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (BG_LEVELS - 1))));
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const turn = (src: Float32Array) => {
    const dst = new Float32Array(src.length);
    for (let o = 0; o < src.length; o += 3) {
      dst[o] = (src[o] * cr - src[o + 2] * sr) * rw;
      dst[o + 1] = src[o + 1] * h;
      dst[o + 2] = (src[o] * sr + src[o + 2] * cr) * rw;
    }
    return dst;
  };
  const leaf = turn(BG_MODEL.leaf);
  const spine = turn(BG_MODEL.spine);
  // Each half-face lit by its own normal, pointed away from the middle
  // of the leaf's section; the two halves of the channel shaded apart,
  // the inner halves two shades down.
  const faceN = new Float32Array(BG_FACES * 3);
  const faceMid = new Float32Array(BG_FACES * 3);
  const faceTone = new Uint8Array(BG_FACES);
  const pt = (i: number, j: number, line: number, k: number) => leaf[(i * BG_PTS + j) * 12 + line * 3 + k];
  for (let i = 0; i < BG_LEAVES; i++) {
    const kind = BG_MODEL.kind[i];
    for (let half = 0; half < 2; half++) {
      const j0 = half ? BG_SPLIT : 0;
      const j1 = half ? BG_PTS - 2 : BG_SPLIT;
      const jm = half ? BG_SPLIT + 1 : 1;
      const along: V3 = [0, 1, 2].map((k) => pt(i, j1, 0, k) - pt(i, j0, 0, k)) as V3;
      const middle: V3 = [0, 1, 2].map((k) => pt(i, jm, 0, k) * 0.6 + pt(i, jm, 3, k) * 0.4) as V3;
      for (let f = 0; f < 4; f++) {
        const [la, lb] = BG_FACE_LINES[f];
        const a: V3 = [0, 1, 2].map((k) => pt(i, jm, la, k)) as V3;
        const b: V3 = [0, 1, 2].map((k) => pt(i, jm, lb, k)) as V3;
        const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let n = unit([along[1] * ac[2] - along[2] * ac[1], along[2] * ac[0] - along[0] * ac[2], along[0] * ac[1] - along[1] * ac[0]]);
        const out = [(a[0] + b[0]) / 2 - middle[0], (a[1] + b[1]) / 2 - middle[1], (a[2] + b[2]) / 2 - middle[2]];
        if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
        const fi = (i * 4 + f) * 2 + half;
        faceN.set(n, fi * 3);
        const je = half ? BG_PTS - 1 : BG_SPLIT;
        for (let k = 0; k < 3; k++) faceMid[fi * 3 + k] = (pt(i, j0, la, k) + pt(i, j0, lb, k) + pt(i, je, la, k) + pt(i, je, lb, k)) / 4;
        const family = kind === 3 ? 3 : f < 2 ? kind : 2;
        faceTone[fi] = family * BG_LEVELS + Math.max(0, level(n) - (half || kind === 3 ? 0 : 2));
      }
    }
  }
  return { leaf, spine, faceN, faceMid, faceTone };
}
