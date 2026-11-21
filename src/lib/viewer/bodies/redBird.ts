// Red bird of paradise's body, grown as stems, fronds and blooms on
// stalks in the scene's feet. Shared by the canvas viewer and its WebGL
// pilot, so both draw the same leaves.

import { rngFor } from "../symbols";

/** Red bird of paradise: dark fern-green fronds, scarlet ruffled blooms
 *  edged in gold, and the pale bark of its open stems. */
export const RED_BIRD_COLOURS = {
  deep: [40, 70, 44], // fronds inside the canopy
  leafLit: [98, 140, 84],
  leafShade: [50, 88, 56],
  bloomLit: [228, 82, 52],
  bloomShade: [176, 50, 36],
  edge: "rgba(236,170,56,0.95)", // the gold rim of the petals
  stamen: "rgba(196,40,32,0.85)",
  stem: "rgba(150,132,112,0.9)",
};
export const RED_BIRD_GOLD = {
  deep: [118, 86, 40],
  leafLit: [226, 192, 120],
  leafShade: [152, 114, 54],
  bloomLit: [244, 222, 160],
  bloomShade: [196, 158, 86],
  edge: "rgba(168,123,47,0.9)",
  stamen: "rgba(168,123,47,0.8)",
  stem: "rgba(168,123,47,0.8)",
};

// Grown once per plant and kept, as the other shrubs are.
export type RedBirdPart = {
  c: [number, number, number];
  /** shapes as offsets from c, xyz; `corners` points each */
  pts: Float32Array;
  corners: number;
  /** for blooms: stamen strokes, pairs of offsets from c */
  lines?: Float32Array;
  kind: "inner" | "frond" | "bloom" | "stalk";
  col: [string, string]; // [plain, gold]
};

// A frond seen flat: a narrow feathery spray, its outline finely
// scalloped by the small round leaflets along it. Broad and coarsely
// toothed, the first ones read as a different plant's leaves; the fern
// texture is in the fineness. Corners along (1, 0), width on the
// second axis.
export const FROND: [number, number][] = (() => {
  const out: [number, number][] = [];
  const S = 15;
  const w = (i: number) => Math.pow(Math.sin(Math.PI * Math.min(1, (i / S) * 1.04)), 0.5) * (i % 2 ? 1 : 0.5);
  for (let i = 0; i <= S; i++) out.push([i / S, w(i)]);
  for (let i = S - 1; i >= 1; i--) out.push([i / S, -w(i)]);
  return out;
})();
// A ruffled bloom, face on: five broad rounded petals, not a star.
export const BLOOM: [number, number][] = Array.from({ length: 15 }, (_, i): [number, number] => {
  const a = (i / 15) * Math.PI * 2;
  const r = i % 3 === 0 ? 0.78 : 1;
  return [0.5 + 0.5 * r * Math.cos(a), 0.5 * r * Math.sin(a) * 2];
});

export function growRedBird(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
  const rng = rngFor("redbird:" + seed);
  const LX = -0.44;
  const LZ = -0.43;
  const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const smooth = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  type V3 = [number, number, number];
  // An open vase: narrow where the stems leave the ground, opening out
  // to full spread by a little over half its height and staying there —
  // the top is flat, tiers of fronds rather than a dome.
  const prof = (u: number) => (0.12 + 0.88 * smooth(0.04, 0.6, u)) * (u > 0.92 ? 1 - 0.35 * (u - 0.92) / 0.08 : 1);

  const stems: V3[][] = [];
  for (let k = 0; k < 9; k++) {
    const a = rot + k * 2.399963 + rng() * 0.5;
    const reach = rw * (0.3 + 0.3 * rng());
    stems.push([
      [x + Math.cos(a) * rw * 0.04, 0, z + Math.sin(a) * rw * 0.04],
      [x + Math.cos(a) * reach, h * (0.5 + 0.2 * rng()), z + Math.sin(a) * reach],
    ]);
  }

  const parts: RedBirdPart[] = [];
  const NI = 140;
  const NF = 320;
  const NB = 30;
  for (let tries = 0; parts.length < NI + NF + NB && tries < (NI + NF + NB) * 4; tries++) {
    const i = parts.length;
    const kind = i < NI ? "inner" : i < NI + NF ? "frond" : "bloom";
    if (kind !== "bloom") {
      // Fronds sit in tiers from a third of the way up to the top,
      // weighted to the broad upper canopy.
      const u = 0.3 + 0.68 * Math.sqrt(rng());
      const th = rng() * Math.PI * 2;
      const reach = kind === "inner" ? 0.25 + 0.4 * rng() : 0.55 + 0.45 * rng();
      const r = rw * prof(u) * reach;
      const c: V3 = [x + Math.cos(th) * r, u * h, z + Math.sin(th) * r];
      // Held out nearly level, along the way it grows, the tip dipping.
      const a = th + (rng() - 0.5) * 0.9;
      const dir: V3 = [Math.cos(a), -0.12 - 0.12 * rng(), Math.sin(a)];
      const dl = Math.hypot(...dir);
      const d: V3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
      const perp: V3 = [-Math.sin(a), 0, Math.cos(a)];
      const L = rw * 0.24 * (0.8 + 0.4 * rng()) * (kind === "inner" ? 0.85 : 1);
      const W = L * 0.12;
      const pts: number[] = [];
      for (const [f, q] of FROND) {
        for (let k = 0; k < 3; k++) pts.push(d[k] * L * (f - 0.35) + perp[k] * W * q);
      }
      // Lit from the light's side, darker low and toward the middle.
      const side = Math.max(0, Math.cos(th) * -LX + Math.sin(th) * -LZ);
      const shade = (0.45 + 0.35 * (1 - side) + 0.2 * rng()) * (0.55 + 0.45 * smooth(0.3, 0.95, u)) * (0.75 + 0.25 * reach);
      const tone = (pal: typeof RED_BIRD_COLOURS) =>
        rgb(kind === "inner" ? mix(pal.deep, pal.leafShade, 0.5 * shade) : mix(pal.leafShade, pal.leafLit, Math.min(1, shade)));
      parts.push({ c, pts: new Float32Array(pts), corners: FROND.length, kind, col: [tone(RED_BIRD_COLOURS), tone(RED_BIRD_GOLD)] });
      continue;
    }
    // A flower stalk rising out of the canopy, carrying its blooms up
    // it, each with a few long stamens arching out of it.
    const th = rng() * Math.PI * 2;
    const r = rw * (0.25 + 0.7 * Math.sqrt(rng()));
    // Mostly rising out of the top; some from the canopy's edge.
    const base: V3 = [x + Math.cos(th) * r, h * (r > rw * 0.75 ? 0.55 + 0.2 * rng() : 0.72 + 0.2 * rng()), z + Math.sin(th) * r];
    const up = h * (0.12 + 0.12 * rng());
    const lean = 0.25 * (rng() - 0.5);
    const tip: V3 = [base[0] + Math.cos(th) * up * 0.25 + lean, base[1] + up, base[2] + Math.sin(th) * up * 0.25];
    parts.push({
      c: base,
      pts: new Float32Array([0, 0, 0, tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]]),
      corners: 2,
      kind: "stalk",
      col: [RED_BIRD_COLOURS.stem, RED_BIRD_GOLD.stem],
    });
    const nb = 3 + Math.floor(rng() * 3);
    for (let b = 0; b < nb; b++) {
      const t = 0.35 + (0.6 * b) / Math.max(1, nb - 1);
      const c: V3 = [base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t, base[2] + (tip[2] - base[2]) * t];
      const fa = th + (rng() - 0.5) * 2.4; // which way the bloom faces
      const face: V3 = [Math.cos(fa), 0.3, Math.sin(fa)];
      const across: V3 = [-Math.sin(fa), 0, Math.cos(fa)];
      const s = rw * 0.055 * (0.8 + 0.4 * rng());
      const pts: number[] = [];
      for (const [f, q] of BLOOM) {
        for (let k = 0; k < 3; k++) pts.push(across[k] * s * (f - 0.5) * 2 + [0, 1, 0][k] * s * q * 0.9 + face[k] * s * 0.1);
      }
      const lines: number[] = [];
      for (let k = 0; k < 3; k++) {
        const sa = fa + (k - 1) * 0.35;
        const len = s * (2.2 + 0.8 * rng());
        lines.push(0, 0, 0, Math.cos(sa) * len, len * (0.35 + 0.3 * rng()), Math.sin(sa) * len);
      }
      const tone = (pal: typeof RED_BIRD_COLOURS) => rgb(mix(pal.bloomShade, pal.bloomLit, 0.5 + 0.5 * rng()));
      parts.push({ c, pts: new Float32Array(pts), corners: BLOOM.length, lines: new Float32Array(lines), kind: "bloom", col: [tone(RED_BIRD_COLOURS), tone(RED_BIRD_GOLD)] });
    }
  }
  return { stems, parts };
}
