// Beaked yucca's body, grown as a ball of blades over a straw skirt in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Beaked Yucca as the app's mature model is: a ball of dark green blades,
 *  a skirt of straw-coloured dead leaves, a short brown trunk. Measured off
 *  the model's render. */
export const BEAKED_YUCCA_COLOURS = {
  trunk: "rgb(120,106,86)",
  trunkLit: "rgb(152,136,110)",
  trunkLine: "rgb(88,76,60)",
  skirt: "rgb(140,126,102)",
  skirtLit: "rgb(178,164,138)",
  straw: ["rgb(116,102,80)", "rgb(150,136,112)", "rgb(184,170,144)"],
  core: "rgb(30,42,22)",
  back: ["rgb(38,54,26)", "rgb(48,66,32)"],
  blade: ["rgb(50,70,30)", "rgb(60,82,34)", "rgb(72,94,40)", "rgb(92,114,50)", "rgb(118,142,62)"],
  edge: "rgb(46,64,30)",
};
export const BEAKED_YUCCA_GOLD = {
  trunk: "rgb(150,112,52)",
  trunkLit: "rgb(196,160,96)",
  trunkLine: "rgb(120,88,40)",
  skirt: "rgb(196,160,96)",
  skirtLit: "rgb(232,206,150)",
  straw: ["rgb(170,130,62)", "rgb(206,170,104)", "rgb(236,210,156)"],
  core: "rgb(120,88,40)",
  back: ["rgb(140,104,46)", "rgb(160,122,58)"],
  blade: ["rgb(170,130,62)", "rgb(190,150,78)", "rgb(210,172,100)", "rgb(228,196,128)", "rgb(240,214,150)"],
  edge: "rgb(140,104,46)",
};

export type YuccaPlant = {
  /** the ball's middle, feet */
  gy: number;
  /** blades, 7 numbers each: base and tip as offsets from the ball's
   *  middle (feet), tone 0–4 */
  blades: Float32Array;
  /** dead leaves on the skirt, 8 each: top and tip as offsets from the
   *  skirt's middle (feet), tone 0–2, how far it curls to one side */
  straw: Float32Array;
  /** the skirt's middle, feet up */
  sy: number;
  /** the skirt's outline, height and radius in feet, bottom up */
  skirt: number[];
  bladeLen: number;
  bladeW: number;
  strawLen: number;
  trunkR: number;
  trunkTop: number;
  coreR: number;
};
// The app's mature model, metres: 4.27 tall, 1.40 at the widest radius.
export const BY_H = 4.267;
export const BY_R = 1.3985;

export function growBeakedYucca(h: number, rw: number, rot: number, seed: string): YuccaPlant {
  const rng = rngFor("beakedyucca:" + seed);
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  const kx = rw / BY_R;
  const ky = h / BY_H;
  const gyM = 2.69;
  // Blades, as the model's 1,880 run: straight out of a crown on the
  // trunk's head (2.2–3.2 m up), the lowest angled 30° down, the top ones
  // 72° up — the higher on the crown, the steeper — each 1.06–1.39 m.
  const N = 1500;
  const blades = new Float32Array(N * 7);
  for (let k = 0; k < N; k++) {
    const t = (k + rng()) / N;
    const e = ((-30 + 102 * t) * Math.PI) / 180;
    const a = k * 2.39996 + rot + (rng() - 0.5) * 0.4;
    const dx = Math.cos(e) * Math.cos(a);
    const dy = Math.sin(e);
    const dz = Math.cos(e) * Math.sin(a);
    const by = 2.22 + 0.94 * t + (rng() - 0.5) * 0.2 - gyM;
    const len = 1.06 + 0.33 * rng();
    // Lit half by where it is on the ball (the far side of the ball
    // shades it) and half by its face: a flat blade's upper face, square
    // to it and as near up as it can be, catches the sun from above.
    let fx = -dx * dy;
    let fy = 1 - dy * dy;
    let fz = -dz * dy;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl;
    fy /= fl;
    fz /= fl;
    const lit = 0.5 + 0.25 * (dx * LX + dy * LY + dz * LZ) + 0.25 * (fx * LX + fy * LY + fz * LZ);
    const shade = (0.4 + 0.6 * lit) * (0.5 + rng());
    blades.set(
      [
        Math.cos(a) * 0.02 * kx,
        by * ky,
        Math.sin(a) * 0.02 * kx,
        (Math.cos(a) * 0.02 + dx * len) * kx,
        (by + dy * len) * ky,
        (Math.sin(a) * 0.02 + dz * len) * kx,
        Math.max(0, Math.min(4, Math.floor(shade * 5))),
      ],
      k * 7,
    );
  }
  // The skirt: last years' leaves hanging straight down the trunk from
  // under the ball, a straw column a little wider at the top.
  const ring: [number, number][] = [
    [0.62, 0.15],
    [0.8, 0.26],
    [1.05, 0.32],
    [1.45, 0.35],
    [1.9, 0.34],
    [2.3, 0.28],
  ];
  const skirt: number[] = [];
  for (const [y, r] of ring) skirt.push(y * ky, r * kx);
  const syM = 1.45;
  const S = 720;
  const straw = new Float32Array(S * 8);
  for (let k = 0; k < S; k++) {
    const y0 = 0.8 + 1.5 * rng();
    let r0 = 0.15;
    for (let i = 1; i < ring.length; i++)
      if (y0 <= ring[i][0]) {
        const f = (y0 - ring[i - 1][0]) / (ring[i][0] - ring[i - 1][0]);
        r0 = ring[i - 1][1] + (ring[i][1] - ring[i - 1][1]) * f;
        break;
      }
    // From the trunk, as the model's do, hanging out to the skirt's edge.
    r0 = 0.15 + (r0 - 0.15) * 0.4;
    const a = rng() * Math.PI * 2;
    const drop = ((60 + 22 * rng()) * Math.PI) / 180;
    const len = Math.min(0.3 + 0.25 * rng(), (y0 - 0.55) / Math.sin(drop));
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const lit = 0.5 + 0.5 * (ca * LX + sa * LZ) * 0.9;
    const tone = Math.max(0, Math.min(2, Math.floor((0.3 + 0.7 * lit) * (0.7 + 0.6 * rng()) * 3)));
    straw.set(
      [
        ca * r0 * kx,
        (y0 - syM) * ky,
        sa * r0 * kx,
        (ca * (r0 + Math.cos(drop) * len)) * kx,
        (y0 - syM - Math.sin(drop) * len) * ky,
        (sa * (r0 + Math.cos(drop) * len)) * kx,
        tone,
        (rng() - 0.5) * 0.5, // dead leaves curl as they dry
      ],
      k * 8,
    );
  }
  return {
    gy: gyM * ky,
    blades,
    straw,
    sy: syM * ky,
    skirt,
    bladeLen: 1.22 * kx,
    bladeW: 0.088 * kx,
    strawLen: 0.42 * kx,
    trunkR: 0.165 * kx,
    trunkTop: 1.0 * ky,
    coreR: 0.55 * kx,
  };
}
