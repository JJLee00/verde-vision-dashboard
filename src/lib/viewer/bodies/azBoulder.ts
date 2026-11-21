// AZ Boulder's body, grown as the scanned rock's faces, creases and grain in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** AZ Boulder: the scan's granite, a pinkish grey-tan, stained rust low
 *  down where it sat in the soil, flecked dark and white close up. */
export const AZ_ROCK_COLOURS = {
  shade: [120, 104, 94],
  lit: [214, 200, 186],
  stain: [134, 96, 74],
  edge: "rgba(84,70,62,0.95)",
  crease: "rgba(92,78,70,0.45)",
  dark: "rgba(74,66,62,0.42)",
  light: "rgba(252,248,240,0.6)",
};
export const AZ_ROCK_GOLD = {
  shade: [140, 100, 46],
  lit: [236, 200, 128],
  stain: [150, 96, 40],
  edge: "rgba(122,86,30,0.95)",
  crease: "rgba(122,86,30,0.45)",
  dark: "rgba(110,76,30,0.42)",
  light: "rgba(255,244,214,0.6)",
};

/** AZ Boulder 1: the scanned rock itself.
 *
 *  The boulder body below is a jittered solid, a fair stand-in for a
 *  rock nobody has scanned. This one has been: a low granite slab a
 *  fifth as tall as it is long, with a step across its top where a layer
 *  broke away, and chipped corners. So its body is the scan, cut down to
 *  199 faces. It is the same rock at every placement, as it is in the
 *  headset, lit face by face under the sheet's light.
 */
// x along its length (-0.5 to 0.5), y up, z across, in lengths of the
// rock; three vertices to a face, wound outward.
export const AZR_V = [
  0.5, 0.042, -0.062, 0.431, 0.004, -0.203, 0.417, 0.003, 0.065, 0.415, 0.086, 0.027, 0.324,
  0.102, 0.054, 0.286, 0.14, 0.038, 0.319, 0.003, 0.154, -0.326, 0.036, 0.32, -0.061, 0.005,
  0.339, -0.033, 0.102, 0.273, -0.041, 0.004, 0.303, 0.033, 0.179, -0.09, 0.13, 0.004, 0.216,
  -0.498, 0.004, 0.245, -0.4, 0.003, 0.307, -0.398, 0.049, 0.326, 0.43, 0.072, -0.066, -0.367,
  0.15, 0.295, 0.071, 0.004, 0.253, 0.122, 0.088, 0.164, 0.004, 0.003, 0.279, 0.049, 0.065,
  0.221, -0.251, 0.003, -0.118, -0.413, 0.002, 0.14, -0.41, 0.152, 0.125, 0.024, 0.171, -0.308,
  -0.088, 0.18, -0.28, 0.287, 0.118, -0.218, 0.206, 0.143, -0.181, -0.041, 0.208, -0.169,
  -0.078, 0.21, -0.225, -0.127, 0.204, -0.147, -0.26, 0.068, -0.039, 0.191, 0.15, -0.093, 0.152,
  0.137, -0.077, 0.123, 0.161, -0.245, 0.487, 0.006, 0.04, 0.49, 0.052, 0.015, -0.007, 0.103,
  0.229, 0.252, 0.061, 0.141, 0.24, 0.004, 0.181, 0.183, 0.004, 0.204, -0.17, 0.076, -0.197,
  -0.251, 0.169, -0.198, -0.24, 0.142, -0.098, -0.252, 0.054, -0.119, -0.235, 0.109, -0.191,
  -0.217, 0.193, -0.25, -0.137, 0.14, -0.243, -0.16, 0.194, -0.265, -0.309, 0.071, 0.284,
  -0.211, 0.142, 0.283, -0.273, 0.142, 0.27, -0.243, 0.151, -0.038, 0.204, 0.128, 0.102, 0.054,
  0.179, 0.03, -0.205, 0.213, -0.05, 0.497, 0.042, -0.134, -0.442, 0.12, 0.277, 0.318, 0.003,
  0.098, -0.331, 0.066, 0.047, -0.315, 0.003, 0.021, -0.312, 0.008, 0.019, -0.275, 0.005, 0.307,
  -0.203, 0.213, -0.173, -0.222, 0.089, 0.31, -0.182, 0.123, 0.324, -0.458, 0.044, 0.186, 0.212,
  0.118, -0.019, -0.247, 0.058, 0.3, 0.268, 0.047, -0.373, 0.263, 0.004, -0.349, 0.266, 0.103,
  0.09, 0.338, 0.074, -0.328, 0.286, 0.086, -0.375, -0.053, 0.204, -0.076, 0.36, 0.003, -0.228,
  -0.488, 0.096, 0.221, -0.44, 0, 0.21, -0.024, 0.075, -0.257, 0.319, 0.107, -0.075, 0.17,
  0.127, -0.344, 0.107, 0.153, -0.32, 0.198, 0.003, -0.328, -0.362, 0.147, 0.062, -0.5, 0.057,
  0.258, -0.462, 0.152, 0.188, -0.281, 0.148, 0.164, 0.193, 0.134, -0.286, -0.12, 0.118, 0.317,
  -0.163, 0.043, 0.373, -0.174, 0.071, 0.329, -0.07, 0.004, -0.205, 0.055, 0.181, -0.191,
  -0.221, 0.149, 0.061, 0.056, 0.003, -0.26, 0.052, 0.094, -0.29, 0.274, 0.105, -0.301, 0.376,
  0.067, -0.291, 0.391, 0.08, -0.182, 0.427, 0.059, -0.226, -0.114, 0.208, 0.008, 0.077, 0.172,
  0.132, -0.192, 0.141, 0.206, -0.093, 0.143, 0.28, -0.073, 0.189, 0.188, -0.196, 0.203, 0.065,
  -0.022, 0.195, 0.101, -0.15, 0.194, 0.18, 0.47, 0.002, -0.158, 0.341, 0.002, -0.276, -0.355,
  0.003, 0.071, -0.219, 0.004, -0.13, -0.274, 0.003, -0.022, -0.149, 0.002, 0.375,
];
export const AZR_F = [
  62, 61, 111, 14, 15, 13, 60, 61, 111, 62, 113, 61, 73, 110, 71, 0, 109, 57, 100, 109, 1, 83,
  70, 71, 0, 36, 109, 58, 85, 15, 15, 17, 58, 86, 58, 17, 85, 67, 13, 85, 58, 77, 85, 77, 67, 4,
  6, 59, 5, 4, 3, 80, 5, 3, 2, 3, 4, 4, 59, 2, 82, 81, 96, 83, 96, 81, 102, 19, 54, 107, 105,
  102, 63, 7, 14, 63, 50, 7, 63, 69, 50, 22, 113, 45, 80, 16, 99, 112, 22, 45, 101, 56, 106,
  102, 55, 107, 108, 105, 107, 19, 102, 21, 102, 105, 38, 80, 28, 33, 27, 80, 99, 38, 104, 9,
  104, 38, 105, 28, 80, 27, 101, 108, 107, 51, 66, 104, 103, 104, 108, 21, 102, 38, 79, 48, 26,
  78, 67, 23, 110, 98, 76, 45, 32, 44, 75, 11, 29, 56, 75, 31, 29, 31, 75, 70, 74, 73, 107, 55,
  101, 98, 110, 73, 73, 71, 70, 37, 3, 36, 17, 50, 52, 52, 87, 17, 8, 9, 89, 38, 9, 10, 89, 9,
  104, 101, 106, 108, 94, 103, 106, 106, 103, 108, 104, 105, 108, 104, 103, 51, 19, 12, 41, 77,
  58, 86, 79, 25, 96, 26, 25, 79, 4, 39, 6, 4, 72, 39, 4, 5, 72, 68, 54, 72, 56, 101, 75, 17,
  24, 86, 24, 17, 87, 99, 57, 100, 57, 109, 100, 66, 65, 69, 73, 97, 98, 0, 37, 36, 68, 72, 5,
  68, 5, 33, 5, 80, 33, 98, 99, 100, 34, 68, 33, 78, 67, 13, 3, 2, 36, 91, 66, 69, 65, 66, 51,
  70, 83, 81, 64, 47, 43, 47, 64, 49, 53, 60, 84, 53, 32, 60, 60, 32, 113, 62, 60, 113, 16, 57,
  99, 98, 100, 76, 76, 100, 1, 97, 27, 98, 98, 27, 99, 62, 61, 60, 83, 95, 96, 55, 75, 101, 55,
  11, 75, 82, 35, 88, 12, 19, 21, 111, 23, 60, 64, 44, 56, 44, 53, 56, 15, 85, 13, 53, 106, 56,
  106, 53, 94, 90, 114, 8, 25, 82, 96, 95, 79, 96, 16, 37, 0, 16, 0, 57, 39, 72, 54, 55, 102,
  54, 44, 32, 53, 25, 35, 82, 81, 74, 70, 88, 97, 81, 97, 74, 81, 74, 97, 73, 65, 51, 52, 69,
  52, 50, 69, 65, 52, 16, 80, 3, 37, 16, 3, 15, 7, 50, 14, 7, 15, 15, 50, 17, 10, 20, 38, 88,
  35, 28, 21, 20, 18, 12, 21, 18, 20, 21, 38, 91, 89, 66, 8, 89, 90, 66, 89, 104, 91, 90, 89,
  51, 103, 52, 94, 87, 103, 53, 84, 94, 8, 10, 9, 48, 79, 92, 49, 64, 31, 34, 11, 55, 68, 34,
  55, 54, 68, 55, 60, 67, 84, 84, 67, 24, 23, 67, 60, 77, 86, 67, 86, 24, 67, 93, 34, 33, 30,
  25, 26, 31, 26, 49, 64, 56, 31, 45, 46, 112, 42, 112, 46, 47, 46, 43, 47, 49, 48, 46, 47, 48,
  30, 26, 31, 49, 26, 48, 87, 84, 24, 103, 87, 52, 94, 84, 87, 11, 93, 29, 42, 46, 48, 44, 64,
  43, 11, 34, 93, 81, 82, 88, 91, 69, 114, 69, 63, 114, 90, 91, 114, 45, 44, 46, 46, 44, 43, 27,
  97, 88, 35, 25, 93, 95, 92, 79, 92, 112, 42, 29, 30, 31, 93, 25, 30, 93, 30, 29, 45, 113, 32,
  39, 41, 40, 40, 6, 39, 92, 42, 48, 54, 41, 39, 54, 19, 41, 93, 28, 35, 28, 93, 33, 28, 27, 88,
];
export const AZR_NV = AZR_V.length / 3;
export const AZR_NF = AZR_F.length / 3;
export const AZR_LEVELS = 8;
export const AZR_H = AZR_V.reduce((m, v, i) => (i % 3 === 1 ? Math.max(m, v) : m), 0);
// Shade to lit, then the same again stained, for each palette.
export const AZR_TONES = [AZ_ROCK_COLOURS, AZ_ROCK_GOLD].map((pal) =>
  [0, 0.35].flatMap((stain) =>
    Array.from({ length: AZR_LEVELS }, (_, i) => {
      const t = i / (AZR_LEVELS - 1);
      const rgb = pal.shade.map((v, k) => {
        const c = v + (pal.lit[k] - v) * t;
        return (c + (pal.stain[k] - c) * stain) | 0;
      });
      return `rgb(${rgb.join(",")})`;
    }),
  ),
);
export const azrNormal = (f: number) => {
  const a = AZR_F[f * 3] * 3;
  const b = AZR_F[f * 3 + 1] * 3;
  const d = AZR_F[f * 3 + 2] * 3;
  const ux = AZR_V[b] - AZR_V[a];
  const uy = AZR_V[b + 1] - AZR_V[a + 1];
  const uz = AZR_V[b + 2] - AZR_V[a + 2];
  const wx = AZR_V[d] - AZR_V[a];
  const wy = AZR_V[d + 1] - AZR_V[a + 1];
  const wz = AZR_V[d + 2] - AZR_V[a + 2];
  return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
};
// Where the stone breaks: edges whose faces meet at more than 40 degrees,
// the step and the chipped corners, as (vertex, vertex, face, face).
export const AZR_CREASES: number[] = (() => {
  const sides = new Map<number, number[]>();
  for (let f = 0; f < AZR_NF; f++) {
    for (let k = 0; k < 3; k++) {
      const a = AZR_F[f * 3 + k];
      const b = AZR_F[f * 3 + ((k + 1) % 3)];
      const key = Math.min(a, b) * 256 + Math.max(a, b);
      const fs = sides.get(key);
      if (fs) fs.push(f);
      else sides.set(key, [f]);
    }
  }
  const out: number[] = [];
  const cos40 = Math.cos((40 * Math.PI) / 180);
  for (const [key, fs] of sides) {
    if (fs.length !== 2) continue;
    const p = azrNormal(fs[0]);
    const q = azrNormal(fs[1]);
    const c = (p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / (Math.hypot(...p) * Math.hypot(...q) || 1);
    if (c < cos40) out.push(key >> 8, key & 255, fs[0], fs[1]);
  }
  return out;
})();
// The granite's grain, scattered by area over its faces: each fleck's
// face, place in the rock's own measure, size, and whether it's light.
// Few and the same size, they read as polka dots; this is grit.
export const AZR_FLECKS = 900;
export const azrFleckFace = new Uint16Array(AZR_FLECKS);
export const azrFleckAt = new Float32Array(AZR_FLECKS * 3);
export const azrFleckSize = new Float32Array(AZR_FLECKS);
export const azrFleckLight = new Uint8Array(AZR_FLECKS);
{
  const rng = rngFor("az-boulder");
  const upTo: number[] = [];
  let total = 0;
  for (let f = 0; f < AZR_NF; f++) upTo.push((total += Math.hypot(...azrNormal(f)) / 2));
  for (let i = 0; i < AZR_FLECKS; i++) {
    const pick = rng() * total;
    let f = 0;
    while (f < AZR_NF - 1 && upTo[f] < pick) f++;
    const r1 = Math.sqrt(rng());
    const r2 = rng();
    const wa = 1 - r1;
    const wb = r1 * (1 - r2);
    const wd = r1 * r2;
    for (let k = 0; k < 3; k++) {
      azrFleckAt[i * 3 + k] =
        AZR_V[AZR_F[f * 3] * 3 + k] * wa + AZR_V[AZR_F[f * 3 + 1] * 3 + k] * wb + AZR_V[AZR_F[f * 3 + 2] * 3 + k] * wd;
    }
    azrFleckFace[i] = f;
    azrFleckSize[i] = 0.5 + rng() * rng() * 1.5;
    azrFleckLight[i] = rng() < 0.55 ? 1 : 0;
  }
}

export type AzRock = {
  /** the vertices on the ground, and each face's outward normal and
   *  centre, in feet */
  v: Float32Array;
  n: Float32Array;
  c: Float32Array;
  /** each face's tone, plus AZR_LEVELS when stained */
  band: Uint8Array;
  /** the flecks on the ground */
  fl: Float32Array;
};

export function growAzRock(x: number, z: number, len: number, rot: number): AzRock {
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const put = (src: ArrayLike<number>, i: number, out: Float32Array) => {
    const mx = src[i * 3];
    const mz = src[i * 3 + 2];
    out[i * 3] = x + (mx * cr - mz * sr) * len;
    out[i * 3 + 1] = src[i * 3 + 1] * len;
    out[i * 3 + 2] = z + (mx * sr + mz * cr) * len;
  };
  const v = new Float32Array(AZR_NV * 3);
  for (let i = 0; i < AZR_NV; i++) put(AZR_V, i, v);
  const n = new Float32Array(AZR_NF * 3);
  const c = new Float32Array(AZR_NF * 3);
  const band = new Uint8Array(AZR_NF);
  for (let f = 0; f < AZR_NF; f++) {
    const [mx, my, mz] = azrNormal(f);
    const L = Math.hypot(mx, my, mz) || 1;
    const nx = (mx * cr - mz * sr) / L;
    const ny = my / L;
    const nz = (mx * sr + mz * cr) / L;
    n[f * 3] = nx;
    n[f * 3 + 1] = ny;
    n[f * 3 + 2] = nz;
    for (let k = 0; k < 3; k++) {
      c[f * 3 + k] = (v[AZR_F[f * 3] * 3 + k] + v[AZR_F[f * 3 + 1] * 3 + k] + v[AZR_F[f * 3 + 2] * 3 + k]) / 3;
    }
    // Wrapped light, so the shaded sides still turn.
    const lit = Math.pow(0.5 + 0.5 * (nx * LX + ny * LY + nz * LZ), 1.5);
    const tone = Math.max(0, Math.min(AZR_LEVELS - 1, Math.round(lit * (AZR_LEVELS - 1))));
    // A side low down, where the rock sat in the soil, is stained.
    const stained = c[f * 3 + 1] < 0.3 * AZR_H * len && Math.abs(ny) < 0.6;
    band[f] = tone + (stained ? AZR_LEVELS : 0);
  }
  const fl = new Float32Array(AZR_FLECKS * 3);
  for (let i = 0; i < AZR_FLECKS; i++) put(azrFleckAt, i, fl);
  return { v, n, c, band, fl };
}
