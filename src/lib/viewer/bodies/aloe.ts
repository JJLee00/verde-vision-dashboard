// Aloe vera's body, grown as fleshy leaves and flower stalks in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same plant.

import { rngFor } from "../symbols";

/** The aloe's flower spikes, on the lantana's terms: confined to the flowers,
 *  muted to sit on the sand, and absent from the plan symbol. A tall stalk of
 *  hanging yellow tubes is what tells an aloe from an agave at a glance —
 *  in ink alone the spike is a bottle brush of any colour. Open flowers, and
 *  the greener buds still closed at the tip. */
export const ALOE_BLOOM = "rgba(222,184,74,0.88)";
export const ALOE_BUD = "rgba(178,180,98,0.88)";

type V3 = [number, number, number];

/** A face of a leaf: the strip between two of its lines, `a` and `b`; the
 *  lines its edges are drawn down, each at a share of the plant's line
 *  width and its ink at a strength (null: the plant's own stroke); the
 *  pale flecks on it; and how lit it is. */
export type AloeFace = {
  a: V3[];
  b: V3[];
  edges: { line: V3[]; w: number; a: number | null }[];
  flecks: [V3, V3][];
  lit: number;
};
export type AloePlant = {
  faces: AloeFace[];
  /** each flower stalk in pieces, each with its share of the stalk's
   *  width; and its flower tubes, each open or still a bud */
  stalks: { pieces: { a: V3; b: V3; w: number }[]; tubes: { base: V3; tip: V3; open: boolean }[] }[];
};

/** Aloe vera's leaves and flowers, as the app's model is (see `drawAloeBody`
 *  in LivingBlueprint). */
export function growAloe(x: number, z: number, h: number, rw: number, rot: number, seed: string): AloePlant {
  const rng = rngFor("aloe:" + seed);
  // Up and to the left, the light every drawing on this sheet is under.
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  const N = 15;
  const S = 14; // stations along a leaf; the odd ones carry the teeth
  const FOLD = 0.3; // margins above the midline, of the half-width
  const BELLY = 0.95; // underside below the margins, of the half-width
  const deg = Math.PI / 180;

  // Centre lines first, in feet: a leaf leaves the crown at its own
  // angle and bends down along its length, the old ones the most.
  const leaves: { c: V3[]; psi: number[]; halfW: number; age: number; flecked: boolean }[] = [];
  let top = 0;
  for (let k = 0; k < N; k++) {
    const age = 1 - k / (N - 1); // 1 = oldest and outermost, 0 = youngest
    const a = rot + k * 2.399963 + (rng() - 0.5) * 0.35; // golden angle
    // Most leaves fan out long and open, as the model's do; only the
    // last few stand up in the core.
    const e0 = (80 - 44 * Math.pow(age, 0.7) + (rng() - 0.5) * 10) * deg;
    const bend = (8 + 56 * Math.pow(age, 1.2) + (rng() - 0.5) * 12) * deg;
    // A few tips hook over, as the model's do.
    const hook = rng() < 0.35 ? (15 + rng() * 25) * deg : 0;
    const sway = (rng() - 0.5) * 28 * deg;
    const L = rw * (1.45 - 0.45 * age) * (0.78 + 0.22 * Math.min(1, age / 0.2)) * (0.92 + 0.16 * rng());
    const r0 = rw * 0.08; // a crown, not a point
    const c: V3[] = [];
    const psi: number[] = [];
    let y = 0;
    let px = x + Math.cos(a) * r0;
    let pz = z + Math.sin(a) * r0;
    for (let i = 0; i <= S; i++) {
      const t = i / S;
      const ps = a + sway * t * t;
      if (i > 0) {
        const tm = (i - 0.5) / S;
        const e = e0 - bend * Math.pow(tm, 1.5) - hook * Math.max(0, (tm - 0.7) / 0.3) ** 2;
        const step = L / S;
        px += Math.cos(e) * Math.cos(ps) * step;
        pz += Math.cos(e) * Math.sin(ps) * step;
        y += Math.sin(e) * step;
      }
      c.push([px, Math.max(y, 0), pz]);
      psi.push(ps);
      top = Math.max(top, y);
    }
    // Drawn broader than life, as the agaves are: at plan scale a
    // true-width leaf thins back into a stroke and the succulent is lost.
    const halfW = rw * (0.11 + 0.07 * age) * (0.9 + 0.2 * rng());
    leaves.push({ c, psi, halfW, age, flecked: rng() < 0.35 });
  }
  // Height follows the model's proportion; the catalog's is a ceiling.
  const ys = top > h * 0.95 ? (h * 0.95) / top : 1;

  const faces: AloeFace[] = [];
  for (const lf of leaves) {
    const c = lf.c.map(([cx, cy, cz]): V3 => [cx, cy * ys, cz]);
    // Broad at the clasp and holding its width most of the way out —
    // a fleshy leaf, not a needle — then closing to a point.
    const width = (t: number) => lf.halfW * Math.pow(1 - t, 0.7) * (0.85 + 0.15 * Math.min(1, t / 0.07));
    const marginL: V3[] = [];
    const marginR: V3[] = [];
    const keel: V3[] = [];
    const frames: { T: V3; Sd: V3; Nn: V3 }[] = [];
    for (let i = 0; i <= S; i++) {
      const t = i / S;
      const p0 = c[Math.max(0, i - 1)];
      const p1 = c[Math.min(S, i + 1)];
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const dz = p1[2] - p0[2];
      const tl = Math.hypot(dx, dy, dz) || 1;
      const T: V3 = [dx / tl, dy / tl, dz / tl];
      const Sd: V3 = [-Math.sin(lf.psi[i]), 0, Math.cos(lf.psi[i])]; // across, level
      // Sd x T: the upper face's normal — in toward the crown on an
      // upright leaf, up on an open one.
      let Nn: V3 = [Sd[1] * T[2] - Sd[2] * T[1], Sd[2] * T[0] - Sd[0] * T[2], Sd[0] * T[1] - Sd[1] * T[0]];
      const nl = Math.hypot(...Nn) || 1;
      Nn = [Nn[0] / nl, Nn[1] / nl, Nn[2] / nl];
      frames.push({ T, Sd, Nn });
      const w = width(t);
      // A tooth is a margin vertex pushed out, on the older leaves.
      const tooth = lf.age > 0.25 && i % 2 === 1 && i > 1 && i < S - 1 ? lf.halfW * 0.12 * (1 - 0.6 * t) : 0;
      const at = (side: number, across: number, up: number): V3 => [
        c[i][0] + Sd[0] * side * across + Nn[0] * up,
        c[i][1] + Nn[1] * up,
        c[i][2] + Sd[2] * side * across + Nn[2] * up,
      ];
      marginL.push(at(1, w + tooth, FOLD * w));
      marginR.push(at(-1, w + tooth, FOLD * w));
      keel.push(at(1, 0, -BELLY * w));
    }
    const fold = c;
    const k = Math.round(S * 0.35);
    // The middle of the leaf's section, for pointing each face's normal
    // OUT of the leaf. Not the boulder's absolute value: that lights an
    // underside facing the ground as brightly as a top facing the sky,
    // and the dark belly under a light trough is what reads as thick.
    const mid: V3 = [
      c[k][0] - frames[k].Nn[0] * BELLY * width(k / S) * 0.4,
      c[k][1] - frames[k].Nn[1] * BELLY * width(k / S) * 0.4,
      c[k][2] - frames[k].Nn[2] * BELLY * width(k / S) * 0.4,
    ];
    const litOf = (a: V3, b: V3) => {
      const T = frames[k].T;
      const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      let nx = T[1] * ac[2] - T[2] * ac[1];
      let ny = T[2] * ac[0] - T[0] * ac[2];
      let nz = T[0] * ac[1] - T[1] * ac[0];
      const out = [(a[0] + b[0]) / 2 - mid[0], (a[1] + b[1]) / 2 - mid[1], (a[2] + b[2]) / 2 - mid[2]];
      if (nx * out[0] + ny * out[1] + nz * out[2] < 0) [nx, ny, nz] = [-nx, -ny, -nz];
      const d = (nx * LX + ny * LY + nz * LZ) / (Math.hypot(nx, ny, nz) || 1);
      return 0.3 + 0.7 * Math.max(0, d); // a floor, so a face in shade is still paper
    };
    for (const [margin, side] of [
      [marginL, 1],
      [marginR, -1],
    ] as [V3[], number][]) {
      // Upper half: the midline to the raised margin. Flecks sit here.
      const flecks: [V3, V3][] = [];
      if (lf.flecked) {
        const n = 2 + Math.floor(rng() * 2);
        for (let f = 0; f < n; f++) {
          const i = 2 + Math.floor(rng() * (S * 0.45));
          const s0 = 0.25 + rng() * 0.35;
          const w = width(i / S);
          const { Sd, Nn } = frames[i];
          const pt = (s: number): V3 => [
            c[i][0] + Sd[0] * side * w * s + Nn[0] * FOLD * w * s,
            c[i][1] + Nn[1] * FOLD * w * s,
            c[i][2] + Sd[2] * side * w * s + Nn[2] * FOLD * w * s,
          ];
          flecks.push([pt(s0), pt(s0 + 0.28)]);
        }
      }
      faces.push({
        a: fold,
        b: margin,
        edges: [
          { line: fold, w: 0.5, a: 0.45 },
          { line: margin, w: 1, a: null },
        ],
        flecks,
        lit: litOf(fold[k], margin[k]),
      });
      // Underside half: the margin round to the keel. This is the
      // succulent's body, and what an agave blade has no room for.
      faces.push({
        a: margin,
        b: keel,
        edges: [
          { line: keel, w: 0.6, a: 0.55 },
          { line: margin, w: 1, a: null },
        ],
        flecks: [],
        lit: litOf(margin[k], keel[k]),
      });
    }
  }

  // The blooms. Each stalk leaves the crown from among the leaves, leans
  // a little outward and away from its partner, and carries its flowers
  // on the top third: open tubes hanging at the bottom of the spike,
  // shorter and turning up toward the buds at the tip.
  const leafTop = top * ys;
  const stalks: AloePlant["stalks"] = [];
  const lean0 = rot + rng() * Math.PI * 2;
  for (let st = 0; st < 2; st++) {
    const la = lean0 + st * (Math.PI * 0.8 + rng() * 0.6);
    const lean = Math.sin((5 + rng() * 9) * deg);
    const tall = leafTop * (1.85 + rng() * 0.3);
    const bx = x + Math.cos(la) * rw * 0.05;
    const bz = z + Math.sin(la) * rw * 0.05;
    const by = leafTop * 0.08;
    const along = (t: number): V3 => {
      const off = tall * lean * Math.pow(t, 1.4); // bends out more toward the top
      return [bx + Math.cos(la) * off, by + (tall - by) * t, bz + Math.sin(la) * off];
    };
    const pieces: AloePlant["stalks"][number]["pieces"] = [];
    const tubes: AloePlant["stalks"][number]["tubes"] = [];
    const SEGS = 10;
    for (let i = 0; i < SEGS; i++) pieces.push({ a: along(i / SEGS), b: along((i + 1) / SEGS), w: 1 - 0.35 * (i / SEGS) });
    const M = 16; // whorls up the spike
    for (let j = 0; j < M; j++) {
      const u = j / (M - 1); // 0 = the lowest, open flowers; 1 = the tip
      const ax = along(0.68 + 0.315 * u);
      const tilt = (-62 + 102 * Math.pow(u, 1.3)) * deg; // hanging, then up
      const len = rw * (0.12 - 0.075 * u);
      for (let m = 0; m < 3; m++) {
        const phi = st * 1.3 + j * 2.399963 + (m * Math.PI * 2) / 3;
        const hx = Math.cos(phi);
        const hz = Math.sin(phi);
        const base: V3 = [ax[0] + hx * rw * 0.02, ax[1], ax[2] + hz * rw * 0.02];
        const tip: V3 = [base[0] + hx * Math.cos(tilt) * len, base[1] + Math.sin(tilt) * len, base[2] + hz * Math.cos(tilt) * len];
        tubes.push({ base, tip, open: u <= 0.72 });
      }
    }
    stalks.push({ pieces, tubes });
  }
  return { faces, stalks };
}
