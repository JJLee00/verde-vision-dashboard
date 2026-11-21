// Agave americana's body, grown as folded leaves, teeth and spines in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Agave americana: glaucous blue-grey, the old outer leaves gone dusty tan,
 *  dead ones brown on the ground; dark brown teeth and terminal spines. */
export const AMERICANA_COLOURS = {
  upper: [[86, 100, 96], [204, 214, 206]],
  under: [[76, 90, 86], [176, 188, 182]],
  dustyUpper: [[96, 92, 76], [200, 192, 166]],
  dustyUnder: [[86, 82, 68], [176, 168, 144]],
  dead: [[90, 68, 50], [176, 148, 112]],
  core: "rgb(46,56,54)",
  margin: "rgba(96,66,46,0.55)",
  teeth: "rgb(98,66,44)",
  spine: "rgb(64,48,38)",
};
export const AMERICANA_GOLD = {
  upper: [[140, 100, 46], [236, 200, 128]],
  under: [[126, 90, 42], [214, 178, 112]],
  dustyUpper: [[146, 104, 50], [240, 206, 140]],
  dustyUnder: [[130, 92, 44], [218, 182, 118]],
  dead: [[110, 76, 36], [200, 160, 96]],
  core: "rgb(100,70,30)",
  margin: "rgba(140,90,36,0.6)",
  teeth: "rgb(118,74,26)",
  spine: "rgb(96,62,22)",
};

// The americana's leaves, the same on every plant as in the headset, in
// the model's measure (its height = 1): twenty-four on the golden angle off a
// short stem, rising steeply — the outer ones at 30–40°, most at 50–70°,
// the youngest nearly upright — each bending back a little toward its
// tip, and some of the old outer ones buckled partway out, as americana's
// leaves do. A leaf is a thick folded blade: the fold down its middle,
// the two margins raised high above it into a V, the keel beneath; four
// faces between those lines. Each station holds fold, left margin, right
// margin, keel, as (x, y, z).
export const AM_LEAVES = 24;
export const AM_ALONG = [0, 0.12, 0.28, 0.46, 0.64, 0.82, 1];
export const AM_WIDE = [0.9, 1, 0.95, 0.8, 0.6, 0.34, 0];
export const AM_PTS = AM_ALONG.length;
export const AM_FACES = AM_LEAVES * 4;
export const AM_FACE_LINES = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
];
export const AM_TEETH = 10; // down each margin
export const AM_DEAD = 2;
export const AM_DEAD_PTS = 5;
export const AM_LEVELS = 8;
// The scan's leaves by elevation, oldest first: where along the list
// (0–1) each is reached, in degrees.
export const AM_RISE = [
  [0, 28],
  [0.2, 40],
  [0.5, 54],
  [0.8, 68],
  [1, 84],
];
export const amRamp = (lo: number[], hi: number[]) =>
  Array.from({ length: AM_LEVELS }, (_, i) => {
    const t = i / (AM_LEVELS - 1);
    return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
  });
// Upper, under, dusty upper, dusty under, dead — the sheet's and gold.
export const AM_TONES = [AMERICANA_COLOURS, AMERICANA_GOLD].map((pal) => [
  ...amRamp(pal.upper[0], pal.upper[1]),
  ...amRamp(pal.under[0], pal.under[1]),
  ...amRamp(pal.dustyUpper[0], pal.dustyUpper[1]),
  ...amRamp(pal.dustyUnder[0], pal.dustyUnder[1]),
  ...amRamp(pal.dead[0], pal.dead[1]),
]);
export const AM_MODEL = (() => {
  const rng = rngFor("agave-americana");
  const deg = Math.PI / 180;
  const leaf = new Float32Array(AM_LEAVES * AM_PTS * 12);
  // Each tooth: where it sits on the margin, then out to its point, then
  // half its foot along the margin.
  const teeth = new Float32Array(AM_LEAVES * 2 * AM_TEETH * 9);
  // Each leaf's tip, and the end of the spine past it.
  const spine = new Float32Array(AM_LEAVES * 6);
  const dusty = new Uint8Array(AM_LEAVES);
  const dead = new Float32Array(AM_DEAD * AM_DEAD_PTS * 6);
  let top = 0;
  for (let i = 0; i < AM_LEAVES; i++) {
    const t = i / (AM_LEAVES - 1); // 0 the oldest, outermost; 1 the youngest
    let k = 0;
    while (k < AM_RISE.length - 2 && AM_RISE[k + 1][0] < t) k++;
    const f = (t - AM_RISE[k][0]) / (AM_RISE[k + 1][0] - AM_RISE[k][0]);
    const chord = AM_RISE[k][1] + (AM_RISE[k + 1][1] - AM_RISE[k][1]) * f + (rng() - 0.5) * 8;
    const bend = (8 + 10 * (1 - t) + (rng() - 0.5) * 10) * deg;
    const e0 = chord * deg + bend * 0.4;
    // A few old leaves buckle partway out and hang their outer half.
    const kink = t < 0.4 && rng() < 0.3 ? (25 + rng() * 15) * deg : 0;
    const len = (0.72 + 0.003 * chord) * (0.92 + 0.16 * rng());
    const hw = 0.15 * (0.85 + 0.3 * rng()) * (1 - 0.2 * t);
    const az = i * 2.39996 + (rng() - 0.5) * 0.3;
    const sway = (rng() - 0.5) * 24 * deg;
    dusty[i] = t < 0.3 ? 1 : 0;
    const angle = (s: number) =>
      e0 - bend * Math.pow(s, 1.5) - kink * Math.max(0, Math.min(1, (s - 0.5) / 0.12));
    const r0 = 0.05 * (1 - 0.6 * t);
    let px = Math.cos(az) * r0;
    let py = 0.03 + 0.1 * t;
    let pz = Math.sin(az) * r0;
    let prev = 0;
    const frame: number[][] = [];
    for (let j = 0; j < AM_PTS; j++) {
      const s = AM_ALONG[j];
      if (j > 0) {
        const sm = (prev + s) / 2;
        const e = angle(sm);
        const ps = az + sway * sm * sm;
        const step = (s - prev) * len;
        px += Math.cos(e) * Math.cos(ps) * step;
        py = Math.max(0.006, py + Math.sin(e) * step);
        pz += Math.cos(e) * Math.sin(ps) * step;
      }
      prev = s;
      // Along the leaf; across it, level; up off its upper face.
      const e = angle(s);
      const ps = az + sway * s * s;
      const T = [Math.cos(e) * Math.cos(ps), Math.sin(e), Math.cos(e) * Math.sin(ps)];
      const S = [-Math.sin(ps), 0, Math.cos(ps)];
      const N = [-Math.cos(ps) * Math.sin(e), Math.cos(e), -Math.sin(ps) * Math.sin(e)];
      const w = hw * AM_WIDE[j];
      const fold = 0.3 * w;
      const keel = 0.32 * w;
      leaf.set(
        [
          px, py, pz,
          px + S[0] * w + N[0] * fold, py + N[1] * fold, pz + S[2] * w + N[2] * fold,
          px - S[0] * w + N[0] * fold, py + N[1] * fold, pz - S[2] * w + N[2] * fold,
          px - N[0] * keel, py - N[1] * keel, pz - N[2] * keel,
        ],
        (i * AM_PTS + j) * 12,
      );
      frame.push([...T, ...S, ...N]);
      top = Math.max(top, py);
    }
    // The terminal spine: long and dark, on along the last stretch.
    const T = frame[AM_PTS - 1];
    const tip = (i * AM_PTS + AM_PTS - 1) * 12;
    const sl = 0.055 * len;
    spine.set([leaf[tip], leaf[tip + 1], leaf[tip + 2], leaf[tip] + T[0] * sl, leaf[tip + 1] + T[1] * sl, leaf[tip + 2] + T[2] * sl], i * 6);
    // Big teeth down both margins, hooked toward the tip, smaller as the
    // leaf narrows.
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? 1 : -1;
      for (let k2 = 0; k2 < AM_TEETH; k2++) {
        const s = 0.06 + (0.76 * (k2 + 0.3 + rng() * 0.4)) / AM_TEETH;
        let j = 0;
        while (j < AM_PTS - 2 && AM_ALONG[j + 1] < s) j++;
        const fr = (s - AM_ALONG[j]) / (AM_ALONG[j + 1] - AM_ALONG[j]);
        const a = (i * AM_PTS + j) * 12 + 3 + side * 3;
        const b = a + 12;
        const [Tx, Ty, Tz, Sx, , Sz, Nx, Ny, Nz] = frame[j];
        const size = (hw / 0.15) * (1 - 0.5 * s);
        const out = 0.018 * size;
        const foot = 0.009 * size;
        teeth.set(
          [
            leaf[a] + (leaf[b] - leaf[a]) * fr,
            leaf[a + 1] + (leaf[b + 1] - leaf[a + 1]) * fr,
            leaf[a + 2] + (leaf[b + 2] - leaf[a + 2]) * fr,
            (Sx * sg * 0.85 + Nx * 0.25 + Tx * 0.45) * out,
            (Ny * 0.25 + Ty * 0.45) * out,
            (Sz * sg * 0.85 + Nz * 0.25 + Tz * 0.45) * out,
            Tx * foot,
            Ty * foot,
            Tz * foot,
          ],
          ((i * 2 + side) * AM_TEETH + k2) * 9,
        );
      }
    }
  }
  // The dead leaves: brown, lying flat out across the ground.
  for (let i = 0; i < AM_DEAD; i++) {
    const az = i * 2.39996 + 0.5 + (rng() - 0.5) * 0.6;
    const len = 0.22 + rng() * 0.08;
    const hw = 0.035 * (0.8 + 0.4 * rng());
    const lift = (rng() - 0.5) * 0.8;
    for (let j = 0; j < AM_DEAD_PTS; j++) {
      const s = j / (AM_DEAD_PTS - 1);
      const r = 0.04 + s * len;
      const w = hw * (1 - 0.8 * s);
      const a = az + (rng() - 0.5) * 0.08;
      dead.set(
        [Math.cos(a) * r, 0.006 + 0.03 * (1 - s), Math.sin(a) * r, -Math.sin(a) * w, lift * w, Math.cos(a) * w],
        (i * AM_DEAD_PTS + j) * 6,
      );
    }
  }
  // The tallest leaf tip to the full height.
  const ys = 1 / top;
  for (let k = 1; k < leaf.length; k += 3) leaf[k] *= ys;
  for (let k = 1; k < teeth.length; k += 3) teeth[k] *= ys;
  for (let k = 1; k < spine.length; k += 3) spine[k] *= ys;
  for (let k = 1; k < dead.length; k += 3) dead[k] *= ys;
  return { leaf, teeth, spine, dusty, dead, core: [0, 0.12 * ys, 0] };
})();

// Grown once per plant and kept, as the trees are.
export type AmericanaPlant = {
  /** the leaves' lines, turned, scaled and placed */
  leaf: Float32Array;
  /** each face's outward normal, its middle and its tone */
  faceN: Float32Array;
  faceMid: Float32Array;
  faceTone: Uint8Array;
  teeth: Float32Array;
  spine: Float32Array;
  /** the dead leaves as centre and half-width, and their tones seen from
   *  above and below */
  dead: Float32Array;
  deadMid: Float32Array;
  deadTone: Uint8Array;
  core: [number, number, number];
};

export function growAmericana(x: number, z: number, h: number, rot: number): AmericanaPlant {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  const level = (n: V3) =>
    Math.max(0, Math.min(AM_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (AM_LEVELS - 1))));
  const unit = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const turn = (src: Float32Array, dst: Float32Array, o: number, offset: boolean) => {
    const mx = src[o];
    const mz = src[o + 2];
    dst[o] = (offset ? x : 0) + (mx * cr - mz * sr) * h;
    dst[o + 1] = src[o + 1] * h;
    dst[o + 2] = (offset ? z : 0) + (mx * sr + mz * cr) * h;
  };

  const leaf = new Float32Array(AM_MODEL.leaf.length);
  for (let o = 0; o < leaf.length; o += 3) turn(AM_MODEL.leaf, leaf, o, true);
  const teeth = new Float32Array(AM_MODEL.teeth.length);
  for (let o = 0; o < teeth.length; o += 9) {
    turn(AM_MODEL.teeth, teeth, o, true);
    turn(AM_MODEL.teeth, teeth, o + 3, false);
    turn(AM_MODEL.teeth, teeth, o + 6, false);
  }
  const spine = new Float32Array(AM_MODEL.spine.length);
  for (let o = 0; o < spine.length; o += 3) turn(AM_MODEL.spine, spine, o, true);
  // Each face lit by its normal a third of the way out, pointed away
  // from the middle of the leaf's section. The two halves of the upper
  // face are shaded apart: the fold, light on one side and dark on the
  // other, is what makes an agave leaf an agave's.
  const faceN = new Float32Array(AM_FACES * 3);
  const faceMid = new Float32Array(AM_FACES * 3);
  const faceTone = new Uint8Array(AM_FACES);
  const pt = (i: number, j: number, line: number, k: number) => leaf[(i * AM_PTS + j) * 12 + line * 3 + k];
  for (let i = 0; i < AM_LEAVES; i++) {
    const along: V3 = [0, 1, 2].map((k) => pt(i, 3, 0, k) - pt(i, 1, 0, k)) as V3;
    const middle: V3 = [0, 1, 2].map((k) => pt(i, 2, 0, k) * 0.6 + pt(i, 2, 3, k) * 0.4) as V3;
    const base = AM_MODEL.dusty[i] ? 2 * AM_LEVELS : 0;
    for (let f = 0; f < 4; f++) {
      const [la, lb] = AM_FACE_LINES[f];
      const a: V3 = [0, 1, 2].map((k) => pt(i, 2, la, k)) as V3;
      const b: V3 = [0, 1, 2].map((k) => pt(i, 2, lb, k)) as V3;
      const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      let n = unit([along[1] * ac[2] - along[2] * ac[1], along[2] * ac[0] - along[0] * ac[2], along[0] * ac[1] - along[1] * ac[0]]);
      const out = [(a[0] + b[0]) / 2 - middle[0], (a[1] + b[1]) / 2 - middle[1], (a[2] + b[2]) / 2 - middle[2]];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
      const fi = i * 4 + f;
      faceN.set(n, fi * 3);
      for (let k = 0; k < 3; k++) faceMid[fi * 3 + k] = (pt(i, 3, la, k) + pt(i, 3, lb, k)) / 2;
      faceTone[fi] = base + (f < 2 ? 0 : AM_LEVELS) + level(n);
    }
  }

  const dead = new Float32Array(AM_MODEL.dead.length);
  for (let o = 0; o < dead.length; o += 6) {
    turn(AM_MODEL.dead, dead, o, true);
    turn(AM_MODEL.dead, dead, o + 3, false);
  }
  const deadMid = new Float32Array(AM_DEAD * 3);
  const deadTone = new Uint8Array(AM_DEAD * 2);
  for (let i = 0; i < AM_DEAD; i++) {
    const m = (i * AM_DEAD_PTS + 2) * 6;
    deadMid.set([dead[m], dead[m + 1], dead[m + 2]], i * 3);
    // Lying nearly flat: lit from above, shaded beneath.
    deadTone[i * 2] = 4 * AM_LEVELS + level(unit([dead[m + 3] * 0.3, 1, dead[m + 5] * 0.3]));
    deadTone[i * 2 + 1] = 4 * AM_LEVELS + 1;
  }
  const c = AM_MODEL.core;
  return { leaf, faceN, faceMid, faceTone, teeth, spine, dead, deadMid, deadTone, core: [x + c[0] * h, c[1] * h, z + c[2] * h] };
}
