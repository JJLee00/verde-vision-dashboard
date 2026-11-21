// Chaste tree's body, grown as trunks and limbs, masses of foliage,
// palmate leaves and flower spikes in the scene's feet. Shared by the
// canvas viewer and its WebGL layer, so both draw the same tree.

import { rngFor } from "../symbols";

/** Chaste tree: a soft grey-green crown of palmate leaves, crowned all
 *  summer with lavender flower spikes, on slim grey-brown trunks. */
export const CHASTE_COLOURS = {
  shade: [56, 80, 52],
  lit: [112, 142, 92],
  leafShade: [80, 112, 70],
  leafLit: [176, 202, 146],
  spikeShade: [126, 108, 188],
  spikeLit: [198, 182, 240],
  trunk: "rgb(132,118,104)",
  limb: "rgba(126,114,102,0.95)",
};
export const CHASTE_GOLD = {
  shade: [140, 104, 50],
  lit: [210, 170, 100],
  leafShade: [170, 130, 64],
  leafLit: [240, 214, 150],
  spikeShade: [214, 182, 120],
  spikeLit: [252, 240, 204],
  trunk: "rgb(176,128,56)",
  limb: "rgba(186,138,60,0.95)",
};

export type ChasteTree = {
  /** limbs by order — trunks, branches, twigs — as segments */
  limbs: [number, number, number][][][];
  /** masses of foliage over the crown's skin: centre, radii (across,
   *  up), the way its leaves face, tone */
  lobes: { c: [number, number, number]; rx: number; ry: number; n: [number, number, number]; col: [string, string] }[];
  /** palmate leaves, grouped by tone, each as its lobe, its offset from
   *  that lobe's centre, and the way it hangs */
  leafLobe: Uint16Array;
  leafOff: Float32Array;
  leafSlant: Float32Array;
  leafStart: Int32Array;
  /** flower spikes, grouped by tone, each as its lobe, its foot's
   *  offset from that lobe's centre, and its length and lean */
  spikeLobe: Uint16Array;
  spikeOff: Float32Array;
  spikeDir: Float32Array;
  spikeStart: Int32Array;
};
export const CT_LEVELS = 6;
export const CT_SPIKE_LEVELS = 4;
const ctRamp = (from: number[], to: number[], n: number) =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return `rgb(${from.map((v, k) => (v + (to[k] - v) * t) | 0).join(",")})`;
  });
export const CT_LEAF_TONES = [CHASTE_COLOURS, CHASTE_GOLD].map((p) => ctRamp(p.leafShade, p.leafLit, CT_LEVELS));
export const CT_SPIKE_TONES = [CHASTE_COLOURS, CHASTE_GOLD].map((p) => ctRamp(p.spikeShade, p.spikeLit, CT_SPIKE_LEVELS));
// A palmate leaf's five fingers: their turn off the leaf's line, and
// their length — the middle one longest.
export const CT_FINGERS = [
  [-0.95, 0.6],
  [-0.48, 0.85],
  [0, 1],
  [0.48, 0.85],
  [0.95, 0.6],
];
// The crown's radius (a fraction of rw) by height: a broad dome on a
// drooping rim — its edge hanging to a third of the way up, widest just
// under three fifths, the leaves topping out short of the spikes — as
// the model's is.
const chasteProf = (u: number) => {
  if (u < 0.34 || u > 0.93) return 0;
  if (u < 0.59) return 0.74 + 0.26 * Math.sin(((u - 0.34) / 0.25) * (Math.PI / 2));
  return Math.sqrt(Math.max(0, 1 - ((u - 0.59) / 0.34) ** 2));
};

export function growChaste(x: number, z: number, h: number, rw: number, rot: number, seed: string): ChasteTree {
  const rng = rngFor("chaste:" + seed);
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
  // Not quite round: a little longer one way, and lopsided, as the
  // model's crown is — each tree its own.
  const a1 = rng() * Math.PI * 2;
  const a2 = rng() * Math.PI * 2;
  // And the rim droops further on two sides than the other two, so from
  // some sides the trunks show under it.
  const a3 = rng() * Math.PI * 2;
  const rimU = (th: number) => 0.35 + 0.12 * (0.5 + 0.5 * Math.cos(2 * (th - a3)));
  const edge = (th: number) =>
    (1 - 0.08 * Math.sin(th - rot) ** 2) * (1 + 0.07 * Math.cos(th - a1) + 0.05 * Math.cos(2 * (th - a2)));
  const skinNormal = (th: number, u: number): V3 => {
    const lo = Math.max(0.34, u - 0.02);
    const hi = Math.min(0.93, u + 0.02);
    const d = (chasteProf(hi) - chasteProf(lo)) / (hi - lo);
    return nrm([Math.cos(th) * h, -d * rw, Math.sin(th) * h]);
  };
  // The way the leaves face: out from low in the crown. Under the
  // bulge the skin itself faces the ground, but the leaves hang on its
  // outside, seen from above as much as from the side.
  const leafward = (c: V3): V3 => nrm([(c[0] - x) / rw ** 2, (c[1] - h * 0.45) / (h * 0.5) ** 2, (c[2] - z) / rw ** 2]);

  // Four or five slim trunks from one foot, splaying into a vase and
  // kinking as they rise, each forking three ways where it meets the
  // crown.
  const trunks: V3[][] = [];
  const branches: V3[][] = [];
  const forks: V3[] = [];
  const NT = rng() < 0.5 ? 4 : 5;
  for (let k = 0; k < NT; k++) {
    const a = rot + (k / NT) * Math.PI * 2 + (rng() - 0.5) * 0.7;
    const foot: V3 = [x + Math.cos(a) * rw * 0.025, 0, z + Math.sin(a) * rw * 0.025];
    const am = a + (rng() - 0.5) * 0.6;
    const rm = rw * (0.07 + 0.07 * rng());
    const mid: V3 = [x + Math.cos(am) * rm, h * (0.18 + 0.08 * rng()), z + Math.sin(am) * rm];
    const rt = rw * (0.22 + 0.14 * rng());
    const top: V3 = [x + Math.cos(a) * rt, h * (0.42 + 0.08 * rng()), z + Math.sin(a) * rt];
    trunks.push([foot, mid], [mid, top]);
    for (let j = 0; j < 3; j++) {
      const ab = a + (j - 1) * 0.55 + (rng() - 0.5) * 0.3;
      const ub = 0.58 + 0.14 * rng();
      const rb = rw * chasteProf(ub) * (0.55 + 0.2 * rng());
      const B: V3 = [x + Math.cos(ab) * rb, ub * h, z + Math.sin(ab) * rb];
      branches.push([top, B]);
      forks.push(B);
    }
  }

  // Masses of foliage over the skin by area — a quarter on the
  // drooping sides, the rest over the broad top — drawn translucent:
  // where they pile up the crown is full, low down it thins enough for
  // the trunks to show through, as the model's does.
  const lobes: ChasteTree["lobes"] = [];
  const twigs: V3[][] = [];
  const alpha = 0.6;
  // Spread evenly — a spiral down the crown, a quarter on the sides —
  // so no stretch of it goes bare by chance.
  const NL = 140;
  for (let i = 0; i < NL; i++) {
    const f = (i + 0.2 + 0.6 * rng()) / NL;
    const th = rot + i * 2.399963 + (rng() - 0.5) * 0.5;
    const u0 = rimU(th);
    const u = f < 0.25 ? u0 + (0.59 - u0) * (f / 0.25) : 0.59 + 0.32 * Math.pow((f - 0.25) / 0.75, 0.9);
    const r = rw * chasteProf(u) * edge(th) * (0.78 + 0.1 * rng());
    const c: V3 = [x + Math.cos(th) * r, u * h, z + Math.sin(th) * r];
    const n = leafward(c);
    // Smaller on the rim, so the leaves hanging off it make its edge.
    const rx = rw * (0.17 + 0.07 * rng()) * (u < 0.59 ? 0.85 : 1);
    // Shaded by the skin, so the underside of the bulge is in shadow.
    const sh = (0.35 + 0.65 * lightOf(skinNormal(th, u))) * (0.6 + 0.4 * smooth(0.36, 0.8, u)) * (0.92 + 0.16 * rng());
    const tone = (pal: typeof CHASTE_COLOURS) =>
      `rgba(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * sh) | 0).join(",")},${alpha})`;
    lobes.push({ c, rx, ry: rx * 0.75, n, col: [tone(CHASTE_COLOURS), tone(CHASTE_GOLD)] });
    // Fed by a twig from the nearest fork.
    let best = forks[0];
    let bd = Infinity;
    for (const F of forks) {
      const d = (F[0] - c[0]) ** 2 + (F[1] - c[1]) ** 2 + (F[2] - c[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = F;
      }
    }
    twigs.push([best, lerp(best, c, 0.9)]);
  }

  // Palmate leaves on the lobes' outer faces, hanging; the ones on the
  // rim hang below it, for its ragged edge.
  const leaves: { li: number; o: V3; slant: number; group: number }[] = [];
  for (let i = 0; i < 1100; i++) {
    const li = i % NL;
    const L = lobes[li];
    const v = nrm([L.n[0] + (rng() - 0.5) * 1.6, L.n[1] + (rng() - 0.5) * 1.6, L.n[2] + (rng() - 0.5) * 1.6]);
    // Out to the mass's edge and past it, so its outline is leaves.
    const r = 0.55 + 0.75 * rng();
    const o: V3 = [v[0] * L.rx * r, v[1] * L.ry * r, v[2] * L.rx * r];
    if (L.c[1] < h * 0.48) o[1] -= L.ry * 0.5 * rng();
    const lit = lightOf(nrm([L.n[0] + v[0], L.n[1] + v[1], L.n[2] + v[2]]));
    const sh = (0.25 + 0.75 * lit) * (0.85 + 0.3 * rng());
    const level = Math.max(0, Math.min(CT_LEVELS - 1, Math.round(sh * (CT_LEVELS - 1))));
    // Screen angle from π/2 (down), tipped either way.
    leaves.push({ li, o, slant: Math.PI / 2 + (rng() - 0.5) * 1.4, group: level });
  }
  leaves.sort((a, b) => a.group - b.group);
  const NF = leaves.length;
  const leafLobe = new Uint16Array(NF);
  const leafOff = new Float32Array(NF * 3);
  const leafSlant = new Float32Array(NF);
  const leafStart = new Int32Array(CT_LEVELS + 1).fill(NF);
  leaves.forEach((f, i) => {
    leafLobe[i] = f.li;
    leafOff.set(f.o, i * 3);
    leafSlant[i] = f.slant;
    if (leafStart[f.group] === NF) leafStart[f.group] = i;
  });
  for (let gi = CT_LEVELS - 1; gi >= 0; gi--) leafStart[gi] = Math.min(leafStart[gi], leafStart[gi + 1]);

  // Flower spikes standing up out of all but the lowest of the crown,
  // leaning out a little: the lavender the tree is planted for.
  const upper: number[] = [];
  lobes.forEach((L, i) => {
    if (L.c[1] > h * 0.45) upper.push(i);
  });
  const spikes: { li: number; o: V3; d: V3; group: number }[] = [];
  for (let i = 0; i < 380 && upper.length; i++) {
    const li = upper[i % upper.length];
    const L = lobes[li];
    const o: V3 = [
      L.n[0] * L.rx * 0.55 + (rng() - 0.5) * L.rx * 1.1,
      L.n[1] * L.ry * 0.55 + (rng() - 0.5) * L.ry * 0.6,
      L.n[2] * L.rx * 0.55 + (rng() - 0.5) * L.rx * 1.1,
    ];
    const len = 0.9 + 0.6 * rng();
    const lean = 0.1 + 0.4 * rng();
    const az = Math.atan2(L.c[2] - z, L.c[0] - x) + (rng() - 0.5) * 1.4;
    const d: V3 = [Math.sin(lean) * Math.cos(az) * len, Math.cos(lean) * len, Math.sin(lean) * Math.sin(az) * len];
    const sh = (0.35 + 0.65 * lightOf(L.n)) * (0.85 + 0.3 * rng());
    const level = Math.max(0, Math.min(CT_SPIKE_LEVELS - 1, Math.round(sh * (CT_SPIKE_LEVELS - 1))));
    spikes.push({ li, o, d, group: level });
  }
  spikes.sort((a, b) => a.group - b.group);
  const NS = spikes.length;
  const spikeLobe = new Uint16Array(NS);
  const spikeOff = new Float32Array(NS * 3);
  const spikeDir = new Float32Array(NS * 3);
  const spikeStart = new Int32Array(CT_SPIKE_LEVELS + 1).fill(NS);
  spikes.forEach((f, i) => {
    spikeLobe[i] = f.li;
    spikeOff.set(f.o, i * 3);
    spikeDir.set(f.d, i * 3);
    if (spikeStart[f.group] === NS) spikeStart[f.group] = i;
  });
  for (let gi = CT_SPIKE_LEVELS - 1; gi >= 0; gi--) spikeStart[gi] = Math.min(spikeStart[gi], spikeStart[gi + 1]);

  return {
    limbs: [trunks, branches, twigs],
    lobes,
    leafLobe,
    leafOff,
    leafSlant,
    leafStart,
    spikeLobe,
    spikeOff,
    spikeDir,
    spikeStart,
  };
}
