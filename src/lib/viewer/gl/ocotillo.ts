// Ocotillo as the WebGL layer draws it: grown by the grower the canvas
// uses (see `drawOcotilloBody` in LivingBlueprint).
//
// The canvas paints its canes far to near, each whole: a sleeve far off,
// the leaves behind it, the bark, its lit side, the leaves in front, the
// flowers. Here each part of every cane is drawn at the depth of the
// cane's middle (see `flat`), one part at a time across all the canes: a
// cane's parts lie at one depth, so each goes over the last, and a nearer
// cane's, written in depth, keep a farther cane's later parts off it. Its
// colours are all opaque, so the parts that hide others are drawn solid
// (see `solid`), and the card's multisampling smooths their edges.
//
// Each cane takes its own local map and its own feet-to-pixels at its
// middle, as the canvas does (see `atK`); and what shows at which size is
// each stroke's own (its window).

import { OCOTILLO_COLOURS, OCOTILLO_GOLD, growOcotillo, type OcotilloCane } from "../bodies/ocotillo";
import { rgba, type Rgba } from "./geom";
import type { MeshBuilder } from "./mesh";

type V3 = [number, number, number];
type Pal = [Rgba, Rgba];

const C = OCOTILLO_COLOURS;
const G = OCOTILLO_GOLD;
const pal = (c: string, g: string): Pal => [rgba(c), rgba(g)];
const ALL: [number, number] = [0, Infinity];

export function ocotillo(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const { canes, leafLen, tube } = growOcotillo(x, z, h, rw, rot, id);
  const foot: V3 = [x, 0, z];
  const pt = (c: OcotilloCane, i: number): V3 => [c.ax[i * 3], c.ax[i * 3 + 1], c.ax[i * 3 + 2]];
  const mid = (c: OcotilloCane) => pt(c, 4);
  // Leaves show from where one is a pixel and a half long; a band of green
  // carries them until it's four.
  const leaves = 1.5 / leafLen;
  const sleeve = 4 / leafLen;
  const solid = { local: foot, atK: true, flat: true, solid: true };

  // The crown: the woody knot the canes come out of, on the ground.
  const t0 = b.tri.length;
  const crown = pal(C.crown, G.crown);
  const base = b.verts;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.vert(x + Math.cos(a) * rw * 0.07, 0, z + Math.sin(a) * rw * 0.07, crown[0], crown[1]);
  }
  for (let i = 1; i < 9; i++) b.tri.push(base, base + i, base + i + 1);
  b.tris(t0, false, false);

  /** A ribbon down a cane's axis, piece `i` (see the stroke shader's mode
   *  6): half-widths at its ends in feet, at least `floor` pixels; with
   *  `off`, its middle that many feet off the axis at each end. */
  const ribbon = (c: OcotilloCane, i: number, wa: number, wb: number, floor: number, col: Pal, win: [number, number], off?: [number, number]) => {
    const m = mid(c);
    b.strokeMode(pt(c, i), pt(c, i + 1), [wa, wb, floor], 6, col[0], col[1], [off?.[0] ?? 0, off?.[1] ?? 0, 0, 0], {
      ca: pt(c, Math.max(0, i - 1)),
      cb: pt(c, Math.min(8, i + 2)),
      pa: m,
      pb: m,
      win,
    });
  };
  /** A cane's leaves, in front of it or behind, of one tone (-1, all). */
  const leafRun = (c: OcotilloCane, front: boolean, tone: number, col: Pal) => {
    const L = c.leaves;
    const m = mid(c);
    for (let o = 0; o < L.length; o += 8) {
      if (tone >= 0 && L[o + 7] !== tone) continue;
      const i = Math.min(7, L[o] | 0);
      const f = L[o] - i;
      const a = pt(c, i);
      const e = pt(c, i + 1);
      const at: V3 = [a[0] + (e[0] - a[0]) * f, a[1] + (e[1] - a[1]) * f, a[2] + (e[2] - a[2]) * f];
      const tl = Math.hypot(L[o + 4], L[o + 5], L[o + 6]) || 1;
      const k = front ? 1 / tl : -1 / tl;
      // Behind when its tip leans away from the camera.
      const n: V3 = [L[o + 4] * k, L[o + 5] * k, L[o + 6] * k];
      b.strokeMode(
        [at[0] + L[o + 1], at[1] + L[o + 2], at[2] + L[o + 3]],
        [at[0] + L[o + 4], at[1] + L[o + 5], at[2] + L[o + 6]],
        [leafLen * 0.55, 0, 0.8],
        0,
        col[0],
        col[1],
        [0, 0, 0, 0],
        { ca: at, cb: at, na: n, thr: 0, pa: m, pb: m, win: [leaves, Infinity] },
      );
    }
  };

  // Far off, a band of green for the leaves; nearer, a narrower shadow
  // among them.
  const s0 = b.strokes;
  const shadow = pal(C.sleeve, G.sleeve);
  const band = pal(C.leaf[1], G.leaf[1]);
  for (const c of canes) {
    const k = c.r[4] * 2 + leafLen * 1.2;
    for (let i = 0; i < 8; i++) {
      ribbon(c, i, k * 0.3, k * 0.3, 0.5, shadow, [leaves, sleeve]);
      ribbon(c, i, k * 0.5, k * 0.5, 0.5, band, [0, leaves]);
    }
  }
  b.strokeRun(s0, 0, undefined, 0, solid);
  // The leaves behind each cane.
  const s1 = b.strokes;
  const back = pal(C.leafBack, G.leafBack);
  for (const c of canes) leafRun(c, false, -1, back);
  b.strokeRun(s1, 0, undefined, 0, { ...solid, cull: 2 });
  // The bark, tapering; close up, its lit side.
  const s2 = b.strokes;
  const bark = pal(C.bark, G.bark);
  for (const c of canes) for (let i = 0; i < 8; i++) ribbon(c, i, c.r[i], c.r[i + 1], 0.45, bark, ALL);
  b.strokeRun(s2, 0, undefined, 0, solid);
  const s3 = b.strokes;
  const lit = pal(C.barkLit, G.barkLit);
  for (const c of canes) {
    const w = c.r[4] * 0.25;
    for (let i = 0; i < 8; i++) ribbon(c, i, w, w, 0, lit, [2.5 / c.r[2], Infinity], [c.r[i] * 0.45, c.r[i + 1] * 0.45]);
  }
  b.strokeRun(s3, 0, undefined, 0, solid);
  // The leaves in front, a tone at a time.
  const s4 = b.strokes;
  for (const c of canes) for (let t = 0; t < 5; t++) leafRun(c, true, t, pal(C.leaf[t], G.leaf[t]));
  b.strokeRun(s4, 0, undefined, 0, { ...solid, cull: 2 });

  // The flower spikes: close up the tubes, the shaded then the lit; far
  // off a flame on the end of the cane, never under a pixel and a bit.
  const s5 = b.strokes;
  const flower = pal(C.flower, G.flower);
  const flowerLit = pal(C.flowerLit, G.flowerLit);
  for (const c of canes) {
    if (!c.spike) continue;
    const m = mid(c);
    const tip = pt(c, 8);
    const prev = pt(c, 7);
    const on: V3 = [tip[0] * 2 - prev[0], tip[1] * 2 - prev[1], tip[2] * 2 - prev[2]];
    b.strokeMode(tip, on, [c.spike * 0.3, 0, 1.4], 7, flowerLit[0], flowerLit[1], [c.spike, 2.5, 0, 0], {
      ca: tip,
      cb: tip,
      pa: m,
      pb: m,
      win: [0, 2 / tube],
    });
    const F = c.flowers;
    for (const l of [0, 1]) {
      const col = l ? flowerLit : flower;
      for (let o = 0; o < F.length; o += 7) {
        if (F[o + 6] !== l) continue;
        b.strokeMode(
          [tip[0] + F[o], tip[1] + F[o + 1], tip[2] + F[o + 2]],
          [tip[0] + F[o + 3], tip[1] + F[o + 4], tip[2] + F[o + 5]],
          [tube * 0.45, 0, 0.8],
          0,
          col[0],
          col[1],
          [1, 0, 0, 0],
          { ca: tip, cb: tip, pa: m, pb: m, win: [2 / tube, Infinity] },
        );
      }
    }
  }
  b.strokeRun(s5, 0, undefined, 0, { local: foot, atK: true, flat: true });
}
