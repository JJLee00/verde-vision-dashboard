// The cacti and agaves as the WebGL layer draws them: each grown by the
// grower the canvas uses (see each species' `draw…Body` in LivingBlueprint)
// and placed as the canvas places it — through the camera's local map at
// the plant, each ring of a stem from its own centre — with the details it
// adds only once they'd show.
//
// Unlike the shrubs and trees these are solids, their faces turned toward
// the eye: the canvas sorts them far to near, and here the depth buffer
// does. Felt, spines, margins and teeth go over the faces they lie on, as
// the canvas draws them after.

import { FENCE_POST_COLOURS, FENCE_POST_GOLD, FP_RIBS, FP_TONES, growFencePost } from "../bodies/fencePost";
import { OP_BANDS, OP_PTS, OP_TONES, ORGAN_PIPE_COLOURS, ORGAN_PIPE_GOLD, growOrganPipe } from "../bodies/organPipe";
import { TOOTHPICK_COLOURS, TOOTHPICK_GOLD, TP_PTS, TP_TONES, growToothpick } from "../bodies/toothpick";
import { TOTEM_COLOURS, TOTEM_GOLD, TT_N, TT_TONES, growTotem } from "../bodies/totem";
import { GB_RIBS, GB_ST, GOLDEN_BARREL_COLOURS, GOLDEN_BARREL_GOLD, growGoldenBarrel } from "../bodies/goldenBarrel";
import { BG_FACE_LINES, BG_MODEL, BG_PTS, BG_SPLIT, BG_TONES, BLUE_GLOW_COLOURS, BLUE_GLOW_GOLD, growBlueGlow } from "../bodies/blueGlow";
import { BLACK_TIP_COLOURS, BLACK_TIP_GOLD, BT_FACE_LINES, BT_PTS, BT_TONES, growBlackTip } from "../bodies/blackTip";
import { TA_LEAVES, TA_PTS, TA_STRIPE, TA_TONES, TROPICAL_AGAVE_COLOURS, TROPICAL_AGAVE_GOLD, growTropicalAgave } from "../bodies/tropicalAgave";
import { AM_DEAD, AM_DEAD_PTS, AM_FACE_LINES, AM_PTS, AM_TEETH, AM_TONES, AMERICANA_COLOURS, AMERICANA_GOLD, growAmericana } from "../bodies/americana";
import { TC_DOME, TC_FACE_LINES, TC_MODEL, TC_PTS, TC_SPLIT, TC_TEETH, TC_TONES, TRUNCATA_COLOURS, TRUNCATA_GOLD, growTruncata } from "../bodies/truncata";
import { hull3, rgb3, rgba, type Rgba } from "./geom";
import type { Cam, MeshBuilder } from "./mesh";

type V3 = [number, number, number];
/** A colour and its gold (selected) colour. */
type Pal = [Rgba, Rgba];

/** The cacti and agaves the layer can draw. */
export const SUCCULENT_MODELS = new Set([
  "MexicanFencePost",
  "OrganPipe",
  "ArgentineToothpick",
  "TotemPole",
  "GoldenBarrel",
  "BlueGlowAgave",
  "BlackTipAgave",
  "TropicalAgave",
  "AgaveAmericana",
  "AgaveTruncata",
]);

/** Lays out the cactus or agave `model`, if it's one. */
export function buildSucculent(b: MeshBuilder, model: string, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  if (model === "MexicanFencePost") fencePost(b, x, z, h, rot);
  else if (model === "OrganPipe") organPipe(b, x, z, h, rot);
  else if (model === "ArgentineToothpick") toothpick(b, x, z, h, rot);
  else if (model === "TotemPole") totem(b, x, z, h, rot);
  else if (model === "GoldenBarrel") goldenBarrel(b, x, z, h, rw, rot, id);
  else if (model === "BlueGlowAgave") blueGlow(b, x, z, h, rw, rot);
  else if (model === "BlackTipAgave") blackTip(b, x, z, h, rw, rot);
  else if (model === "TropicalAgave") tropical(b, x, z, h, rot);
  else if (model === "AgaveAmericana") americana(b, x, z, h, rot);
  else if (model === "AgaveTruncata") truncata(b, x, z, h, rot);
}

const at3 = (a: ArrayLike<number>, o: number): V3 => [a[o], a[o + 1], a[o + 2]];
const add = (a: ArrayLike<number>, d: ArrayLike<number>, k = 1): V3 => [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k];
const lerp = (a: ArrayLike<number>, c: ArrayLike<number>, t: number): V3 => [
  a[0] + (c[0] - a[0]) * t,
  a[1] + (c[1] - a[1]) * t,
  a[2] + (c[2] - a[2]) * t,
];
const pal = (c: string, g: string): Pal => [rgba(c), rgba(g)];

/** How long a foot along x, y or z is on screen at a point — a column of
 *  the canvas's local map there. */
function step(cam: Cam, p: ArrayLike<number>, axis: 0 | 1 | 2) {
  const q = cam.P(p[0], p[1], p[2]);
  const e = cam.P(p[0] + (axis === 0 ? 1 : 0), p[1] + (axis === 1 ? 1 : 0), p[2] + (axis === 2 ? 1 : 0));
  return Math.hypot(e[0] - q[0], e[1] - q[1]);
}
/** The canvas's `footPx` at a plant's foot: the longest of the three. */
const footPx = (cam: Cam, p: ArrayLike<number>) => Math.max(step(cam, p, 0), step(cam, p, 1), step(cam, p, 2));

/** A strip of quads between two lines of points: one face, passed over on
 *  the far side of `face` (its normal, through its middle). */
function strip(b: MeshBuilder, la: V3[], lb: V3[], c: Pal, at: V3, face?: { n: ArrayLike<number>; c: ArrayLike<number> }) {
  const base = b.verts;
  for (let i = 0; i < la.length; i++) {
    b.vert(la[i][0], la[i][1], la[i][2], c[0], c[1], face?.n, face?.c, at);
    b.vert(lb[i][0], lb[i][1], lb[i][2], c[0], c[1], face?.n, face?.c, at);
  }
  for (let i = 0; i + 1 < la.length; i++) {
    const a = base + i * 2;
    b.tri.push(a, a + 2, a + 3, a, a + 3, a + 1);
  }
}

/** The solid hull of points, each placed from its centre in `ats`: what
 *  the canvas fills as the outline of their places on screen. */
function hull(b: MeshBuilder, pts: V3[], ats: V3[], c: Pal) {
  const base = b.verts;
  pts.forEach((p, k) => b.vert(p[0], p[1], p[2], c[0], c[1], undefined, undefined, ats[k]));
  for (const i of hull3(pts)) b.tri.push(base + i);
}

/** A ribbed stem's faces, band by band: ring `l`'s point `j` at `pt(l, j)`,
 *  placed from `centre(l)`, the last band closing on the apex. Each face
 *  is passed over on the far side of `mid`. */
function bands(
  b: MeshBuilder,
  n: number,
  pts: number,
  pt: (l: number, j: number) => V3,
  centre: (l: number) => V3,
  faceN: Float32Array,
  faceTone: Uint8Array,
  tones: string[][],
  mid: V3,
) {
  for (let f = 0; f < n * pts; f++) {
    const band = (f / pts) | 0;
    const j = f % pts;
    const t = faceTone[f];
    const c = pal(tones[0][t], tones[1][t]);
    const nf = faceN.subarray(f * 3, f * 3 + 3);
    const v = (l: number, k: number) => {
      const p = pt(l, k);
      return b.vert(p[0], p[1], p[2], c[0], c[1], nf, mid, centre(l));
    };
    if (band === n - 1) b.tri.push(v(band, j), v(band, j + 1), v(n, 0));
    else {
      const a = v(band, j);
      const d = v(band, j + 1);
      const e = v(band + 1, j + 1);
      const k = v(band + 1, j);
      b.tri.push(a, d, e, a, e, k);
    }
  }
}

/* ── cacti ── */

function fencePost(b: MeshBuilder, x: number, z: number, h: number, rot: number) {
  const g = growFencePost(x, z, h, rot);
  const felt = pal(FENCE_POST_COLOURS.felt, FENCE_POST_GOLD.felt);
  const feltShade = pal(FENCE_POST_COLOURS.feltShade, FENCE_POST_GOLD.feltShade);
  for (const st of g.stems) {
    const foot: V3 = [st.sx, 0, st.sz];
    const mid: V3 = [st.sx, st.ys[1] * 0.5, st.sz];
    const centre = (l: number): V3 => [st.sx, st.ys[l], st.sz];
    const pt = (l: number, j: number): V3 => {
      if (l === 4) return centre(4);
      const i = l * 12 + (j % 12);
      return [st.sx + st.ring[i * 2], st.ys[l], st.sz + st.ring[i * 2 + 1]];
    };
    const t0 = b.tri.length;
    bands(b, 4, 12, pt, centre, st.faceN, st.faceTone, FP_TONES, mid);
    b.tris(t0, true, true, { local: foot });
    // The felt down each crest wherever a face beside it shows: the shaded
    // crests', then the lit ones'.
    const face = (f: number) => st.faceN.subarray(f * 3, f * 3 + 3);
    for (const lit of [0, 1]) {
      const s0 = b.strokes;
      const c = lit ? felt : feltShade;
      for (let k = 0; k < FP_RIBS; k++) {
        if (st.crestLit[k] !== lit) continue;
        const j = 2 * k;
        const jl = (j + 11) % 12;
        for (let band = 0; band < 4; band++) {
          b.strokeX(pt(band, j), pt(band + 1, j), [0.12, 0, 0.7], c[0], c[1], {
            round: true,
            ca: centre(band),
            cb: centre(band + 1),
            na: face(band * 12 + j),
            nb: face(band * 12 + jl),
            pa: mid,
            pb: mid,
          });
        }
      }
      b.strokeRun(s0, b.once(), undefined, 0, { local: foot, cull: 1, wbias: 2, frame: (cam) => ({ foot: cam.ft(st.sx, st.sz) }) });
    }
  }
}

function organPipe(b: MeshBuilder, x: number, z: number, h: number, rot: number) {
  const g = growOrganPipe(x, z, h, rot);
  const dark = pal(OP_TONES[0][0], OP_TONES[1][0]);
  const spines = pal(ORGAN_PIPE_COLOURS.spines, ORGAN_PIPE_GOLD.spines);
  for (const st of g.stems) {
    const centre = (l: number) => at3(st.axis, l * 3);
    const foot = centre(0);
    const mid = centre(1);
    const pt = (l: number, j: number): V3 => {
      if (l === 5) return centre(5);
      const i = l * OP_PTS + (j % OP_PTS);
      return add(centre(l), [st.ring[i * 2], 0, st.ring[i * 2 + 1]]);
    };
    // Its silhouette, dark, so the seams read as the grooves they are: the
    // outline of the three lower rings and the apex. Written in depth at
    // the stem's axis — behind its own faces, in front of a stem behind.
    const t0 = b.tri.length;
    const pts: V3[] = [];
    const ats: V3[] = [];
    for (let l = 0; l < 3; l++) {
      for (let j = 0; j < OP_PTS; j++) {
        pts.push(pt(l, j));
        ats.push(centre(l));
      }
    }
    pts.push(centre(5));
    ats.push(centre(5));
    hull(b, pts, ats, dark);
    b.tris(t0, true, false, { local: foot, offset: 0, bias: -st.r });
    const t1 = b.tri.length;
    bands(b, OP_BANDS, OP_PTS, pt, centre, st.faceN, st.faceTone, OP_TONES, mid);
    b.tris(t1, true, true, { local: foot });
    // Spine clusters every few inches down each rib, close up only: specks
    // a little off their spacing, by a hash of rib and place, along the
    // rib's line on screen from its foot to its shoulder. That line runs
    // inside the stem where it swells between, so they're drawn a radius
    // nearer: over the stem, as the canvas lays them, short of one before.
    const s0 = b.strokes;
    const n = Math.max(2, Math.round((st.axis[7] - st.axis[1]) / 0.3));
    for (let j = 0; j < OP_PTS; j += 2) {
      const jl = (j + OP_PTS - 1) % OP_PTS;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5 + 0.35 * Math.sin(k * 12.9898 + j * 78.233)) / n;
        b.strokeMode(pt(0, j), pt(2, j), [0.07, 0, 0.8], 4, spines[0], spines[1], [t, 0, 0, 0], {
          ca: centre(0),
          cb: centre(2),
          na: st.faceN.subarray(j * 3, j * 3 + 3),
          nb: st.faceN.subarray(jl * 3, jl * 3 + 3),
          pa: mid,
          pb: mid,
        });
      }
    }
    b.strokeRun(s0, b.once(), undefined, st.r, {
      local: foot,
      cull: 1,
      frame: (cam) => ({ show: step(cam, foot, 0) * st.r > 7, foot: cam.ft(foot[0], foot[2]) }),
    });
  }
}

function toothpick(b: MeshBuilder, x: number, z: number, h: number, rot: number) {
  const g = growToothpick(x, z, h, rot);
  const spine = pal(TOOTHPICK_COLOURS.spine, TOOTHPICK_GOLD.spine);
  const tuft = pal(TOOTHPICK_COLOURS.tuft, TOOTHPICK_GOLD.tuft);
  const SPINE = 0.22;
  for (const lb of g.limbs) {
    const R = lb.rings;
    const centre = (k: number) => at3(lb.c, k * 3);
    const base = centre(0);
    const mid = centre(Math.min(R - 1, R >> 1));
    const off = (k: number, j: number) => at3(lb.o, (k * TP_PTS + (j % TP_PTS)) * 3);
    const pt = (k: number, j: number): V3 => (k === R ? centre(R) : add(centre(k), off(k, j)));
    const face = (f: number) => lb.faceN.subarray(f * 3, f * 3 + 3);
    const t0 = b.tri.length;
    bands(b, R, TP_PTS, pt, centre, lb.faceN, lb.faceTone, TP_TONES, mid);
    b.tris(t0, true, true, { local: base });
    // The spines, close enough to see them: three out of each areole, every
    // few inches down every rib that shows — one straight out, one tipped
    // toward the limb's end, one across — a small star.
    const s0 = b.strokes;
    for (let band = 0; band < lb.shaft - 1; band++) {
      const tan = [0, 1, 2].map((q) => lb.c[(band + 1) * 3 + q] - lb.c[band * 3 + q]);
      const len = Math.hypot(tan[0], tan[1], tan[2]) || 1;
      const n = Math.max(1, Math.round(len / 0.3));
      const k1 = (SPINE * 0.8) / len;
      for (let j = 0; j < TP_PTS; j += 2) {
        const o0 = off(band, j);
        const ol = Math.hypot(o0[0], o0[1], o0[2]) || 1;
        const nn = o0.map((v) => v / ol);
        const o2 = off(band, j + 2);
        const w = o2.map((v, q) => (v - o0[q]) / ol);
        const rays = [
          nn.map((v) => v * SPINE),
          nn.map((v, q) => v * SPINE * 0.6 + tan[q] * k1),
          nn.map((v, q) => (v * 0.6 + w[q] * 0.7) * SPINE),
        ];
        const na = face(band * TP_PTS + j);
        const nb = face(band * TP_PTS + ((j + TP_PTS - 1) % TP_PTS));
        for (let k = 0; k < n; k++) {
          const t = (k + (j % 4 ? 0.75 : 0.25)) / n;
          const p = lerp(pt(band, j), pt(band + 1, j), t);
          const c = lerp(centre(band), centre(band + 1), t);
          for (const ray of rays) {
            b.strokeX(p, add(p, ray), [0.02, 0, 0.6], spine[0], spine[1], { round: true, ca: c, cb: c, na, nb, pa: mid, pb: mid });
          }
        }
      }
    }
    b.strokeRun(s0, b.once(), undefined, 0, { local: base, wbias: 2, cull: 1, frame: (cam) => ({ show: step(cam, base, 0) * lb.r > 3.5 }) });
    // The crown of spines at the tip, splayed round its line.
    const s1 = b.strokes;
    const [ax, ay, az] = lb.tip;
    const apex = centre(R);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const d: V3 = [(ax * 0.8 + ay * Math.cos(a) * 0.7) * SPINE, (ay * 0.8 - ax * Math.cos(a) * 0.7) * SPINE, (az * 0.8 + Math.sin(a) * 0.7) * SPINE];
      b.strokeX(apex, add(apex, d), [0.025, 0, 0.7], tuft[0], tuft[1], { round: true, ca: apex, cb: apex });
    }
    b.strokeRun(s1, b.once(), undefined, 0, { local: base, wbias: 2, frame: (cam) => ({ show: step(cam, base, 0) * lb.r > 2 }) });
  }
}

function totem(b: MeshBuilder, x: number, z: number, h: number, rot: number) {
  const g = growTotem(x, z, h, rot);
  const { core, k, out, top, tone, lift } = g;
  const mid: V3 = [x, h * 0.5, z];
  const crease = pal(TOTEM_COLOURS.crease, TOTEM_GOLD.crease);
  // The core, dark: what shows in the creases.
  const t0 = b.tri.length;
  const pts: V3[] = [];
  const ats: V3[] = [];
  for (let i = 0; i < 4; i++) {
    const c = at3(core, i * 4);
    const r = core[i * 4 + 3];
    for (let j = 0; j < 12; j++) {
      pts.push([c[0] + Math.cos((j * Math.PI) / 6) * r, c[1], c[2] + Math.sin((j * Math.PI) / 6) * r]);
      ats.push(c);
    }
  }
  pts.push(at3(core, 16));
  ats.push(at3(core, 16));
  hull(b, pts, ats, crease);
  b.tris(t0, false, false, { local: mid });
  // The knobs that face the eye, and those just round the edge that make
  // its lumpy outline, near over far: each the shadow it casts just under
  // its foot, itself, and its lit shoulder — as many of those as the stem
  // is big enough to show. Each a hair farther or nearer than the knob, so
  // they stack the canvas's way.
  const hPx = (cam: Cam) => step(cam, mid, 1) * h;
  const knob = (i: number, shift: ArrayLike<number>, s: number, c: Pal, dz: number) => {
    const o = i * 12;
    const n: V3 | null = top[i] ? null : [out[i * 2], 0, out[i * 2 + 1]];
    const ax = (q: number): V3 => [k[o + q] * s, k[o + q + 1] * s, k[o + q + 2] * s];
    b.ellipse(at3(k, o), shift, ax(3), ax(6), ax(9), c[0], c[1], n, -0.25, dz);
  };
  const e0 = b.ellipses;
  for (let i = 0; i < TT_N - 1; i++) {
    const drop = Math.max(Math.abs(k[i * 12 + 7]) * 0.3, Math.abs(k[i * 12 + 10]) * 0.8);
    knob(i, [0, -drop, 0], 0.9, crease, 0.004);
  }
  b.ellipseRun(e0, { local: mid, frame: (cam) => ({ show: hPx(cam) > 24 }) });
  const e1 = b.ellipses;
  for (let i = 0; i < TT_N; i++) knob(i, [0, 0, 0], 1, pal(TT_TONES[0][tone[i * 2]], TT_TONES[1][tone[i * 2]]), 0);
  b.ellipseRun(e1, { local: mid });
  const e2 = b.ellipses;
  for (let i = 0; i < TT_N; i++) {
    const t = tone[i * 2 + 1];
    knob(i, [lift[i * 3] * 0.32, lift[i * 3 + 1] * 0.32, lift[i * 3 + 2] * 0.32], 0.62, pal(TT_TONES[0][t], TT_TONES[1][t]), -0.004);
  }
  b.ellipseRun(e2, { local: mid, frame: (cam) => ({ show: hPx(cam) > 70 }) });
}

function goldenBarrel(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const g = growGoldenBarrel(h, rw, rot, id);
  const { ridge, groove, faces, areoles } = g;
  const foot: V3 = [x, 0, z];
  const P = (a: Float32Array, o: number): V3 => [x + a[o], a[o + 1], z + a[o + 2]];
  const C = GOLDEN_BARREL_COLOURS;
  const G = GOLDEN_BARREL_GOLD;
  // How much of the green body shows between the spines: none far off,
  // all of it once the spines are drawn.
  const near = (cam: Cam) => Math.max(0, Math.min(1, (g.step * footPx(cam, foot) - 2) / 4));
  // The flanks toward the camera twice: their far-off gold, then the
  // body's green over it as much as the canvas mixes in.
  for (const pass of ["far", "body"] as const) {
    const t0 = b.tri.length;
    for (let o = 0; o < faces.length; o += 8) {
      const k = faces[o];
      const gk = faces[o + 1] ? (k + GB_RIBS - 1) % GB_RIBS : k;
      const t = Math.min(4, Math.floor(faces[o + 7] * 5));
      const la: V3[] = [];
      const lb: V3[] = [];
      for (let i = faces[o + 2]; i <= faces[o + 3]; i++) {
        la.push(P(ridge, (k * GB_ST + i) * 3));
        lb.push(P(groove, (gk * GB_ST + i) * 3));
      }
      strip(b, la, lb, [rgb3(C[pass][t]), rgb3(G[pass][t])], foot, { n: faces.subarray(o + 4, o + 7), c: [0, 0, 0] });
    }
    if (pass === "far") b.tris(t0, true, 2, { local: foot });
    else b.tris(t0, false, 2, { local: foot, frame: (cam) => ({ show: near(cam) > 0, alpha: near(cam) }) });
  }
  // Grooves dark and ridges pale (the rows of spines) on the near side,
  // over the flanks.
  const facing = (k: number, i: number): V3 => {
    const o = (k * GB_ST + i) * 3;
    const rl = Math.hypot(ridge[o], ridge[o + 2]) || 1;
    return [ridge[o] / rl, 0.4, ridge[o + 2] / rl];
  };
  const lines = (pts: Float32Array, c: Pal, w: number) => {
    const s0 = b.strokes;
    for (let k = 0; k < GB_RIBS; k++) {
      for (let i = 0; i + 1 < GB_ST; i++) {
        const o = (k * GB_ST + i) * 3;
        b.strokeX(P(pts, o), P(pts, o + 3), [w, 0, 0.6], c[0], c[1], {
          round: true,
          ca: foot,
          cb: foot,
          na: facing(k, i),
          nb: facing(k, i + 1),
          thr: -0.05,
        });
      }
    }
    return s0;
  };
  const s0 = lines(groove, pal(C.groove, G.groove), rw * 0.025);
  b.strokeRun(s0, b.once(), undefined, rw, { local: foot, cull: 2, frame: (cam) => ({ foot: footPx(cam, foot) }) });
  const s1 = lines(ridge, pal(C.ridge, G.ridge), rw * 0.03);
  b.strokeRun(s1, b.once(), undefined, rw, {
    local: foot,
    cull: 2,
    frame: (cam) => {
      const n = near(cam);
      return { show: n < 1, alpha: (1 - n) * 0.55, foot: footPx(cam, foot) };
    },
  });
  // The crown: a ragged cushion of cream wool, paler where it's newest.
  const cap = (y: number, r: number, c: Pal) => {
    const t0 = b.tri.length;
    const base = b.verts;
    b.vert(x, y * h, z, c[0], c[1], undefined, undefined, foot);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rr = r * rw * (1 + 0.09 * Math.sin(a * 5 + rot * 3) + (i % 2 ? 0.1 : -0.06));
      b.vert(x + Math.cos(a) * rr, y * h, z + Math.sin(a) * rr, c[0], c[1], undefined, undefined, foot);
      b.tri.push(base, base + 1 + i, base + 1 + ((i + 1) % 26));
    }
    b.tris(t0, false, false, { local: foot, bias: rw });
  };
  cap(0.93, 0.34, pal(C.crown, G.crown));
  cap(0.985, 0.12, pal(C.crownHeart, G.crownHeart));
  // Close up, a tuft of spines at every areole on the near side, the shaded
  // ones then the lit ones; then the woolly areoles themselves.
  const A = 6 + 21;
  const close = (cam: Cam) => {
    const f = footPx(cam, foot);
    return { show: g.step * f >= 2, foot: f };
  };
  for (const lit of [0, 1]) {
    const s = b.strokes;
    const c = lit ? pal(C.spineLit, G.spineLit) : pal(C.spine, G.spine);
    for (let o = 0; o < areoles.length; o += A) {
      const n = areoles.subarray(o + 3, o + 6);
      if ((n[0] * -0.44 + n[1] * 0.79 + n[2] * -0.43 > 0.15 ? 1 : 0) !== lit) continue;
      for (let k = 0; k < 7; k++) {
        b.strokeX(P(areoles, o), P(areoles, o + 6 + k * 3), [g.spine * 0.065, 0, 0.5], c[0], c[1], { round: true, ca: foot, cb: foot, na: n, thr: 0.05 });
      }
    }
    // Each spine on its own: inked once together, a pixel crossed by many
    // thin ones took only the first's share of it, where the canvas's one
    // stroke of them all fills it.
    b.strokeRun(s, 0, undefined, rw, { local: foot, cull: 2, frame: close });
  }
  const s2 = b.strokes;
  const wool = pal(C.wool, G.wool);
  for (let o = 0; o < areoles.length; o += A) {
    const p = P(areoles, o);
    b.strokeX(p, p, [g.step * 0.32, 0, 1.2], wool[0], wool[1], { round: true, ca: foot, cb: foot, na: areoles.subarray(o + 3, o + 6), thr: 0.05 });
  }
  b.strokeRun(s2, b.once(), undefined, rw, { local: foot, cull: 2, frame: close });
}

/* ── agaves ── */

/** An agave's leaves as its grower lays them out: four lines down each
 *  leaf (`pts` stations of four points), each face's normal, middle and
 *  tone, and where the leaves are measured from. */
type Leaves = {
  leaf: Float32Array;
  pts: number;
  faceN: Float32Array;
  faceMid: Float32Array;
  faceTone: Uint8Array;
  /** where the local map is taken */
  at: V3;
  /** what the grower's offsets are from: the foot, or none (world) */
  o: V3;
};
const linePt = (L: Leaves, i: number, j: number, line: number) => add(L.o, at3(L.leaf, (i * L.pts + j) * 12 + line * 3));
const faceAt = (L: Leaves, it: number) => ({ n: L.faceN.subarray(it * 3, it * 3 + 3), c: add(L.o, at3(L.faceMid, it * 3)) });

/** A face of a leaf: the strip between its two lines, station j0 to j1. */
function leafFace(b: MeshBuilder, L: Leaves, tones: string[][], it: number, i: number, lines: readonly number[], j0: number, j1: number) {
  const A: V3[] = [];
  const B: V3[] = [];
  for (let j = j0; j <= j1; j++) {
    A.push(linePt(L, i, j, lines[0]));
    B.push(linePt(L, i, j, lines[1]));
  }
  const t = L.faceTone[it];
  strip(b, A, B, pal(tones[0][t], tones[1][t]), L.at, faceAt(L, it));
}
/** A margin down a leaf's line, station j0 to j1, shown where either face
 *  beside it is (`fa`, `fb`). */
function margin(b: MeshBuilder, L: Leaves, i: number, line: number, j0: number, j1: number, fa: number, fb: number, w: number, c: Pal) {
  const a = faceAt(L, fa);
  const d = faceAt(L, fb);
  for (let j = j0; j < j1; j++) {
    b.strokeX(linePt(L, i, j, line), linePt(L, i, j + 1, line), [w, 0, 0.6], c[0], c[1], {
      round: true,
      ca: L.at,
      cb: L.at,
      na: a.n,
      nb: d.n,
      pa: a.c,
      pb: d.c,
    });
  }
}
/** A tooth off a margin, hooked toward the tip, where either face beside
 *  the margin shows: laid once on each face's terms (it's opaque, so twice
 *  is no different). */
function tooth(b: MeshBuilder, L: Leaves, list: Float32Array, o: number, fa: number, fb: number, c: Pal) {
  const m = add(L.o, at3(list, o));
  const out = at3(list, o + 3);
  const a = at3(list, o + 6);
  for (const f of [fa, fb]) {
    const face = faceAt(L, f);
    const base = b.verts;
    for (const p of [add(m, a, -1), add(m, a), add(add(m, out), a, 0.8)]) b.vert(p[0], p[1], p[2], c[0], c[1], face.n, face.c, L.at);
    b.tri.push(base, base + 1, base + 2);
  }
}
/** A leaf's spine — or a thorn, broad where it leaves the leaf. Drawn in
 *  paint order, it goes with the nearer of the leaf's faces `fa` and `fb`. */
function spineOf(b: MeshBuilder, L: Leaves, spine: Float32Array, i: number, w: [number, number, number], c: Pal, thorn = false, fa?: number, fb?: number) {
  const a = fa === undefined ? undefined : faceAt(L, fa);
  const d = fb === undefined ? undefined : faceAt(L, fb);
  b.strokeX(add(L.o, at3(spine, i * 6)), add(L.o, at3(spine, i * 6 + 3)), w, c[0], c[1], {
    round: !thorn,
    thorn,
    ca: L.at,
    cb: L.at,
    na: a?.n,
    nb: d?.n,
    pa: a?.c,
    pb: d?.c,
  });
}

function blueGlow(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number) {
  const g = growBlueGlow(h, rw, rot);
  const foot: V3 = [x, 0, z];
  const C = BLUE_GLOW_COLOURS;
  const G = BLUE_GLOW_GOLD;
  const size = (cam: Cam) => footPx(cam, foot) * h;
  const leaves = BG_MODEL.kind.length;
  // The dark heart: a cone from the stem out under the leaves' bases.
  const t0 = b.tri.length;
  const pts: V3[] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    for (const [y, r] of [
      [0.02, 0.2],
      [0.28, 0.28],
    ]) {
      pts.push([x + Math.cos(a) * r * rw, y * h, z + Math.sin(a) * r * rw]);
    }
  }
  hull(b, pts, pts.map(() => foot), pal(C.core, G.core));
  b.tris(t0, false, false, { local: foot });
  // Each leaf's four faces, each cut in two along the leaf.
  const L: Leaves = { leaf: g.leaf, pts: BG_PTS, faceN: g.faceN, faceMid: g.faceMid, faceTone: g.faceTone, at: foot, o: foot };
  const half = (s: number) => (s ? [BG_SPLIT, BG_PTS - 1] : [0, BG_SPLIT]);
  const t1 = b.tri.length;
  for (let i = 0; i < leaves; i++) {
    for (let f = 0; f < 4; f++) {
      for (let s = 0; s < 2; s++) leafFace(b, L, BG_TONES, (i * 4 + f) * 2 + s, i, BG_FACE_LINES[f], half(s)[0], half(s)[1]);
    }
  }
  b.tris(t1, true, true, { local: foot });
  // The red margin, once it's big enough to show (not on the dead leaves);
  // the spine at each tip.
  const s0 = b.strokes;
  for (let i = 0; i < leaves; i++) {
    if (BG_MODEL.kind[i] === 3) continue;
    for (let s = 0; s < 2; s++) {
      for (const line of [1, 2]) {
        const [j0, j1] = half(s);
        margin(b, L, i, line, j0, j1, (i * 4 + line - 1) * 2 + s, (i * 4 + line + 1) * 2 + s, h * 0.003, pal(C.margin, G.margin));
      }
    }
  }
  b.strokeRun(s0, b.once(), undefined, 0, { local: foot, wbias: 2, cull: 1, frame: (cam) => ({ show: size(cam) > 120, foot: footPx(cam, foot) }) });
  const s1 = b.strokes;
  for (let i = 0; i < leaves; i++) spineOf(b, L, g.spine, i, [h * 0.006, 0, 0.7], pal(C.spine, G.spine));
  b.strokeRun(s1, 0, undefined, 0, { local: foot, wbias: 2, frame: (cam) => ({ show: size(cam) > 30, foot: footPx(cam, foot) }) });
}

function blackTip(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number) {
  const g = growBlackTip(h, rw, rot);
  const foot: V3 = [x, 0, z];
  const C = BLACK_TIP_COLOURS;
  const G = BLACK_TIP_GOLD;
  const size = (cam: Cam) => footPx(cam, foot) * h;
  const leaves = g.faceTone.length / 4;
  // The dark dome inside, a little inside the tips.
  const t0 = b.tri.length;
  const pts: V3[] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    for (let l = 0; l < 5; l++) {
      const p = (l / 4) * (Math.PI / 2);
      pts.push([x + Math.cos(a) * Math.cos(p) * 0.45 * rw, (0.08 + Math.sin(p) * 0.52) * h, z + Math.sin(a) * Math.cos(p) * 0.45 * rw]);
    }
  }
  hull(b, pts, pts.map(() => foot), pal(C.core, G.core));
  b.tris(t0, false, false, { local: foot });
  const L: Leaves = { leaf: g.leaf, pts: BT_PTS, faceN: g.faceN, faceMid: g.faceMid, faceTone: g.faceTone, at: foot, o: foot };
  const t1 = b.tri.length;
  for (let i = 0; i < leaves; i++) for (let f = 0; f < 4; f++) leafFace(b, L, BT_TONES, i * 4 + f, i, BT_FACE_LINES[f], 0, BT_PTS - 1);
  b.tris(t1, true, true, { local: foot });
  const s0 = b.strokes;
  for (let i = 0; i < leaves; i++) {
    for (const line of [1, 2]) margin(b, L, i, line, 0, BT_PTS - 1, i * 4 + line - 1, i * 4 + line + 1, h * 0.003, pal(C.margin, G.margin));
  }
  b.strokeRun(s0, b.once(), undefined, 0, { local: foot, wbias: 2, cull: 1, frame: (cam) => ({ show: size(cam) > 120, foot: footPx(cam, foot) }) });
  const s1 = b.strokes;
  for (let i = 0; i < leaves; i++) spineOf(b, L, g.spine, i, [h * 0.004, 0, 0.6], pal(C.spine, G.spine));
  b.strokeRun(s1, 0, undefined, 0, { local: foot, wbias: 2, frame: (cam) => ({ show: size(cam) > 60, foot: footPx(cam, foot) }) });
}

/** A ribbon down a centre line, `wide` of its half-widths either side:
 *  laid twice, one for each face — each passed over when the other faces
 *  the eye. */
function ribbon(b: MeshBuilder, line: Float32Array, o0: number, pts: number, wide: number, at: V3, n: V3, mid: V3, up: Pal, down: Pal) {
  const A: V3[] = [];
  const B: V3[] = [];
  for (let j = 0; j < pts; j++) {
    const o = o0 + j * 6;
    A.push([line[o] + line[o + 3] * wide, line[o + 1] + line[o + 4] * wide, line[o + 2] + line[o + 5] * wide]);
    B.push([line[o] - line[o + 3] * wide, line[o + 1] - line[o + 4] * wide, line[o + 2] - line[o + 5] * wide]);
  }
  strip(b, A, B, up, at, { n, c: mid });
  strip(b, A, B, down, at, { n: [-n[0], -n[1], -n[2]], c: mid });
}

function tropical(b: MeshBuilder, x: number, z: number, h: number, rot: number) {
  const g = growTropicalAgave(x, z, h, rot);
  const { leaf, mid, leafN, leafTone, heart } = g;
  const at = at3(heart, 0);
  const tone = (t: number): Pal => pal(TA_TONES[0][t], TA_TONES[1][t]);
  // Each leaf cream, then its green stripe over it — on both faces, or the
  // upright leaves' backs merge into one flat blob. They cross at the
  // heart, and go down in the canvas's far-to-near order (see `flat`).
  for (const k of [0, 1]) {
    const t0 = b.tri.length;
    for (let i = 0; i < TA_LEAVES; i++) {
      const T = leafTone.subarray(i * 4, i * 4 + 4);
      ribbon(b, leaf, i * TA_PTS * 6, TA_PTS, k ? TA_STRIPE : 1, at, at3(leafN, i * 3), at3(mid, i * 3), tone(T[k]), tone(T[2 + k]));
    }
    b.tris(t0, true, true, { local: at, flat: true, offset: k ? 0 : 1 });
  }
  // Close up, the small dark spine on past each tip, along its last stretch.
  const s0 = b.strokes;
  const sp = pal(TROPICAL_AGAVE_COLOURS.spine, TROPICAL_AGAVE_GOLD.spine);
  for (let i = 0; i < TA_LEAVES; i++) {
    const a = at3(leaf, (i * TA_PTS + TA_PTS - 2) * 6);
    const e = at3(leaf, (i * TA_PTS + TA_PTS - 1) * 6);
    const u = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
    b.strokeX(add(e, u, -0.15), add(e, u, 0.1), [h * 0.004, 0, 0.8], sp[0], sp[1], { round: true, ca: at, cb: at, pa: at3(mid, i * 3) });
  }
  b.strokeRun(s0, 0, undefined, 0.01, {
    local: at,
    flat: true,
    frame: (cam) => {
      const f = step(cam, at, 1);
      return { show: f * h > 250, foot: f };
    },
  });
}

function americana(b: MeshBuilder, x: number, z: number, h: number, rot: number) {
  const g = growAmericana(x, z, h, rot);
  const at = at3(g.core, 0);
  const C = AMERICANA_COLOURS;
  const G = AMERICANA_GOLD;
  const size = (cam: Cam) => step(cam, at, 1) * h;
  // Its broad leaves cross where they crowd at the heart, and the canvas
  // lays them in its far-to-near sort: drawn in that order here too (see
  // `flat`), each part just over the face it goes with.
  const over = 0.01;
  const L: Leaves = { leaf: g.leaf, pts: AM_PTS, faceN: g.faceN, faceMid: g.faceMid, faceTone: g.faceTone, at, o: [0, 0, 0] };
  const leaves = g.faceTone.length / 4;
  const t0 = b.tri.length;
  for (let i = 0; i < leaves; i++) for (let f = 0; f < 4; f++) leafFace(b, L, AM_TONES, i * 4 + f, i, AM_FACE_LINES[f], 0, AM_PTS - 1);
  // The dead leaves on the ground, lit from above, shaded beneath.
  for (let i = 0; i < AM_DEAD; i++) {
    const t = (k: number): Pal => pal(AM_TONES[0][g.deadTone[i * 2 + k]], AM_TONES[1][g.deadTone[i * 2 + k]]);
    ribbon(b, g.dead, i * AM_DEAD_PTS * 6, AM_DEAD_PTS, 1, at, [0, 1, 0], at3(g.deadMid, i * 3), t(0), t(1));
  }
  b.tris(t0, true, true, { local: at, flat: true });
  // The heart, where the leaf bases crowd: dark.
  const e0 = b.ellipses;
  const core = pal(C.core, G.core);
  b.ellipse(at, [0, 0, 0], [0.09 * h, 0, 0], [0, 0, 0], [0, 0, 0], core[0], core[1], null);
  b.ellipseRun(e0, { local: at, mode: 1 });
  // Its margins, teeth and spines, as soon as they'd show.
  const s0 = b.strokes;
  for (let i = 0; i < leaves; i++) {
    for (const line of [1, 2]) margin(b, L, i, line, 0, AM_PTS - 1, i * 4 + line - 1, i * 4 + line + 1, h * 0.0024, pal(C.margin, G.margin));
  }
  b.strokeRun(s0, b.once(), undefined, over, { local: at, flat: true, cull: 1, frame: (cam) => ({ show: size(cam) > 70, foot: step(cam, at, 1) }) });
  const t1 = b.tri.length;
  const teeth = pal(C.teeth, G.teeth);
  for (let i = 0; i < leaves; i++) {
    for (const line of [1, 2]) {
      for (let k = 0; k < AM_TEETH; k++) tooth(b, L, g.teeth, ((i * 2 + line - 1) * AM_TEETH + k) * 9, i * 4 + line - 1, i * 4 + line + 1, teeth);
    }
  }
  b.tris(t1, true, true, { local: at, flat: true, offset: 0, frame: (cam) => ({ show: size(cam) > 140 }) });
  const s1 = b.strokes;
  for (let i = 0; i < leaves; i++) spineOf(b, L, g.spine, i, [h * 0.006, 0, 0.8], pal(C.spine, G.spine), false, i * 4, i * 4 + 1);
  b.strokeRun(s1, 0, undefined, over, { local: at, flat: true, frame: (cam) => ({ show: size(cam) > 70, foot: step(cam, at, 1) }) });
}

function truncata(b: MeshBuilder, x: number, z: number, h: number, rot: number) {
  const g = growTruncata(x, z, h, rot);
  const at = at3(g.core, 0);
  const C = TRUNCATA_COLOURS;
  const G = TRUNCATA_GOLD;
  const size = (cam: Cam) => step(cam, at, 1) * h;
  // The shadowed inside, packed with leaf bases, first: the outline of the
  // dome as seen, so whatever shows between the leaves is dark.
  const t0 = b.tri.length;
  const pts: V3[] = [];
  for (let k = 0; k < TC_DOME.length; k += 3) pts.push([at[0] + TC_DOME[k] * h, TC_DOME[k + 1] * h, at[2] + TC_DOME[k + 2] * h]);
  hull(b, pts, pts.map(() => at), pal(C.core, G.core));
  b.tris(t0, false, false, { local: at });
  // Each leaf's four faces, cut in two along it.
  const L: Leaves = { leaf: g.leaf, pts: TC_PTS, faceN: g.faceN, faceMid: g.faceMid, faceTone: g.faceTone, at, o: [0, 0, 0] };
  const leaves = g.faceTone.length / 8;
  const half = (s: number) => (s ? [TC_SPLIT, TC_PTS - 1] : [0, TC_SPLIT]);
  const face = (i: number, s: number, f: number) => (i * 2 + s) * 4 + f;
  const t1 = b.tri.length;
  for (let i = 0; i < leaves; i++) {
    for (let s = 0; s < 2; s++) for (let f = 0; f < 4; f++) leafFace(b, L, TC_TONES, face(i, s, f), i, TC_FACE_LINES[f], half(s)[0], half(s)[1]);
  }
  b.tris(t1, true, true, { local: at });
  const s0 = b.strokes;
  for (let i = 0; i < leaves; i++) {
    for (let s = 0; s < 2; s++) {
      for (const line of [1, 2]) {
        margin(b, L, i, line, half(s)[0], half(s)[1], face(i, s, line - 1), face(i, s, line + 1), h * 0.004, pal(C.margin, G.margin));
      }
    }
  }
  b.strokeRun(s0, b.once(), undefined, 0, { local: at, wbias: 2, cull: 1, frame: (cam) => ({ show: size(cam) > 60, foot: step(cam, at, 1) }) });
  const t2 = b.tri.length;
  const teeth = pal(C.teeth, G.teeth);
  for (let i = 0; i < leaves; i++) {
    for (const line of [1, 2]) {
      for (let k = 0; k < TC_TEETH; k++) {
        const n = (i * 2 + line - 1) * TC_TEETH + k;
        const s = TC_MODEL.toothHalf[n];
        tooth(b, L, g.teeth, n * 9, face(i, s, line - 1), face(i, s, line + 1), teeth);
      }
    }
  }
  b.tris(t2, true, true, { local: at, offset: 0, frame: (cam) => ({ show: size(cam) > 130 }) });
  // A thorn at every tip: broad where it leaves the leaf, to a point.
  const s1 = b.strokes;
  for (let i = 0; i < leaves; i++) spineOf(b, L, g.spine, i, [h * 0.022, 0, 1.2], pal(C.spine, G.spine), true);
  b.strokeRun(s1, 0, undefined, 0, { local: at, wbias: 2, frame: (cam) => ({ foot: step(cam, at, 1) }) });
}
