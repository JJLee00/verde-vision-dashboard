// Golden barrel's body, grown as ribs, areoles and spines in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Golden Barrel as the app's scan is: from any distance a ball of pale
 *  gold spines; close to, a dark green body under them and cream wool at
 *  the areoles and the crown. Flank tones shade to lit, far off and near;
 *  measured off the scan's render. */
export const GOLDEN_BARREL_COLOURS = {
  far: [[96, 84, 50], [130, 112, 68], [160, 138, 88], [188, 164, 110], [212, 192, 136]],
  body: [[56, 60, 30], [74, 80, 40], [94, 100, 52], [116, 120, 64], [138, 140, 78]],
  groove: "rgb(50,50,28)",
  ridge: "rgb(222,200,140)",
  spine: "rgb(190,158,92)",
  spineLit: "rgb(236,212,150)",
  wool: "rgb(236,220,180)",
  crown: "rgb(228,206,160)",
  crownHeart: "rgb(222,194,150)",
};
export const GOLDEN_BARREL_GOLD = {
  far: [[150, 112, 52], [176, 136, 66], [200, 160, 90], [222, 188, 120], [240, 214, 150]],
  body: [[120, 88, 40], [140, 104, 46], [160, 122, 58], [182, 144, 74], [204, 168, 96]],
  groove: "rgb(110,80,36)",
  ridge: "rgb(244,224,170)",
  spine: "rgb(206,170,104)",
  spineLit: "rgb(248,232,190)",
  wool: "rgb(250,238,206)",
  crown: "rgb(244,226,184)",
  crownHeart: "rgb(232,196,140)",
};

// Golden Barrel's profile, from the app's scan: radius (1 = the plant's
// half-spread) at heights up it (1 = its height). A drum to half way,
// then the dome closing in to the crown.
export const GB_PROFILE: [number, number][] = [
  [0, 0.86],
  [0.12, 0.92],
  [0.26, 0.94],
  [0.4, 0.93],
  [0.52, 0.89],
  [0.63, 0.82],
  [0.73, 0.73],
  [0.82, 0.6],
  [0.9, 0.42],
  [0.96, 0.22],
];
export const GB_RIBS = 27;
export type BarrelPlant = {
  /** ridge and groove points, per rib per station, xyz offsets from the
   *  plant's foot, feet: ridge k at [k][i], groove after it at [k][i] */
  ridge: Float32Array;
  groove: Float32Array;
  /** the flank faces: rib, which side, lower and upper station, then
   *  the face's normal xyz and how lit it is 0–1 */
  faces: Float32Array;
  /** areoles: xyz, normal xyz, then spines' tips, 7 × xyz */
  areoles: Float32Array;
  /** spine reach, feet */
  spine: number;
  /** areole spacing up a rib, feet */
  step: number;
};
export const GB_ST = GB_PROFILE.length;

export function growGoldenBarrel(h: number, rw: number, rot: number, seed: string): BarrelPlant {
  const rng = rngFor("goldenbarrel:" + seed);
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  const ridge = new Float32Array(GB_RIBS * GB_ST * 3);
  const groove = new Float32Array(GB_RIBS * GB_ST * 3);
  // Rib depth: the grooves sit a seventh in from the ridges.
  for (let k = 0; k < GB_RIBS; k++) {
    const a = rot + ((k + (rng() - 0.5) * 0.15) / GB_RIBS) * Math.PI * 2;
    const g = rot + ((k + 0.5) / GB_RIBS) * Math.PI * 2;
    for (let i = 0; i < GB_ST; i++) {
      const [y, r] = GB_PROFILE[i];
      const o = (k * GB_ST + i) * 3;
      ridge[o] = Math.cos(a) * r * rw;
      ridge[o + 1] = y * h;
      ridge[o + 2] = Math.sin(a) * r * rw;
      const rg = r * (1 - 0.14 * Math.min(1, (1 - y) * 2.5));
      groove[o] = Math.cos(g) * rg * rw;
      groove[o + 1] = y * h;
      groove[o + 2] = Math.sin(g) * rg * rw;
    }
  }
  // Faces: each rib's two flanks (side 0 toward the groove after it, 1
  // toward the one before), in three pieces up the plant.
  const SEG = [0, 3, 6, GB_ST - 1];
  const faces: number[] = [];
  for (let k = 0; k < GB_RIBS; k++) {
    const kp = (k + GB_RIBS - 1) % GB_RIBS;
    for (let side = 0; side < 2; side++) {
      for (let s = 0; s < 3; s++) {
        const i0 = SEG[s];
        const i1 = SEG[s + 1];
        const im = (i0 + i1) >> 1;
        const R = (i: number) => (k * GB_ST + i) * 3;
        const Gq = (i: number) => ((side ? kp : k) * GB_ST + i) * 3;
        // up the ridge, and across from the ridge to the groove
        const tx = ridge[R(i1)] - ridge[R(i0)];
        const ty = ridge[R(i1) + 1] - ridge[R(i0) + 1];
        const tz = ridge[R(i1) + 2] - ridge[R(i0) + 2];
        const cx = groove[Gq(im)] - ridge[R(im)];
        const cy = groove[Gq(im) + 1] - ridge[R(im) + 1];
        const cz = groove[Gq(im) + 2] - ridge[R(im) + 2];
        let nx = ty * cz - tz * cy;
        let ny = tz * cx - tx * cz;
        let nz = tx * cy - ty * cx;
        // outward
        if (nx * ridge[R(im)] + nz * ridge[R(im) + 2] + ny * (ridge[R(im) + 1] - h * 0.3) < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const lit = Math.max(0, Math.min(1, 0.5 + 0.5 * (nx * LX + ny * LY + nz * LZ)));
        faces.push(k, side, i0, i1, nx, ny, nz, lit);
      }
    }
  }
  // Areoles up every ridge, each a tuft of seven spines lying out over
  // the body, curving a little off it.
  const spine = rw * 0.17;
  const N = 13;
  const step = (h * 0.9) / N;
  const ar: number[] = [];
  for (let k = 0; k < GB_RIBS; k++) {
    for (let j = 0; j < N; j++) {
      const u = 0.05 + (0.9 * (j + 0.5 + (rng() - 0.5) * 0.3)) / N;
      // along the ridge by height
      let i = 0;
      while (i < GB_ST - 2 && GB_PROFILE[i + 1][0] < u) i++;
      const f = (u - GB_PROFILE[i][0]) / (GB_PROFILE[i + 1][0] - GB_PROFILE[i][0]);
      const o0 = (k * GB_ST + i) * 3;
      const o1 = o0 + 3;
      const px = ridge[o0] + (ridge[o1] - ridge[o0]) * f;
      const py = ridge[o0 + 1] + (ridge[o1 + 1] - ridge[o0 + 1]) * f;
      const pz = ridge[o0 + 2] + (ridge[o1 + 2] - ridge[o0 + 2]) * f;
      // the surface's frame there: out, up the rib, across it
      let ux = ridge[o1] - ridge[o0];
      let uy = ridge[o1 + 1] - ridge[o0 + 1];
      let uz = ridge[o1 + 2] - ridge[o0 + 2];
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const rl = Math.hypot(px, pz) || 1;
      let ax = -pz / rl;
      const ay = 0;
      let az = px / rl;
      let nx = ay * uz - az * uy;
      let ny = az * ux - ax * uz;
      let nz = ax * uy - ay * ux;
      if (nx * px + nz * pz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
        ax = -ax;
        az = -az;
      }
      ar.push(px, py, pz, nx, ny, nz);
      for (let s = 0; s < 7; s++) {
        const b = ((s + rng() * 0.6) / 7) * Math.PI * 2;
        const len = spine * (0.6 + 0.5 * rng()) * (s === 0 ? 1.3 : 1);
        const cb = Math.cos(b);
        const sb = Math.sin(b);
        ar.push(
          px + (ux * cb + ax * sb + nx * 0.35) * len,
          py + (uy * cb + ay * sb + ny * 0.35) * len,
          pz + (uz * cb + az * sb + nz * 0.35) * len,
        );
      }
    }
  }
  return { ridge, groove, faces: new Float32Array(faces), areoles: new Float32Array(ar), spine, step };
}
