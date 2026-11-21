// Mexican fence post's body, grown as ribbed stems in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

/** Mexican fence post: mid-green ribbed stems, every rib crest lined with
 *  the white felt of its fused areoles — the stripes it's named for. */
export const FENCE_POST_COLOURS = {
  shade: [60, 98, 58],
  lit: [152, 190, 114],
  felt: "rgb(234,230,214)",
  feltShade: "rgb(172,172,156)",
};
export const FENCE_POST_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  felt: "rgb(252,244,218)",
  feltShade: "rgb(212,186,134)",
};

export type FencePostClump = {
  stems: {
    /** where it stands, and the heights of its foot, its shoulder, two
     *  rings up its dome, and its apex */
    sx: number;
    sz: number;
    ys: number[];
    /** each ring's twelve points — crest, valley, crest… — as offsets
     *  (x, z) from the stem's axis, ring by ring */
    ring: Float32Array;
    /** each face's outward normal and tone, band by band (the shaft, two
     *  bands of dome, the cap), twelve to a band */
    faceN: Float32Array;
    faceTone: Uint8Array;
    /** whether each crest's felt is in the light */
    crestLit: Uint8Array;
  }[];
};
export const FP_LEVELS = 8;
export const FP_RIBS = 6;
export const FP_TONES = [FENCE_POST_COLOURS, FENCE_POST_GOLD].map((pal) =>
  Array.from({ length: FP_LEVELS }, (_, i) => {
    const t = i / (FP_LEVELS - 1);
    return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
  }),
);
// The model's four stems in its own measure (its height = 1): where each
// stands, how tall it is, how thick.
export const FP_STEMS = [
  [0.002, -0.039, 0.98, 0.067],
  [0.094, 0.027, 0.7, 0.066],
  [-0.105, -0.035, 0.566, 0.06],
  [-0.03, 0.051, 0.384, 0.05],
];

export function growFencePost(x: number, z: number, h: number, rot: number): FencePostClump {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  // Wrapped light, so the shaded side of a column still turns.
  const shadeOf = (n: V3) => Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5);
  const toneOf = (n: V3) => Math.max(0, Math.min(FP_LEVELS - 1, Math.round(shadeOf(n) * (FP_LEVELS - 1))));
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const stems = FP_STEMS.map(([mx, mz, mh, mr], si) => {
    const r = mr * h;
    const top = mh * h;
    // A blunt dome, a little lower than the stem is wide.
    const rd = r * 0.9;
    const y0 = top - rd;
    const ys = [0, y0, y0 + rd * Math.sin(0.55), y0 + rd * Math.sin(1.1), top];
    const across = [1, 1, Math.cos(0.55), Math.cos(1.1)];
    // Each stem's ribs turned its own way.
    const phase = rot + si * 0.9;
    const ring = new Float32Array(4 * 12 * 2);
    for (let l = 0; l < 4; l++) {
      for (let j = 0; j < 12; j++) {
        const a = phase + (j * Math.PI) / FP_RIBS;
        const rr = r * across[l] * (j % 2 ? 0.84 : 1);
        ring[(l * 12 + j) * 2] = Math.cos(a) * rr;
        ring[(l * 12 + j) * 2 + 1] = Math.sin(a) * rr;
      }
    }
    const pt = (l: number, j: number): V3 =>
      l === 4 ? [0, ys[4], 0] : [ring[(l * 12 + (j % 12)) * 2], ys[l], ring[(l * 12 + (j % 12)) * 2 + 1]];
    const faceN = new Float32Array(4 * 12 * 3);
    const faceTone = new Uint8Array(4 * 12);
    for (let b = 0; b < 4; b++) {
      for (let j = 0; j < 12; j++) {
        const A = pt(b, j);
        const B = pt(b, j + 1);
        const C = pt(b + 1, j + (b === 3 ? 0 : 1));
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        let n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        n = [n[0] / l, n[1] / l, n[2] / l];
        // Outward: away from the axis, and up on the dome.
        const ox = (A[0] + B[0]) / 2;
        const oz = (A[2] + B[2]) / 2;
        if (n[0] * ox + n[2] * oz + (b ? n[1] * r : 0) < 0) n = [-n[0], -n[1], -n[2]];
        faceN.set(n, (b * 12 + j) * 3);
        faceTone[b * 12 + j] = toneOf(n);
      }
    }
    const crestLit = new Uint8Array(FP_RIBS);
    for (let k = 0; k < FP_RIBS; k++) {
      const a = phase + (2 * k * Math.PI) / FP_RIBS;
      crestLit[k] = shadeOf([Math.cos(a), 0, Math.sin(a)]) > 0.45 ? 1 : 0;
    }
    return {
      sx: x + (mx * cr - mz * sr) * h,
      sz: z + (mx * sr + mz * cr) * h,
      ys,
      ring,
      faceN,
      faceTone,
      crestLit,
    };
  });
  return { stems };
}
