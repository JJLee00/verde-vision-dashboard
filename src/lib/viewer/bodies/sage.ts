// Texas sage's body, grown as tufts of leaves and bloom spikes in the
// scene's feet. Shared by the canvas viewer and its WebGL pilot, so both draw
// the same leaves.

import { rngFor } from "../symbols";

/** Texas sage: lavender bloom over woolly silver leaves — the model is in
 *  flower, as the plant is for weeks after every monsoon. */
export const SAGE_COLOURS = {
  core: [150, 140, 170], // the dense middle, seen between the tufts
  bloomLit: [184, 166, 222],
  bloomShade: [122, 104, 164],
  bloomPale: [222, 212, 242], // the open flowers catching the light
  leafLit: [206, 212, 196],
  leafShade: [142, 152, 134],
};
export const SAGE_GOLD = {
  core: [170, 132, 66],
  bloomLit: [228, 196, 128],
  bloomShade: [156, 118, 58],
  bloomPale: [240, 220, 160],
  leafLit: [222, 200, 140],
  leafShade: [150, 120, 64],
};

// Grown once per plant and kept.
export type SageTuft = {
  c: [number, number, number];
  /** leaf corners then spike corners, as offsets from c, xyz */
  leaves: Float32Array;
  spikes: Float32Array;
  inner: boolean;
  leafCol: [string, string]; // [plain, gold]
  spikeCol: [string, string];
};
// The sage's core: its shell set back from the leaves, as points round
// the dome, filled as one silhouette each frame.
export const sageCoreRing = (x: number, z: number, h: number, rw: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const u = 0.04 + (0.86 * i) / 10;
    const r = rw * 0.8 * (u < 0.3 ? 0.8 + 0.2 * (u / 0.3) : Math.pow(Math.max(0, 1 - ((u - 0.3) / 0.7) ** 2), 0.42));
    for (let j = 0; j < 16; j++) {
      const th = (j / 16) * Math.PI * 2;
      out.push([x + Math.cos(th) * r, u * h, z + Math.sin(th) * r]);
    }
  }
  return out;
};

export function growTexasSage(x: number, z: number, h: number, rw: number, seed: string): SageTuft[] {
  const rng = rngFor("texassage:" + seed);
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const smooth = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  type V3 = [number, number, number];
  const nrm = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const crs = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  // A dome sitting on the ground: foliage right down to the soil, widest
  // a third of the way up, rounding over the top. No stems show.
  const prof = (u: number) =>
    u < 0.3 ? 0.8 + 0.2 * smooth(0, 0.3, u) : Math.pow(Math.max(0, 1 - ((u - 0.3) / 0.7) ** 2), 0.42);

  // Corners of a soft oval leaf and of a bloom spike, along (1, 0) with
  // the width on the second axis: [along, across] fractions.
  const OVAL: [number, number][] = [[0, 0], [0.2, 0.42], [0.55, 0.5], [0.9, 0.3], [1, 0], [0.9, -0.3], [0.55, -0.5], [0.2, -0.42]];
  const SPIKE: [number, number][] = [[0, -0.45], [0.3, -1], [0.65, -0.75], [1, 0], [0.65, 0.75], [0.3, 1], [0, 0.45]];
  const put = (out: number[], base: V3, dir: V3, perp: V3, len: number, wid: number, shape: [number, number][]) => {
    for (const [f, q] of shape) {
      for (let i = 0; i < 3; i++) out.push(base[i] + dir[i] * len * f + perp[i] * wid * q);
    }
  };

  // The mass: big soft clumps of grey foliage under everything, fill
  // only. A sage is a dense mound; tufts alone left it mostly air.
  const NI = 190;
  const NS = 300;
  const s1 = rng() * 6.28;
  const tufts: SageTuft[] = [];
  for (let tries = 0; tufts.length < NS + NI && tries < (NS + NI) * 4; tries++) {
    const inner = tufts.length < NI;
    const u = 0.02 + 0.96 * rng();
    // By area. Up the straight lower third that follows the radius; over
    // the dome it doesn't — a sphere has as much skin per foot of height
    // at the crown as at the waist, and thinning by radius left the top,
    // the part the camera looks down on, nearly bare.
    if (u < 0.3 && rng() > prof(u)) continue;
    const th = rng() * Math.PI * 2;
    const lump = 1 + 0.05 * Math.sin(5 * th + 7 * u + s1);
    const r = rw * prof(u) * (inner ? 0.72 + 0.18 * rng() : 0.92 + 0.1 * rng()) * lump;
    const c: V3 = [x + Math.cos(th) * r, Math.min(u * h, h * 0.97), z + Math.sin(th) * r];
    const n = nrm([Math.cos(th) * prof(u), (u - 0.25) * 1.6, Math.sin(th) * prof(u)]);
    const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
    const shade = (0.3 + 0.7 * lit) * (0.55 + 0.45 * smooth(0, 0.6, u));
    const side = nrm(crs([0, 1, 0], n[1] > 0.98 ? [1, 0, 0] : n));
    const leaves: number[] = [];
    const spikes: number[] = [];
    // A tuft's woolly leaves, lying along the surface and fanned.
    const nl = inner ? 3 : 4;
    const L = rw * (inner ? 0.2 : 0.085) * (0.85 + 0.3 * rng());
    for (let k = 0; k < nl; k++) {
      const a = (k / nl) * Math.PI * 2 + rng() * 0.8;
      const dir = nrm([
        n[0] * 0.5 + side[0] * Math.cos(a) * 0.8,
        n[1] * 0.5 + 0.35 + Math.sin(a) * 0.5,
        n[2] * 0.5 + side[2] * Math.cos(a) * 0.8,
      ]);
      const perp = nrm(crs(dir, n));
      put(leaves, [0, 0, 0], dir, perp, L, L * 0.55, OVAL);
    }
    // Bloom spikes: up and a little out, mostly on the upper two thirds.
    const blooming = !inner && rng() < 0.35 + 0.6 * smooth(0.1, 0.45, u);
    const pale = rng() < 0.45;
    if (blooming) {
      const ns = 3 + Math.floor(rng() * 2);
      for (let k = 0; k < ns; k++) {
        const dir = nrm([
          n[0] * 0.45 + (rng() - 0.5) * 0.35,
          0.85 + (rng() - 0.5) * 0.2,
          n[2] * 0.45 + (rng() - 0.5) * 0.35,
        ]);
        const perp = nrm(crs(dir, n[1] > 0.98 ? [1, 0, 0] : n));
        // Slim: a short raceme of small bells, not a petal.
        const Ls = rw * 0.15 * (0.75 + 0.45 * rng());
        put(spikes, [(rng() - 0.5) * L * 0.6, 0, (rng() - 0.5) * L * 0.6], dir, perp, Ls, Ls * 0.2, SPIKE);
      }
    }
    const leafTone = (pal: typeof SAGE_COLOURS) => {
      let col = mix(pal.leafShade, pal.leafLit, inner ? shade * 0.7 : shade);
      // In flower the upper mass is a lavender haze, not grey: bloom
      // seen through bloom. The mass also sits a step into shadow.
      if (inner) col = mix(col, pal.bloomLit, 0.5 * smooth(0.15, 0.6, u)).map((v) => v * 0.9);
      return rgb(col);
    };
    const spikeTone = (pal: typeof SAGE_COLOURS) => {
      const col = mix(pal.bloomShade, pal.bloomLit, shade);
      return rgb(pale ? mix(col, pal.bloomPale, 0.5) : col);
    };
    tufts.push({
      c,
      leaves: new Float32Array(leaves),
      spikes: new Float32Array(spikes),
      inner,
      leafCol: [leafTone(SAGE_COLOURS), leafTone(SAGE_GOLD)],
      spikeCol: [spikeTone(SAGE_COLOURS), spikeTone(SAGE_GOLD)],
    });
  }
  return tufts;
}
