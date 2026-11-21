// White Dawn lantana's body, grown as runners, leaf clusters and flower
// heads in the scene's feet. Shared by the canvas viewer and its WebGL
// pilot, so both draw the same leaves.

import { rngFor } from "../symbols";

/** White Dawn lantana: mid-dark green trailing runners, greenish-brown
 *  stems, and white posies with a yellow eye. */
export const WHITE_DAWN_COLOURS = {
  leafLit: [150, 166, 116],
  leafShade: [48, 58, 42],
  inner: [38, 46, 34],
  stem: "rgba(98,86,64,0.85)",
  flower: "rgb(244,242,232)",
  floret: "rgb(252,251,246)",
  eye: "rgb(218,182,72)",
};
export const WHITE_DAWN_GOLD = {
  leafLit: [226, 192, 120],
  leafShade: [152, 114, 54],
  inner: [118, 86, 40],
  stem: "rgba(168,123,47,0.85)",
  flower: "rgb(244,222,166)",
  floret: "rgb(250,232,184)",
  eye: "rgb(168,123,47)",
};

export type WhiteDawnSprig = {
  c: [number, number, number];
  /** leaf corners as offsets from c, xyz; WHITE_DAWN_LEAF.length each */
  leaves: Float32Array;
  /** the same leaves as kites, WHITE_DAWN_KITE.length each */
  kites: Float32Array;
  inner: boolean;
  /** its step on the light ramp, 0 shade to WD_LEVELS - 1 lit */
  tone: number;
};
export type WhiteDawnPlant = {
  /** the runners, each a path from the crown */
  runners: [number, number, number][][];
  sprigs: WhiteDawnSprig[];
  /** flower heads: centre and radius, ft */
  flowers: [number, number, number, number][];
};
// A lantana leaf: a broad oval to a blunt point. Narrower, they read as
// fern.
export const WHITE_DAWN_LEAF: [number, number][] = [[0, 0], [0.22, 0.48], [0.62, 0.44], [1, 0], [0.62, -0.44], [0.22, -0.48]];
// The leaf as a kite of the same area, for leaves a few pixels long:
// the oval can't be told from it at that size, and the plant's
// thousands of corners are most of its cost.
export const WHITE_DAWN_KITE: [number, number][] = [[0, 0], [0.4, 0.64], [1, 0], [0.4, -0.64]];
// Leaf tones in steps, made once, so a fill's colour is only set when
// the step changes: the leaves', then the shaded heart's. A fill per
// cluster: sharing fills — a run of one tone, or a band of depth and a
// step of tone at once — was slower, the long paths costing more to
// fill than the fills they save.
export const WD_LEVELS = 8;
export const WD_TONES = [WHITE_DAWN_COLOURS, WHITE_DAWN_GOLD].map((pal) => {
  const ramp = (inner: boolean) =>
    Array.from({ length: WD_LEVELS }, (_, k) => {
      const t = 0.25 + (0.75 * k) / (WD_LEVELS - 1);
      const col = pal.leafShade.map((v, i) => v + (pal.leafLit[i] - v) * t);
      const c = inner ? pal.inner.map((v, i) => v + (col[i] - v) * 0.45) : col;
      return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    });
  return [...ramp(false), ...ramp(true)];
});

export function growWhiteDawn(x: number, z: number, h: number, rw: number, rot: number, seed: string): WhiteDawnPlant {
  const rng = rngFor("white-dawn:" + seed);
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
  // A mat, lit from above: leaves high on an arch catch the light, the
  // ones down in it don't. Mottled a step either way, as the scan is.
  const toneAt = (c: V3, n: V3) => {
    const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
    const shade = (0.4 + 0.6 * lit) * (0.62 + 0.38 * Math.min(1, c[1] / (h * 0.5))) * (0.9 + 0.2 * rng());
    return Math.max(0, Math.min(WD_LEVELS - 1, Math.round(((shade - 0.25) / 0.75) * (WD_LEVELS - 1))));
  };

  const runners: V3[][] = [];
  const sprigs: WhiteDawnSprig[] = [];
  const flowers: [number, number, number, number][] = [];
  const L = rw * 0.085;
  // A cluster of four to six leaves round a point on a runner, held near
  // flat — a groundcover turns its leaves to the sky.
  const cluster = (c: V3, dir: V3, len: number, inner: boolean) => {
    const side = nrm(crs([0, 1, 0], dir));
    const pts: number[] = [];
    const kts: number[] = [];
    const put = (d: V3, l: number) => {
      const p = nrm(crs([0, 1, 0], d));
      for (const [f, q] of WHITE_DAWN_LEAF) {
        for (let i = 0; i < 3; i++) pts.push(d[i] * l * f + p[i] * l * 0.62 * q);
      }
      for (const [f, q] of WHITE_DAWN_KITE) {
        for (let i = 0; i < 3; i++) kts.push(d[i] * l * f + p[i] * l * 0.62 * q);
      }
    };
    const spin = rng() * Math.PI;
    const k = 4 + Math.floor(rng() * 3);
    for (let j = 0; j < k; j++) {
      const ang = spin + (j / k) * Math.PI * 2 + (rng() - 0.5) * 0.9;
      const l = 0.75 + 0.3 * rng();
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const d = nrm([dir[0] * ca + side[0] * sa, 0.12 + (rng() - 0.3) * 0.5, dir[2] * ca + side[2] * sa]);
      put(d, len * l);
    }
    const n = nrm([(c[0] - x) / rw, 1.6, (c[2] - z) / rw]);
    sprigs.push({ c, leaves: new Float32Array(pts), kites: new Float32Array(kts), inner, tone: toneAt(c, n) });
  };
  // A flower head on a short stalk over the leaves.
  const bloom = (c: V3) => {
    flowers.push([c[0], c[1] + h * 0.04, c[2], rw * (0.032 + 0.012 * rng())]);
  };

  // Runners: wiry stems out of a small crown, arching up and over and
  // trailing out low across the ground, their tips lifting — a few
  // standing right up at the edge, as the scan's do. Each forks once
  // or twice. Out to an oval a fifth narrower across the plant's yaw
  // than along it, as the model is.
  const walk = (p0: V3, p1: V3, p2: V3, p3: V3, flowerAtTip: boolean) => {
    const at = (t: number): V3 => {
      const u = 1 - t;
      return [0, 1, 2].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]) as V3;
    };
    const path: V3[] = [];
    for (let i = 0; i <= 10; i++) path.push(at(i / 10));
    runners.push(path);
    let len = 0;
    for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
    const n = Math.max(3, Math.round(len / (rw * 0.08)));
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, 0.12 + (0.88 * (i + 0.2 + 0.6 * rng())) / n);
      const c = at(t);
      const c2 = at(Math.min(1, t + 0.02));
      const dir = nrm([c2[0] - c[0], 0, c2[2] - c[2]]);
      cluster(c, dir, L * (t > 0.9 ? 0.75 : 1), false);
      if (rng() < 0.03) bloom(c);
    }
    if (flowerAtTip && rng() < 0.45) bloom(at(1));
    return at;
  };
  const NR = 22;
  for (let k = 0; k < NR; k++) {
    const a = rot + k * 2.399963 + (rng() - 0.5) * 0.5;
    const edge = rw * (1 - 0.21 * Math.sin(a - rot) ** 2);
    const R = edge * (0.5 + 0.5 * Math.sqrt(rng()));
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const wob = (rng() - 0.5) * 0.24 * R;
    const lift = rng() < 0.12;
    const pt = (r: number, y: number, side: number): V3 => [x + ca * r - sa * side, y, z + sa * r + ca * side];
    const at = walk(
      pt(rw * 0.04, h * 0.12, 0),
      pt(R * 0.3, h * (0.42 + 0.16 * rng()), wob * 0.5),
      pt(R * 0.7, h * (lift ? 0.3 + 0.12 * rng() : 0.18 + 0.12 * rng()), wob),
      pt(R * (lift ? 0.9 : 1), h * (lift ? 0.55 + 0.25 * rng() : 0.1 + 0.12 * rng()), wob * 1.3 + (lift ? (rng() - 0.5) * R * 0.3 : 0)),
      true,
    );
    // Side runners forking off partway out.
    const forks = 1 + (rng() < 0.5 ? 1 : 0);
    for (let f = 0; f < forks; f++) {
      const t = 0.3 + 0.3 * rng();
      const p0 = at(t);
      const b = a + (rng() < 0.5 ? 1 : -1) * (0.45 + 0.35 * rng());
      const rr = R * (0.3 + 0.25 * rng());
      const cb = Math.cos(b);
      const sb = Math.sin(b);
      walk(
        p0,
        [p0[0] + cb * rr * 0.35, p0[1] + h * 0.06, p0[2] + sb * rr * 0.35],
        [p0[0] + cb * rr * 0.75, h * (0.14 + 0.1 * rng()), p0[2] + sb * rr * 0.75],
        [p0[0] + cb * rr, h * (0.08 + 0.12 * rng()), p0[2] + sb * rr],
        true,
      );
    }
  }
  // The heart of the mat, where the runners crowd out of the crown:
  // clusters in shade, fill only, so it reads as a mat there and not a
  // tangle of wire.
  for (let i = 0; i < 70; i++) {
    const th = rng() * Math.PI * 2;
    const r = rw * 0.5 * Math.sqrt(rng()) * (1 - 0.21 * Math.sin(th - rot) ** 2);
    const c: V3 = [x + Math.cos(th) * r, h * (0.08 + 0.26 * rng()) * (1 - (0.5 * r) / rw), z + Math.sin(th) * r];
    cluster(c, [Math.cos(th + 1.3), 0, Math.sin(th + 1.3)], L * 1.15, true);
  }
  // The heart first, a step of tone at a time; the rest as grown.
  sprigs.sort((a, b) => (a.inner === b.inner ? (a.inner ? a.tone - b.tone : 0) : a.inner ? -1 : 1));
  return { runners, sprigs, flowers };
}
