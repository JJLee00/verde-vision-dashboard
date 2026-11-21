// Argentine toothpick's body, grown as a ribbed trunk and arms in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

/** Argentine toothpick: a light olive green, bristling with the long tan
 *  spines it's named for, a reddish crown of them at every tip. */
export const TOOTHPICK_COLOURS = {
  shade: [104, 126, 74],
  lit: [200, 214, 144],
  spine: "rgba(224,198,152,0.9)",
  tuft: "rgba(192,128,94,0.95)",
};
export const TOOTHPICK_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  spine: "rgba(255,240,206,0.9)",
  tuft: "rgba(214,160,90,0.95)",
};

export type ToothpickPlant = {
  limbs: {
    /** its radius */
    r: number;
    /** ring centres along the limb, then its apex, as (x, y, z) */
    c: Float32Array;
    /** each ring's points — crest, groove, crest… — as offsets
     *  (x, y, z) from its centre */
    o: Float32Array;
    rings: number;
    /** rings along its length before the tip's */
    shaft: number;
    /** each face's outward normal and tone, band by band; the last
     *  band closes the tip on the apex */
    faceN: Float32Array;
    faceTone: Uint8Array;
    /** the runs of bands drawn as one piece: each straight enough
     *  that it never hides part of itself */
    pieces: [number, number][];
    /** the way the tip points, for its crown of spines */
    tip: [number, number, number];
  }[];
};
export const TP_LEVELS = 8;
export const TP_RIBS = 8;
export const TP_PTS = TP_RIBS * 2;
export const TP_TONES = [TOOTHPICK_COLOURS, TOOTHPICK_GOLD].map((pal) =>
  Array.from({ length: TP_LEVELS }, (_, i) => {
    const t = i / (TP_LEVELS - 1);
    return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
  }),
);
// The model's trunk and two arms in its own measure (its height = 1),
// all in one plane: the line each follows, its radius, and where an
// arm's elbow ends and its upright begins.
export const TP_LIMBS: { path: [number, number][]; r: number; split: number }[] = [
  { path: [[0, 0], [0, 0.47], [0, 0.94]], r: 0.04, split: 0 },
  // Out of the trunk a quarter of the way up, dipping, then up.
  { path: [[-0.02, 0.27], [-0.075, 0.245], [-0.125, 0.258], [-0.145, 0.31], [-0.145, 0.585]], r: 0.034, split: 2 },
  // Higher, shorter in reach, taller.
  { path: [[0.02, 0.405], [0.06, 0.39], [0.092, 0.41], [0.1, 0.46], [0.1, 0.69]], r: 0.03, split: 2 },
];

export function growToothpick(x: number, z: number, h: number, rot: number): ToothpickPlant {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  type V3 = [number, number, number];
  const shadeOf = (n: V3) => Math.pow(0.5 + 0.5 * (n[0] * LX + n[1] * LY + n[2] * LZ), 1.5);
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  // The model's plane turned with the plant: its x, its depth, and up.
  const place = (px: number, py: number, pz: number): V3 => [
    x + (px * cr - pz * sr) * h,
    py * h,
    z + (px * sr + pz * cr) * h,
  ];
  const dir = (px: number, py: number, pz: number): V3 => [px * cr - pz * sr, py, px * sr + pz * cr];
  const limbs = TP_LIMBS.map(({ path, r: mr, split }, li) => {
    const r = mr * h;
    const nP = path.length;
    // Tangents along the path, in the model's plane.
    const tan = path.map((_, i) => {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(nP - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    });
    // Each ring: centre, the way across it in the plane, its size.
    const rings: { c: [number, number]; t: number[]; f: number }[] = path.map((c, i) => ({ c, t: tan[i], f: 1 }));
    // A blunt tip as long as the limb is wide.
    const [lx, ly] = path[nP - 1];
    const [tx, ty] = tan[nP - 1];
    for (const sv of [0.6, 1.15]) {
      rings.push({ c: [lx + tx * mr * Math.sin(sv), ly + ty * mr * Math.sin(sv)], t: tan[nP - 1], f: 0.92 * Math.cos(sv) });
    }
    const nR = rings.length;
    const c = new Float32Array((nR + 1) * 3);
    const o = new Float32Array(nR * TP_PTS * 3);
    const phase = rot + li * 0.4;
    rings.forEach((ring, k) => {
      c.set(place(ring.c[0], ring.c[1], 0), k * 3);
      // Across the limb: in the plane (perpendicular to its line), and
      // through the plane.
      const e2 = dir(ring.t[1], -ring.t[0], 0);
      const e1 = dir(0, 0, 1);
      for (let j = 0; j < TP_PTS; j++) {
        const a = phase + (j * Math.PI) / TP_RIBS;
        const rr = r * ring.f * (j % 2 ? 0.88 : 1);
        o.set(
          [0, 1, 2].map((q) => rr * (Math.cos(a) * e2[q] + Math.sin(a) * e1[q])),
          (k * TP_PTS + j) * 3,
        );
      }
    });
    c.set(place(lx + tx * mr, ly + ty * mr, 0), nR * 3);
    const pt = (k: number, j: number): V3 =>
      k === nR
        ? [c[nR * 3], c[nR * 3 + 1], c[nR * 3 + 2]]
        : [0, 1, 2].map((q) => c[k * 3 + q] + o[(k * TP_PTS + (j % TP_PTS)) * 3 + q]) as V3;
    const faceN = new Float32Array(nR * TP_PTS * 3);
    const faceTone = new Uint8Array(nR * TP_PTS);
    for (let b = 0; b < nR; b++) {
      for (let j = 0; j < TP_PTS; j++) {
        const A = pt(b, j);
        const B = pt(b, j + 1);
        const C = pt(b + 1, j + (b === nR - 1 ? 0 : 1));
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        let n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const ln = Math.hypot(n[0], n[1], n[2]) || 1;
        n = [n[0] / ln, n[1] / ln, n[2] / ln];
        // Outward: away from the limb's line (the last path ring, for
        // the tip).
        const k0 = Math.min(b, nP - 1);
        const mx = (A[0] + B[0]) / 2 - c[k0 * 3];
        const my = (A[1] + B[1]) / 2 - c[k0 * 3 + 1];
        const mz = (A[2] + B[2]) / 2 - c[k0 * 3 + 2];
        if (n[0] * mx + n[1] * my + n[2] * mz < 0) n = [-n[0], -n[1], -n[2]];
        faceN.set(n, (b * TP_PTS + j) * 3);
        faceTone[b * TP_PTS + j] = Math.max(0, Math.min(TP_LEVELS - 1, Math.round(shadeOf(n) * (TP_LEVELS - 1))));
      }
    }
    const pieces: [number, number][] = split ? [[0, split], [split, nR]] : [[0, nR]];
    return { r, c, o, rings: nR, shaft: nP, faceN, faceTone, pieces, tip: dir(tx, ty, 0) };
  });
  return { limbs };
}
