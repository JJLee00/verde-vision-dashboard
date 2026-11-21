// Tropical agave's body, grown as twisted strap leaves in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Tropical agave: variegated — cream margins down every leaf with a broad
 *  grey-green stripe between them, on both faces; the undersides' margins
 *  paler and greener. */
export const TROPICAL_AGAVE_COLOURS = {
  cream: [[150, 146, 100], [236, 230, 176]],
  green: [[98, 112, 84], [180, 196, 158]],
  under: [[126, 132, 92], [208, 210, 170]],
  spine: "rgb(96,72,52)",
};
export const TROPICAL_AGAVE_GOLD = {
  cream: [[160, 120, 60], [248, 220, 150]],
  green: [[130, 94, 40], [222, 186, 108]],
  under: [[126, 90, 42], [214, 178, 112]],
  spine: "rgb(110,76,30)",
};

// The tropical agave's leaves, the same on every plant as in the
// headset, in the model's measure (its height = 1): forty-eight straight
// out of the ground on the golden angle. The oldest are splayed flat
// across it; then a few held low; most rise at 45–65° in an open vase,
// the youngest stand up in the middle. Every leaf arches back toward its
// tip. A leaf is a strap, widest past its middle, soft and a little
// twisted, so each is its centre line and the half-width across it,
// station by station, as (x, y, z) pairs.
export const TA_LEAVES = 48;
export const TA_ALONG = [0, 0.12, 0.28, 0.46, 0.64, 0.82, 1];
export const TA_WIDE = [0.55, 0.85, 1, 1, 0.9, 0.6, 0];
export const TA_PTS = TA_ALONG.length;
export const TA_STRIPE = 0.6; // the green stripe, of the leaf's width
export const TA_LEVELS = 8;
export const taRamp = (lo: number[], hi: number[]) =>
  Array.from({ length: TA_LEVELS }, (_, i) => {
    const t = i / (TA_LEVELS - 1);
    return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
  });
// Cream, green stripe, under — the sheet's and gold.
export const TA_TONES = [TROPICAL_AGAVE_COLOURS, TROPICAL_AGAVE_GOLD].map((pal) => [
  ...taRamp(pal.cream[0], pal.cream[1]),
  ...taRamp(pal.green[0], pal.green[1]),
  ...taRamp(pal.under[0], pal.under[1]),
]);
// The scan's leaves by how steeply they leave the ground, oldest first:
// where along the list (0–1) each elevation is reached, in degrees.
export const TA_RISE = [
  [0, -12],
  [0.22, 5],
  [0.4, 18],
  [0.55, 40],
  [0.6, 48],
  [0.88, 62],
  [1, 82],
];
export const TA_LEAF = (() => {
  const rng = rngFor("tropical-agave");
  const deg = Math.PI / 180;
  const out = new Float32Array(TA_LEAVES * TA_PTS * 6);
  let top = 0;
  for (let i = 0; i < TA_LEAVES; i++) {
    const t = i / (TA_LEAVES - 1);
    let k = 0;
    while (k < TA_RISE.length - 2 && TA_RISE[k + 1][0] < t) k++;
    const f = (t - TA_RISE[k][0]) / (TA_RISE[k + 1][0] - TA_RISE[k][0]);
    const chord = TA_RISE[k][1] + (TA_RISE[k + 1][1] - TA_RISE[k][1]) * f + (rng() - 0.5) * 8;
    // Arching back: the steeper the leaf, the more it bends over at the
    // end; the flat ones lie on the ground already.
    const bend = (chord < 10 ? 18 : 22 + 14 * Math.sin(Math.min(1, chord / 70) * Math.PI)) * (0.75 + 0.5 * rng()) * deg;
    const e0 = chord * deg + bend * 0.45;
    const len = (0.47 + 0.0062 * Math.max(0, chord)) * (0.9 + 0.2 * rng()) * 1.04;
    const hw = 0.12 * (0.85 + 0.3 * rng()) * (1 - 0.2 * t);
    const az = i * 2.39996 + (rng() - 0.5) * 0.3;
    const tw0 = (rng() - 0.5) * 0.5;
    const tw1 = (rng() - 0.5) * 0.9;
    const dx = Math.cos(az);
    const dz = Math.sin(az);
    let px = dx * 0.04 * (1 - t);
    let py = 0.02 + 0.08 * t;
    let pz = dz * 0.04 * (1 - t);
    let prev = 0;
    for (let j = 0; j < TA_PTS; j++) {
      const s = TA_ALONG[j];
      if (j > 0) {
        const sm = (prev + s) / 2;
        const e = e0 - bend * Math.pow(sm, 1.6);
        const step = (s - prev) * len;
        px += dx * Math.cos(e) * step;
        py = Math.max(0.006, py + Math.sin(e) * step);
        pz += dz * Math.cos(e) * step;
      }
      prev = s;
      // Across the leaf, twisted a little along it about its own line.
      const e = e0 - bend * Math.pow(s, 1.6);
      const tw = tw0 + tw1 * s;
      const w = hw * TA_WIDE[j];
      const o = (i * TA_PTS + j) * 6;
      out[o] = px;
      out[o + 1] = py;
      out[o + 2] = pz;
      out[o + 3] = (-dz * Math.cos(tw) - dx * Math.sin(e) * Math.sin(tw)) * w;
      out[o + 4] = Math.cos(e) * Math.sin(tw) * w;
      out[o + 5] = (dx * Math.cos(tw) - dz * Math.sin(e) * Math.sin(tw)) * w;
      top = Math.max(top, py);
    }
  }
  for (let k = 1; k < out.length; k += 3) out[k] /= top;
  return out;
})();

// Grown once per plant and kept, as the trees are.
export type TropicalAgavePlant = {
  /** each leaf's centre line and half-width, turned, scaled and placed;
   *  its middle; the normal of its upper face; and its tones — margin
   *  and stripe seen from above, then from below */
  leaf: Float32Array;
  mid: Float32Array;
  leafN: Float32Array;
  leafTone: Uint8Array;
  heart: [number, number, number];
};

export function growTropicalAgave(x: number, z: number, h: number, rot: number): TropicalAgavePlant {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  const level = (n: V3) =>
    Math.max(0, Math.min(TA_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (TA_LEVELS - 1))));
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const leaf = new Float32Array(TA_LEAF.length);
  for (let o = 0; o < leaf.length; o += 6) {
    const mx = TA_LEAF[o];
    const mz = TA_LEAF[o + 2];
    const wx = TA_LEAF[o + 3];
    const wz = TA_LEAF[o + 5];
    leaf[o] = x + (mx * cr - mz * sr) * h;
    leaf[o + 1] = TA_LEAF[o + 1] * h;
    leaf[o + 2] = z + (mx * sr + mz * cr) * h;
    leaf[o + 3] = (wx * cr - wz * sr) * h;
    leaf[o + 4] = TA_LEAF[o + 4] * h;
    leaf[o + 5] = (wx * sr + wz * cr) * h;
  }
  const mid = new Float32Array(TA_LEAVES * 3);
  const leafN = new Float32Array(TA_LEAVES * 3);
  const leafTone = new Uint8Array(TA_LEAVES * 4);
  for (let i = 0; i < TA_LEAVES; i++) {
    const a = (i * TA_PTS + 2) * 6;
    const b = (i * TA_PTS + 4) * 6;
    const m = (i * TA_PTS + 3) * 6;
    mid.set([leaf[m], leaf[m + 1], leaf[m + 2]], i * 3);
    // Up off the leaf: across it, crossed with along it.
    const tx = leaf[b] - leaf[a];
    const ty = leaf[b + 1] - leaf[a + 1];
    const tz = leaf[b + 2] - leaf[a + 2];
    const wx = leaf[m + 3];
    const wy = leaf[m + 4];
    const wz = leaf[m + 5];
    let n: V3 = [wy * tz - wz * ty, wz * tx - wx * tz, wx * ty - wy * tx];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    leafN.set(n, i * 3);
    const down = level([-n[0], -n[1], -n[2]]);
    leafTone[i * 4] = level(n);
    leafTone[i * 4 + 1] = TA_LEVELS + level(n);
    leafTone[i * 4 + 2] = 2 * TA_LEVELS + down;
    leafTone[i * 4 + 3] = TA_LEVELS + down;
  }
  return { leaf, mid, leafN, leafTone, heart: [x, 0.3 * h, z] };
}
