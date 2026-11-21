// Blue palo verde's body, grown as limbs, lobes of foliage and flecks of
// leaf in the scene's feet. Shared by the canvas viewer and its WebGL
// layer, so both draw the same tree.

import { rngFor } from "../symbols";

/** Blue palo verde: the misty sage of a canopy that's mostly fine green
 *  twigs, the smooth pale bark it's named for, and a light spring bloom. */
export const PALO_VERDE_COLOURS = {
  lit: [210, 216, 186],
  shade: [124, 140, 114],
  bloom: "rgb(224,208,138)",
  trunk: "rgb(156,162,138)",
  limb: "rgba(122,142,112,0.95)",
  twig: "rgba(128,148,118,0.8)",
};
export const PALO_VERDE_GOLD = {
  lit: [232, 204, 140],
  shade: [160, 122, 60],
  bloom: "rgb(246,226,170)",
  trunk: "rgb(196,150,70)",
  limb: "rgba(186,138,60,0.95)",
  twig: "rgba(196,150,70,0.8)",
};

export type PaloVerdeTree = {
  /** limbs by order — trunk, main limbs, branches, twigs, fine twigs — as segments */
  limbs: [number, number, number][][][];
  /** canopy lobes: centre, then its two radii (across, up) */
  lobes: { c: [number, number, number]; rx: number; ry: number; col: [string, string] }[];
  /** leaf flecks, grouped by tone — 0 (deep shade) to PV_LEVELS - 1,
   *  then the flowers — each as the lobe it sits in, its offset from
   *  that lobe's centre (xyz), and its slant */
  fleckLobe: Uint16Array;
  fleckOff: Float32Array;
  fleckSlant: Float32Array;
  /** where each tone's flecks start; the flowers' group is PV_LEVELS */
  groupStart: Int32Array;
};
// Flecks take one of a few tones, so all of one tone fill in a single
// pass — a canopy is a thousand of them.
export const PV_LEVELS = 8;
const pvTones = (pal: typeof PALO_VERDE_COLOURS) =>
  Array.from({ length: PV_LEVELS }, (_, i) => {
    const t = i / (PV_LEVELS - 1);
    return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
  });
export const PV_TONES = [pvTones(PALO_VERDE_COLOURS), pvTones(PALO_VERDE_GOLD)];

export function growPaloVerde(x: number, z: number, h: number, rw: number, rot: number, seed: string): PaloVerdeTree {
  const rng = rngFor("paloverde:" + seed);
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
  // The canopy's skin: a broad dome on a drooping rim — widest a little
  // above halfway, its edge down to a third of the height, as the model.
  const y0 = h * 0.55;
  const shell = (th: number, ph: number): V3 => [
    x + rw * Math.cos(ph) * Math.cos(th),
    y0 + Math.sin(ph) * (ph > 0 ? h * 0.45 : h * 0.6),
    z + rw * Math.cos(ph) * Math.sin(th),
  ];
  const outward = (c: V3): V3 => nrm([(c[0] - x) / rw, ((c[1] - y0) / h) * 1.4, (c[2] - z) / rw]);

  // One trunk, forking a fifth of the way up into a vase of limbs, each
  // forking twice more out to the canopy's skin, every twig ending in a
  // fan of fine ones.
  const trunk: V3[][] = [];
  const mains: V3[][] = [];
  const branches: V3[][] = [];
  const twigs: V3[][] = [];
  const fine: V3[][] = [];
  const clusters: V3[][] = []; // each branch's twig ends
  const lean = rng() * 6.28;
  const F: V3 = [x + Math.cos(lean) * rw * 0.03, h * 0.2, z + Math.sin(lean) * rw * 0.03];
  trunk.push([[x, 0, z], F]);
  const NM = 7;
  for (let k = 0; k < NM; k++) {
    const a = rot + (k / NM) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const o1 = rw * (0.24 + 0.12 * rng());
    const P1: V3 = [F[0] + Math.cos(a) * o1, h * (0.38 + 0.08 * rng()), F[2] + Math.sin(a) * o1];
    mains.push([F, P1]);
    for (let j = 0; j < 3; j++) {
      const a2 = a + (j - 1) * 0.45 + (rng() - 0.5) * 0.3;
      const out = rw * (j === 1 ? 0.16 : 0.24) * (0.8 + 0.4 * rng());
      const P2: V3 = [P1[0] + Math.cos(a2) * out, h * (j === 1 ? 0.64 : 0.54) * (0.95 + 0.1 * rng()), P1[2] + Math.sin(a2) * out];
      branches.push([P1, P2]);
      const ends: V3[] = [];
      for (let i = 0; i < 3; i++) {
        const th = a2 + (rng() - 0.5) * 0.7;
        // Out to the skin, anywhere from the drooping rim to the crown;
        // the middle branch of each fork reaches higher.
        const ph = -0.35 + (Math.PI / 2 + 0.35) * Math.pow(rng(), j === 1 ? 0.6 : 1.3) * 0.95;
        const P3 = lerp(P2, shell(th, ph), 0.88 + 0.1 * rng());
        twigs.push([P2, P3]);
        ends.push(P3);
        const td = nrm([P3[0] - P2[0], P3[1] - P2[1], P3[2] - P2[2]]);
        for (let f = 0; f < 5; f++) {
          const A = lerp(P2, P3, 0.35 + 0.65 * rng());
          const fd = nrm([td[0] * 0.6 + (rng() - 0.5) * 0.9, td[1] * 0.6 + 0.45 + (rng() - 0.5) * 0.4, td[2] * 0.6 + (rng() - 0.5) * 0.9]);
          const fl = rw * 0.12 * (0.6 + 0.6 * rng());
          fine.push([A, [A[0] + fd[0] * fl, A[1] + fd[1] * fl, A[2] + fd[2] * fl]]);
        }
      }
      clusters.push([P2, ...ends]);
    }
  }

  // A lobe of foliage round each branch's spray of twigs, drawn
  // translucent: where lobes overlap the crown thickens, at its edges
  // it thins to air, and the limbs show through it dimmed — as the
  // model's mist does.
  // Two to a branch, one in and one out, so they run together into one
  // lumpy dome; none hangs below the drooping rim, or the crown grows a
  // skirt round the trunk.
  const lobes: PaloVerdeTree["lobes"] = [];
  // Each lobe is itself three overlapping puffs, fainter, so its edge is
  // lumpy as foliage is — one clean ellipse apiece made cartoon clouds.
  const alpha = 0.23;
  for (const [P2, ...ends] of clusters) {
    const m: V3 = [0, 0, 0];
    for (const e of ends) for (let i = 0; i < 3; i++) m[i] += e[i] / ends.length;
    for (const t of [0.55, 0.95]) {
      const c = lerp(P2, m, t);
      c[0] += (rng() - 0.5) * rw * 0.06;
      c[2] += (rng() - 0.5) * rw * 0.06;
      let spread = 0;
      for (const e of ends) spread = Math.max(spread, Math.hypot(e[0] - c[0], e[2] - c[2]));
      const rx = Math.max(rw * 0.22, spread * 0.9) * (0.85 + 0.25 * rng());
      const ry = Math.max(rx * 0.3, Math.min(rx * 0.6, c[1] - h * 0.32));
      for (let k = 0; k < 3; k++) {
        const pc: V3 = [c[0] + (rng() - 0.5) * rx * 0.8, c[1] + (rng() - 0.5) * ry * 0.6, c[2] + (rng() - 0.5) * rx * 0.8];
        const s = (0.45 + 0.55 * lightOf(outward(pc))) * 0.85 + 0.15;
        const tone = (pal: typeof PALO_VERDE_COLOURS) =>
          `rgba(${pal.shade.map((v, i) => (v + (pal.lit[i] - v) * s) | 0).join(",")},${alpha})`;
        lobes.push({ c: pc, rx: rx * (0.6 + 0.15 * rng()), ry: ry * (0.65 + 0.15 * rng()), col: [tone(PALO_VERDE_COLOURS), tone(PALO_VERDE_GOLD)] });
      }
    }
  }

  // Flecks of tiny leaves through the lobes, thickest toward their
  // skins; a few, out at the canopy's edge, yellow bloom. Each is kept
  // as an offset in its lobe, so it's placed by the lobe's projection
  // rather than projected itself — a thousand projections a tree was
  // most of what a small tree cost.
  const NF = 1500;
  const raw: { li: number; o: V3; slant: number; group: number }[] = [];
  for (let i = 0; i < NF; i++) {
    const li = Math.floor(rng() * lobes.length);
    const L = lobes[li];
    const v = nrm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
    const r = Math.pow(rng(), 0.4);
    const o: V3 = [v[0] * L.rx * r, v[1] * L.ry * r, v[2] * L.rx * r];
    const c: V3 = [L.c[0] + o[0], L.c[1] + o[1], L.c[2] + o[2]];
    const n = outward(c);
    const e = Math.hypot((c[0] - x) / rw, (c[1] - y0) / (h * 0.5), (c[2] - z) / rw);
    const shade = (0.3 + 0.7 * lightOf(nrm([n[0] + v[0], n[1] + v[1], n[2] + v[2]]))) * (0.55 + 0.45 * smooth(0.4, 1, e)) * (0.9 + 0.2 * rng());
    const level = Math.max(0, Math.min(PV_LEVELS - 1, Math.round(shade * (PV_LEVELS - 1))));
    raw.push({ li, o, slant: rng() * Math.PI, group: e > 0.8 && rng() < 0.12 ? PV_LEVELS : level });
  }
  raw.sort((a, b) => a.group - b.group);
  const fleckLobe = new Uint16Array(NF);
  const fleckOff = new Float32Array(NF * 3);
  const fleckSlant = new Float32Array(NF);
  const groupStart = new Int32Array(PV_LEVELS + 2).fill(NF);
  raw.forEach((f, i) => {
    fleckLobe[i] = f.li;
    fleckOff.set(f.o, i * 3);
    fleckSlant[i] = f.slant;
    if (groupStart[f.group] === NF) groupStart[f.group] = i;
  });
  // A group with no flecks starts where the next one does.
  for (let gi = PV_LEVELS; gi >= 0; gi--) groupStart[gi] = Math.min(groupStart[gi], groupStart[gi + 1]);
  return { limbs: [trunk, mains, branches, twigs, fine], lobes, fleckLobe, fleckOff, fleckSlant, groupStart };
}
