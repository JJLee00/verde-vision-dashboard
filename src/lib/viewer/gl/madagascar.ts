// Madagascar palm as the WebGL layer draws it: grown by the grower the
// canvas uses (see `drawMadagascarBody` in LivingBlueprint), placed by its
// local map at the crown's heart.
//
// The canvas sorts the leaves, the trunk and the heart far to near and
// paints each whole. Here each is drawn at the depth it sorts by (see
// `flat`) — a leaf its middle, the trunk its first ring up, the heart its
// own — and written in depth, so they stack the same way; what goes on
// them (the trunk's spines, a leaf's midrib) just over them.

import { MADAGASCAR_COLOURS, MADAGASCAR_GOLD, MP_LEAVES, MP_LEVELS, MP_PTS, MP_RINGS, MP_SIDES, MP_SPINES, MP_TONES, growMadagascar } from "../bodies/madagascar";
import { hull3, rgba, type Rgba } from "./geom";
import { step, type Cam, type MeshBuilder } from "./mesh";

type V3 = [number, number, number];
type Pal = [Rgba, Rgba];

const tone = (i: number): Pal => [rgba(MP_TONES[0][i]), rgba(MP_TONES[1][i])];
const pal = (c: string, g: string): Pal => [rgba(c), rgba(g)];
const C = MADAGASCAR_COLOURS;
const G = MADAGASCAR_GOLD;

export function madagascar(b: MeshBuilder, x: number, z: number, h: number, rot: number) {
  const { axis, ring, faceN, faceTone, spines, heart, leaf, mid, leafN, leafTone } = growMadagascar(x, z, h, rot);
  const NR = MP_RINGS.length;
  const at3 = (a: Float32Array, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
  // The trunk sorts by its first ring up; which of its faces show, by the
  // way to the eye from its second.
  const key = at3(axis, 1);
  const from = at3(axis, 2);
  const placed = { local: heart, flat: true };
  // The canvas's feet-to-pixels at the heart: a foot up, on screen.
  const up = (cam: Cam) => step(cam, heart, 1);
  const pt = (l: number, j: number): V3 => {
    const k = (l * MP_SIDES + (j % MP_SIDES)) * 2;
    return [axis[l * 3] + ring[k], axis[l * 3 + 1], axis[l * 3 + 2] + ring[k + 1]];
  };

  // The trunk: its outline in the bark's darkest, each ring placed from
  // its own centre.
  const t0 = b.tri.length;
  const dark = tone(2 * MP_LEVELS);
  const rings: V3[] = [];
  const ats: V3[] = [];
  for (let l = 0; l < NR; l++) {
    for (let j = 0; j < MP_SIDES; j++) {
      rings.push(pt(l, j));
      ats.push(at3(axis, l));
    }
  }
  const base = b.verts;
  rings.forEach((p, k) => b.vert(p[0], p[1], p[2], dark[0], dark[1], undefined, key, ats[k]));
  for (const i of hull3(rings)) b.tri.push(base + i);
  b.tris(t0, true, false, placed);
  // Then its faces toward the eye, each in its tone.
  const t1 = b.tri.length;
  for (let f = 0; f < (NR - 1) * MP_SIDES; f++) {
    const l = (f / MP_SIDES) | 0;
    const j = f % MP_SIDES;
    const c = tone(2 * MP_LEVELS + faceTone[f]);
    const n = at3(faceN, f);
    const v = (ll: number, jj: number) => {
      const p = pt(ll, jj);
      return b.vert(p[0], p[1], p[2], c[0], c[1], n, key, at3(axis, ll), from);
    };
    const a = v(l, j);
    const d = v(l, j + 1);
    const e = v(l + 1, j + 1);
    const k = v(l + 1, j);
    b.tri.push(a, d, e, a, e, k);
  }
  b.tris(t1, true, true, placed);
  // Close up, its spines: short pale points on the side toward the eye.
  const s0 = b.strokes;
  const spine = pal(C.spine, G.spine);
  const len = 0.014 * h;
  for (let i = 0; i < MP_SPINES; i++) {
    const o = i * 6;
    const p: V3 = [spines[o], spines[o + 1], spines[o + 2]];
    const e: V3 = [p[0] + spines[o + 3] * len, p[1] + spines[o + 4] * len, p[2] + spines[o + 5] * len];
    b.strokeX(p, e, [0.005 * h, 0, 0.6], spine[0], spine[1], { ca: p, cb: p, na: [spines[o + 3], 0, spines[o + 5]], pa: key, thr: 0.1 });
  }
  b.strokeRun(s0, b.once(), undefined, 0.01, {
    ...placed,
    cull: 5,
    frame: (cam) => {
      const f = up(cam);
      return { show: f * 0.05 * h > 4, foot: f };
    },
  });

  // The heart, where the leaf bases crowd: dark.
  const e0 = b.ellipses;
  const heartC = pal(C.heart, G.heart);
  b.ellipse(heart, [0, 0, 0], [0.07 * h, 0, 0], [0, 0, 0], [0, 0, 0], heartC[0], heartC[1], null);
  b.ellipseRun(e0, { local: heart, mode: 3 });

  // The leaves, each in the tone of the face toward the eye: twice, the
  // upper face and the under, each passed over when it faces away.
  const t2 = b.tri.length;
  for (let i = 0; i < MP_LEAVES; i++) {
    const m = at3(mid, i);
    const n = at3(leafN, i);
    for (const side of [1, -1]) {
      const c = tone(leafTone[i * 2 + (side > 0 ? 0 : 1)]);
      const sn: V3 = [n[0] * side, n[1] * side, n[2] * side];
      const v0 = b.verts;
      for (let j = 0; j < MP_PTS; j++) {
        const o = (i * MP_PTS + j) * 6;
        for (const s of [1, -1]) {
          b.vert(leaf[o] + leaf[o + 3] * s, leaf[o + 1] + leaf[o + 4] * s, leaf[o + 2] + leaf[o + 5] * s, c[0], c[1], sn, m, heart);
        }
      }
      for (let j = 0; j + 1 < MP_PTS; j++) {
        const v = v0 + j * 2;
        b.tri.push(v, v + 2, v + 3, v, v + 3, v + 1);
      }
    }
  }
  b.tris(t2, true, true, placed);
  // Big enough to see, the midrib of each leaf showing its upper face.
  const s1 = b.strokes;
  const rib = pal(C.midrib, G.midrib);
  for (let i = 0; i < MP_LEAVES; i++) {
    const m = at3(mid, i);
    const n = at3(leafN, i);
    for (let j = 2; j < MP_PTS - 1; j++) {
      const o = (i * MP_PTS + j) * 6;
      const p: V3 = [leaf[o - 6], leaf[o - 5], leaf[o - 4]];
      const q: V3 = [leaf[o], leaf[o + 1], leaf[o + 2]];
      b.strokeX(p, q, [0.004 * h, 0, 0.6], rib[0], rib[1], { ca: heart, cb: heart, na: n, pa: m });
    }
  }
  b.strokeRun(s1, b.once(), undefined, 0.01, {
    ...placed,
    cull: 1,
    frame: (cam) => {
      const f = up(cam);
      return { show: f * h > 90, foot: f };
    },
  });
}
