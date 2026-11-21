// Black Tip agave's body, grown as folded lance leaves in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Black Tip agave as the app's scan is: pale glaucous blue-grey, the
 *  backs a little greener; fine pale margins and dark spines. Measured off
 *  the model's render. */
export const BLACK_TIP_COLOURS = {
  upper: [[38, 48, 52], [158, 170, 168]],
  back: [[72, 84, 82], [170, 178, 168]],
  core: "rgb(64,78,78)",
  margin: "rgba(226,232,226,0.45)",
  spine: "rgb(36,30,28)",
};
export const BLACK_TIP_GOLD = {
  upper: [[140, 100, 46], [236, 200, 128]],
  back: [[126, 90, 42], [214, 178, 112]],
  core: "rgb(100,70,30)",
  margin: "rgba(255,236,190,0.5)",
  spine: "rgb(96,62,22)",
};

// Black Tip's leaves, the same on every plant as in the headset, from
// the app's scan: a hundred and fifty on the golden angle, their tips
// spread evenly up a low dome (the scan's 124 outermost tips run from
// flat on the ground to near upright, as many at every height), the
// oldest lowest, the youngest closed into a bud on top. A leaf is a
// lance, folded down its middle and keeled beneath, from a crown that
// rises as the leaves get younger. Each station holds the midrib, left
// margin, right margin, keel, as (x, y, z).
export const BT_LEAVES = 150;
export const BT_ALONG = [0, 0.12, 0.28, 0.45, 0.62, 0.8, 1];
// Broad from the base, widest a third out, then tapering to the spine.
export const BT_WIDE = [0.7, 0.92, 1, 0.98, 0.82, 0.52, 0];
export const BT_PTS = BT_ALONG.length;
// The two halves of the fold, then the two halves of the back.
export const BT_FACE_LINES = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
];
export const BT_LEVELS = 8;
// The dome the tips lie on, in metres from the scan's middle: by
// elevation off the base, degrees, the tip's distance out.
export const BT_REACH = [
  [0, 0.97],
  [25, 1],
  [45, 0.92],
  [65, 0.8],
  [80, 0.72],
  [90, 0.5],
];
export const btRamp = (lo: number[], hi: number[]) =>
  Array.from({ length: BT_LEVELS }, (_, i) => {
    const t = i / (BT_LEVELS - 1);
    return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
  });
// Upper, back — the sheet's and gold.
export const BT_TONES = [BLACK_TIP_COLOURS, BLACK_TIP_GOLD].map((pal) => [
  ...btRamp(pal.upper[0], pal.upper[1]),
  ...btRamp(pal.back[0], pal.back[1]),
]);
export const BT_MODEL = (() => {
  const rng = rngFor("black-tip-agave");
  const deg = Math.PI / 180;
  const at = (table: number[][], v: number) => {
    let k = 0;
    while (k < table.length - 2 && table[k + 1][0] < v) k++;
    const f = (v - table[k][0]) / (table[k + 1][0] - table[k][0]);
    return table[k][1] + (table[k + 1][1] - table[k][1]) * f;
  };
  const n = BT_LEAVES;
  const leaf = new Float32Array(n * BT_PTS * 12);
  // Each leaf's tip, and the end of its spine.
  const spine = new Float32Array(n * 6);
  let top = 0;
  let reach = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1); // 0 the oldest, lowest
    const az = i * 2.39996 + (rng() - 0.5) * 0.25;
    // Where it starts: the crown widens and sinks toward the old leaves.
    const r0 = 0.04 + 0.22 * (1 - t);
    const y0 = 0.04 + 0.3 * t * t;
    // Where it ends, on the dome.
    const el = Math.min(88, 2 + 84 * Math.pow(t, 0.95) + (rng() - 0.5) * 8);
    const d = at(BT_REACH, el) * (0.92 + 0.14 * rng());
    const tx = Math.cos(az) * Math.cos(el * deg) * d;
    const ty = 0.05 + Math.sin(el * deg) * d;
    const tz = Math.sin(az) * Math.cos(el * deg) * d;
    const bx = Math.cos(az) * r0;
    const bz = Math.sin(az) * r0;
    const cx = tx - bx;
    const cy = ty - y0;
    const cz = tz - bz;
    const len = Math.hypot(cx, cy, cz);
    // Across the chord, level; up off it.
    const hl = Math.hypot(cx, cz) || 1;
    const S = [-cz / hl, 0, cx / hl];
    const C = [cx / len, cy / len, cz / len];
    const N = [C[1] * S[2] - C[2] * S[1], C[2] * S[0] - C[0] * S[2], C[0] * S[1] - C[1] * S[0]];
    if (N[1] < 0) {
      N[0] = -N[0];
      N[1] = -N[1];
      N[2] = -N[2];
    }
    // The old leaves arch up a little and back down to their tips; the
    // young stand straight.
    const arch = 0.08 * (1 - t) * len;
    const hw = 0.075 * (1 - 0.25 * t) * (0.85 + 0.3 * rng());
    const fold = 0.3 + 0.3 * t;
    const keel = 0.25;
    for (let j = 0; j < BT_PTS; j++) {
      const s = BT_ALONG[j];
      const lift = arch * 4 * s * (1 - s);
      const px = bx + cx * s + N[0] * lift;
      const py = y0 + cy * s + N[1] * lift;
      const pz = bz + cz * s + N[2] * lift;
      const w = hw * BT_WIDE[j];
      const fw = fold * w;
      const kw = keel * w;
      leaf.set(
        [
          px, py, pz,
          px + S[0] * w + N[0] * fw, py + N[1] * fw, pz + S[2] * w + N[2] * fw,
          px - S[0] * w + N[0] * fw, py + N[1] * fw, pz - S[2] * w + N[2] * fw,
          px - N[0] * kw, py - N[1] * kw, pz - N[2] * kw,
        ],
        (i * BT_PTS + j) * 12,
      );
      top = Math.max(top, py);
      reach = Math.max(reach, Math.hypot(px, pz));
    }
    // The dark spine it is named for, on along the leaf.
    const tip = (i * BT_PTS + BT_PTS - 1) * 12;
    const sl = 0.025 * len;
    spine.set([leaf[tip], leaf[tip + 1], leaf[tip + 2], leaf[tip] + C[0] * sl, leaf[tip + 1] + C[1] * sl, leaf[tip + 2] + C[2] * sl], i * 6);
  }
  // To the plant's measure: its height 1 up, its half-spread 1 across.
  for (const a of [leaf, spine]) {
    for (let k = 0; k < a.length; k += 3) {
      a[k] /= reach;
      a[k + 1] /= top;
      a[k + 2] /= reach;
    }
  }
  return { leaf, spine };
})();

// Grown once per plant and kept: the leaves turned and scaled, every
// face's normal, middle and tone.
export type BlackTipPlant = {
  leaf: Float32Array;
  spine: Float32Array;
  faceN: Float32Array;
  faceMid: Float32Array;
  faceTone: Uint8Array;
};
export const BT_ALL = BT_LEAVES * 4;

export function growBlackTip(h: number, rw: number, rot: number): BlackTipPlant {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  const unit = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const level = (n: V3) =>
    Math.max(0, Math.min(BT_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (BT_LEVELS - 1))));
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const turn = (src: Float32Array, sx: number, sy: number) => {
    const dst = new Float32Array(src.length);
    for (let o = 0; o < src.length; o += 3) {
      dst[o] = (src[o] * cr - src[o + 2] * sr) * sx;
      dst[o + 1] = src[o + 1] * sy;
      dst[o + 2] = (src[o] * sr + src[o + 2] * cr) * sx;
    }
    return dst;
  };
  const leaf = turn(BT_MODEL.leaf, rw, h);
  const spine = turn(BT_MODEL.spine, rw, h);
  // Each half of the fold, and of the back, lit by its own normal,
  // pointed away from the middle of the leaf's section.
  const faceN = new Float32Array(BT_ALL * 3);
  const faceMid = new Float32Array(BT_ALL * 3);
  const faceTone = new Uint8Array(BT_ALL);
  const pt = (i: number, j: number, line: number, k: number) => leaf[(i * BT_PTS + j) * 12 + line * 3 + k];
  for (let i = 0; i < BT_LEAVES; i++) {
    const along: V3 = [0, 1, 2].map((k) => pt(i, 4, 0, k) - pt(i, 1, 0, k)) as V3;
    const middle: V3 = [0, 1, 2].map((k) => pt(i, 2, 0, k) * 0.6 + pt(i, 2, 3, k) * 0.4) as V3;
    for (let f = 0; f < 4; f++) {
      const [la, lb] = BT_FACE_LINES[f];
      const a: V3 = [0, 1, 2].map((k) => pt(i, 2, la, k)) as V3;
      const b: V3 = [0, 1, 2].map((k) => pt(i, 2, lb, k)) as V3;
      const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      let n = unit([along[1] * ac[2] - along[2] * ac[1], along[2] * ac[0] - along[0] * ac[2], along[0] * ac[1] - along[1] * ac[0]]);
      const out = [(a[0] + b[0]) / 2 - middle[0], (a[1] + b[1]) / 2 - middle[1], (a[2] + b[2]) / 2 - middle[2]];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
      const fi = i * 4 + f;
      faceN.set(n, fi * 3);
      for (let k = 0; k < 3; k++) faceMid[fi * 3 + k] = (pt(i, 1, la, k) + pt(i, 1, lb, k) + pt(i, 5, la, k) + pt(i, 5, lb, k)) / 4;
      const family = f < 2 ? 0 : 1;
      faceTone[fi] = family * BT_LEVELS + level(n);
    }
  }
  return { leaf, spine, faceN, faceMid, faceTone };
}
