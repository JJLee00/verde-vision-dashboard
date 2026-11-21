// Agave truncata's body, grown as cupped leaves, teeth and spines in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Agave truncata: pale glaucous blue-grey above, the backs a creamy sage;
 *  fine red-brown teeth and a stout red-brown spine at every tip. */
export const TRUNCATA_COLOURS = {
  upper: [[104, 118, 112], [204, 214, 206]],
  under: [[122, 130, 118], [222, 218, 190]],
  core: "rgb(58,70,66)",
  margin: "rgba(132,96,72,0.5)",
  teeth: "rgb(128,78,58)",
  spine: "rgb(92,52,38)",
};
export const TRUNCATA_GOLD = {
  upper: [[140, 100, 46], [236, 200, 128]],
  under: [[126, 90, 42], [214, 178, 112]],
  core: "rgb(100,70,30)",
  margin: "rgba(140,90,36,0.6)",
  teeth: "rgb(118,74,26)",
  spine: "rgb(96,62,22)",
};

// The truncata's leaves, the same on every plant as in the headset, in
// the model's measure (its height = 1): thirty-four on the golden angle
// up a short cone, their tips spread evenly over a dome — the oldest out
// at the rim a third of the way up, the youngest closed into a bud at
// the top. Every leaf leaves the stem flatter than it ends: they curl
// up and in, which is what stands the sides up straight and makes the
// artichoke. A leaf is a broad, thick spoon: the fold down its middle,
// the margins cupped up either side of it, a shallow keel beneath; four
// faces between those lines, and every face in two halves — below and
// above the leaf's widest — since a leaf that runs out flat and then
// stands up shows its back only on the half that stands. Each station
// holds fold, left margin, right margin, keel, as (x, y, z).
export const TC_LEAVES = 34;
export const TC_ALONG = [0, 0.14, 0.3, 0.46, 0.62, 0.76, 0.87, 0.94, 1];
// Narrow where it joins, widest three-quarters out, then rounded off
// short to the spine: a paddle, not a blade.
export const TC_WIDE = [0.4, 0.55, 0.72, 0.88, 0.98, 1, 0.86, 0.56, 0];
export const TC_PTS = TC_ALONG.length;
export const TC_SPLIT = 4; // the station the two halves share
export const TC_FACES = TC_LEAVES * 2 * 4;
export const TC_FACE_LINES = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
];
export const TC_TEETH = 8; // down each margin
export const TC_LEVELS = 8;
export const tcRamp = (lo: number[], hi: number[]) =>
  Array.from({ length: TC_LEVELS }, (_, i) => {
    const t = i / (TC_LEVELS - 1);
    return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
  });
// Upper, then under — the sheet's and gold.
export const TC_TONES = [TRUNCATA_COLOURS, TRUNCATA_GOLD].map((pal) => [
  ...tcRamp(pal.upper[0], pal.upper[1]),
  ...tcRamp(pal.under[0], pal.under[1]),
]);
export const TC_MODEL = (() => {
  const rng = rngFor("agave-truncata");
  const deg = Math.PI / 180;
  const leaf = new Float32Array(TC_LEAVES * TC_PTS * 12);
  // Each tooth: where it sits on the margin, then out to its point, then
  // half its foot along the margin.
  const teeth = new Float32Array(TC_LEAVES * 2 * TC_TEETH * 9);
  const toothHalf = new Uint8Array(TC_LEAVES * 2 * TC_TEETH);
  // Each leaf's tip, and the end of the spine past it.
  const spine = new Float32Array(TC_LEAVES * 6);
  let top = 0;
  for (let i = 0; i < TC_LEAVES; i++) {
    const t = i / (TC_LEAVES - 1); // 0 the oldest, outermost; 1 the youngest
    // Where the tip lands on the dome, and where the leaf leaves the stem.
    const lat = (6 + 76 * t + (rng() - 0.5) * 6) * deg;
    const tipR = 1.02 * Math.cos(lat);
    const tipY = 0.28 + 0.72 * Math.sin(lat);
    // A broad crown: the old leaves come out of it well clear of the
    // middle, so what shows of them stands up as a wall.
    const r0 = 0.03 + 0.5 * Math.pow(1 - t, 1.5);
    const y0 = 0.03 + 0.4 * Math.pow(t, 1.2);
    // The curl gathers toward the end — the old leaves run out low and
    // then stand up — and the leaf is aimed and sized so that, curled,
    // its tip still lands on the dome.
    const curl = (75 - 66 * t + (rng() - 0.5) * 8) * deg;
    const angle = (s: number) => e0 + curl * Math.pow(s, 1.8);
    const reach = () => {
      let dr = 0;
      let dy = 0;
      for (let j = 1; j < TC_PTS; j++) {
        const e = angle((TC_ALONG[j - 1] + TC_ALONG[j]) / 2);
        dr += Math.cos(e) * (TC_ALONG[j] - TC_ALONG[j - 1]) * len;
        dy += Math.sin(e) * (TC_ALONG[j] - TC_ALONG[j - 1]) * len;
      }
      return [dr, dy];
    };
    const want = Math.atan2(tipY - y0, tipR - r0);
    const far = Math.hypot(tipR - r0, tipY - y0);
    let e0 = want;
    let len = far;
    for (let k = 0; k < 8; k++) {
      const [dr, dy] = reach();
      e0 += want - Math.atan2(dy, dr);
      len *= far / Math.hypot(dr, dy);
    }
    const hw = 0.34 * (1 - 0.45 * t) * (0.9 + 0.2 * rng());
    const az = i * 2.39996 + (rng() - 0.5) * 0.2;
    const sway = (rng() - 0.5) * 16 * deg;
    let px = Math.cos(az) * r0;
    let py = y0;
    let pz = Math.sin(az) * r0;
    let prev = 0;
    const frame: number[][] = [];
    for (let j = 0; j < TC_PTS; j++) {
      const s = TC_ALONG[j];
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
      const w = hw * TC_WIDE[j];
      const cup = 0.24 * w;
      const keel = 0.14 * w;
      leaf.set(
        [
          px, py, pz,
          px + S[0] * w + N[0] * cup, py + N[1] * cup, pz + S[2] * w + N[2] * cup,
          px - S[0] * w + N[0] * cup, py + N[1] * cup, pz - S[2] * w + N[2] * cup,
          px - N[0] * keel, py - N[1] * keel, pz - N[2] * keel,
        ],
        (i * TC_PTS + j) * 12,
      );
      frame.push([...T, ...S, ...N]);
      top = Math.max(top, py);
    }
    // The terminal spine: short and stout, straight on from the tip.
    const T = frame[TC_PTS - 1];
    const tip = (i * TC_PTS + TC_PTS - 1) * 12;
    const sl = 0.06;
    spine.set([leaf[tip], leaf[tip + 1], leaf[tip + 2], leaf[tip] + T[0] * sl, leaf[tip + 1] + T[1] * sl, leaf[tip + 2] + T[2] * sl], i * 6);
    // Fine teeth down the outer two-thirds of both margins.
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? 1 : -1;
      for (let k2 = 0; k2 < TC_TEETH; k2++) {
        const s = 0.2 + (0.68 * (k2 + 0.3 + rng() * 0.4)) / TC_TEETH;
        let j = 0;
        while (j < TC_PTS - 2 && TC_ALONG[j + 1] < s) j++;
        const fr = (s - TC_ALONG[j]) / (TC_ALONG[j + 1] - TC_ALONG[j]);
        const a = (i * TC_PTS + j) * 12 + 3 + side * 3;
        const b = a + 12;
        const [Tx, Ty, Tz, Sx, , Sz, Nx, Ny, Nz] = frame[j];
        const size = hw / 0.34;
        const out = 0.02 * size;
        const foot = 0.011 * size;
        teeth.set(
          [
            leaf[a] + (leaf[b] - leaf[a]) * fr,
            leaf[a + 1] + (leaf[b + 1] - leaf[a + 1]) * fr,
            leaf[a + 2] + (leaf[b + 2] - leaf[a + 2]) * fr,
            (Sx * sg * 0.8 + Nx * 0.35 + Tx * 0.4) * out,
            (Ny * 0.35 + Ty * 0.4) * out,
            (Sz * sg * 0.8 + Nz * 0.35 + Tz * 0.4) * out,
            Tx * foot,
            Ty * foot,
            Tz * foot,
          ],
          ((i * 2 + side) * TC_TEETH + k2) * 9,
        );
        toothHalf[(i * 2 + side) * TC_TEETH + k2] = s < TC_ALONG[TC_SPLIT] ? 0 : 1;
      }
    }
  }
  // The tallest leaf tip to the full height.
  const ys = 1 / top;
  for (let k = 1; k < leaf.length; k += 3) leaf[k] *= ys;
  for (let k = 1; k < teeth.length; k += 3) teeth[k] *= ys;
  for (let k = 1; k < spine.length; k += 3) spine[k] *= ys;
  return { leaf, teeth, toothHalf, spine, core: [0, 0.36 * ys, 0] };
})();

// Grown once per plant and kept, as the trees are.
export type TruncataPlant = {
  /** the leaves' lines, turned, scaled and placed */
  leaf: Float32Array;
  /** each face's outward normal, its middle and its tone */
  faceN: Float32Array;
  faceMid: Float32Array;
  faceTone: Uint8Array;
  teeth: Float32Array;
  spine: Float32Array;
  core: [number, number, number];
};
// The packed leaf bases inside, as a cone in the model's measure: rings
// of (radius, height) round the middle. It stays under the old leaves,
// which run out low, and fills what's seen past their tips.
export const TC_DOME_AROUND = 16;
export const TC_DOME = (() => {
  const rings = [
    [0.52, 0],
    [0.42, 0.15],
    [0.3, 0.32],
    [0.16, 0.5],
    [0.04, 0.62],
  ];
  const pts = new Float32Array(rings.length * TC_DOME_AROUND * 3);
  rings.forEach(([r, y], k) => {
    for (let a = 0; a < TC_DOME_AROUND; a++) {
      const th = (a / TC_DOME_AROUND) * Math.PI * 2;
      pts.set([Math.cos(th) * r, y, Math.sin(th) * r], (k * TC_DOME_AROUND + a) * 3);
    }
  });
  return pts;
})();

export function growTruncata(x: number, z: number, h: number, rot: number): TruncataPlant {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  const level = (n: V3) =>
    Math.max(0, Math.min(TC_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (TC_LEVELS - 1))));
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

  const leaf = new Float32Array(TC_MODEL.leaf.length);
  for (let o = 0; o < leaf.length; o += 3) turn(TC_MODEL.leaf, leaf, o, true);
  const teeth = new Float32Array(TC_MODEL.teeth.length);
  for (let o = 0; o < teeth.length; o += 9) {
    turn(TC_MODEL.teeth, teeth, o, true);
    turn(TC_MODEL.teeth, teeth, o + 3, false);
    turn(TC_MODEL.teeth, teeth, o + 6, false);
  }
  const spine = new Float32Array(TC_MODEL.spine.length);
  for (let o = 0; o < spine.length; o += 3) turn(TC_MODEL.spine, spine, o, true);
  // Each face lit by its normal halfway along its half, pointed away
  // from the middle of the leaf's section.
  const faceN = new Float32Array(TC_FACES * 3);
  const faceMid = new Float32Array(TC_FACES * 3);
  const faceTone = new Uint8Array(TC_FACES);
  const pt = (i: number, j: number, line: number, k: number) => leaf[(i * TC_PTS + j) * 12 + line * 3 + k];
  for (let i = 0; i < TC_LEAVES; i++) {
    for (let g = 0; g < 2; g++) {
      const m = g === 0 ? 2 : 6;
      const along: V3 = [0, 1, 2].map((k) => pt(i, m + 1, 0, k) - pt(i, m - 1, 0, k)) as V3;
      const middle: V3 = [0, 1, 2].map((k) => pt(i, m, 0, k) * 0.6 + pt(i, m, 3, k) * 0.4) as V3;
      for (let f = 0; f < 4; f++) {
        const [la, lb] = TC_FACE_LINES[f];
        const a: V3 = [0, 1, 2].map((k) => pt(i, m, la, k)) as V3;
        const b: V3 = [0, 1, 2].map((k) => pt(i, m, lb, k)) as V3;
        const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let n = unit([along[1] * ac[2] - along[2] * ac[1], along[2] * ac[0] - along[0] * ac[2], along[0] * ac[1] - along[1] * ac[0]]);
        const out = [(a[0] + b[0]) / 2 - middle[0], (a[1] + b[1]) / 2 - middle[1], (a[2] + b[2]) / 2 - middle[2]];
        if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
        const fi = (i * 2 + g) * 4 + f;
        faceN.set(n, fi * 3);
        for (let k = 0; k < 3; k++) faceMid[fi * 3 + k] = (a[k] + b[k]) / 2;
        faceTone[fi] = (f < 2 ? 0 : TC_LEVELS) + level(n);
      }
    }
  }
  const c = TC_MODEL.core;
  return { leaf, faceN, faceMid, faceTone, teeth, spine, core: [x + c[0] * h, c[1] * h, z + c[2] * h] };
}
