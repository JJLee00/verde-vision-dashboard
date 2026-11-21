// Jojoba's body, grown as stems and twigs of paired leaves in the scene's
// feet. Shared by the canvas viewer and its WebGL pilot, so both draw the
// same leaves.

import { rngFor } from "../symbols";

/** Jojoba: the dull grey-green of a shrub that turns its leaves edge-on to
 *  the sun, mottled, over the grey of its twigs. No flowers worth drawing. */
export const JOJOBA_COLOURS = {
  core: [76, 88, 77], // the shadow inside the mound — darker than any leaf, or the shaded side melts into it
  leafLit: [190, 198, 178],
  leafShade: [112, 124, 108],
  twig: "rgba(104,94,80,0.8)",
  stem: "rgba(84,80,70,0.5)",
};
export const JOJOBA_GOLD = {
  core: [118, 86, 40],
  leafLit: [226, 192, 120],
  leafShade: [152, 114, 54],
  twig: "rgba(168,123,47,0.8)",
  stem: "rgba(168,123,47,0.5)",
};

// Grown once per plant and kept, as the shrubs before it are.
export type JojobaSprig = {
  c: [number, number, number];
  /** outward normal, to skip outlines on the far side */
  n: [number, number, number];
  /** the twig's tip, as an offset from c */
  tip: [number, number, number];
  /** leaf corners as offsets from c, xyz; JOJOBA_LEAF.length each */
  leaves: Float32Array;
  inner: boolean;
  col: [string, string]; // [plain, gold]
};
// The mound: foliage down to the soil, near-straight sides from a foot
// up, a broad rounded crown. Radius (a fraction of rw) by height, the
// mass's own height being 0.88 of the plant's — twigs make up the rest.
export const jojobaProf = (u: number) => {
  const t = Math.min(1, u / 0.15);
  const base = 0.78 + 0.22 * t * t * (3 - 2 * t);
  return u > 0.6 ? base * Math.sqrt(Math.max(0, 1 - ((u - 0.6) / 0.36) ** 2)) : base;
};
// A blunt oval, half as wide as it is long.
export const JOJOBA_LEAF: [number, number][] = [[0, 0], [0.3, 0.48], [0.75, 0.42], [1, 0], [0.75, -0.42], [0.3, -0.48]];

// Its core: the mound set back from the leaves, filled as one silhouette.
export const jojobaCoreRing = (x: number, z: number, h: number, rw: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const u = 0.06 + (0.86 * i) / 8;
    const r = rw * 0.7 * jojobaProf(u);
    for (let j = 0; j < 12; j++) {
      const th = (j / 12) * Math.PI * 2;
      out.push([x + Math.cos(th) * r, u * h * 0.88, z + Math.sin(th) * r]);
    }
  }
  return out;
};

export function growJojoba(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
  const rng = rngFor("jojoba:" + seed);
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

  // Many stems from the root crown, fanning up and out into the mound:
  // the dark lines seen through it low down.
  const stems: V3[][] = [];
  for (let k = 0; k < 9; k++) {
    const a = rot + k * 2.399963 + rng() * 0.5;
    const out = rw * (0.35 + 0.2 * rng());
    stems.push([
      [x + Math.cos(a) * rw * 0.06, 0, z + Math.sin(a) * rw * 0.06],
      [x + Math.cos(a) * out, h * (0.25 + 0.15 * rng()), z + Math.sin(a) * out],
    ]);
  }

  const sprigs: JojobaSprig[] = [];
  const NI = 140;
  const NS = 340;
  const s1 = rng() * 6.28;
  const s2 = rng() * 6.28;
  for (let tries = 0; sprigs.length < NI + NS && tries < (NI + NS) * 4; tries++) {
    const inner = sprigs.length < NI;
    const u = 0.02 + 0.94 * rng();
    // By area, as the sage: the sides follow the radius, the crown
    // doesn't.
    if (u < 0.6 && rng() > jojobaProf(u)) continue;
    const th = rng() * Math.PI * 2;
    // A few broad lobes round it and over the top — the model's mound
    // is lumpy, not a dome.
    const lobe = Math.sin(3 * th + s1);
    const lump = 1 + 0.06 * lobe + 0.04 * Math.sin(5 * th + 3 * u + s2);
    const pr = jojobaProf(u);
    const r = rw * pr * (inner ? 0.66 + 0.2 * rng() : 0.93 + 0.1 * rng()) * lump;
    const c: V3 = [x + Math.cos(th) * r, u * h * 0.88 * (1 + 0.04 * lobe), z + Math.sin(th) * r];
    const ny = u > 0.55 ? ((u - 0.55) / 0.41) * 2.5 : u < 0.12 ? -(0.12 - u) * 4 : 0;
    const n = nrm([Math.cos(th) * pr, ny, Math.sin(th) * pr]);
    const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
    const shade = (0.38 + 0.62 * lit) * (0.6 + 0.4 * smooth(0, 0.6, u));

    // A twig mostly up, leaning out and to either side — jojoba's twigs
    // are upright, and pointing straight out they were end-on to the
    // camera, each a small rosette with the core showing round it. At
    // the foot they flare out over the soil. A third of those up the
    // sides and over the top stand proud of the mound — the model's
    // ragged, twiggy outline.
    const up = 0.15 + 0.55 * smooth(0, 0.15, u) + 0.3 * smooth(0.2, 0.7, u);
    const tw = (rng() - 0.5) * 0.9;
    const d = nrm([
      n[0] * 0.6 - Math.sin(th) * tw,
      up + n[1] * 0.3 + (rng() - 0.5) * 0.3,
      n[2] * 0.6 + Math.cos(th) * tw,
    ]);
    const proud = !inner && rng() < (u > 0.3 ? 0.35 : 0.15);
    const Ls = rw * (inner ? 0.24 : 0.17) * (0.8 + 0.4 * rng()) * (proud ? 1.9 : 1);
    const s0 = nrm(crs([0, 1, 0], Math.abs(d[1]) > 0.98 ? [Math.cos(th), 0, Math.sin(th)] : d));
    const b = nrm(crs(d, s0));
    // Drawn larger than life, as every shrub here is: at true size the
    // leaves covered under half the mound and it read as a dark ball.
    const L = rw * (inner ? 0.14 : 0.095) * (0.85 + 0.3 * rng());
    const pts: number[] = [];
    const put = (base: V3, dir: V3, len: number, flat: boolean) => {
      const dy = dir[1];
      const perp: V3 = flat || Math.abs(dy) > 0.95 ? s0 : nrm([-dir[0] * dy, 1 - dy * dy, -dir[2] * dy]);
      for (const [f, q] of JOJOBA_LEAF) {
        for (let i = 0; i < 3; i++) pts.push(base[i] + dir[i] * len * f + perp[i] * len * 0.52 * q);
      }
    };
    // Opposite pairs up the twig, each pair a quarter turn from the
    // last, and a young leaf at the tip. The pairs out to the sides
    // stand on edge, as jojoba holds its leaves to the sun; the pairs
    // above and below the twig lie across it — on edge too, they lay in
    // the twig's own upright plane, end-on to anyone looking at the
    // shrub, and the mound went thin.
    [0.35, 0.62, 0.86].forEach((t, k) => {
      const s = k % 2 ? b : s0;
      const base: V3 = [d[0] * Ls * t, d[1] * Ls * t, d[2] * Ls * t];
      for (const sg of [1, -1]) {
        const a = 0.85 + (rng() - 0.5) * 0.3;
        const ca = Math.cos(a);
        const sa = Math.sin(a) * sg;
        put(base, nrm([d[0] * ca + s[0] * sa, d[1] * ca + s[1] * sa, d[2] * ca + s[2] * sa]), L, k % 2 === 1);
      }
    });
    put([d[0] * Ls * 0.9, d[1] * Ls * 0.9, d[2] * Ls * 0.9], d, L * 0.75, true);

    // Mottled, as the scan is: every sprig a shade lighter or darker.
    const mottle = 0.92 + 0.16 * rng();
    const tone = (pal: typeof JOJOBA_COLOURS) => {
      const col = mix(pal.leafShade, pal.leafLit, shade).map((v) => Math.min(255, v * mottle));
      return rgb(inner ? mix(pal.core, col, 0.6) : col);
    };
    sprigs.push({
      c,
      n,
      tip: [d[0] * Ls, d[1] * Ls, d[2] * Ls],
      leaves: new Float32Array(pts),
      inner,
      col: [tone(JOJOBA_COLOURS), tone(JOJOBA_GOLD)],
    });
  }
  return { stems, sprigs };
}
