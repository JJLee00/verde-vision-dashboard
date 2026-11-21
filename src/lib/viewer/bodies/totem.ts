// Totem pole's body, grown as a core and its knobs in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Totem pole: the scan's pale yellow-sage, every knob lit on its
 *  shoulder and shadowed under its drip, deep olive in the creases. */
export const TOTEM_COLOURS = {
  shade: [98, 100, 58],
  lit: [218, 220, 160],
  crease: "rgb(80,82,46)",
};
export const TOTEM_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  crease: "rgb(116,80,36)",
};

export type TotemPlant = {
  /** the core's rings, foot to shoulder — centre (x, y, z) and radius —
   *  then its apex */
  core: Float32Array;
  /** each knob's centre, then its three half-axes as (x, y, z) vectors:
   *  across, along its drip, and out */
  k: Float32Array;
  /** each knob's outward normal across the ground, and whether it's on
   *  the top, where it always shows */
  out: Float32Array;
  top: Uint8Array;
  /** each knob's tones: its face, its shoulder */
  tone: Uint8Array;
  /** the point on each knob that faces the light, as an (x, y, z) shift
   *  from its centre — its shoulder is drawn toward it */
  lift: Float32Array;
};
export const TT_LEVELS = 8;
export const TT_TONES = [TOTEM_COLOURS, TOTEM_GOLD].map((pal) =>
  Array.from({ length: TT_LEVELS }, (_, i) => {
    const t = i / (TT_LEVELS - 1);
    return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
  }),
);
// The model in its own measure (its height = 1). The stem leans a
// little from foot to top, and its knobs reach this far out at each
// height — widest low down, where it's oldest, rounding over on top.
export const TT_FOOT = [-0.03, 0.04];
export const TT_TOP = [0.02, -0.02];
export const TT_REACH = [
  [0, 0.15],
  [0.3, 0.145],
  [0.6, 0.135],
  [0.86, 0.135],
];
export const ttReach = (y: number) => {
  if (y >= 0.86) return 0.135 * Math.sqrt(Math.max(0, 1 - ((y - 0.86) / 0.14) ** 2));
  let i = 0;
  while (y > TT_REACH[i + 1][0]) i++;
  const [y0, r0] = TT_REACH[i];
  const [y1, r1] = TT_REACH[i + 1];
  return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
};
// Its knobs, the same on every plant as they are in the headset. Five
// ribs run up the stem, a little twisted, each a chain of long knobs
// like drips of wax, every one swelling out at its foot over the next;
// smaller ones sit deeper in the grooves between. On top, five lobes
// on the ribs lie out over the shoulder — the star the model shows
// from above, wider than the stem — round a small dome.
// Each is [height, angle, half-width, half-length, depth, droop, kind,
// a tone up or down, how far in it sits, a sideways tilt]: kind 0 a
// knob, 1 a crown lobe, 2 the dome.
export const TT_KNOBS: number[][] = (() => {
  const rng = rngFor("totem-pole");
  const out: number[][] = [];
  const shift = () => [-1, 0, 0, 1][(rng() * 4) | 0];
  for (let rib = 0; rib < 10; rib++) {
    const groove = rib % 2;
    let y = 0.05 + rng() * 0.05 + groove * 0.06;
    while (y < (groove ? 0.74 : 0.8)) {
      const s = 0.65 + rng() * 0.7;
      const long = 1.5 + rng() * 1.1;
      out.push([
        y,
        0.3 + (rib / 10) * Math.PI * 2 + y * 0.15 + (rng() - 0.5) * (groove ? 0.5 : 0.3),
        (groove ? 0.036 : 0.05) * s,
        (groove ? 0.036 : 0.05) * s * long,
        groove ? 0.026 : 0.04,
        0.35,
        0,
        shift() - groove,
        groove ? 0.045 : 0,
        (rng() - 0.5) * 0.8,
      ]);
      y += (groove ? 0.14 : 0.13) * (0.75 + rng() * 0.5);
    }
  }
  for (let i = 0; i < 5; i++) {
    out.push([0.86, 0.3 + (i / 5) * Math.PI * 2 + 0.13, 0.06, 0.085, 0.05, 1.8, 1, shift() - 1, 0, 0]);
  }
  out.push([0.92, 0, 0.05, 0.04, 0.05, 0, 2, -1, 0, 0]);
  return out;
})();
export const TT_N = TT_KNOBS.length;

export function growTotem(x: number, z: number, h: number, rot: number): TotemPlant {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  const unit = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const level = (n: V3) =>
    Math.max(0, Math.min(TT_LEVELS - 1, Math.round(Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5) * (TT_LEVELS - 1))));
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const turn = (mx: number, mz: number): [number, number] => [mx * cr - mz * sr, mx * sr + mz * cr];
  const axisAt = (y: number): V3 => {
    const [ax, az] = turn(TT_FOOT[0] + (TT_TOP[0] - TT_FOOT[0]) * y, TT_FOOT[1] + (TT_TOP[1] - TT_FOOT[1]) * y);
    return [x + ax * h, y * h, z + az * h];
  };

  const core = new Float32Array(5 * 4);
  [0.02, 0.3, 0.6, 0.84].forEach((y, i) => {
    core.set([...axisAt(y), (ttReach(y) - 0.04) * h], i * 4);
  });
  core.set([...axisAt(0.96), 0], 16);

  const k = new Float32Array(TT_N * 12);
  const out = new Float32Array(TT_N * 2);
  const top = new Uint8Array(TT_N);
  const tone = new Uint8Array(TT_N * 2);
  const lift = new Float32Array(TT_N * 3);
  TT_KNOBS.forEach(([y, ang, a, b, c, droop, kind, jog, sunk, tilt], i) => {
    const [nx, nz] = turn(Math.cos(ang), Math.sin(ang));
    const t: V3 = [-nz, 0, nx];
    let face: V3;
    let centre: V3;
    if (kind === 2) {
      face = [0, 1, 0];
      centre = axisAt(y);
      const A: V3[] = [
        [a, 0, 0],
        [0, b, 0],
        [0, 0, c],
      ];
      k.set([...centre, ...A[0].map((v) => v * h), ...A[1].map((v) => v * h), ...A[2].map((v) => v * h)], i * 12);
    } else {
      // Along the drip, its foot swung out; a crown lobe lies out over
      // the shoulder, its tip dipping.
      let along = unit([-droop * nx + tilt * t[0], 1, -droop * nz + tilt * t[2]]);
      if (kind === 1) along = [-along[0], -along[1], -along[2]];
      // Square to the drip, out of the stem.
      const dn = along[0] * nx + along[2] * nz;
      let out3 = unit([nx - dn * along[0], -dn * along[1], nz - dn * along[2]]);
      if (kind === 1) out3 = unit([nx * 0.3, 1, nz * 0.3]);
      face = kind === 1 ? unit([nx * 0.6, 1, nz * 0.6]) : out3;
      const r = kind === 1 ? 0.085 : ttReach(y) - c * 0.9 - sunk;
      const ax = axisAt(y);
      centre = [ax[0] + nx * r * h, ax[1], ax[2] + nz * r * h];
      k.set(
        [
          ...centre,
          t[0] * a * h, 0, t[2] * a * h,
          along[0] * b * h, along[1] * b * h, along[2] * b * h,
          out3[0] * c * h, out3[1] * c * h, out3[2] * c * h,
        ],
        i * 12,
      );
    }
    out[i * 2] = nx;
    out[i * 2 + 1] = nz;
    top[i] = kind ? 1 : 0;
    const mid = Math.max(0, Math.min(TT_LEVELS - 1, level(face) + jog));
    tone[i * 2] = mid;
    tone[i * 2 + 1] = Math.min(TT_LEVELS - 1, mid + 1);
    // The point on the knob facing the light: through its half-axes,
    // as a sphere's would be.
    const M = [k.subarray(i * 12 + 3, i * 12 + 6), k.subarray(i * 12 + 6, i * 12 + 9), k.subarray(i * 12 + 9, i * 12 + 12)];
    const w = M.map((m) => m[0] * LX + m[1] * LY + m[2] * LZ);
    const wl = Math.hypot(w[0], w[1], w[2]) || 1;
    for (let d = 0; d < 3; d++) lift[i * 3 + d] = (M[0][d] * w[0] + M[1][d] * w[1] + M[2][d] * w[2]) / wl;
  });
  return { core, k, out, top, tone, lift };
}
