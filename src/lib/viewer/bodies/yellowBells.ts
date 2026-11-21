// Yellow bells' body, grown as stems, compound leaves and clusters of
// trumpets in the scene's feet. Shared by the canvas viewer and its WebGL
// pilot, so both draw the same leaves.

import { rngFor } from "../symbols";

/** Yellow bells: deep glossy green, and the golden trumpets it's named for. */
export const YELLOW_BELLS_COLOURS = {
  core: [58, 90, 52],
  leafLit: [128, 168, 82],
  leafShade: [56, 94, 52],
  bloomLit: [232, 190, 62],
  bloomShade: [184, 136, 36],
};
export const YELLOW_BELLS_GOLD = {
  core: [118, 86, 40],
  leafLit: [226, 192, 120],
  leafShade: [152, 114, 54],
  bloomLit: [244, 222, 160],
  bloomShade: [196, 158, 86],
};

// Grown once per plant and kept, as the hopseed and sage are.
export type YellowBellsPart = {
  c: [number, number, number];
  /** outward normal, to skip outlines on the far side */
  n: [number, number, number];
  /** shapes as offsets from c, xyz; `corners` points each */
  pts: Float32Array;
  corners: number;
  kind: "inner" | "leaf" | "bloom";
  col: [string, string]; // [plain, gold]
};

// Leaflets are broad ovals, toothed in life but too small for it to
// show; trumpets flare from a narrow tube to an open mouth.
export const LEAFLET: [number, number][] = [[0, 0], [0.25, 0.42], [0.65, 0.45], [1, 0], [0.65, -0.45], [0.25, -0.42]];
export const TRUMPET: [number, number][] = [[0, -0.16], [0.5, -0.24], [0.78, -0.55], [0.96, -0.72], [1.06, 0], [0.96, 0.72], [0.78, 0.55], [0.5, 0.24], [0, 0.16]];

export function growYellowBells(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
  const rng = rngFor("yellowbells:" + seed);
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
  // An upright oval: bare stems only for the first few inches, the
  // foliage widening to full by a third of the way up, straight-sided,
  // then rounding over the top quarter.
  const prof = (u: number) =>
    (0.7 + 0.3 * smooth(0.07, 0.32, u)) *
    (u > 0.72 ? Math.pow(Math.max(0, 1 - ((u - 0.72) / 0.28) ** 2), 0.45) : 1);

  const stems: V3[][] = [];
  for (let k = 0; k < 6; k++) {
    const a = rot + k * 2.399963 + rng() * 0.6;
    const out = rw * (0.22 + 0.16 * rng());
    stems.push([
      [x + Math.cos(a) * rw * 0.05, 0, z + Math.sin(a) * rw * 0.05],
      [x + Math.cos(a) * out, h * (0.28 + 0.1 * rng()), z + Math.sin(a) * out],
    ]);
  }

  const put = (out: number[], base: V3, dir: V3, perp: V3, len: number, wid: number, shape: [number, number][]) => {
    for (const [f, q] of shape) {
      for (let i = 0; i < 3; i++) out.push(base[i] + dir[i] * len * f + perp[i] * wid * q);
    }
  };

  const parts: YellowBellsPart[] = [];
  const NI = 190;
  const NS = 300;
  const NB = 40;
  const s1 = rng() * 6.28;
  for (let tries = 0; parts.length < NI + NS + NB && tries < (NI + NS + NB) * 4; tries++) {
    const i = parts.length;
    const kind: YellowBellsPart["kind"] = i < NI ? "inner" : i < NI + NS ? "leaf" : "bloom";
    // Flowers sit on the upper two thirds, at the tips of the outer shoots.
    const u = kind === "bloom" ? 0.25 + 0.73 * Math.sqrt(rng()) : 0.07 + 0.91 * rng();
    // By area: the straight sides follow the radius; the rounded crown,
    // like the sage's dome, has as much skin per foot at the top.
    if (u < 0.72 && rng() > prof(u)) continue;
    const th = rng() * Math.PI * 2;
    const tuft = 1 + 0.06 * Math.sin(5 * th + 8 * u + s1);
    const reach = kind === "inner" ? 0.62 + 0.2 * rng() : kind === "leaf" ? 0.9 + 0.12 * rng() : 1.0 + 0.1 * rng();
    const r = rw * prof(u) * reach * tuft;
    const c: V3 = [x + Math.cos(th) * r, Math.min(u * h, h * 0.98), z + Math.sin(th) * r];
    const n = nrm([Math.cos(th) * prof(u), (u - 0.45) * 1.2, Math.sin(th) * prof(u)]);
    const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
    const shade = (0.3 + 0.7 * lit) * (0.5 + 0.5 * smooth(0.08, 0.75, u));
    const side = nrm(crs([0, 1, 0], n[1] > 0.98 ? [1, 0, 0] : n));
    const pts: number[] = [];
    if (kind === "bloom") {
      // A bunch of trumpets hanging together off one tip — out and
      // down, a little splayed. Fanned all the way round they read as a
      // propeller, which is nothing yellow bells ever does.
      // Each trumpet hangs from its own place along a short stalk; all
      // from one point they overlapped into a single yellow fan.
      const nt = 4 + Math.floor(rng() * 3);
      const L = rw * 0.12;
      const stalk = nrm([n[0] * 0.7, 0.55, n[2] * 0.7]);
      for (let k = 0; k < nt; k++) {
        const along = (k / (nt - 1)) * rw * 0.22;
        const sg = k % 2 ? 1 : -1;
        const dir = nrm([
          n[0] * 0.5 + side[0] * sg * (0.45 + 0.3 * rng()),
          n[1] * 0.4 - 0.6 + (rng() - 0.5) * 0.3,
          n[2] * 0.5 + side[2] * sg * (0.45 + 0.3 * rng()),
        ]);
        const perp = nrm(crs(dir, n[1] > 0.98 ? [1, 0, 0] : n));
        put(pts, [stalk[0] * along, stalk[1] * along, stalk[2] * along], dir, perp, L * (0.85 + 0.3 * rng()), L * 0.46, TRUMPET);
      }
      const tone = (pal: typeof YELLOW_BELLS_COLOURS) => rgb(mix(pal.bloomShade, pal.bloomLit, 0.35 + 0.65 * shade));
      parts.push({ c, n, pts: new Float32Array(pts), corners: TRUMPET.length, kind, col: [tone(YELLOW_BELLS_COLOURS), tone(YELLOW_BELLS_GOLD)] });
      continue;
    }
    // A compound leaf: a short rachis out and up, two pairs of leaflets
    // and one at the end.
    const rach = nrm([n[0] * 0.75 + (rng() - 0.5) * 0.3, 0.45 + (rng() - 0.5) * 0.3, n[2] * 0.75 + (rng() - 0.5) * 0.3]);
    const rs = nrm(crs(rach, n[1] > 0.98 ? [1, 0, 0] : n));
    const Ll = rw * (kind === "inner" ? 0.16 : 0.115) * (0.85 + 0.3 * rng());
    const len = rw * 0.2;
    [[0.35, 1], [0.35, -1], [0.7, 1], [0.7, -1], [1, 0]].forEach(([t, sg]) => {
      const base: V3 = [rach[0] * len * t, rach[1] * len * t, rach[2] * len * t];
      const k = sg === 0 ? 0 : 0.82;
      const dir = nrm([rach[0] * (1 - k * 0.5) + rs[0] * sg * k, rach[1] * (1 - k * 0.5) + rs[1] * sg * k - 0.1, rach[2] * (1 - k * 0.5) + rs[2] * sg * k]);
      const perp = nrm(crs(dir, n));
      put(pts, base, dir, perp, Ll, Ll * 0.48, LEAFLET);
    });
    const tone = (pal: typeof YELLOW_BELLS_COLOURS) => {
      const col = mix(pal.leafShade, pal.leafLit, shade);
      return rgb(kind === "inner" ? mix(pal.core, col, 0.4) : col);
    };
    parts.push({ c, n, pts: new Float32Array(pts), corners: LEAFLET.length, kind, col: [tone(YELLOW_BELLS_COLOURS), tone(YELLOW_BELLS_GOLD)] });
  }
  return { stems, parts };
}
