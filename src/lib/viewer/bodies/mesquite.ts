// Honey mesquite's body, grown as limbs, puffs of foliage, weeping strands
// and flecks of leaf in the scene's feet. Shared by the canvas viewer and
// its WebGL layer, so both draw the same tree.

import { rngFor } from "../symbols";

/** Honey mesquite: fresh yellow-green feathery leaves, the dark rough grey
 *  of its trunk and crooked limbs, and pale catkins of bloom. */
export const MESQUITE_COLOURS = {
  lit: [182, 194, 132],
  shade: [88, 114, 64],
  bloom: "rgb(218,212,158)",
  trunk: "rgb(104,94,86)",
  limb: "rgba(112,102,94,0.95)",
  twig: "rgba(126,118,106,0.8)",
  strand: "rgba(112,138,80,0.75)",
};
export const MESQUITE_GOLD = {
  lit: [232, 204, 140],
  shade: [160, 122, 60],
  bloom: "rgb(246,226,170)",
  trunk: "rgb(176,128,56)",
  limb: "rgba(186,138,60,0.95)",
  twig: "rgba(196,150,70,0.8)",
  strand: "rgba(196,150,70,0.75)",
};

export type MesquiteTree = {
  /** limbs by order — trunk, main limbs, branches, twigs — as segments */
  limbs: [number, number, number][][][];
  /** canopy puffs: centre, its two radii (across, up), and tone */
  lobes: { c: [number, number, number]; rx: number; ry: number; col: [string, string] }[];
  /** weeping strands: polylines of three points hanging off the canopy */
  strands: [number, number, number][][];
  /** leaf flecks and catkins, grouped by tone — 0 (deep shade) to
   *  MQ_LEVELS - 1, then the catkins — each as the puff it hangs from,
   *  its offset from that puff's centre (xyz), and its slant */
  fleckLobe: Uint16Array;
  fleckOff: Float32Array;
  fleckSlant: Float32Array;
  groupStart: Int32Array;
};
export const MQ_LEVELS = 8;
const mqTones = (pal: typeof MESQUITE_COLOURS) =>
  Array.from({ length: MQ_LEVELS }, (_, i) => {
    const t = i / (MQ_LEVELS - 1);
    return `rgb(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")})`;
  });
export const MQ_TONES = [mqTones(MESQUITE_COLOURS), mqTones(MESQUITE_GOLD)];

export function growMesquite(x: number, z: number, h: number, rw: number, rot: number, seed: string): MesquiteTree {
  const rng = rngFor("mesquite:" + seed);
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
  // The crown: a broad, low dome — widest a third of the way up, where
  // the limbs spread — with a lobe or two standing above it, and its
  // edge weeping toward the ground.
  const y0 = h * 0.5;
  const shell = (th: number, ph: number): V3 => [
    x + rw * Math.cos(ph) * Math.cos(th),
    y0 + Math.sin(ph) * (ph > 0 ? h * 0.42 : h * 0.3),
    z + rw * Math.cos(ph) * Math.sin(th),
  ];
  const outward = (c: V3): V3 => nrm([(c[0] - x) / rw, ((c[1] - y0) / h) * 1.4, (c[2] - z) / rw]);

  // A short, stout trunk with a lean, forking low into a few big limbs
  // that run out nearly level and crook upward — a mesquite's limbs zig
  // and zag — then branch and twig out to the crown.
  const trunk: V3[][] = [];
  const mains: V3[][] = [];
  const branches: V3[][] = [];
  const twigs: V3[][] = [];
  const clusters: V3[][] = [];
  const lean = rng() * 6.28;
  const F: V3 = [x + Math.cos(lean) * rw * 0.06, h * 0.22, z + Math.sin(lean) * rw * 0.06];
  trunk.push([[x, 0, z], F]);
  const NM = 5;
  for (let k = 0; k < NM; k++) {
    const a = rot + (k / NM) * Math.PI * 2 + (rng() - 0.5) * 0.7;
    // Out nearly level, then a crook up.
    const K: V3 = [F[0] + Math.cos(a) * rw * (0.2 + 0.1 * rng()), h * (0.28 + 0.06 * rng()), F[2] + Math.sin(a) * rw * (0.2 + 0.1 * rng())];
    const ak = a + (rng() - 0.5) * 0.5;
    const P1: V3 = [K[0] + Math.cos(ak) * rw * (0.14 + 0.08 * rng()), h * (0.42 + 0.08 * rng()), K[2] + Math.sin(ak) * rw * (0.14 + 0.08 * rng())];
    mains.push([F, K], [K, P1]);
    for (let j = 0; j < 3; j++) {
      const a2 = ak + (j - 1) * 0.55 + (rng() - 0.5) * 0.3;
      const out = rw * (j === 1 ? 0.14 : 0.24) * (0.8 + 0.4 * rng());
      const P2: V3 = [P1[0] + Math.cos(a2) * out, h * (j === 1 ? 0.66 : 0.52) * (0.95 + 0.1 * rng()), P1[2] + Math.sin(a2) * out];
      branches.push([P1, P2]);
      const ends: V3[] = [];
      for (let i = 0; i < 3; i++) {
        const th = a2 + (rng() - 0.5) * 0.8;
        const ph = -0.5 + (Math.PI / 2 + 0.5) * Math.pow(rng(), j === 1 ? 0.55 : 1.2) * 0.95;
        // Ending inside the foliage: bare, they poked out of the crown
        // like straws.
        const P3 = lerp(P2, shell(th, ph), 0.76 + 0.1 * rng());
        twigs.push([P2, P3]);
        ends.push(P3);
      }
      clusters.push([P2, ...ends]);
    }
  }

  // Puffs of foliage round each branch's twigs — denser than the palo
  // verde's mist, as the model is: you see into this crown, not
  // through it — three to a lobe, two lobes to a branch.
  const lobes: MesquiteTree["lobes"] = [];
  const alpha = 0.3;
  for (const [P2, ...ends] of clusters) {
    const m: V3 = [0, 0, 0];
    for (const e of ends) for (let i = 0; i < 3; i++) m[i] += e[i] / ends.length;
    for (const t of [0.5, 0.92]) {
      const c = lerp(P2, m, t);
      let spread = 0;
      for (const e of ends) spread = Math.max(spread, Math.hypot(e[0] - c[0], e[2] - c[2]));
      const rx = Math.max(rw * 0.24, spread * 0.95) * (0.85 + 0.25 * rng());
      const ry = Math.max(rx * 0.35, Math.min(rx * 0.62, c[1] - h * 0.28));
      for (let k = 0; k < 3; k++) {
        const pc: V3 = [c[0] + (rng() - 0.5) * rx * 0.8, c[1] + (rng() - 0.5) * ry * 0.6, c[2] + (rng() - 0.5) * rx * 0.8];
        const sh = (0.4 + 0.6 * lightOf(outward(pc))) * 0.85 + 0.15;
        const tone = (pal: typeof MESQUITE_COLOURS) =>
          `rgba(${pal.shade.map((v, i) => (v + (pal.lit[i] - v) * sh) | 0).join(",")},${alpha})`;
        lobes.push({ c: pc, rx: rx * (0.6 + 0.15 * rng()), ry: ry * (0.65 + 0.15 * rng()), col: [tone(MESQUITE_COLOURS), tone(MESQUITE_GOLD)] });
      }
    }
  }

  // Weeping strands off the outer puffs: the drooping branchlets hang a
  // fifth of the height below the crown's edge, curving out then down.
  const strands: V3[][] = [];
  const strandOf: number[] = [];
  lobes.forEach((L, li) => {
    const out = Math.hypot(L.c[0] - x, L.c[2] - z) / rw;
    if (out < 0.45) return;
    const n = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const a = rng() * 6.28;
      const A: V3 = [L.c[0] + Math.cos(a) * L.rx * 0.7, L.c[1] - L.ry * 0.4, L.c[2] + Math.sin(a) * L.rx * 0.7];
      const drop = h * (0.1 + 0.12 * rng()) * out;
      const ox = (A[0] - x) / (rw * out);
      const oz = (A[2] - z) / (rw * out);
      const B: V3 = [A[0] + ox * rw * 0.04, A[1] - drop * 0.5, A[2] + oz * rw * 0.04];
      const C: V3 = [B[0] + ox * rw * 0.015, Math.max(h * 0.12, A[1] - drop), B[2] + oz * rw * 0.015];
      strands.push([A, B, C]);
      strandOf.push(li);
    }
  });

  // Flecks: the leaflets, hanging — a mesquite's feathery leaves droop,
  // so the dashes mostly fall near-vertical — through the puffs and
  // down the strands; and pale catkins hanging among them. Each kept as
  // an offset in its puff, placed by the puff's projection.
  const raw: { li: number; o: V3; slant: number; group: number }[] = [];
  const fleckAt = (li: number, c: V3, v: V3, catkin: boolean) => {
    const L = lobes[li];
    const n = outward(c);
    const e = Math.hypot((c[0] - x) / rw, (c[1] - y0) / (h * 0.45), (c[2] - z) / rw);
    const sh = (0.3 + 0.7 * lightOf(nrm([n[0] + v[0], n[1] + v[1], n[2] + v[2]]))) * (0.55 + 0.45 * smooth(0.35, 1, e)) * (0.9 + 0.2 * rng());
    const level = Math.max(0, Math.min(MQ_LEVELS - 1, Math.round(sh * (MQ_LEVELS - 1))));
    raw.push({ li, o: [c[0] - L.c[0], c[1] - L.c[1], c[2] - L.c[2]], slant: Math.PI / 2 + (rng() - 0.5) * (catkin ? 0.25 : 0.9), group: catkin ? MQ_LEVELS : level });
  };
  for (let i = 0; i < 1000; i++) {
    const li = Math.floor(rng() * lobes.length);
    const L = lobes[li];
    const v = nrm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
    const r = Math.pow(rng(), 0.45);
    const c: V3 = [L.c[0] + v[0] * L.rx * r, L.c[1] + v[1] * L.ry * r, L.c[2] + v[2] * L.rx * r];
    const e = Math.hypot((c[0] - x) / rw, (c[1] - y0) / (h * 0.45), (c[2] - z) / rw);
    fleckAt(li, c, v, e > 0.7 && rng() < 0.06);
  }
  strands.forEach(([A, B, C], si) => {
    for (let k = 0; k < 3; k++) {
      const t = rng();
      const c = t < 0.5 ? lerp(A, B, t * 2) : lerp(B, C, t * 2 - 1);
      fleckAt(strandOf[si], c, nrm([c[0] - x, 0, c[2] - z]), false);
    }
  });
  raw.sort((a, b) => a.group - b.group);
  const NF = raw.length;
  const fleckLobe = new Uint16Array(NF);
  const fleckOff = new Float32Array(NF * 3);
  const fleckSlant = new Float32Array(NF);
  const groupStart = new Int32Array(MQ_LEVELS + 2).fill(NF);
  raw.forEach((f, i) => {
    fleckLobe[i] = f.li;
    fleckOff.set(f.o, i * 3);
    fleckSlant[i] = f.slant;
    if (groupStart[f.group] === NF) groupStart[f.group] = i;
  });
  for (let gi = MQ_LEVELS; gi >= 0; gi--) groupStart[gi] = Math.min(groupStart[gi], groupStart[gi + 1]);
  return { limbs: [trunk, mains, branches, twigs], lobes, strands, fleckLobe, fleckOff, fleckSlant, groupStart };
}
