// Little John bottlebrush's body, grown as arms of needle whorls and
// crimson brushes in the scene's feet. Shared by the canvas viewer and its
// WebGL pilot, so both draw the same leaves.

import { rngFor } from "../symbols";

/** Little John bottlebrush: dark blue-green needles, paler yellow-green at
 *  the growing tips, and the crimson brushes it's named for. */
export const BOTTLEBRUSH_COLOURS = {
  core: [46, 60, 54], // the shadow at the heart of the mound
  leafLit: [138, 150, 128],
  leafShade: [62, 76, 70],
  tip: [176, 182, 124], // new growth
  stem: "rgba(96,84,72,0.85)",
  brush: "rgb(146,20,36)", // the flower spike under its stamens
  stamen: "rgba(214,42,54,0.95)",
};
export const BOTTLEBRUSH_GOLD = {
  core: [118, 86, 40],
  leafLit: [226, 192, 120],
  leafShade: [152, 114, 54],
  tip: [240, 216, 150],
  stem: "rgba(168,123,47,0.8)",
  brush: "rgb(168,123,47)",
  stamen: "rgba(236,206,140,0.95)",
};

// Grown once per plant and kept, as the shrubs before it are.
export type BottlebrushPart = {
  c: [number, number, number];
  /** outward normal, to skip outlines on the far side */
  n: [number, number, number];
  /** leaf corners as offsets from c, xyz; BOTTLEBRUSH_LEAF.length each.
   *  For a brush, its axis — two points, offsets from c — then a
   *  [place along it, lean, side] triple per stamen. */
  pts: Float32Array;
  kind: "inner" | "leaf" | "tip" | "brush";
  col: [string, string]; // [plain, gold]
};
// A needle: narrow, pointed both ends.
export const BOTTLEBRUSH_LEAF: [number, number][] = [[0, 0], [0.45, 0.5], [1, 0], [0.45, -0.5]];

// The heart of the mound, set back behind the inner needles.
export const bottlebrushCoreRing = (x: number, z: number, h: number, rw: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 6;
    const r = rw * 0.38 * Math.cos(a);
    const y = h * (0.3 + 0.18 * Math.sin(a));
    for (let j = 0; j < 12; j++) {
      const th = (j / 12) * Math.PI * 2;
      out.push([x + Math.cos(th) * r, y, z + Math.sin(th) * r]);
    }
  }
  return out;
};

export function growBottlebrush(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
  const rng = rngFor("bottlebrush:" + seed);
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
  const outward = (c: V3): V3 => nrm([c[0] - x, ((c[1] - h * 0.25) * rw) / h, c[2] - z]);
  const shadeAt = (c: V3, n: V3) => {
    const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
    return (0.35 + 0.65 * lit) * (0.6 + 0.4 * smooth(0, 0.8, c[1] / h));
  };
  const parts: BottlebrushPart[] = [];
  // A whorl of needles round a stretch of shoot, swept forward along it.
  const whorl = (c: V3, dir: V3, k: number, L: number, sweep: number, spin: number) => {
    const s0 = nrm(crs(dir, Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
    const s1 = crs(dir, s0);
    const pts: number[] = [];
    const cs = Math.cos(sweep);
    const sn = Math.sin(sweep);
    for (let i = 0; i < k; i++) {
      const a = spin + (i / k) * Math.PI * 2;
      const rad: V3 = [s0[0] * Math.cos(a) + s1[0] * Math.sin(a), s0[1] * Math.cos(a) + s1[1] * Math.sin(a), s0[2] * Math.cos(a) + s1[2] * Math.sin(a)];
      const d: V3 = [dir[0] * cs + rad[0] * sn, dir[1] * cs + rad[1] * sn, dir[2] * cs + rad[2] * sn];
      // The blade's width lies round the shoot, so a whorl reads as a
      // bristling cylinder from any side.
      const w: V3 = crs(d, rad);
      for (const [f, q] of BOTTLEBRUSH_LEAF) {
        for (let j = 0; j < 3; j++) pts.push(d[j] * L * f + w[j] * L * 0.28 * q);
      }
    }
    return new Float32Array(pts);
  };

  // Arms: stiff shoots fanning out of a tight base, the long ones low and
  // reaching the rim halfway up, the short ones nearly upright to the
  // top — the model's fan, widest at mid-height, not a dome. A little
  // shorter across the plant's yaw than along it, as the model is.
  const arms: V3[][] = [];
  const NA = 24;
  for (let k = 0; k < NA; k++) {
    const a = rot + k * 2.399963 + (rng() - 0.5) * 0.4;
    const reach = (0.3 + 0.75 * Math.sqrt(rng())) * (1 - 0.19 * Math.sin(a - rot) ** 2);
    const rt = rw * Math.min(1.02, reach);
    const yt = h * Math.min(1, (1 - 0.48 * (rt / rw) ** 2) * (0.88 + 0.14 * rng()));
    const p0: V3 = [x + Math.cos(a) * rw * 0.06, h * 0.06, z + Math.sin(a) * rw * 0.06];
    // Nearly straight out of the base, curling up a little at the end.
    const p1: V3 = [x + Math.cos(a) * rt * 0.55, yt * 0.44, z + Math.sin(a) * rt * 0.55];
    const p2: V3 = [x + Math.cos(a) * rt, yt, z + Math.sin(a) * rt];
    const at = (t: number): V3 => {
      const u = 1 - t;
      return [0, 1, 2].map((i) => u * u * p0[i] + 2 * u * t * p1[i] + t * t * p2[i]) as V3;
    };
    const path: V3[] = [];
    for (let i = 0; i <= 8; i++) path.push(at(i / 8));
    arms.push(path);
    // Needles from a quarter of the way out — inside that the shoot is in
    // the mound — in close whorls, so each shoot is a thick bristling
    // cylinder as the model's are (sparse, they read as rosemary), to a
    // clubbed tip of paler new growth.
    const len = Math.hypot(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    const nW = Math.max(5, Math.round(len / (rw * 0.06)));
    const L = rw * 0.16 * (0.9 + 0.2 * rng());
    for (let i = 0; i < nW; i++) {
      const t = 0.25 + (0.75 * (i + 0.5)) / nW;
      const c = at(t);
      const c2 = at(Math.min(1, t + 0.02));
      const dir = nrm([c2[0] - c[0], c2[1] - c[1], c2[2] - c[2]]);
      const tip = t > 0.88;
      const n = outward(c);
      const shade = shadeAt(c, n);
      const pts = whorl(c, dir, 9, L * (tip ? 0.8 : 1), tip ? 0.45 : 0.85, rng() * 6.28);
      const tone = (pal: typeof BOTTLEBRUSH_COLOURS) => {
        const col = mix(pal.leafShade, pal.leafLit, shade);
        return rgb(tip ? mix(col, pal.tip, 0.65) : col);
      };
      parts.push({ c, n, pts, kind: tip ? "tip" : "leaf", col: [tone(BOTTLEBRUSH_COLOURS), tone(BOTTLEBRUSH_GOLD)] });
    }
    // A crimson brush on some shoots, just behind the leafy tip — the
    // shoot grows on through the flower, as a bottlebrush's does.
    if (rng() < 0.38) {
      const t0 = 0.66 + 0.08 * rng();
      const a0 = at(t0);
      const a1 = at(t0 + 0.17);
      const c: V3 = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2, (a0[2] + a1[2]) / 2];
      const pts = [a0[0] - c[0], a0[1] - c[1], a0[2] - c[2], a1[0] - c[0], a1[1] - c[1], a1[2] - c[2]];
      for (let i = 0; i < 32; i++) pts.push((i + 0.5) / 32, (rng() - 0.5) * 0.9, i % 2 ? 1 : -1);
      parts.push({ c, n: outward(c), pts: new Float32Array(pts), kind: "brush", col: ["", ""] });
    }
  }

  // The mound's heart: big whorls in shade round the base of the arms,
  // fill only.
  for (let i = 0; i < 140; i++) {
    const th = rng() * Math.PI * 2;
    const v = rng() * 2 - 1;
    const r = rw * 0.46 * Math.sqrt(1 - v * v) * (0.85 + 0.2 * rng());
    const c: V3 = [x + Math.cos(th) * r, h * (0.3 + 0.22 * v), z + Math.sin(th) * r];
    const n = outward(c);
    const dir = nrm([n[0] * 0.6 + (rng() - 0.5) * 0.6, 0.7, n[2] * 0.6 + (rng() - 0.5) * 0.6]);
    const shade = shadeAt(c, n);
    // Smaller than the shoots' own needles would suggest: big, they
    // read as agave spikes at the foot of the plant.
    const pts = whorl(c, dir, 7, rw * 0.13, 0.75, rng() * 6.28);
    const tone = (pal: typeof BOTTLEBRUSH_COLOURS) => rgb(mix(pal.core, mix(pal.leafShade, pal.leafLit, shade), 0.55));
    parts.push({ c, n, pts, kind: "inner", col: [tone(BOTTLEBRUSH_COLOURS), tone(BOTTLEBRUSH_GOLD)] });
  }
  return { arms, parts };
}
