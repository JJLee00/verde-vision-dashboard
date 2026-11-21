// Madagascar palm's body, grown as a spined trunk and a fountain of strap leaves in the scene's feet.
// Shared by the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Madagascar palm: long strap leaves, yellow-green on top with a pale
 *  midrib, duller olive beneath, over a grey-brown trunk of pale spines. */
export const MADAGASCAR_COLOURS = {
  shade: [72, 82, 40],
  lit: [192, 202, 112],
  under: [98, 108, 60],
  underLit: [176, 184, 118],
  midrib: "rgba(222,226,170,0.7)",
  heart: "rgb(58,58,36)",
  bark: [82, 70, 60],
  barkLit: [182, 164, 140],
  spine: "rgba(220,216,202,0.6)",
};
export const MADAGASCAR_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  under: [126, 90, 42],
  underLit: [214, 178, 112],
  midrib: "rgba(255,240,200,0.85)",
  heart: "rgb(112,78,36)",
  bark: [126, 88, 40],
  barkLit: [226, 186, 120],
  spine: "rgba(255,240,206,0.85)",
};

export type MadagascarPlant = {
  /** the trunk's ring centres, foot to neck, and its rings' points as
   *  offsets, and each face's outward normal and tone */
  axis: Float32Array;
  ring: Float32Array;
  faceN: Float32Array;
  faceTone: Uint8Array;
  /** spines on the trunk: where each sits, and which way it points */
  spines: Float32Array;
  /** the heart of the crown, where the leaves meet */
  heart: [number, number, number];
  /** each leaf's centre line and the half-width across it, as (x, y, z)
   *  pairs, point by point; its middle; the normal of its upper face;
   *  and its tone seen from above and from below */
  leaf: Float32Array;
  mid: Float32Array;
  leafN: Float32Array;
  leafTone: Uint8Array;
};
export const MP_LEVELS = 8;
export const MP_SIDES = 10;
export const MP_PTS = 7;
export const MP_LEAVES = 96;
export const MP_SPINES = 160;
const mpRamp = (lo: number[], hi: number[]) =>
  Array.from({ length: MP_LEVELS }, (_, i) => {
    const t = i / (MP_LEVELS - 1);
    return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
  });
// Leaf tones over, then under, then the bark's — the sheet's and gold.
export const MP_TONES = [MADAGASCAR_COLOURS, MADAGASCAR_GOLD].map((pal) => [
  ...mpRamp(pal.shade, pal.lit),
  ...mpRamp(pal.under, pal.underLit),
  ...mpRamp(pal.bark, pal.barkLit),
]);
// The model in its own measure (its height = 1): the trunk leans from
// its foot to the neck where the leaves begin, thick and tapering, and
// the crown's heart sits just above, over the bounding box's middle.
const MP_FOOT = [0.06, 0.055];
const MP_NECK = [0.012, 0.02];
export const MP_RINGS = [
  [0, 0.05],
  [0.14, 0.046],
  [0.28, 0.041],
  [0.42, 0.037],
  [0.56, 0.035],
];
export const MP_HEART = [0.005, 0.56, 0.01];
// Where a leaf is along its length, and how wide: a narrow foot, a long
// strap, a rounded point.
const MP_ALONG = [0, 0.15, 0.35, 0.55, 0.75, 0.9, 1];
const MP_WIDE = [0.3, 0.9, 1, 1, 0.95, 0.7, 0.15];
// The leaves, the same on every plant as in the headset: a spiral up
// the neck, the oldest at the bottom hanging down the trunk, the middle
// ones arching out and drooping at the tips, the youngest standing up
// out of the top. Each as its centre line and half-width, point by
// point, in the model's measure.
const MP_LEAF = (() => {
  const rng = rngFor("madagascar-palm");
  const out = new Float32Array(MP_LEAVES * MP_PTS * 6);
  const deg = Math.PI / 180;
  for (let i = 0; i < MP_LEAVES; i++) {
    const t = (i + 0.5) / MP_LEAVES;
    const az = i * 2.39996 + (rng() - 0.5) * 0.3;
    const dx = Math.cos(az);
    const dz = Math.sin(az);
    const sx = -dz;
    const sz = dx;
    const rise = (-55 + 135 * Math.pow(t, 0.85) + (rng() - 0.5) * 24) * deg;
    const bend = (0.55 + 0.8 * (1 - t)) * (0.7 + 0.6 * rng());
    const tip = Math.max(rise - bend, -85 * deg);
    // The oldest, hanging, are the shortest left.
    const len = 0.36 * (0.85 + 0.3 * rng()) * (t < 0.25 ? 0.7 + 1.2 * t : 1);
    const hw = 0.026 * (0.85 + 0.3 * rng());
    const tw0 = (rng() - 0.5) * 1.0;
    const tw1 = (rng() - 0.5) * 0.8;
    let px = MP_HEART[0] + dx * 0.035;
    let py = 0.46 + 0.2 * t;
    let pz = MP_HEART[2] + dz * 0.035;
    let prev = 0;
    for (let j = 0; j < MP_PTS; j++) {
      const sAt = MP_ALONG[j];
      if (j > 0) {
        // Along the stretch since the last point, at its middle angle.
        const sm = (prev + sAt) / 2;
        const th = rise + (tip - rise) * Math.pow(sm, 1.5);
        const step = (sAt - prev) * len;
        px += dx * Math.cos(th) * step;
        py += Math.sin(th) * step;
        pz += dz * Math.cos(th) * step;
      }
      prev = sAt;
      const th = rise + (tip - rise) * Math.pow(sAt, 1.5);
      // Across the leaf, twisted a little along it; up off it, the
      // normal of its upper face before the twist.
      const tw = tw0 + tw1 * sAt;
      const ux = -Math.sin(th) * dx;
      const uy = Math.cos(th);
      const uz = -Math.sin(th) * dz;
      const w = hw * MP_WIDE[j];
      const o = (i * MP_PTS + j) * 6;
      out[o] = px;
      out[o + 1] = py;
      out[o + 2] = pz;
      out[o + 3] = (sx * Math.cos(tw) + ux * Math.sin(tw)) * w;
      out[o + 4] = uy * Math.sin(tw) * w;
      out[o + 5] = (sz * Math.cos(tw) + uz * Math.sin(tw)) * w;
    }
  }
  return out;
})();
// Spines up the trunk on a spiral: each one's height and angle.
const MP_SPINE_AT = (() => {
  const rng = rngFor("madagascar-spines");
  const out = new Float32Array(MP_SPINES * 2);
  for (let i = 0; i < MP_SPINES; i++) {
    out[i * 2] = 0.02 + 0.4 * (i / MP_SPINES) + (rng() - 0.5) * 0.01;
    out[i * 2 + 1] = i * 2.39996 + (rng() - 0.5) * 0.4;
  }
  return out;
})();

export function growMadagascar(x: number, z: number, h: number, rot: number): MadagascarPlant {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  const level = (n: V3) =>
    Math.max(0, Math.min(MP_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (MP_LEVELS - 1))));
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const turnX = (mx: number, mz: number) => mx * cr - mz * sr;
  const turnZ = (mx: number, mz: number) => mx * sr + mz * cr;
  const put = (mx: number, my: number, mz: number): V3 => [x + turnX(mx, mz) * h, my * h, z + turnZ(mx, mz) * h];
  const vec = (mx: number, my: number, mz: number): V3 => [turnX(mx, mz), my, turnZ(mx, mz)];

  // The trunk: rings up the lean, faces shaded once.
  const NR = MP_RINGS.length;
  const axis = new Float32Array(NR * 3);
  const ring = new Float32Array(NR * MP_SIDES * 2);
  MP_RINGS.forEach(([y, r], l) => {
    const f = Math.min(1, y / 0.42);
    axis.set(put(MP_FOOT[0] + (MP_NECK[0] - MP_FOOT[0]) * f, y, MP_FOOT[1] + (MP_NECK[1] - MP_FOOT[1]) * f), l * 3);
    for (let j = 0; j < MP_SIDES; j++) {
      const a = rot + (j * Math.PI * 2) / MP_SIDES;
      ring[(l * MP_SIDES + j) * 2] = Math.cos(a) * r * h;
      ring[(l * MP_SIDES + j) * 2 + 1] = Math.sin(a) * r * h;
    }
  });
  const faceN = new Float32Array((NR - 1) * MP_SIDES * 3);
  const faceTone = new Uint8Array((NR - 1) * MP_SIDES);
  for (let b = 0; b < NR - 1; b++) {
    const taper = (MP_RINGS[b][1] - MP_RINGS[b + 1][1]) / (MP_RINGS[b + 1][0] - MP_RINGS[b][0]);
    for (let j = 0; j < MP_SIDES; j++) {
      const a = rot + ((j + 0.5) * Math.PI * 2) / MP_SIDES;
      const l = Math.hypot(1, taper);
      const n: V3 = [Math.cos(a) / l, taper / l, Math.sin(a) / l];
      faceN.set(n, (b * MP_SIDES + j) * 3);
      faceTone[b * MP_SIDES + j] = level(n);
    }
  }
  // Its spines, each standing out of the bark where it sits.
  const spines = new Float32Array(MP_SPINES * 6);
  for (let i = 0; i < MP_SPINES; i++) {
    const y = MP_SPINE_AT[i * 2];
    const a = MP_SPINE_AT[i * 2 + 1] + rot;
    const f = Math.min(1, y / 0.42);
    const r = 0.05 + (0.037 - 0.05) * f;
    const c = put(MP_FOOT[0] + (MP_NECK[0] - MP_FOOT[0]) * f, y, MP_FOOT[1] + (MP_NECK[1] - MP_FOOT[1]) * f);
    spines.set([c[0] + Math.cos(a) * r * h, c[1], c[2] + Math.sin(a) * r * h, Math.cos(a), 0.35, Math.sin(a)], i * 6);
  }

  // The leaves, turned and scaled, each with its upper face's normal.
  const leaf = new Float32Array(MP_LEAVES * MP_PTS * 6);
  const mid = new Float32Array(MP_LEAVES * 3);
  const leafN = new Float32Array(MP_LEAVES * 3);
  const leafTone = new Uint8Array(MP_LEAVES * 2);
  for (let i = 0; i < MP_LEAVES; i++) {
    for (let j = 0; j < MP_PTS; j++) {
      const o = (i * MP_PTS + j) * 6;
      leaf.set(put(MP_LEAF[o], MP_LEAF[o + 1], MP_LEAF[o + 2]), o);
      const w = vec(MP_LEAF[o + 3], MP_LEAF[o + 4], MP_LEAF[o + 5]);
      leaf.set([w[0] * h, w[1] * h, w[2] * h], o + 3);
    }
    const a = (i * MP_PTS + 2) * 6;
    const b = (i * MP_PTS + 4) * 6;
    mid.set([leaf[(i * MP_PTS + 3) * 6], leaf[(i * MP_PTS + 3) * 6 + 1], leaf[(i * MP_PTS + 3) * 6 + 2]], i * 3);
    // Up off the leaf: across it, crossed with along it.
    const tx = leaf[b] - leaf[a];
    const ty = leaf[b + 1] - leaf[a + 1];
    const tz = leaf[b + 2] - leaf[a + 2];
    const wx = leaf[(i * MP_PTS + 3) * 6 + 3];
    const wy = leaf[(i * MP_PTS + 3) * 6 + 4];
    const wz = leaf[(i * MP_PTS + 3) * 6 + 5];
    let n: V3 = [wy * tz - wz * ty, wz * tx - wx * tz, wx * ty - wy * tx];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    leafN.set(n, i * 3);
    leafTone[i * 2] = level(n);
    leafTone[i * 2 + 1] = MP_LEVELS + level([-n[0], -n[1], -n[2]]);
  }
  return { axis, ring, faceN, faceTone, spines, heart: put(MP_HEART[0], MP_HEART[1], MP_HEART[2]), leaf, mid, leafN, leafTone };
}
