// Firestick's body, grown as pencil sticks in the scene's feet. Shared by the canvas viewer and its
// WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** Firestick: the scan's pencil sticks — the old wood pale grey, the
 *  branches straw-tan, the young growth up top green. Each as its shaded
 *  and lit side. */
export const FIRESTICK_COLOURS = {
  wood: [[156, 150, 136], [228, 224, 210]],
  straw: [[160, 140, 106], [230, 214, 178]],
  young: [[108, 120, 66], [178, 188, 118]],
};
export const FIRESTICK_GOLD = {
  wood: [[150, 112, 56], [246, 222, 170]],
  straw: [[140, 100, 46], [236, 200, 128]],
  young: [[130, 96, 40], [226, 190, 112]],
};

// The firestick's sticks, the same on every plant as in the headset,
// in the model's measure (its height = 1): a pale leader the whole
// height; low down, branches spreading wide and forking, and forking
// again, each fork turning further up, into a coral of upturned sticks;
// higher, shorter branches held more upright, so the top is narrow.
// Each stick is [x0, y0, z0, x1, y1, z1, width, colour], its colour 0
// the old wood, 1 straw, 2 the young green.
const FS_STICKS: number[][] = (() => {
  const rng = rngFor("firestick");
  const out: number[][] = [];
  const widths = [0.019, 0.015, 0.012, 0.0095, 0.008];
  type V3 = [number, number, number];
  const unit = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const colourAt = (y: number, order: number) =>
    order === 0 && y < 0.3 ? 0 : rng() < Math.max(0, Math.min(1, (y - 0.5) / 0.35)) * 0.75 ? 2 : 1;
  const fork = (p: V3, d: V3, len: number, order: number, last: number, lift: number) => {
    const e: V3 = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
    out.push([...p, ...e, widths[Math.min(order, 4)], colourAt(e[1], order)]);
    // Some stop short, as the scan's do.
    if (order >= last || (order >= 2 && rng() < 0.12)) return;
    // Two ways on (now and then three), splayed across the stick and
    // turned up.
    const side = unit([-d[2], 0, d[0]]);
    const n = rng() < 0.2 ? 3 : 2;
    const roll = rng() * Math.PI;
    for (let k = 0; k < n; k++) {
      const a = roll + (k * Math.PI * 2) / n;
      const spread = (0.3 + rng() * 0.45) * (order === 0 ? 1.1 : 0.9);
      const across: V3 = [side[0] * Math.cos(a), Math.sin(a) * 0.6, side[2] * Math.cos(a)];
      const nd = unit([d[0] + across[0] * spread, d[1] + across[1] * spread + lift, d[2] + across[2] * spread]);
      fork(e, nd, len * (0.55 + rng() * 0.35), order + 1, last, lift);
    }
  };
  // The leader, leaning a touch as it climbs, forking at its top.
  let at: V3 = [0, 0, 0];
  for (let k = 0; k < 5; k++) {
    const next: V3 = [at[0] + (rng() - 0.5) * 0.02, (k + 1) * 0.17, at[2] + (rng() - 0.5) * 0.02];
    out.push([...at, ...next, 0.028 - k * 0.0022, k < 3 ? 0 : 1]);
    at = next;
  }
  fork(at, [0, 1, 0], 0.08, 1, 3, 0.3);
  const leaderAt = (y: number): V3 => {
    for (const st of out.slice(0, 5)) {
      if (y <= st[4]) {
        const f = (y - st[1]) / (st[4] - st[1]);
        return [st[0] + (st[3] - st[0]) * f, y, st[2] + (st[5] - st[2]) * f];
      }
    }
    return at;
  };
  // The low branches: out nearly flat from the foot, then forking
  // four deep, each fork turning up.
  for (let i = 0; i < 16; i++) {
    const y = 0.03 + (i / 15) * 0.37 + (rng() - 0.5) * 0.03;
    const az = i * 2.39996 + (rng() - 0.5) * 0.4;
    const el = (12 + rng() * 22 + (y / 0.4) * 10) * (Math.PI / 180);
    fork(leaderAt(y), [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], 0.12 + rng() * 0.05, 0, 4, 0.32);
  }
  // The high ones: shorter, steeper, crowding into an upright head.
  for (let i = 0; i < 16; i++) {
    const y = 0.42 + (i / 15) * 0.45 + (rng() - 0.5) * 0.03;
    const az = 1.3 + i * 2.39996 + (rng() - 0.5) * 0.4;
    const el = (50 + rng() * 20) * (Math.PI / 180);
    fork(leaderAt(y), [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], 0.06 + rng() * 0.03, 1, 4, 0.4);
  }
  return out;
})();
export const FS_N = FS_STICKS.length;
// Every stick's batch: its width (the leader's own five, then the
// branches' four), colour and whether it's on the near side.
export const FS_WIDTHS = [...new Set(FS_STICKS.map((st) => st[6]))].sort((a, b) => b - a);
export const FS_BATCH = FS_STICKS.map((st) => FS_WIDTHS.indexOf(st[6]) * 3 + st[7]);
export const FS_BATCHES = FS_WIDTHS.length * 3;
export const FS_TONES = [FIRESTICK_COLOURS, FIRESTICK_GOLD].map((pal) =>
  [pal.wood, pal.straw, pal.young].map(([lo, hi]) =>
    [0.35, 0.6, 0.9].map((t) => `rgb(${lo.map((v, k) => (v + (hi[k] - v) * t) | 0).join(",")})`),
  ),
);

/** Every stick's ends, (x, y, z) twice, placed and turned, in feet. */
export function growFirestick(x: number, z: number, h: number, rot: number) {
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const out = new Float32Array(FS_N * 6);
  FS_STICKS.forEach((st, i) => {
    for (let e = 0; e < 2; e++) {
      const mx = st[e * 3];
      const mz = st[e * 3 + 2];
      out.set([x + (mx * cr - mz * sr) * h, st[e * 3 + 1] * h, z + (mx * sr + mz * cr) * h], i * 6 + e * 3);
    }
  });
  return out;
}
