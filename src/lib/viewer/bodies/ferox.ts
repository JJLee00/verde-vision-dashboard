// Aloe ferox's body, grown as thick channelled leaves, teeth and dead leaves in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Aloe ferox: thick glaucous leaves, olive grey-green, the undersides a
 *  little duller; red-brown teeth down every margin; a skirt of dead leaves
 *  gone brown at the foot. */
export const FEROX_COLOURS = {
  upper: [[96, 106, 86], [196, 204, 176]],
  under: [[80, 88, 70], [170, 178, 152]],
  dead: [[72, 54, 42], [160, 130, 100]],
  core: "rgb(48,54,42)",
  margin: "rgba(132,70,46,0.6)",
  teeth: "rgb(150,74,44)",
};
export const FEROX_GOLD = {
  upper: [[140, 100, 46], [236, 200, 128]],
  under: [[126, 90, 42], [214, 178, 112]],
  dead: [[110, 76, 36], [200, 160, 96]],
  core: "rgb(100,70,30)",
  margin: "rgba(140,90,36,0.6)",
  teeth: "rgb(128,78,28)",
};

// The aloe ferox's leaves, the same on every plant as in the headset, in
// the model's measure (its height = 1): twenty-two on the golden angle off
// a short stem, the oldest lowest. The outer ones are held out nearly flat,
// the middle ones are the longest and rise at about 55°, the youngest
// stand up in the centre. A leaf is a thick blade, so it is four lines
// along its length — the fold down its middle, the two margins raised
// above it into a channel, the keel beneath — and four faces between
// them: upper left and right, under left and right. Each station holds
// fold, left margin, right margin, keel, as (x, y, z).
export const AF_LEAVES = 22;
export const AF_ALONG = [0, 0.12, 0.28, 0.46, 0.64, 0.82, 1];
export const AF_PTS = AF_ALONG.length;
export const AF_FACES = AF_LEAVES * 4;
// Which two lines bound each face, and which margin it shares.
export const AF_FACE_LINES = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
];
export const AF_TEETH = 15; // down each margin
export const AF_DEAD = 8;
export const AF_DEAD_PTS = 5;
export const AF_LEVELS = 8;
export const afRamp = (lo: number[], hi: number[]) =>
  Array.from({ length: AF_LEVELS }, (_, i) => {
    const t = i / (AF_LEVELS - 1);
    return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
  });
// Upper faces, under faces, dead leaves — the sheet's and gold.
export const AF_TONES = [FEROX_COLOURS, FEROX_GOLD].map((pal) => [
  ...afRamp(pal.upper[0], pal.upper[1]),
  ...afRamp(pal.under[0], pal.under[1]),
  ...afRamp(pal.dead[0], pal.dead[1]),
]);
export const AF_MODEL = (() => {
  const rng = rngFor("aloe-ferox");
  const deg = Math.PI / 180;
  const leaf = new Float32Array(AF_LEAVES * AF_PTS * 12);
  // Each tooth: where it sits on the margin, then out to its point, then
  // half its foot along the margin.
  const teeth = new Float32Array(AF_LEAVES * 2 * AF_TEETH * 9);
  const dead = new Float32Array(AF_DEAD * AF_DEAD_PTS * 6);
  let top = 0;
  for (let i = 0; i < AF_LEAVES; i++) {
    const t = i / (AF_LEAVES - 1); // 0 the oldest, outermost; 1 the youngest
    const az = i * 2.39996 + (rng() - 0.5) * 0.3;
    const e0Deg = 12 + 64 * Math.pow(t, 1.1) + (rng() - 0.5) * 10;
    const e0 = e0Deg * deg;
    // Every leaf turns up a little toward its tip.
    const bend = (-10 + (rng() - 0.5) * 10) * deg;
    const len = (0.7 + 0.32 * Math.exp(-(((e0Deg - 57) / 18) ** 2))) * (0.92 + 0.16 * rng());
    const hw = 0.15 * (0.85 + 0.3 * rng()) * (1 - 0.25 * t);
    const sway = (rng() - 0.5) * 16 * deg;
    const r0 = 0.05 * (1 - 0.5 * t);
    let px = Math.cos(az) * r0;
    let py = 0.1 + 0.2 * Math.pow(t, 0.8);
    let pz = Math.sin(az) * r0;
    let prev = 0;
    const frame: number[][] = [];
    for (let j = 0; j < AF_PTS; j++) {
      const s = AF_ALONG[j];
      if (j > 0) {
        // Along the stretch since the last station, at its middle angle.
        const sm = (prev + s) / 2;
        const e = e0 - bend * Math.pow(sm, 1.5);
        const ps = az + sway * sm * sm;
        const step = (s - prev) * len;
        px += Math.cos(e) * Math.cos(ps) * step;
        py += Math.sin(e) * step;
        pz += Math.cos(e) * Math.sin(ps) * step;
      }
      prev = s;
      // Along the leaf; across it, level; and up off its upper face
      // (across × along) — up on a flat leaf, in toward the crown on an
      // upright one.
      const e = e0 - bend * Math.pow(s, 1.5);
      const ps = az + sway * s * s;
      const T = [Math.cos(e) * Math.cos(ps), Math.sin(e), Math.cos(e) * Math.sin(ps)];
      const S = [-Math.sin(ps), 0, Math.cos(ps)];
      const N = [-Math.cos(ps) * Math.sin(e), Math.cos(e), -Math.sin(ps) * Math.sin(e)];
      // Broad at the clasp, tapering the whole way to a sharp point.
      const w = hw * Math.pow(1 - s, 0.6) * (0.85 + 0.15 * Math.min(1, s / 0.12));
      const fold = 0.12 * w;
      const keel = 0.5 * w;
      leaf.set(
        [
          px, py, pz,
          px + S[0] * w + N[0] * fold, py + N[1] * fold, pz + S[2] * w + N[2] * fold,
          px - S[0] * w + N[0] * fold, py + N[1] * fold, pz - S[2] * w + N[2] * fold,
          px - N[0] * keel, py - N[1] * keel, pz - N[2] * keel,
        ],
        (i * AF_PTS + j) * 12,
      );
      frame.push([...T, ...S, ...N]);
      top = Math.max(top, py);
    }
    // Teeth down both margins, hooked a little toward the tip, smaller
    // as the leaf narrows.
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? 1 : -1;
      for (let k = 0; k < AF_TEETH; k++) {
        const s = 0.06 + (0.8 * (k + 0.3 + rng() * 0.4)) / AF_TEETH;
        let j = 0;
        while (j < AF_PTS - 2 && AF_ALONG[j + 1] < s) j++;
        const f = (s - AF_ALONG[j]) / (AF_ALONG[j + 1] - AF_ALONG[j]);
        const a = (i * AF_PTS + j) * 12 + 3 + side * 3;
        const b = a + 12;
        const [Tx, Ty, Tz, Sx, , Sz, Nx, Ny, Nz] = frame[j];
        const size = (hw / 0.15) * (1 - 0.55 * s);
        const out = 0.012 * size;
        const foot = 0.007 * size;
        teeth.set(
          [
            leaf[a] + (leaf[b] - leaf[a]) * f,
            leaf[a + 1] + (leaf[b + 1] - leaf[a + 1]) * f,
            leaf[a + 2] + (leaf[b + 2] - leaf[a + 2]) * f,
            (Sx * sg * 0.9 + Nx * 0.2 + Tx * 0.35) * out,
            (Ny * 0.2 + Ty * 0.35) * out,
            (Sz * sg * 0.9 + Nz * 0.2 + Tz * 0.35) * out,
            Tx * foot,
            Ty * foot,
            Tz * foot,
          ],
          ((i * 2 + side) * AF_TEETH + k) * 9,
        );
      }
    }
  }
  // The dead leaves at the foot: narrow, gone brown, curled down to the
  // ground and lying on it. Each as centre and half-width, point by point.
  for (let i = 0; i < AF_DEAD; i++) {
    const az = i * 2.39996 + 0.8 + (rng() - 0.5) * 0.5;
    const e0 = (-30 - rng() * 30) * deg;
    const curl = (20 + rng() * 40) * deg;
    const len = 0.14 + rng() * 0.1;
    const hw = 0.03 * (0.8 + 0.4 * rng());
    const lift = (rng() - 0.5) * 0.6;
    let px = Math.cos(az) * 0.05;
    let py = 0.05 + rng() * 0.05;
    let pz = Math.sin(az) * 0.05;
    for (let j = 0; j < AF_DEAD_PTS; j++) {
      const s = j / (AF_DEAD_PTS - 1);
      if (j > 0) {
        const e = e0 - curl * ((j - 0.5) / (AF_DEAD_PTS - 1));
        const step = len / (AF_DEAD_PTS - 1);
        px += Math.cos(e) * Math.cos(az) * step;
        py = Math.max(0.004, py + Math.sin(e) * step);
        pz += Math.cos(e) * Math.sin(az) * step;
      }
      const w = hw * (1 - 0.7 * s);
      dead.set([px, py, pz, -Math.sin(az) * w, lift * w, Math.cos(az) * w], (i * AF_DEAD_PTS + j) * 6);
    }
  }
  // The tallest leaf tip to the full height.
  const ys = 1 / top;
  for (let k = 1; k < leaf.length; k += 3) leaf[k] *= ys;
  for (let k = 1; k < teeth.length; k += 3) teeth[k] *= ys;
  for (let k = 1; k < dead.length; k += 3) dead[k] *= ys;
  return { leaf, teeth, dead, core: [0, 0.2 * ys, 0] };
})();

// Grown once per plant and kept, as the trees are.
export type FeroxPlant = {
  /** the leaves' lines, turned, scaled and placed */
  leaf: Float32Array;
  /** each face's outward normal, its middle and its tone */
  faceN: Float32Array;
  faceMid: Float32Array;
  faceTone: Uint8Array;
  teeth: Float32Array;
  /** the dead leaves as centre and half-width, each one's middle, the
   *  normal of its upper side, and its tone seen from above and below */
  dead: Float32Array;
  deadMid: Float32Array;
  deadN: Float32Array;
  deadTone: Uint8Array;
  core: [number, number, number];
};

export function growFerox(x: number, z: number, h: number, rot: number): FeroxPlant {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  const level = (n: V3) =>
    Math.max(0, Math.min(AF_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (AF_LEVELS - 1))));
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

  const leaf = new Float32Array(AF_MODEL.leaf.length);
  for (let o = 0; o < leaf.length; o += 3) turn(AF_MODEL.leaf, leaf, o, true);
  const teeth = new Float32Array(AF_MODEL.teeth.length);
  for (let o = 0; o < teeth.length; o += 9) {
    turn(AF_MODEL.teeth, teeth, o, true);
    turn(AF_MODEL.teeth, teeth, o + 3, false);
    turn(AF_MODEL.teeth, teeth, o + 6, false);
  }
  // Each face lit by its normal a third of the way out, pointed away
  // from the middle of the leaf's section.
  const faceN = new Float32Array(AF_FACES * 3);
  const faceMid = new Float32Array(AF_FACES * 3);
  const faceTone = new Uint8Array(AF_FACES);
  const pt = (i: number, j: number, line: number, k: number) => leaf[(i * AF_PTS + j) * 12 + line * 3 + k];
  for (let i = 0; i < AF_LEAVES; i++) {
    const along: V3 = [0, 1, 2].map((k) => pt(i, 3, 0, k) - pt(i, 1, 0, k)) as V3;
    const middle: V3 = [0, 1, 2].map((k) => pt(i, 2, 0, k) * 0.6 + pt(i, 2, 3, k) * 0.4) as V3;
    for (let f = 0; f < 4; f++) {
      const [la, lb] = AF_FACE_LINES[f];
      const a: V3 = [0, 1, 2].map((k) => pt(i, 2, la, k)) as V3;
      const b: V3 = [0, 1, 2].map((k) => pt(i, 2, lb, k)) as V3;
      const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      let n = unit([along[1] * ac[2] - along[2] * ac[1], along[2] * ac[0] - along[0] * ac[2], along[0] * ac[1] - along[1] * ac[0]]);
      const out = [(a[0] + b[0]) / 2 - middle[0], (a[1] + b[1]) / 2 - middle[1], (a[2] + b[2]) / 2 - middle[2]];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
      const fi = i * 4 + f;
      faceN.set(n, fi * 3);
      for (let k = 0; k < 3; k++) faceMid[fi * 3 + k] = (pt(i, 3, la, k) + pt(i, 3, lb, k)) / 2;
      faceTone[fi] = AF_LEVELS + level(n);
    }
    // The upper face, though channelled, reads as one broad surface:
    // both halves take the tone of their mean. Halves apart, every leaf
    // is a folded blade, light and dark, and the plant an agave.
    const o = i * 12;
    const up = unit([faceN[o] + faceN[o + 3], faceN[o + 1] + faceN[o + 4], faceN[o + 2] + faceN[o + 5]]);
    faceTone[i * 4] = faceTone[i * 4 + 1] = level(up);
  }

  const dead = new Float32Array(AF_MODEL.dead.length);
  for (let o = 0; o < dead.length; o += 6) {
    turn(AF_MODEL.dead, dead, o, true);
    turn(AF_MODEL.dead, dead, o + 3, false);
  }
  const deadMid = new Float32Array(AF_DEAD * 3);
  const deadN = new Float32Array(AF_DEAD * 3);
  const deadTone = new Uint8Array(AF_DEAD * 2);
  for (let i = 0; i < AF_DEAD; i++) {
    const a = (i * AF_DEAD_PTS + 1) * 6;
    const b = (i * AF_DEAD_PTS + 3) * 6;
    const m = (i * AF_DEAD_PTS + 2) * 6;
    deadMid.set([dead[m], dead[m + 1], dead[m + 2]], i * 3);
    const t: V3 = [dead[b] - dead[a], dead[b + 1] - dead[a + 1], dead[b + 2] - dead[a + 2]];
    const w: V3 = [dead[m + 3], dead[m + 4], dead[m + 5]];
    let n = unit([w[1] * t[2] - w[2] * t[1], w[2] * t[0] - w[0] * t[2], w[0] * t[1] - w[1] * t[0]]);
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    deadN.set(n, i * 3);
    deadTone[i * 2] = 2 * AF_LEVELS + level(n);
    deadTone[i * 2 + 1] = 2 * AF_LEVELS + level([-n[0], -n[1], -n[2]]);
  }
  const c = AF_MODEL.core;
  return { leaf, faceN, faceMid, faceTone, teeth, dead, deadMid, deadN, deadTone, core: [x + c[0] * h, c[1] * h, z + c[2] * h] };
}
