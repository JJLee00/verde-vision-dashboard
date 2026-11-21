// Organ pipe's body, grown as fluted stems in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

/** Organ pipe: a dark grey-green, its many low ribs catching the light in
 *  fine lines, paler at the tips with new growth and grey spines. */
export const ORGAN_PIPE_COLOURS = {
  shade: [52, 68, 60],
  lit: [150, 168, 138],
  tip: [184, 190, 152],
  spines: "rgba(206,206,192,0.55)",
};
export const ORGAN_PIPE_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  tip: [252, 230, 172],
  spines: "rgba(255,244,214,0.6)",
};

export type OrganPipeClump = {
  stems: {
    /** its radius */
    r: number;
    /** the centre of each ring — foot, halfway, shoulder, two up the
     *  tip — and the apex, as (x, y, z) */
    axis: Float32Array;
    /** each ring's points — crest, groove, crest… — as offsets (x, z)
     *  from its centre */
    ring: Float32Array;
    /** each face's outward normal and tone, band by band */
    faceN: Float32Array;
    faceTone: Uint8Array;
  }[];
};
export const OP_LEVELS = 8;
export const OP_RIBS = 14;
export const OP_PTS = OP_RIBS * 2;
export const OP_BANDS = 5;
// Two ramps a palette: the stem, and its paler tip.
export const OP_TONES = [ORGAN_PIPE_COLOURS, ORGAN_PIPE_GOLD].map((pal) =>
  [pal.lit, pal.tip].flatMap((hi, ramp) =>
    Array.from({ length: OP_LEVELS }, (_, i) => {
      const t = i / (OP_LEVELS - 1);
      const lo = ramp ? pal.shade.map((v, k) => v + (pal.tip[k] - v) * 0.35) : pal.shade;
      return `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`;
    }),
  ),
);
// The model's six stems in its own measure (its height = 1): foot,
// halfway and top as (x, z), how tall each grows, and its radius —
// three tall ones leaning a little apart, three short ones round them.
export const OP_STEMS = [
  [-0.069, 0.144, -0.103, 0.144, -0.12, 0.127, 1.0, 0.043],
  [0.069, 0.137, 0.072, 0.144, 0.084, 0.151, 0.93, 0.045],
  [-0.01, -0.058, -0.024, -0.045, -0.041, -0.041, 0.74, 0.043],
  [0.076, 0.086, 0.069, 0.069, 0.062, 0.052, 0.46, 0.041],
  [0.107, -0.141, 0.118, -0.153, 0.122, -0.152, 0.28, 0.038],
  [-0.108, -0.056, -0.1, -0.041, -0.1, -0.041, 0.18, 0.034],
];

export function growOrganPipe(x: number, z: number, h: number, rot: number): OrganPipeClump {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  const shadeOf = (n: V3) => Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5);
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const turn = (mx: number, mz: number) => [x + (mx * cr - mz * sr) * h, z + (mx * sr + mz * cr) * h];
  const stems = OP_STEMS.map(([bx, bz, , , tx, tz, mh, mr], si) => {
    const r = mr * h;
    const top = mh * h;
    // A rounded tip, a little longer than the stem is wide.
    const rd = r * 1.1;
    const [fx, fz] = turn(bx, bz);
    const [ux, uz] = turn(tx, tz);
    // Straight from foot to top, leaning as the model's does — its
    // halfway point is within an inch of the line, and a kink there
    // reads as a joint.
    const at = (f: number): [number, number] => [fx + (ux - fx) * f, fz + (uz - fz) * f];
    const ys = [0, top * 0.5, top - rd, top - rd + rd * Math.sin(0.6), top - rd + rd * Math.sin(1.15), top];
    // One width up the shaft, narrowing a little into the tip.
    const across = [1, 1, 0.92, 0.92 * Math.cos(0.6), 0.92 * Math.cos(1.15)];
    const axis = new Float32Array(6 * 3);
    ys.forEach((y, l) => {
      const [cx, cz] = at(Math.min(1, y / top));
      axis.set([cx, y, cz], l * 3);
    });
    const phase = rot + si * 1.3;
    const ring = new Float32Array(5 * OP_PTS * 2);
    for (let l = 0; l < 5; l++) {
      for (let j = 0; j < OP_PTS; j++) {
        const a = phase + (j * Math.PI) / OP_RIBS;
        const rr = r * across[l] * (j % 2 ? 0.86 : 1);
        ring[(l * OP_PTS + j) * 2] = Math.cos(a) * rr;
        ring[(l * OP_PTS + j) * 2 + 1] = Math.sin(a) * rr;
      }
    }
    const pt = (l: number, j: number): V3 =>
      l === 5
        ? [axis[15], axis[16], axis[17]]
        : [
            axis[l * 3] + ring[(l * OP_PTS + (j % OP_PTS)) * 2],
            axis[l * 3 + 1],
            axis[l * 3 + 2] + ring[(l * OP_PTS + (j % OP_PTS)) * 2 + 1],
          ];
    const faceN = new Float32Array(OP_BANDS * OP_PTS * 3);
    const faceTone = new Uint8Array(OP_BANDS * OP_PTS);
    for (let b = 0; b < OP_BANDS; b++) {
      for (let j = 0; j < OP_PTS; j++) {
        const A = pt(b, j);
        const B = pt(b, j + 1);
        const C = pt(b + 1, j + (b === OP_BANDS - 1 ? 0 : 1));
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        let n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const ln = Math.hypot(n[0], n[1], n[2]) || 1;
        n = [n[0] / ln, n[1] / ln, n[2] / ln];
        // Outward: away from the axis, and up on the tip.
        const ox = (A[0] + B[0]) / 2 - axis[b * 3];
        const oz = (A[2] + B[2]) / 2 - axis[b * 3 + 2];
        if (n[0] * ox + n[2] * oz + (b >= 2 ? n[1] * r : 0) < 0) n = [-n[0], -n[1], -n[2]];
        faceN.set(n, (b * OP_PTS + j) * 3);
        const level = Math.max(0, Math.min(OP_LEVELS - 1, Math.round(shadeOf(n) * (OP_LEVELS - 1))));
        // The tip pales with new growth.
        faceTone[b * OP_PTS + j] = (b >= 3 ? OP_LEVELS : 0) + level;
      }
    }
    return { r, axis, ring, faceN, faceTone };
  });
  return { stems };
}
