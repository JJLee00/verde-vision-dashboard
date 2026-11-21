// The purple and yellow lantanas' bodies, grown as leaf clusters over a
// lumpy mound and flower heads in the scene's feet. Shared by the canvas
// viewer and its WebGL pilot, so both draw the same leaves.

import { rngFor } from "../symbols";

/** Purple lantana: a dense olive mound of small leaves, its lavender flower
 *  heads all over it, each a ring of florets with a pale eye. The scan's
 *  colours, the flowers a little clearer than its washed lavender. */
export const PURPLE_LANTANA_COLOURS = {
  leafLit: [150, 162, 100],
  leafShade: [40, 43, 36],
  inner: [32, 35, 28],
  core: "rgb(36,40,31)",
  flowerLit: [214, 194, 222],
  flower: [174, 140, 184],
  flowerShade: [112, 84, 118],
  eye: "rgb(240,232,204)",
};
export const PURPLE_LANTANA_GOLD = {
  leafLit: [226, 192, 120],
  leafShade: [150, 112, 52],
  inner: [116, 84, 38],
  core: "rgb(104,76,34)",
  flowerLit: [252, 238, 200],
  flower: [240, 214, 150],
  flowerShade: [196, 160, 92],
  eye: "rgb(255,248,226)",
};

/** Yellow lantana: the purple's dark green leaves, smothered in golden
 *  heads — a third of what the scan shows is flower. Each head a ring of
 *  golden florets round a deeper amber heart of buds. */
export const YELLOW_LANTANA_COLOURS = {
  leafLit: [144, 154, 98],
  leafShade: [40, 44, 34],
  inner: [31, 35, 27],
  core: "rgb(34,38,29)",
  flowerLit: [240, 204, 128],
  flower: [212, 160, 78],
  flowerShade: [146, 100, 44],
  bud: [208, 136, 56],
  eye: "rgb(186,116,44)",
};
export const YELLOW_LANTANA_GOLD = {
  leafLit: [226, 192, 120],
  leafShade: [150, 112, 52],
  inner: [116, 84, 38],
  core: "rgb(104,76,34)",
  flowerLit: [252, 238, 200],
  flower: [240, 214, 150],
  flowerShade: [196, 160, 92],
  bud: [226, 190, 120],
  eye: "rgb(196,150,72)",
};

export type PurpleSprig = {
  c: [number, number, number];
  /** the mound's outward normal there, to pass over the far side */
  n: [number, number, number];
  /** leaf corners as offsets from c, xyz; PURPLE_LEAF.length each */
  leaves: Float32Array;
  /** the same leaves as kites, PURPLE_KITE.length each */
  kites: Float32Array;
  inner: boolean;
  /** its step on the light ramp, 0 shade to PL_LEVELS - 1 lit */
  tone: number;
};
export type PurplePlant = {
  sprigs: PurpleSprig[];
  /** flower heads, 8 numbers each: centre, radius (ft), outward
   *  normal, step on the flower ramp */
  flowers: Float32Array;
  /** the heart of the mound, set in from the leaves, hulled for the
   *  dark core */
  core: [number, number, number][];
};
// A lantana leaf, broad and ovate.
export const PURPLE_LEAF: [number, number][] = [[0, 0], [0.2, 0.5], [0.6, 0.5], [1, 0], [0.6, -0.5], [0.2, -0.5]];
// The leaf as a kite of the same area, for leaves a few pixels long.
export const PURPLE_KITE: [number, number][] = [[0, 0], [0.4, 0.7], [1, 0], [0.4, -0.7]];
export const PL_LEVELS = 8;
export const PL_FLOWER_LEVELS = 4;
// Tones made once, so a fill's colour is only set when the step changes.
export const PL_TONES = [PURPLE_LANTANA_COLOURS, PURPLE_LANTANA_GOLD].map((pal) => {
  const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const leaf = Array.from({ length: PL_LEVELS }, (_, k) => mix(pal.leafShade, pal.leafLit, 0.2 + (0.8 * k) / (PL_LEVELS - 1)));
  const step = (k: number) => k / (PL_FLOWER_LEVELS - 1);
  return {
    leaf: leaf.map(rgb),
    inner: leaf.map((c) => rgb(mix(pal.inner, c, 0.4))),
    flower: Array.from({ length: PL_FLOWER_LEVELS }, (_, k) => rgb(mix(pal.flowerShade, pal.flower, step(k)))),
    flowerLit: Array.from({ length: PL_FLOWER_LEVELS }, (_, k) => rgb(mix(pal.flower, pal.flowerLit, 0.15 + 0.5 * step(k)))),
    floret: Array.from({ length: PL_FLOWER_LEVELS }, (_, k) => rgb(mix(mix(pal.flowerShade, pal.flower, step(k)), pal.flowerLit, 0.35))),
  };
});

export function growPurpleLantana(x: number, z: number, h: number, rw: number, rot: number, seed: string): PurplePlant {
  const rng = rngFor("purple-lantana:" + seed);
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
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

  // The outline: an oval a quarter narrower across the plant's yaw than
  // along it, as the scan is, thrown out in low arms with notches
  // between; shoots trail out past it to the plant's full spread.
  const ph2 = rng() * Math.PI * 2;
  const ph3 = rng() * Math.PI * 2;
  const ph5 = rng() * Math.PI * 2;
  const oval = (th: number) => rw * (1 - 0.24 * Math.sin(th - rot) ** 2);
  const edge = (th: number) =>
    oval(th) * (0.86 + 0.06 * Math.sin(2 * th + ph2) + 0.05 * Math.sin(3 * th + ph3) + 0.03 * Math.sin(5 * th + ph5));
  // The mound: a low flat-topped cushion, held up nearly to its edge as
  // the scan is, with lumps and pockets all over it — not a smooth bun.
  // A sprinkle of lumps, not a few big ones: big ones stack into a peak.
  const lumps = Array.from({ length: 11 }, (_, i) => {
    const th = i * 2.399963 + rng();
    const r = rw * 0.75 * Math.sqrt((i + 0.5) / 11);
    return [x + Math.cos(th) * r, z + Math.sin(th) * r, (rng() < 0.3 ? -0.5 : 1) * (0.12 + 0.14 * rng()), rw * (0.12 + 0.08 * rng())];
  });
  // Flat-topped in the middle and falling away with the distance out,
  // so the arms run lower than the body; rounded off at the outline.
  const raw = (px: number, pz: number) => {
    const r = Math.hypot(px - x, pz - z);
    const th = Math.atan2(pz - z, px - x);
    const rho = r / edge(th);
    if (rho >= 1) return 0;
    const out = Math.min(1, r / oval(th));
    let lump = 0;
    for (const [lx, lz, a, sg] of lumps) lump += a * Math.exp(-((px - lx) ** 2 + (pz - lz) ** 2) / (sg * sg));
    return (0.8 * (0.15 + 0.85 * (1 - out ** 2.5) ** 0.8) + lump * (1 - rho ** 4)) * (1 - rho ** 6) ** 0.5;
  };
  // Scaled so its highest lump, with the leaves standing on it, is the
  // plant's height.
  let top = 0;
  for (let i = 0; i < 400; i++) {
    const r = Math.sqrt((i + 0.5) / 400) * rw;
    top = Math.max(top, raw(x + Math.cos(i * 2.399963) * r, z + Math.sin(i * 2.399963) * r));
  }
  const S = (px: number, pz: number) => (raw(px, pz) * h * 0.88) / top;
  const e = rw * 0.03;
  const normalAt = (px: number, pz: number): V3 =>
    nrm([(S(px - e, pz) - S(px + e, pz)) / (2 * e), 1, (S(px, pz - e) - S(px, pz + e)) / (2 * e)]);
  // Down in the folds between lumps is darker.
  const foldAt = (px: number, pz: number) => {
    const f = rw * 0.07;
    const dip = (S(px + f, pz) + S(px - f, pz) + S(px, pz + f) + S(px, pz - f)) / 4 - S(px, pz);
    return 1 - Math.min(0.45, Math.max(0, dip / (h * 0.04)) * 0.45);
  };
  // Lit from above, darker low down, mottled a step either way.
  const toneAt = (c: V3, n: V3, dark: number) => {
    const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
    const shade = (0.25 + 0.75 * lit) * (0.5 + 0.5 * Math.min(1, c[1] / (h * 0.7))) * dark * (0.72 + 0.5 * rng());
    const step = Math.round(((shade - 0.2) / 0.8) * (PL_LEVELS - 1)) + (rng() < 0.15 ? 2 : 0);
    return Math.max(0, Math.min(PL_LEVELS - 1, step));
  };

  const sprigs: PurpleSprig[] = [];
  const L = rw * 0.06;
  // A cluster of three to five leaves round a shoot tip, lying in the
  // mound's skin and lifting a little off it.
  const cluster = (c: V3, n: V3, len: number, inner: boolean, dark: number) => {
    const t1 = nrm(crs(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const t2 = crs(n, t1);
    const pts: number[] = [];
    const kts: number[] = [];
    const spin = rng() * Math.PI * 2;
    const m = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < m; j++) {
      const a = spin + (j / m) * Math.PI * 2 + (rng() - 0.5) * 0.8;
      const l = len * (0.8 + 0.4 * rng());
      const lift = 0.15 + 0.35 * rng();
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const d = nrm([t1[0] * ca + t2[0] * sa + n[0] * lift, t1[1] * ca + t2[1] * sa + n[1] * lift, t1[2] * ca + t2[2] * sa + n[2] * lift]);
      const p = nrm(crs(n, d));
      for (const [f, q] of PURPLE_LEAF) for (let i = 0; i < 3; i++) pts.push(d[i] * l * f + p[i] * l * 0.7 * q);
      for (const [f, q] of PURPLE_KITE) for (let i = 0; i < 3; i++) kts.push(d[i] * l * f + p[i] * l * 0.7 * q);
    }
    sprigs.push({ c, n, leaves: new Float32Array(pts), kites: new Float32Array(kts), inner, tone: toneAt(c, n, dark) });
  };
  const flowers: number[] = [];
  // A flower head sitting up off the leaves.
  const bloom = (c: V3, n: V3) => {
    const r = rw * (0.022 + 0.02 * rng());
    const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
    const shade = (0.35 + 0.65 * lit) * (0.7 + 0.3 * Math.min(1, c[1] / (h * 0.6)));
    const tone = Math.max(0, Math.min(PL_FLOWER_LEVELS - 1, Math.round(shade * (PL_FLOWER_LEVELS - 1))));
    flowers.push(c[0] + n[0] * r * 0.6, c[1] + n[1] * r * 0.6, c[2] + n[2] * r * 0.6, r, n[0], n[1], n[2], tone);
  };
  // A point on the mound's top, or on its side down to the ground.
  const onTop = (th: number, rho: number): [V3, V3, number] => {
    const r = rho * edge(th);
    const px = x + Math.cos(th) * r;
    const pz = z + Math.sin(th) * r;
    return [[px, S(px, pz), pz], normalAt(px, pz), foldAt(px, pz)];
  };
  const onSide = (th: number): [V3, V3] => {
    const r = (0.86 + (rng() < 0.2 ? 0.25 : 0.12) * rng()) * edge(th);
    const px = x + Math.cos(th) * r;
    const pz = z + Math.sin(th) * r;
    return [[px, S(px, pz) * (0.05 + 0.9 * rng()), pz], nrm([Math.cos(th), 0.55, Math.sin(th)])];
  };

  // The shaded layer under the leaves, so a gap shows leaves in shadow
  // before it shows the core.
  for (let i = 0; i < 150; i++) {
    const [c, n] = onTop(i * 2.399963, 0.95 * Math.sqrt((i + 0.5) / 150));
    cluster([c[0], c[1] - h * 0.09, c[2]], n, L * 1.1, true, 0.8);
  }
  // The skin, evenly over the top on a spiral, then round the sides.
  const NT = 640;
  for (let i = 0; i < NT; i++) {
    const [c, n, fold] = onTop(i * 2.399963 + (rng() - 0.5) * 0.2, Math.min(0.97, Math.sqrt((i + 0.5) / NT) + (rng() - 0.5) * 0.03));
    const proud = rng() < 0.12 ? h * (0.04 + 0.06 * rng()) : h * 0.04 * (rng() - 0.5);
    cluster([c[0] + n[0] * proud, c[1] + n[1] * proud, c[2] + n[2] * proud], n, L, false, fold);
  }
  for (let i = 0; i < 180; i++) {
    const [c, n] = onSide(i * 2.399963 + rng() * 0.3);
    cluster(c, n, L, false, 1);
  }
  // Shoots trailing out past the mound, low, to break its edge.
  for (let i = 0; i < 22; i++) {
    const th = i * 2.399963 + rng() * 0.5;
    const ed = edge(th);
    const out = Math.min(rw * (1 - 0.24 * Math.sin(th - rot) ** 2), ed * (1.08 + 0.16 * rng())) / ed;
    const side = (rng() - 0.5) * 0.5;
    const y0 = S(x + Math.cos(th) * ed * 0.75, z + Math.sin(th) * ed * 0.75) * (0.6 + 0.4 * rng());
    const n = nrm([Math.cos(th), 1, Math.sin(th)]);
    let c: V3 = [x, 0, z];
    for (let k = 1; k <= 5; k++) {
      const f = (0.78 + ((out - 0.78) * k) / 5) * ed;
      const a = th + side * (k / 5);
      c = [x + Math.cos(a) * f, Math.max(h * 0.03, y0 * (1 - k / 5.5)), z + Math.sin(a) * f];
      cluster(c, n, L * 0.9, false, 1);
    }
    if (rng() < 0.4) bloom(c, n);
  }
  // Flowers all over it, the sides as well as the top.
  for (let i = 0; i < 130; i++) {
    const th = rng() * Math.PI * 2;
    if (rng() < 0.3) {
      const [c, n] = onSide(th);
      bloom(c, n);
    } else {
      const [c, n] = onTop(th, 0.95 * Math.sqrt(rng()));
      bloom(c, n);
    }
  }
  // The heart, set in from the skin.
  const core: V3[] = [];
  for (let i = 0; i < 16; i++) {
    const th = (i / 16) * Math.PI * 2;
    for (const rho of [0.25, 0.5, 0.72]) {
      const [c] = onTop(th, rho);
      core.push([c[0], c[1] * 0.85 - h * 0.04, c[2]]);
    }
    const r = 0.72 * edge(th);
    core.push([x + Math.cos(th) * r, 0, z + Math.sin(th) * r]);
  }
  // The shaded layer first, a step of tone at a time; the rest as grown.
  sprigs.sort((a, b) => (a.inner === b.inner ? (a.inner ? a.tone - b.tone : 0) : a.inner ? -1 : 1));
  return { sprigs, flowers: new Float32Array(flowers), core };
}

export type YellowSprig = {
  c: [number, number, number];
  /** the cushion's outward normal there, to pass over the far side */
  n: [number, number, number];
  /** leaf corners as offsets from c, xyz; YELLOW_LEAF.length each */
  leaves: Float32Array;
  /** the same leaves as kites, YELLOW_KITE.length each */
  kites: Float32Array;
  inner: boolean;
  /** its step on the light ramp, 0 shade to YL_LEVELS - 1 lit */
  tone: number;
};
export type YellowPlant = {
  sprigs: YellowSprig[];
  /** flower heads, 8 numbers each: centre, radius (ft), outward
   *  normal, step on the flower ramp */
  flowers: Float32Array;
  /** the heart of the cushion, set in from the leaves, hulled for the
   *  dark core */
  core: [number, number, number][];
};
// A lantana leaf, ovate to a point.
export const YELLOW_LEAF: [number, number][] = [[0, 0], [0.18, 0.42], [0.55, 0.46], [1, 0], [0.55, -0.46], [0.18, -0.42]];
// The leaf as a kite of the same area, for leaves a few pixels long.
export const YELLOW_KITE: [number, number][] = [[0, 0], [0.4, 0.61], [1, 0], [0.4, -0.61]];
export const YL_LEVELS = 8;
export const YL_FLOWER_LEVELS = 4;
// Tones made once, so a fill's colour is only set when the step changes.
export const YL_TONES = [YELLOW_LANTANA_COLOURS, YELLOW_LANTANA_GOLD].map((pal) => {
  const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const leaf = Array.from({ length: YL_LEVELS }, (_, k) => mix(pal.leafShade, pal.leafLit, 0.2 + (0.8 * k) / (YL_LEVELS - 1)));
  const step = (k: number) => k / (YL_FLOWER_LEVELS - 1);
  const ramp = (f: (t: number) => number[]) => Array.from({ length: YL_FLOWER_LEVELS }, (_, k) => rgb(f(step(k))));
  return {
    leaf: leaf.map(rgb),
    inner: leaf.map((c) => rgb(mix(pal.inner, c, 0.4))),
    flower: ramp((t) => mix(pal.flowerShade, pal.flower, t)),
    flowerLit: ramp((t) => mix(pal.flower, pal.flowerLit, 0.15 + 0.5 * t)),
    floret: ramp((t) => mix(mix(pal.flowerShade, pal.flower, t), pal.flowerLit, 0.45)),
    bud: ramp((t) => mix(pal.flowerShade, pal.bud, 0.5 + 0.5 * t)),
  };
});

export function growYellowLantana(x: number, z: number, h: number, rw: number, rot: number, seed: string): YellowPlant {
  const rng = rngFor("yellow-lantana:" + seed);
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
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

  // The outline: an oval a fifth narrower across the plant's yaw than
  // along it, as the scan is, and only gently lobed — this one is a full
  // round cushion, where the purple throws out arms.
  const ph2 = rng() * Math.PI * 2;
  const ph3 = rng() * Math.PI * 2;
  const ph5 = rng() * Math.PI * 2;
  const oval = (th: number) => rw * (1 - 0.2 * Math.sin(th - rot) ** 2);
  const edge = (th: number) =>
    oval(th) * (0.88 + 0.04 * Math.sin(2 * th + ph2) + 0.03 * Math.sin(3 * th + ph3) + 0.02 * Math.sin(5 * th + ph5));
  // The cushion: flat-topped, held high nearly to its edge and then
  // steep to the ground, a little hollow in the middle where the crown
  // opens, and lumpy all over.
  const lumps = Array.from({ length: 12 }, (_, i) => {
    const th = i * 2.399963 + rng();
    const r = rw * 0.75 * Math.sqrt((i + 0.5) / 12);
    return [x + Math.cos(th) * r, z + Math.sin(th) * r, (rng() < 0.3 ? -0.7 : 1) * (0.08 + 0.1 * rng()), rw * (0.1 + 0.08 * rng())];
  });
  const raw = (px: number, pz: number) => {
    const rho = Math.hypot(px - x, pz - z) / edge(Math.atan2(pz - z, px - x));
    if (rho >= 1) return 0;
    let lump = 0;
    for (const [lx, lz, a, sg] of lumps) lump += a * Math.exp(-((px - lx) ** 2 + (pz - lz) ** 2) / (sg * sg));
    return (1 - rho ** 5) ** 0.4 - 0.12 * Math.exp(-((rho / 0.3) ** 2)) + lump * (1 - rho ** 4);
  };
  // Scaled so the cushion stands a little under the plant's height: the
  // shoots standing out of it make up the rest.
  let top = 0;
  for (let i = 0; i < 400; i++) {
    const r = Math.sqrt((i + 0.5) / 400) * rw;
    top = Math.max(top, raw(x + Math.cos(i * 2.399963) * r, z + Math.sin(i * 2.399963) * r));
  }
  const S = (px: number, pz: number) => (raw(px, pz) * h * 0.82) / top;
  const e = rw * 0.03;
  const normalAt = (px: number, pz: number): V3 =>
    nrm([(S(px - e, pz) - S(px + e, pz)) / (2 * e), 1, (S(px, pz - e) - S(px, pz + e)) / (2 * e)]);
  // Down in the folds between lumps is darker.
  const foldAt = (px: number, pz: number) => {
    const f = rw * 0.07;
    const dip = (S(px + f, pz) + S(px - f, pz) + S(px, pz + f) + S(px, pz - f)) / 4 - S(px, pz);
    return 1 - Math.min(0.45, Math.max(0, dip / (h * 0.04)) * 0.45);
  };
  // Lit from above, darker low down, mottled a step either way.
  const toneAt = (c: V3, n: V3, dark: number) => {
    const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
    const shade = (0.25 + 0.75 * lit) * (0.5 + 0.5 * Math.min(1, c[1] / (h * 0.7))) * dark * (0.72 + 0.5 * rng());
    const step = Math.round(((shade - 0.2) / 0.8) * (YL_LEVELS - 1)) + (rng() < 0.15 ? 2 : 0);
    return Math.max(0, Math.min(YL_LEVELS - 1, step));
  };

  const sprigs: YellowSprig[] = [];
  const L = rw * 0.062;
  // A cluster of three to five leaves round a shoot tip, lying in the
  // cushion's skin and lifting a little off it.
  const cluster = (c: V3, n: V3, len: number, inner: boolean, dark: number) => {
    const t1 = nrm(crs(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const t2 = crs(n, t1);
    const pts: number[] = [];
    const kts: number[] = [];
    const spin = rng() * Math.PI * 2;
    const m = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < m; j++) {
      const a = spin + (j / m) * Math.PI * 2 + (rng() - 0.5) * 0.8;
      const l = len * (0.8 + 0.4 * rng());
      const lift = 0.15 + 0.35 * rng();
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const d = nrm([t1[0] * ca + t2[0] * sa + n[0] * lift, t1[1] * ca + t2[1] * sa + n[1] * lift, t1[2] * ca + t2[2] * sa + n[2] * lift]);
      const p = nrm(crs(n, d));
      for (const [f, q] of YELLOW_LEAF) for (let i = 0; i < 3; i++) pts.push(d[i] * l * f + p[i] * l * 0.7 * q);
      for (const [f, q] of YELLOW_KITE) for (let i = 0; i < 3; i++) kts.push(d[i] * l * f + p[i] * l * 0.7 * q);
    }
    sprigs.push({ c, n, leaves: new Float32Array(pts), kites: new Float32Array(kts), inner, tone: toneAt(c, n, dark) });
  };
  const flowers: number[] = [];
  // A flower head sitting up off the leaves; many open in pairs, two
  // heads touching, as the scan's do.
  const bloom = (c: V3, n: V3) => {
    const r = rw * (0.035 + 0.025 * rng());
    const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
    const shade = (0.35 + 0.65 * lit) * (0.7 + 0.3 * Math.min(1, c[1] / (h * 0.6)));
    const tone = Math.max(0, Math.min(YL_FLOWER_LEVELS - 1, Math.round(shade * (YL_FLOWER_LEVELS - 1))));
    flowers.push(c[0] + n[0] * r * 0.6, c[1] + n[1] * r * 0.6, c[2] + n[2] * r * 0.6, r, n[0], n[1], n[2], tone);
    if (rng() < 0.4) {
      const t1 = nrm(crs(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const t2 = crs(n, t1);
      const a = rng() * Math.PI * 2;
      const r2 = r * (0.7 + 0.25 * rng());
      const d = r + r2 * 0.6;
      const ox = (t1[0] * Math.cos(a) + t2[0] * Math.sin(a)) * d;
      const oy = (t1[1] * Math.cos(a) + t2[1] * Math.sin(a)) * d;
      const oz = (t1[2] * Math.cos(a) + t2[2] * Math.sin(a)) * d;
      flowers.push(c[0] + ox + n[0] * r2 * 0.6, c[1] + oy + n[1] * r2 * 0.6, c[2] + oz + n[2] * r2 * 0.6, r2, n[0], n[1], n[2], tone);
    }
  };
  // A point on the cushion's top, or on its steep side down to the
  // ground.
  const onTop = (th: number, rho: number): [V3, V3, number] => {
    const r = rho * edge(th);
    const px = x + Math.cos(th) * r;
    const pz = z + Math.sin(th) * r;
    return [[px, S(px, pz), pz], normalAt(px, pz), foldAt(px, pz)];
  };
  const onSide = (th: number): [V3, V3] => {
    const ed = edge(th);
    const r = (0.9 + (rng() < 0.2 ? 0.16 : 0.08) * rng()) * ed;
    const shoulder = S(x + Math.cos(th) * ed * 0.9, z + Math.sin(th) * ed * 0.9);
    return [[x + Math.cos(th) * r, shoulder * (0.02 + 0.93 * rng()), z + Math.sin(th) * r], nrm([Math.cos(th), 0.35, Math.sin(th)])];
  };

  // The shaded layer under the leaves, so a gap shows leaves in shadow
  // before it shows the core.
  for (let i = 0; i < 140; i++) {
    const [c, n] = onTop(i * 2.399963, 0.95 * Math.sqrt((i + 0.5) / 140));
    cluster([c[0], c[1] - h * 0.09, c[2]], n, L * 1.1, true, 0.8);
  }
  // The skin, evenly over the top on a spiral, then round the sides.
  const NT = 480;
  for (let i = 0; i < NT; i++) {
    const [c, n, fold] = onTop(i * 2.399963 + (rng() - 0.5) * 0.2, Math.min(0.97, Math.sqrt((i + 0.5) / NT) + (rng() - 0.5) * 0.03));
    const proud = rng() < 0.12 ? h * (0.04 + 0.06 * rng()) : h * 0.04 * (rng() - 0.5);
    cluster([c[0] + n[0] * proud, c[1] + n[1] * proud, c[2] + n[2] * proud], n, L, false, fold);
  }
  for (let i = 0; i < 320; i++) {
    const [c, n] = onSide(i * 2.399963 + rng() * 0.3);
    cluster(c, n, L, false, 1);
  }
  // Shoots standing up out of the top, leafy, mostly with a head at the
  // tip, as the scan's do: they break the cushion's skyline.
  for (let i = 0; i < 18; i++) {
    const th = i * 2.399963 + rng();
    const [c0] = onTop(th, 0.1 + 0.8 * Math.sqrt(rng()));
    const rise = Math.min(h * (0.1 + 0.12 * rng()), h * 0.98 - c0[1]);
    const lean = 0.2 + 0.3 * rng();
    const up = nrm([Math.cos(th) * lean, 1, Math.sin(th) * lean]);
    let c: V3 = c0;
    for (let k = 1; k <= 4; k++) {
      const f = ((k / 4) * rise) / up[1];
      c = [c0[0] + up[0] * f, c0[1] + up[1] * f, c0[2] + up[2] * f];
      cluster(c, up, L * (1 - 0.08 * k), false, 1);
    }
    if (rng() < 0.75) bloom(c, up);
  }
  // Shoots reaching out of the sides past the edge, most of them about
  // halfway up, some trailing low, a head at the end of half of them.
  for (let i = 0; i < 18; i++) {
    const th = i * 2.399963 + rng() * 0.5;
    const ed = edge(th);
    const out = Math.min(oval(th), ed * (1.05 + 0.12 * rng())) / ed;
    const side = (rng() - 0.5) * 0.5;
    const low = rng() < 0.3;
    const y0 = S(x + Math.cos(th) * ed * 0.8, z + Math.sin(th) * ed * 0.8) * (low ? 0.3 : 0.55 + 0.3 * rng());
    const droop = low ? 0.22 : 0.06 + 0.06 * rng();
    const n = nrm([Math.cos(th), 1, Math.sin(th)]);
    let c: V3 = [x, 0, z];
    for (let k = 1; k <= 4; k++) {
      const f = (0.85 + ((out - 0.85) * k) / 4) * ed;
      const a = th + side * (k / 4);
      c = [x + Math.cos(a) * f, Math.max(h * 0.03, y0 * (1 - droop * k)), z + Math.sin(a) * f];
      cluster(c, n, L * 0.9, false, 1);
    }
    if (rng() < 0.5) bloom(c, n);
  }
  // Heads smothering it, the sides as well as the top.
  for (let i = 0; i < 200; i++) {
    const th = rng() * Math.PI * 2;
    if (rng() < 0.35) {
      const [c, n] = onSide(th);
      bloom(c, n);
    } else {
      const [c, n] = onTop(th, 0.96 * Math.sqrt(rng()));
      bloom(c, n);
    }
  }
  // The heart, set in from the skin.
  const core: V3[] = [];
  for (let i = 0; i < 16; i++) {
    const th = (i / 16) * Math.PI * 2;
    for (const rho of [0.25, 0.5, 0.75]) {
      const [c] = onTop(th, rho);
      core.push([c[0], c[1] * 0.85 - h * 0.04, c[2]]);
    }
    const r = 0.72 * edge(th);
    core.push([x + Math.cos(th) * r, 0, z + Math.sin(th) * r]);
  }
  // The shaded layer first, a step of tone at a time; the rest as grown.
  sprigs.sort((a, b) => (a.inner === b.inner ? (a.inner ? a.tone - b.tone : 0) : a.inner ? -1 : 1));
  return { sprigs, flowers: new Float32Array(flowers), core };
}
