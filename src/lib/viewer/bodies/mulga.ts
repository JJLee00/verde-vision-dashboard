// Mulga's body, grown as a leader and branches, faint puffs of foliage and
// needles of phyllode in the scene's feet. Shared by the canvas viewer and
// its WebGL layer, so both draw the same tree.

import { rngFor } from "../symbols";

/** Mulga: the palest crown in the catalog — silver-grey phyllodes — over
 *  the reddish-brown of its leader and branches. */
export const MULGA_COLOURS = {
  lit: [204, 216, 206],
  shade: [124, 142, 134],
  trunk: "rgb(140,108,96)",
  limb: "rgba(142,110,98,0.95)",
  twig: "rgba(150,124,112,0.8)",
};
export const MULGA_GOLD = {
  lit: [232, 204, 140],
  shade: [160, 122, 60],
  trunk: "rgb(176,128,56)",
  limb: "rgba(186,138,60,0.95)",
  twig: "rgba(196,150,70,0.8)",
};
// The sapling and the mature tree are separate models; the viewer draws
// every size mature, so both take the mature body.
export const MULGA_MODELS = new Set(["MulgaAcaciaSm", "MulgaAcaciaLg"]);

export type MulgaTree = {
  /** limbs by order — trunk, leader, branches, twigs — as segments */
  limbs: [number, number, number][][][];
  /** canopy puffs: centre, radii (across, up), tone */
  lobes: { c: [number, number, number]; rx: number; ry: number; col: [string, string] }[];
  /** phyllode flecks, grouped by tone, each as its puff, its offset from
   *  that puff's centre, and its slant */
  fleckLobe: Uint16Array;
  fleckOff: Float32Array;
  fleckSlant: Float32Array;
  groupStart: Int32Array;
};
export const MU_LEVELS = 7;
const muTones = (pal: typeof MULGA_COLOURS) =>
  Array.from({ length: MU_LEVELS }, (_, i) => {
    const t = i / (MU_LEVELS - 1);
    return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
  });
export const MU_TONES = [muTones(MULGA_COLOURS), muTones(MULGA_GOLD)];
// The crown's radius (a fraction of rw) by height: widest low, where
// the lower limbs spread, then tapering to a point — a narrow upright
// cone over an oval, as the model is.
const mulgaProf = (u: number) => {
  if (u < 0.2 || u > 1) return 0;
  if (u < 0.32) return 0.65 + 0.35 * Math.sin(((u - 0.2) / 0.12) * (Math.PI / 2));
  if (u < 0.5) return 1 - 0.22 * ((u - 0.32) / 0.18);
  return 0.78 * Math.sqrt(Math.max(0, 1 - ((u - 0.5) / 0.5) ** 1.6));
};

export function growMulga(x: number, z: number, h: number, rw: number, rot: number, seed: string): MulgaTree {
  const rng = rngFor("mulga:" + seed);
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  const smooth = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  type V3 = [number, number, number];
  const nrm = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const lightOf = (n: V3) => Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
  const outward = (c: V3): V3 => nrm([(c[0] - x) / rw, ((c[1] - h * 0.5) / h) * 1.2, (c[2] - z) / rw]);

  // One leader all the way up — a mulga doesn't fork into a vase as the
  // palo verde does — with branches rising off it at a steep angle, the
  // low ones longest, out to the crown's skin.
  const lean = rng() * 6.28;
  const top: V3 = [x + Math.cos(lean) * rw * 0.06, h * 0.88, z + Math.sin(lean) * rw * 0.06];
  const F: V3 = lerp([x, 0, z], top, 0.22 / 0.88);
  const trunk: V3[][] = [[[x, 0, z], F]];
  const leader: V3[][] = [[F, top]];
  const branches: V3[][] = [];
  const twigs: V3[][] = [];
  const clusters: V3[][] = [];
  const NB = 13;
  for (let k = 0; k < NB; k++) {
    const t = 0.22 + (0.62 * (k + rng() * 0.6)) / NB;
    const A = lerp([x, 0, z], top, t / 0.88);
    const a = rot + k * 2.399963 + (rng() - 0.5) * 0.4;
    // Up at forty to sixty degrees, to the skin a little higher up; the
    // lowest ones flatter, spreading the crown wide just above the trunk.
    const low = 1 - smooth(0.22, 0.4, t);
    const ut = Math.min(0.96, t + (0.1 + 0.08 * rng()) * (1 - 0.6 * low));
    const r = rw * mulgaProf(ut) * (0.85 + 0.15 * rng());
    const B: V3 = [x + Math.cos(a) * r, ut * h, z + Math.sin(a) * r];
    branches.push([A, B]);
    const ends: V3[] = [B];
    for (let j = 0; j < 2; j++) {
      const S = lerp(A, B, 0.45 + 0.3 * rng());
      const aj = a + (j ? 0.6 : -0.6) * (0.6 + 0.6 * rng());
      const uj = Math.min(0.98, S[1] / h + 0.08 + 0.08 * rng());
      const rj = rw * mulgaProf(uj) * (0.8 + 0.2 * rng());
      const E: V3 = [x + Math.cos(aj) * rj, uj * h, z + Math.sin(aj) * rj];
      twigs.push([S, E]);
      ends.push(E);
    }
    clusters.push([A, ...ends]);
  }

  // Faint silver puffs along the outer half of every branch and twig:
  // a mulga's crown is as see-through as the palo verde's, its limbs
  // showing through it.
  const lobes: MulgaTree["lobes"] = [];
  const alpha = 0.17;
  for (const [A, ...ends] of clusters) {
    for (const E of ends) {
      for (const t of [0.8]) {
        const c = lerp(A, E, t);
        const rx = rw * (0.22 + 0.08 * rng());
        for (let k = 0; k < 3; k++) {
          const pc: V3 = [c[0] + (rng() - 0.5) * rx * 0.9, c[1] + (rng() - 0.5) * rx * 1.2, c[2] + (rng() - 0.5) * rx * 0.9];
          // None hangs below the crown's floor, or the bare trunk wears a
          // bubble.
          pc[1] = Math.max(pc[1], h * 0.26 + rx * 0.6);
          const sh = (0.45 + 0.55 * lightOf(outward(pc))) * 0.85 + 0.15;
          const tone = (pal: typeof MULGA_COLOURS) =>
            `rgba(${pal.shade.map((v, i) => (v + (pal.lit[i] - v) * sh) | 0).join(",")},${alpha})`;
          // Taller than wide: the phyllodes stand up off upright shoots.
          const prx = rx * (0.55 + 0.15 * rng());
          lobes.push({ c: pc, rx: prx, ry: prx * 1.15, col: [tone(MULGA_COLOURS), tone(MULGA_GOLD)] });
        }
      }
    }
  }

  // Phyllodes: thin silver needles, slanting up — the fine, misty
  // texture the catalog sells it on.
  const raw: { li: number; o: V3; slant: number; group: number }[] = [];
  for (let i = 0; i < 1100; i++) {
    const li = Math.floor(rng() * lobes.length);
    const L = lobes[li];
    const v = nrm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
    const r = Math.pow(rng(), 0.45);
    const o: V3 = [v[0] * L.rx * r, v[1] * L.ry * r, v[2] * L.rx * r];
    const c: V3 = [L.c[0] + o[0], L.c[1] + o[1], L.c[2] + o[2]];
    const n = outward(c);
    const e = Math.hypot((c[0] - x) / (rw * Math.max(0.3, mulgaProf(c[1] / h))), 0, (c[2] - z) / (rw * Math.max(0.3, mulgaProf(c[1] / h))));
    const sh = (0.3 + 0.7 * lightOf(nrm([n[0] + v[0], n[1] + v[1], n[2] + v[2]]))) * (0.6 + 0.4 * smooth(0.3, 1, e)) * (0.9 + 0.2 * rng());
    const level = Math.max(0, Math.min(MU_LEVELS - 1, Math.round(sh * (MU_LEVELS - 1))));
    // Up and to either side, never flat: screen angle from -π/2 (up).
    raw.push({ li, o, slant: -Math.PI / 2 + (rng() - 0.5) * 1.6, group: level });
  }
  raw.sort((a, b) => a.group - b.group);
  const NF = raw.length;
  const fleckLobe = new Uint16Array(NF);
  const fleckOff = new Float32Array(NF * 3);
  const fleckSlant = new Float32Array(NF);
  const groupStart = new Int32Array(MU_LEVELS + 1).fill(NF);
  raw.forEach((f, i) => {
    fleckLobe[i] = f.li;
    fleckOff.set(f.o, i * 3);
    fleckSlant[i] = f.slant;
    if (groupStart[f.group] === NF) groupStart[f.group] = i;
  });
  for (let gi = MU_LEVELS - 1; gi >= 0; gi--) groupStart[gi] = Math.min(groupStart[gi], groupStart[gi + 1]);
  return { limbs: [trunk, leader, branches, twigs], lobes, fleckLobe, fleckOff, fleckSlant, groupStart };
}
