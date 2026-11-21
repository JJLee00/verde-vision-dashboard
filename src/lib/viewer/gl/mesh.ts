// A plant (or the yard) as the WebGL layer draws it: vertices for its
// filled shapes and their outlines, instances for its strokes, flowers and
// flecks, a tree's lobes of foliage, and the order the canvas paints them
// in. Built once, on the CPU, and kept on the card — but for the lobes,
// which go far first as the camera turns, so are sorted every frame.
// The cacti and agaves add ellipses (an ellipsoid through the local map),
// and their parts placed as the canvas places them: through the camera's
// local map at the plant, by way of a centre each projects exactly.

import type { Rgba } from "./geom";

/** A vertex: xyz floats; its colour and its gold (selected) colour as
 *  bytes; the facing normal of the sprig it's in as signed bytes, and that
 *  normal dotted with the sprig's centre — so the shader passes over a
 *  sprig on the far side as the canvas's `facing()` does; drawn through a
 *  local map, the centre it's placed from; and the sprig's centre itself,
 *  whose depth it takes drawn in paint order (see `Placed`). */
export const VSTRIDE = 52;
/** A stroke: its two ends; width in feet, in line widths and in pixels at
 *  least, and its mode; colour and gold; four numbers its mode reads (see
 *  the stroke shader); drawn through a local map, the centres its ends are
 *  placed from; two planes, each a normal (signed bytes) and a number,
 *  that say whether it shows (see `Op` strokes' `cull`); a point on each,
 *  whose depth it takes drawn in paint order (see `Placed`); the
 *  feet-to-pixels it shows between (see `atK`); how many of its widths
 *  it's moved up and left on screen; and pixels added to its width. */
export const SSTRIDE = 144;
/** A flower head: its centre, facing normal (w set: cull it on the far
 *  side), radius in feet and the angle its florets turn by, its tone, and
 *  seven jitters for the yellow lantana's florets. */
export const FSTRIDE = 36;
/** A tree's lobe of foliage: its centre, its radii (across, up), colour and
 *  gold, and nine jitters for the ebony's ragged puffs (0.78 to 1.1 of its
 *  radius, as bytes). */
export const LSTRIDE = 40;
/** A fleck of leaf, placed as the canvas places one, by its lobe's local
 *  map: the lobe's centre, its offset from that, its slant on screen,
 *  colour and gold; a flower spike's lean, and the lobe's facing normal. */
export const KSTRIDE = 60;
/** An ellipse: the centre it's placed at, a shift from that through the
 *  local map, three half-axes (an ellipsoid's, flattened by the map),
 *  colour and gold; a normal (signed bytes, w set: passed over when it
 *  faces away by more than its slack), the slack, and how much farther
 *  than its centre it's drawn, feet — so a knob's shadow, the knob and
 *  its shoulder stack as the canvas paints them. */
export const ESTRIDE = 80;
/** A yucca's blade: its base and tip from the ball's middle, and its tone. */
export const BSTRIDE = 28;

/** The camera, for parts that change with it: the canvas's `P` (CSS
 *  pixels, and depth), the eye, which way it looks, and `ftPx` — pixels
 *  a foot across at a point on the ground. */
export type Cam = {
  P: (x: number, y: number, z: number) => [number, number, number];
  eye: number[];
  fw: number[];
  ft: (x: number, z: number) => number;
};

/** How long a foot along x, y or z is on screen at a point — a column of
 *  the canvas's local map there. */
export function step(cam: Cam, p: ArrayLike<number>, axis: 0 | 1 | 2) {
  const q = cam.P(p[0], p[1], p[2]);
  const e = cam.P(p[0] + (axis === 0 ? 1 : 0), p[1] + (axis === 1 ? 1 : 0), p[2] + (axis === 2 ? 1 : 0));
  return Math.hypot(e[0] - q[0], e[1] - q[1]);
}
/** The canvas's `footPx` at a point: the longest of the three. */
export const footPx = (cam: Cam, p: ArrayLike<number>) => Math.max(step(cam, p, 0), step(cam, p, 1), step(cam, p, 2));
/** What a part does this frame: whether it shows at all, the feet-to-
 *  pixels its widths take (the plant's `ftPx` otherwise), and how opaque. */
export type Frame = (cam: Cam) => { show?: boolean; foot?: number; alpha?: number };
/** Placed through the camera's local map at `local` — each vertex its
 *  centre's own projection, plus the map times its offset from that. With
 *  `flat`, drawn in the canvas's paint order: each face at the depth of its
 *  middle, so faces stack as its far-to-near sort lays them, not as they
 *  cross; and a stroke at the depth of the nearer of its planes' points
 *  that faces the eye (of both, when neither does), just over the face it
 *  lies on. */
type Placed = {
  local?: V3;
  frame?: Frame;
  flat?: boolean;
  /** gold only when the plant is picked, not when it's only hovered */
  pickedGold?: boolean;
};

/** What a draw of part of a plant is, in the canvas's order. `once` groups
 *  ink each pixel once between them (the canvas strokes them as one path);
 *  0 inks as often as they cross. */
export type Op =
  | ({
      kind: "tris";
      first: number;
      count: number;
      depth: boolean;
      /** 1 passed over on the far side (see the fill shader); 2 when it
       *  faces away from the camera, as a body under one local map does */
      cull: boolean | 2;
      /** depth pushed back this much (polygon offset units) when it writes
       *  depth, so what's drawn on it goes over it; 1 by default */
      offset?: number;
      /** drawn this many feet nearer than it stands (less than 0, farther) */
      bias?: number;
      /** drawn only when the plant is picked, not when it's only hovered */
      picked?: boolean;
    } & Placed)
  | { kind: "lines"; first: number; count: number; colour: Rgba; gold: Rgba; cull: boolean; once: number }
  | ({
      kind: "strokes";
      first: number;
      count: number;
      once: number;
      stamen?: [number, number];
      /** how much nearer than they stand they're drawn, feet */
      bias?: number;
      /** 1 shown when the eye is in front of either plane; 2 when the
       *  camera looks into both (dotted with the way it looks, over the
       *  plane's number); 3 when it's in front of one and not the other (an
       *  edge of a silhouette); 4 when it's in front of both; 5 when the
       *  way to the eye from `pa` is within its first normal by more than
       *  `thr` (the cosine) */
      cull?: 0 | 1 | 2 | 3 | 4 | 5;
      /** drawn this many of its half-widths nearer too (see the stroke
       *  shader) */
      wbias?: number;
      /** opaque and square: each pixel inked whole or not at all, the
       *  card's multisampling smoothing its edges, and written in depth */
      solid?: boolean;
      /** its solid middles written in depth, so a nearer one hides it */
      depth?: boolean;
      /** each stroke placed through the local map at its own `pa`, and its
       *  widths and window by the feet-to-pixels there (the longest of the
       *  map's columns) — the canvas's map at each ocotillo cane */
      atK?: boolean;
    } & Placed)
  | ({
      kind: "ellipses";
      first: number;
      count: number;
      /** 1 an americana's heart: its first half-axis's x is a radius, and
       *  the ellipse is the canvas's, upright; 2 a circle that radius
       *  through the map's longest column, a pixel at least; 3 a
       *  Madagascar palm's heart: that radius through the map's x column
       *  across, and 1.6 times it through its y column up */
      mode?: 0 | 1 | 2 | 3;
      /** written in depth (the default), so nearer parts go over it */
      depth?: boolean;
    } & Placed)
  | {
      kind: "flowers";
      first: number;
      count: number;
      /** 0 White Dawn's flat posies, 1 the purple's balls, 2 the yellow's domes */
      style: 0 | 1 | 2;
      /** how much nearer than they stand they're drawn, feet */
      bias: number;
      /** the height, as a fraction of the plant's, its local map is taken at */
      cy: number;
      pal: Float32Array;
      palGold: Float32Array;
    }
  | {
      kind: "lobes";
      first: number;
      count: number;
      /** the ebony's ragged puffs, nine points round, not smooth ellipses */
      ragged: boolean;
      /** far to near in this many bands, each band a tone at a time and
       *  each tone inking once (the ebony's); 0, one at a time, far first */
      bands: number;
    }
  | {
      kind: "flecks";
      first: number;
      count: number;
      /** 0 a dash `max(feet, floor) × mul` pixels long, `wd` of that wide;
       *  1 a chaste leaf (a hand of five fingers, close to); 2 a flower spike */
      shape: 0 | 1 | 2;
      ft: number;
      floor: number;
      mul: number;
      wd: number;
      /** 1 passed over on the far side of `centre`; 2 on the far side of
       *  its lobe, by `slack` */
      cull: 0 | 1 | 2;
      centre?: [number, number, number];
      slack?: number;
    }
  | {
      kind: "blades";
      first: number;
      count: number;
      /** the ball's middle, where its local map is taken; and where the
       *  sun's way across the screen is read off (the skirt's) */
      at: V3;
      sun: V3;
      /** the blades this pass draws, by their bucket (band × 5 + tone,
       *  the band worked out from the camera), and which of each: two
       *  buckets (-1, none), each with a side — 0 the whole blade, 1 its
       *  sunny half, -1 its shaded half. An edge pass takes a band */
      pick: [number, number, number, number];
      /** 0 a stroke, 1 a kite, 2 a kite's shaded edge */
      mode: 0 | 1 | 2;
      colour: Rgba;
      gold: Rgba;
      /** a blade's length and width, feet */
      len: number;
      wd: number;
      frame?: Frame;
    }
  | {
      /** strokes laid out afresh each frame, as the canvas lays them on
       *  screen: a yucca's trunk. In the runs its builder marks with
       *  `strokeRun` (only their `once` is read), or all as one */
      kind: "dyn";
      build: (cam: Cam, b: MeshBuilder) => void;
      pickedGold?: boolean;
    };

export type Built = {
  verts: Uint8Array;
  index: Uint16Array | Uint32Array;
  strokes: Uint8Array;
  flowers: Uint8Array;
  flecks: Uint8Array;
  ellipses: Uint8Array;
  blades: Uint8Array;
  /** lobes: their records, centres (to sort them by) and tones (to band them by) */
  lobes: Uint8Array;
  lobeC: Float64Array;
  lobeLevel: Uint8Array;
  ops: Op[];
};

/** Records of a fixed size, grown as written. */
class Records {
  buf: ArrayBuffer;
  f: Float32Array;
  u: Uint8Array;
  i: Int8Array;
  n = 0;
  constructor(
    readonly stride: number,
    cap = 64,
  ) {
    this.buf = new ArrayBuffer(cap * stride);
    this.f = new Float32Array(this.buf);
    this.u = new Uint8Array(this.buf);
    this.i = new Int8Array(this.buf);
  }
  /** The byte offset of a new record. */
  add() {
    if ((this.n + 1) * this.stride > this.buf.byteLength) {
      const old = this.u;
      this.buf = new ArrayBuffer(this.buf.byteLength * 2);
      this.f = new Float32Array(this.buf);
      this.u = new Uint8Array(this.buf);
      this.i = new Int8Array(this.buf);
      this.u.set(old);
    }
    return this.n++ * this.stride;
  }
  get bytes() {
    return this.u.slice(0, this.n * this.stride);
  }
}

const put4 = (u: Uint8Array, o: number, c: Rgba) => {
  u[o] = c[0];
  u[o + 1] = c[1];
  u[o + 2] = c[2];
  u[o + 3] = c[3];
};

export type V3 = ArrayLike<number>;

export class MeshBuilder {
  private v = new Records(VSTRIDE, 1024);
  private s = new Records(SSTRIDE, 64);
  private fl = new Records(FSTRIDE, 16);
  private lo = new Records(LSTRIDE, 16);
  private lc: number[] = [];
  private ll: number[] = [];
  private k = new Records(KSTRIDE, 64);
  private el = new Records(ESTRIDE, 16);
  private bl = new Records(BSTRIDE, 16);
  /** Triangle and line indices, kept apart and joined at the end. */
  readonly tri: number[] = [];
  readonly line: number[] = [];
  private ops: Op[] = [];
  private onceN = 0;

  get verts() {
    return this.v.n;
  }
  get strokes() {
    return this.s.n;
  }
  get flowers() {
    return this.fl.n;
  }
  get lobes() {
    return this.lo.n;
  }
  get flecks() {
    return this.k.n;
  }
  get ellipses() {
    return this.el.n;
  }
  get bladeCount() {
    return this.bl.n;
  }

  /** A new once-group's number. */
  once() {
    return ++this.onceN;
  }

  /** A vertex: its colour and gold; with `n`, the plane through `c` (or
   *  `p`) its face is passed over on the far side of; with `flat`, drawn at
   *  `c`'s depth; with `local`, placed from `at`. */
  vert(x: number, y: number, z: number, col: Rgba, gold: Rgba, n?: V3, c?: V3, at?: V3, p?: V3) {
    const o = this.v.add();
    const f = o >> 2;
    const F = this.v.f;
    F[f] = x;
    F[f + 1] = y;
    F[f + 2] = z;
    F[f + 7] = at ? at[0] : x;
    F[f + 8] = at ? at[1] : y;
    F[f + 9] = at ? at[2] : z;
    F[f + 10] = c ? c[0] : x;
    F[f + 11] = c ? c[1] : y;
    F[f + 12] = c ? c[2] : z;
    put4(this.v.u, o + 12, col);
    put4(this.v.u, o + 16, gold);
    if (n && c) {
      const I = this.v.i;
      const q0 = Math.round(n[0] * 127);
      const q1 = Math.round(n[1] * 127);
      const q2 = Math.round(n[2] * 127);
      I[o + 20] = q0;
      I[o + 21] = q1;
      I[o + 22] = q2;
      I[o + 23] = 0;
      const d = p ?? c;
      F[f + 6] = (q0 * d[0] + q1 * d[1] + q2 * d[2]) / 127;
    } else {
      put4(this.v.u, o + 20, [0, 0, 0, 0]);
      F[f + 6] = 0;
    }
    return this.v.n - 1;
  }

  /** Shapes laid out as offsets from a centre, `corners` points each, each
   *  filled by the template's triangles and, with `outline`, ringed by
   *  lines. Returns nothing; the indices go on `tri` and `line`. */
  shapes(
    c: V3,
    pts: ArrayLike<number>,
    corners: number,
    tris: number[],
    col: Rgba,
    gold: Rgba,
    face?: { n: V3; c: V3 },
    from = 0,
    to = pts.length,
  ) {
    const bases: number[] = [];
    for (let o = from; o < to; o += corners * 3) {
      const base = this.v.n;
      for (let k = 0; k < corners; k++) {
        const i = o + k * 3;
        this.vert(c[0] + pts[i], c[1] + pts[i + 1], c[2] + pts[i + 2], col, gold, face?.n, face?.c);
      }
      for (const t of tris) this.tri.push(base + t);
      bases.push(base);
    }
    return bases;
  }

  /** Closed outlines round shapes `shapes` returned. */
  outline(bases: number[], corners: number) {
    for (const b of bases) {
      for (let k = 0; k < corners; k++) this.line.push(b + k, b + ((k + 1) % corners));
    }
  }

  /** A stroke from a to b, `w` = [feet, line widths, pixels] — the canvas's
   *  `max(ftPx(feet), lw × line widths, pixels)`; or, with line widths
   *  under 0, `max(ftPx(feet), pixels)` and that many more line widths. */
  stroke(a: V3, b: V3, w: [number, number, number], col: Rgba, gold: Rgba, round: boolean, dash?: [number, number, number]) {
    this.strokeMode(a, b, w, 0, col, gold, [round ? 1 : 0, dash?.[0] ?? 0, dash?.[1] ?? 0, dash?.[2] ?? 0]);
  }

  /** A stroke through a local map (see `Placed`): each end placed from
   *  its centre, `ca` and `cb`; and the planes its op's `cull` reads —
   *  normals `na` and `nb` through points `pa` and `pb`, or with the
   *  number `thr`. A thorn is the truncata's: `w` wide at its foot, a
   *  quarter of its length back from `a`, to a point at `b`. */
  strokeX(
    a: V3,
    b: V3,
    w: [number, number, number],
    col: Rgba,
    gold: Rgba,
    o: { round?: boolean; thorn?: boolean; ca?: V3; cb?: V3; na?: V3; nb?: V3; pa?: V3; pb?: V3; thr?: number },
  ) {
    this.strokeMode(a, b, w, o.thorn ? 3 : 0, col, gold, [o.round ? 1 : 0, 0, 0, 0], o);
  }

  strokeMode(
    a: V3,
    b: V3,
    w: [number, number, number],
    mode: number,
    col: Rgba,
    gold: Rgba,
    s: [number, number, number, number],
    x?: { ca?: V3; cb?: V3; na?: V3; nb?: V3; pa?: V3; pb?: V3; thr?: number; win?: [number, number]; shift?: number; add?: number },
  ) {
    const o = this.s.add();
    const f = o >> 2;
    const F = this.s.f;
    F[f] = a[0];
    F[f + 1] = a[1];
    F[f + 2] = a[2];
    F[f + 3] = b[0];
    F[f + 4] = b[1];
    F[f + 5] = b[2];
    F[f + 6] = w[0];
    F[f + 7] = w[1];
    F[f + 8] = w[2];
    F[f + 9] = mode;
    put4(this.s.u, o + 40, col);
    put4(this.s.u, o + 44, gold);
    F[f + 12] = s[0];
    F[f + 13] = s[1];
    F[f + 14] = s[2];
    F[f + 15] = s[3];
    const ca = x?.ca ?? a;
    const cb = x?.cb ?? b;
    for (let i = 0; i < 3; i++) {
      F[f + 16 + i] = ca[i];
      F[f + 19 + i] = cb[i];
    }
    const I = this.s.i;
    const plane = (n: V3 | undefined, p: V3 | undefined, at: number) => {
      const q = n ? [Math.round(n[0] * 127), Math.round(n[1] * 127), Math.round(n[2] * 127)] : [0, 0, 0];
      I[o + at] = q[0];
      I[o + at + 1] = q[1];
      I[o + at + 2] = q[2];
      I[o + at + 3] = 0;
      if (x?.thr !== undefined) return x.thr;
      return p ? (q[0] * p[0] + q[1] * p[1] + q[2] * p[2]) / 127 : 0;
    };
    F[f + 24] = plane(x?.na, x?.pa, 88);
    F[f + 25] = plane(x?.nb ?? x?.na, x?.pb ?? x?.pa, 92);
    const ka = x?.pa ?? a;
    const kb = x?.pb ?? x?.pa ?? b;
    for (let i = 0; i < 3; i++) {
      F[f + 26 + i] = ka[i];
      F[f + 29 + i] = kb[i];
    }
    F[f + 32] = x?.win?.[0] ?? 0;
    F[f + 33] = Math.min(x?.win?.[1] ?? 1e30, 1e30);
    F[f + 34] = x?.shift ?? 0;
    F[f + 35] = x?.add ?? 0;
  }

  /** The canvas's quadratic from `a` to `b` with control point `m`, each
   *  projected as it is, butt-ended (see the stroke shader's mode 8). */
  curve(a: V3, m: V3, b: V3, w: [number, number, number], col: Rgba, gold: Rgba, o?: { pa?: V3; add?: number }) {
    this.strokeMode(a, b, w, 8, col, gold, [0, 0, 0, 0], { ca: m, pa: o?.pa, add: o?.add });
  }

  /** A path of strokes through points, round-capped so the joins are
   *  round, as the canvas's are. */
  path(pts: V3[], w: [number, number, number], col: Rgba, gold: Rgba) {
    for (let i = 1; i < pts.length; i++) this.stroke(pts[i - 1], pts[i], w, col, gold, true);
  }

  flower(c: V3, n: V3 | null, r: number, spin: number, tone: number, jit?: number[]) {
    const o = this.fl.add();
    const f = o >> 2;
    const F = this.fl.f;
    F[f] = c[0];
    F[f + 1] = c[1];
    F[f + 2] = c[2];
    const I = this.fl.i;
    I[o + 12] = n ? Math.round(n[0] * 127) : 0;
    I[o + 13] = n ? Math.round(n[1] * 127) : 0;
    I[o + 14] = n ? Math.round(n[2] * 127) : 0;
    I[o + 15] = n ? 127 : 0;
    F[f + 4] = r;
    F[f + 5] = spin;
    put4(this.fl.u, o + 24, [tone, 0, 0, 0]);
    for (let k = 0; k < 8; k++) this.fl.u[o + 28 + k] = jit && k < jit.length ? Math.round(((jit[k] + 1) / 2) * 255) : 128;
  }

  lobe(c: V3, rx: number, ry: number, col: Rgba, gold: Rgba, level = 0, jit?: ArrayLike<number>) {
    const o = this.lo.add();
    const f = o >> 2;
    const F = this.lo.f;
    F[f] = c[0];
    F[f + 1] = c[1];
    F[f + 2] = c[2];
    F[f + 3] = rx;
    F[f + 4] = ry;
    put4(this.lo.u, o + 20, col);
    put4(this.lo.u, o + 24, gold);
    for (let k = 0; k < 12; k++) this.lo.u[o + 28 + k] = jit && k < jit.length ? Math.round(((jit[k] - 0.78) / 0.32) * 255) : 255;
    this.lc.push(c[0], c[1], c[2]);
    this.ll.push(level);
  }

  /** A fleck at `o` from its lobe's centre `c`, slanted `a` on screen; `d`
   *  a spike's lean, `n` its lobe's facing. */
  fleck(c: V3, o: V3, a: number, col: Rgba, gold: Rgba, d?: V3, n?: V3) {
    const r = this.k.add();
    const f = r >> 2;
    const F = this.k.f;
    for (let i = 0; i < 3; i++) {
      F[f + i] = c[i];
      F[f + 3 + i] = o[i];
      F[f + 9 + i] = d ? d[i] : 0;
      F[f + 12 + i] = n ? n[i] : 0;
    }
    F[f + 6] = a;
    put4(this.k.u, r + 28, col);
    put4(this.k.u, r + 32, gold);
  }

  /** An ellipse at `c` (see ESTRIDE), shifted `s` through the local map;
   *  `n` passes it over when it faces away by more than `slack` (the cosine
   *  past side-on). */
  ellipse(c: V3, s: V3, a1: V3, a2: V3, a3: V3, col: Rgba, gold: Rgba, n: V3 | null, slack = 0, dz = 0) {
    const r = this.el.add();
    const f = r >> 2;
    const F = this.el.f;
    for (let i = 0; i < 3; i++) {
      F[f + i] = c[i];
      F[f + 3 + i] = s[i];
      F[f + 6 + i] = a1[i];
      F[f + 9 + i] = a2[i];
      F[f + 12 + i] = a3[i];
    }
    put4(this.el.u, r + 60, col);
    put4(this.el.u, r + 64, gold);
    const I = this.el.i;
    for (let i = 0; i < 3; i++) I[r + 68 + i] = n ? Math.round(n[i] * 127) : 0;
    I[r + 71] = n ? 127 : 0;
    F[f + 18] = slack;
    F[f + 19] = dz;
  }

  /** A yucca's blade (see BSTRIDE). */
  blade(base: V3, tip: V3, tone: number) {
    const r = this.bl.add();
    const f = r >> 2;
    const F = this.bl.f;
    for (let i = 0; i < 3; i++) {
      F[f + i] = base[i];
      F[f + 3 + i] = tip[i];
    }
    F[f + 6] = tone;
  }

  /** Marks where a run of triangles, lines, strokes or flowers ends, as one
   *  draw. Call with where the run began. */
  tris(first: number, depth: boolean, cull: boolean | 2, o?: Placed & { offset?: number; bias?: number; picked?: boolean }) {
    if (this.tri.length > first) this.ops.push({ kind: "tris", first, count: this.tri.length - first, depth, cull, ...o });
  }
  lines(first: number, colour: Rgba, gold: Rgba, cull: boolean, once: number) {
    if (this.line.length > first) this.ops.push({ kind: "lines", first, count: this.line.length - first, colour, gold, cull, once });
  }
  strokeRun(
    first: number,
    once: number,
    stamen?: [number, number],
    bias?: number,
    o?: Placed & { cull?: 0 | 1 | 2 | 3 | 4 | 5; wbias?: number; solid?: boolean; depth?: boolean; atK?: boolean },
  ) {
    if (this.s.n > first) this.ops.push({ kind: "strokes", first, count: this.s.n - first, once, stamen, bias, ...o });
  }
  ellipseRun(first: number, o?: Placed & { mode?: 0 | 1 | 2 | 3; depth?: boolean }) {
    if (this.el.n > first) this.ops.push({ kind: "ellipses", first, count: this.el.n - first, ...o });
  }
  flowerRun(first: number, style: 0 | 1 | 2, bias: number, cy: number, pal: Float32Array, palGold: Float32Array) {
    if (this.fl.n > first) this.ops.push({ kind: "flowers", first, count: this.fl.n - first, style, bias, cy, pal, palGold });
  }
  lobeRun(first: number, ragged: boolean, bands: number) {
    if (this.lo.n > first) this.ops.push({ kind: "lobes", first, count: this.lo.n - first, ragged, bands });
  }
  fleckRun(first: number, o: Omit<Extract<Op, { kind: "flecks" }>, "kind" | "first" | "count">) {
    if (this.k.n > first) this.ops.push({ kind: "flecks", first, count: this.k.n - first, ...o });
  }
  /** A pass over the blades from `first` on (see `Op` blades). */
  bladeRun(first: number, o: Omit<Extract<Op, { kind: "blades" }>, "kind" | "first" | "count">) {
    if (this.bl.n > first) this.ops.push({ kind: "blades", first, count: this.bl.n - first, ...o });
  }
  dyn(build: (cam: Cam, b: MeshBuilder) => void, o?: { pickedGold?: boolean }) {
    this.ops.push({ kind: "dyn", build, ...o });
  }

  finish(): Built {
    const nt = this.tri.length;
    const all = this.tri.concat(this.line);
    const index = this.v.n > 65535 ? new Uint32Array(all) : new Uint16Array(all);
    // Line runs index past the triangles.
    const ops = this.ops.map((op) => (op.kind === "lines" ? { ...op, first: op.first + nt } : op));
    return {
      verts: this.v.bytes,
      index,
      strokes: this.s.bytes,
      flowers: this.fl.bytes,
      flecks: this.k.bytes,
      ellipses: this.el.bytes,
      blades: this.bl.bytes,
      lobes: this.lo.bytes,
      lobeC: new Float64Array(this.lc),
      lobeLevel: new Uint8Array(this.ll),
      ops,
    };
  }
}

/** A flower palette as the flower shader takes it: 17 colours, rgba 0-1 —
 *  the head's tones, its lit tones, its florets', its buds', and its eye. */
export function flowerPalette(cols: { flower?: string[]; lit?: string[]; floret?: string[]; bud?: string[]; eye?: string }, parse: (css: string) => Rgba) {
  const out = new Float32Array(17 * 4);
  const set = (slot: number, css: string | undefined) => {
    if (!css) return;
    const c = parse(css);
    out.set([c[0] / 255, c[1] / 255, c[2] / 255, c[3] / 255], slot * 4);
  };
  for (let k = 0; k < 4; k++) {
    set(k, cols.flower?.[Math.min(k, (cols.flower?.length ?? 1) - 1)]);
    set(4 + k, cols.lit?.[Math.min(k, (cols.lit?.length ?? 1) - 1)]);
    set(8 + k, cols.floret?.[Math.min(k, (cols.floret?.length ?? 1) - 1)]);
    set(12 + k, cols.bud?.[Math.min(k, (cols.bud?.length ?? 1) - 1)]);
  }
  set(16, cols.eye);
  return out;
}
