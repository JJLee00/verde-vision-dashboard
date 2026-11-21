// Texas ebony's body, grown as limbs, a set-back crown, puffs over its
// skin and flecks of leaflet in the scene's feet. Shared by the canvas
// viewer and its WebGL layer, so both draw the same tree.

import { rngFor } from "../symbols";

/** Texas ebony: the darkest green in the catalog, a near-black canopy lit
 *  by small bright leaflets, its brown pods, and a pale trunk. */
export const EBONY_COLOURS = {
  core: [30, 44, 34], // the shadow inside the crown
  shade: [36, 54, 40],
  lit: [80, 108, 70],
  fleckShade: [52, 78, 48],
  fleckLit: [128, 158, 94],
  pod: "rgb(164,114,80)",
  trunk: "rgb(152,142,132)",
  limb: "rgba(128,118,108,0.95)",
};
// Every container size is its own model; the viewer draws them all at the
// mature size, so all three take the mature tree's body.
export const EBONY_MODELS = new Set(["TexasEbonySm", "TexasEbonyMd", "TexasEbonyLg"]);
export const EBONY_GOLD = {
  core: [118, 86, 40],
  shade: [140, 104, 50],
  lit: [210, 170, 100],
  fleckShade: [170, 130, 64],
  fleckLit: [240, 214, 150],
  pod: "rgb(120,80,30)",
  trunk: "rgb(196,150,70)",
  limb: "rgba(186,138,60,0.95)",
};

export type EbonyTree = {
  /** trunk and the limbs it forks into, as segments */
  limbs: [number, number, number][][][];
  /** the crown's set-back shell, filled as one silhouette */
  coreRing: [number, number, number][];
  /** puffs over the crown's skin: centre, radii (across, up), outward
   *  normal, tone, and how far out its outline reaches at each of
   *  EB_PUFF points round it */
  puffs: { c: [number, number, number]; rx: number; ry: number; n: [number, number, number]; level: number; jit: Float32Array }[];
  /** leaflet flecks, grouped by tone — 0 to EB_LEVELS - 1, then the pods —
   *  each as its puff, its offset from that puff's centre, and its slant */
  fleckPuff: Uint16Array;
  fleckOff: Float32Array;
  fleckSlant: Float32Array;
  groupStart: Int32Array;
};
export const EB_LEVELS = 6;
export const EB_PUFF = 9;
const ebTones = (pal: typeof EBONY_COLOURS) =>
  Array.from({ length: EB_LEVELS }, (_, i) => {
    const t = i / (EB_LEVELS - 1);
    return `rgb(${pal.fleckShade.map((v, k) => (v + (pal.fleckLit[k] - v) * t) | 0).join(",")})`;
  });
export const EB_TONES = [ebTones(EBONY_COLOURS), ebTones(EBONY_GOLD)];
// Puffs take one of a few tones too, so a band of them at one depth
// fills a tone at a time — a crown is three hundred of them.
const ebPuffTones = (pal: typeof EBONY_COLOURS) =>
  Array.from({ length: EB_LEVELS }, (_, i) => {
    const t = i / (EB_LEVELS - 1);
    return `rgba(${pal.shade.map((v, k) => (v + (pal.lit[k] - v) * t) | 0).join(",")},0.92)`;
  });
export const EB_PUFF_TONES = [ebPuffTones(EBONY_COLOURS), ebPuffTones(EBONY_GOLD)];
// The crown's radius (a fraction of rw) by height (a fraction of h): an
// upright egg from a seventh of the way up, widest at three fifths, as
// the model's is.
const ebonyProf = (u: number) => {
  if (u < 0.13 || u > 1) return 0;
  if (u < 0.6) {
    const t = (u - 0.13) / 0.47;
    return 0.62 + 0.38 * Math.sin((t * Math.PI) / 2);
  }
  return Math.sqrt(Math.max(0, 1 - ((u - 0.6) / 0.4) ** 2));
};

export function growEbony(x: number, z: number, h: number, rw: number, rot: number, seed: string): EbonyTree {
  const rng = rngFor("ebony:" + seed);
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
  const lightOf = (n: V3) => Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
  // Slightly longer one way than the other, as the model's crown is.
  const squash = (th: number) => 1 - 0.12 * Math.sin(th - rot) ** 2;
  const skinNormal = (th: number, u: number): V3 => {
    const d = (ebonyProf(Math.min(1, u + 0.02)) - ebonyProf(Math.max(0.13, u - 0.02))) / 0.04;
    return nrm([Math.cos(th) * h, -d * rw, Math.sin(th) * h].map((v, i) => (i === 1 ? v : v / h)) as V3);
  };

  // A short, stout, pale trunk forking a seventh of the way up into three
  // thick limbs that rise into the crown.
  const F: V3 = [x, h * 0.13, z];
  const trunk: V3[][] = [[[x, 0, z], F]];
  const mains: V3[][] = [];
  for (let k = 0; k < 3; k++) {
    const a = rot + (k / 3) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    const r = rw * (0.18 + 0.1 * rng());
    mains.push([F, [x + Math.cos(a) * r, h * (0.32 + 0.08 * rng()), z + Math.sin(a) * r]]);
  }

  // Tapered at the foot, so its bottom edge stays inside the puffs.
  const coreRing: V3[] = [];
  for (let i = 0; i <= 8; i++) {
    const u = 0.2 + (0.76 * i) / 8;
    for (let j = 0; j < 12; j++) {
      const th = (j / 12) * Math.PI * 2;
      const r = rw * 0.8 * ebonyProf(u) * squash(th) * (0.7 + 0.3 * smooth(0.2, 0.32, u));
      coreRing.push([x + Math.cos(th) * r, u * h, z + Math.sin(th) * r]);
    }
  }

  // Puffs over the crown's skin, by area: they make its lumpy outline and
  // its light and shade; the core behind them means no sand shows
  // through a crown this dense.
  // Many small ones, of varied size and ragged outline: big, they read
  // as broccoli; round and alike, as cauliflower.
  const puffs: EbonyTree["puffs"] = [];
  const push = (c: V3, n: V3, u: number) => {
    const rx = rw * (0.1 + 0.08 * rng());
    const jit = new Float32Array(EB_PUFF);
    for (let k = 0; k < EB_PUFF; k++) jit[k] = 0.78 + 0.32 * rng();
    const sh = (0.3 + 0.7 * lightOf(n)) * (0.6 + 0.4 * smooth(0.15, 0.7, u)) * (0.9 + 0.2 * rng());
    const level = Math.max(0, Math.min(EB_LEVELS - 1, Math.round(sh * (EB_LEVELS - 1))));
    puffs.push({ c, rx, ry: rx * 0.8, n, level, jit });
  };
  for (let tries = 0; puffs.length < 300 && tries < 2000; tries++) {
    const u = 0.15 + 0.85 * rng();
    if (rng() > ebonyProf(u) && u < 0.6) continue;
    const th = rng() * Math.PI * 2;
    const r = rw * ebonyProf(u) * squash(th) * (0.86 + 0.1 * rng());
    push([x + Math.cos(th) * r, Math.min(u * h, h * 0.95), z + Math.sin(th) * r], skinNormal(th, u), u);
  }

  // Leaflet flecks on the puffs' outer faces — the model's bright green
  // speckle, brightest where the light falls — and a few brown pods.
  const raw: { pi: number; o: V3; slant: number; group: number }[] = [];
  for (let i = 0; i < 1200; i++) {
    const pi = Math.floor(rng() * puffs.length);
    const P0 = puffs[pi];
    const v = nrm([P0.n[0] + (rng() - 0.5) * 1.6, P0.n[1] + (rng() - 0.5) * 1.6, P0.n[2] + (rng() - 0.5) * 1.6]);
    const r = 0.55 + 0.45 * rng();
    const o: V3 = [v[0] * P0.rx * r, v[1] * P0.ry * r, v[2] * P0.rx * r];
    const lit = lightOf(nrm([P0.n[0] + v[0], P0.n[1] + v[1], P0.n[2] + v[2]]));
    const sh = (0.25 + 0.75 * lit) * (0.85 + 0.3 * rng());
    const level = Math.max(0, Math.min(EB_LEVELS - 1, Math.round(sh * (EB_LEVELS - 1))));
    raw.push({ pi, o, slant: rng() * Math.PI, group: rng() < 0.04 ? EB_LEVELS : level });
  }
  raw.sort((a, b) => a.group - b.group);
  const NF = raw.length;
  const fleckPuff = new Uint16Array(NF);
  const fleckOff = new Float32Array(NF * 3);
  const fleckSlant = new Float32Array(NF);
  const groupStart = new Int32Array(EB_LEVELS + 2).fill(NF);
  raw.forEach((f, i) => {
    fleckPuff[i] = f.pi;
    fleckOff.set(f.o, i * 3);
    fleckSlant[i] = f.group === EB_LEVELS ? Math.PI / 2 + (f.slant - Math.PI / 2) * 0.3 : f.slant;
    if (groupStart[f.group] === NF) groupStart[f.group] = i;
  });
  for (let gi = EB_LEVELS; gi >= 0; gi--) groupStart[gi] = Math.min(groupStart[gi], groupStart[gi + 1]);
  return { limbs: [trunk, mains], coreRing, puffs, fleckPuff, fleckOff, fleckSlant, groupStart };
}
