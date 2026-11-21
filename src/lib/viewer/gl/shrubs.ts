// The leafy shrubs as the WebGL layer draws them: each grown by the same
// grower the canvas uses, then laid into triangles, outlines, strokes and
// flower heads in the order the canvas paints them (see each species'
// `draw…Body` in LivingBlueprint).
//
// Leaves are flat colours as their grower lit them. What the canvas paints
// first and leaves under everything — a core, stems, a shaded heart — is
// drawn without depth; the rest with it, so each leaf is hidden where a
// nearer one covers it, as the far-first painting does.

import { growTexasSage, sageCoreRing, SAGE_COLOURS, SAGE_GOLD } from "../bodies/sage";
import { growHopseed } from "../bodies/hopseed";
import { growWhiteDawn, WHITE_DAWN_COLOURS, WHITE_DAWN_GOLD, WHITE_DAWN_LEAF, WD_LEVELS, WD_TONES } from "../bodies/whiteDawn";
import {
  growPurpleLantana,
  growYellowLantana,
  PL_TONES,
  PURPLE_LANTANA_COLOURS,
  PURPLE_LANTANA_GOLD,
  PURPLE_LEAF,
  YELLOW_LANTANA_COLOURS,
  YELLOW_LANTANA_GOLD,
  YELLOW_LEAF,
  YL_TONES,
} from "../bodies/lantana";
import { growYellowBells, LEAFLET, TRUMPET } from "../bodies/yellowBells";
import { BLOOM, FROND, growRedBird, RED_BIRD_COLOURS, RED_BIRD_GOLD } from "../bodies/redBird";
import { growJojoba, JOJOBA_COLOURS, JOJOBA_GOLD, JOJOBA_LEAF, jojobaCoreRing } from "../bodies/jojoba";
import {
  BOTTLEBRUSH_COLOURS,
  BOTTLEBRUSH_GOLD,
  BOTTLEBRUSH_LEAF,
  bottlebrushCoreRing,
  growBottlebrush,
} from "../bodies/bottlebrush";
import { earcut, hull3, rgb3, rgba, type Rgba } from "./geom";
import { flowerPalette, MeshBuilder, type Built } from "./mesh";
import { buildSucculent, SUCCULENT_MODELS } from "./succulents";
import { buildTree, TREE_MODELS } from "./trees";

/** A plant the layer draws: where, how big, which way it turns. */
export type GLPlant = {
  id: string;
  model: string;
  x: number;
  z: number;
  h: number;
  rw: number;
  rot: number;
  gold: boolean;
  lw: number;
};

/** The species the layer can draw: these shrubs, the trees, and the cacti
 *  and agaves. */
export const GL_MODELS = new Set([
  "TexasSage",
  "GreenHopseed",
  "WhiteDawnLantana",
  "PurpleLantana",
  "YellowLantana",
  "YellowBells",
  "RedBirdOfParadise",
  "Jojoba",
  "LittleJohnBottlebrush",
  ...TREE_MODELS,
  ...SUCCULENT_MODELS,
]);

const INK_EDGE = rgba("rgba(28,42,33,0.4)");
const GOLD_EDGE = rgba("rgba(168,123,47,0.6)");
const GOLD_8 = rgba("rgba(168,123,47,0.8)");

/** A convex shape's triangles: a fan from its first corner. */
const fan = (n: number) => {
  const out: number[] = [];
  for (let k = 1; k < n - 1; k++) out.push(0, k, k + 1);
  return out;
};
const TRI_YB_LEAF = fan(LEAFLET.length);
const TRI_YB_TRUMPET = earcut(TRUMPET);
const TRI_RB_FROND = earcut(FROND);
const TRI_RB_BLOOM = earcut(BLOOM);

/** A core: the hull of its points, solid, under everything else. */
function core(b: MeshBuilder, pts: [number, number, number][], col: Rgba, gold: Rgba) {
  const base = b.verts;
  for (const p of pts) b.vert(p[0], p[1], p[2], col, gold);
  for (const i of hull3(pts)) b.tri.push(base + i);
}

/** One plant grown and laid out. Its key is everything its leaves depend
 *  on; colours both ways are in it, so a pick or hover doesn't rebuild. */
export function plantKey(p: GLPlant) {
  return `${p.model}|${p.id}|${p.x}|${p.z}|${p.h}|${p.rw}|${p.rot}`;
}

export function buildPlant(p: GLPlant): Built {
  const b = new MeshBuilder();
  const { x, z, h, rw, rot, id } = p;
  switch (p.model) {
    case "TexasSage":
      sage(b, x, z, h, rw, id);
      break;
    case "GreenHopseed":
      hopseed(b, x, z, h, rw, rot, id);
      break;
    case "WhiteDawnLantana":
      whiteDawn(b, x, z, h, rw, rot, id);
      break;
    case "PurpleLantana":
    case "YellowLantana":
      lantana(b, x, z, h, rw, rot, id, p.model === "YellowLantana");
      break;
    case "YellowBells":
      yellowBells(b, x, z, h, rw, rot, id);
      break;
    case "RedBirdOfParadise":
      redBird(b, x, z, h, rw, rot, id);
      break;
    case "Jojoba":
      jojoba(b, x, z, h, rw, rot, id);
      break;
    case "LittleJohnBottlebrush":
      bottlebrush(b, x, z, h, rw, rot, id);
      break;
    default:
      if (SUCCULENT_MODELS.has(p.model)) buildSucculent(b, p.model, x, z, h, rw, rot, id);
      else buildTree(b, p.model, x, z, h, rw, rot, id);
  }
  return b.finish();
}

function sage(b: MeshBuilder, x: number, z: number, h: number, rw: number, id: string) {
  const tufts = growTexasSage(x, z, h, rw, id);
  const ring = sageCoreRing(x, z, h, rw);
  // The core: the dome set back inside the tufts, solid, so the gaps between
  // them never show sand. Its rings of sixteen, and a lid.
  const cc = rgb3(SAGE_COLOURS.core);
  const cg = rgb3(SAGE_GOLD.core);
  const t0 = b.tri.length;
  const base = b.verts;
  for (const p of ring) b.vert(p[0], p[1], p[2], cc, cg);
  const RINGS = ring.length / 16;
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < 16; j++) {
      const a = base + i * 16 + j;
      const bb = base + i * 16 + ((j + 1) % 16);
      const c = base + (i + 1) * 16 + j;
      const d = base + (i + 1) * 16 + ((j + 1) % 16);
      b.tri.push(a, bb, d, a, d, c);
    }
  }
  const top = ring.slice((RINGS - 1) * 16);
  const mid = top.reduce((s, q) => [s[0] + q[0] / 16, s[1] + q[1] / 16, s[2] + q[2] / 16], [0, 0, 0]);
  const m = b.vert(mid[0], mid[1], mid[2], cc, cg);
  for (let j = 0; j < 16; j++) b.tri.push(m, base + (RINGS - 1) * 16 + j, base + (RINGS - 1) * 16 + ((j + 1) % 16));
  b.tris(t0, false, false);

  const t1 = b.tri.length;
  const l1 = b.line.length;
  const F8 = fan(8);
  const F7 = fan(7);
  for (const t of tufts) {
    const leaves = b.shapes(t.c, t.leaves, 8, F8, rgba(t.leafCol[0]), rgba(t.leafCol[1]));
    const spikes = b.shapes(t.c, t.spikes, 7, F7, rgba(t.spikeCol[0]), rgba(t.spikeCol[1]));
    if (t.inner) continue;
    b.outline(leaves, 8);
    b.outline(spikes, 7);
  }
  b.tris(t1, true, false);
  b.lines(l1, INK_EDGE, GOLD_EDGE, false, b.once());
}

function hopseed(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const grown = growHopseed(x, z, h, rw, rot, id);
  // Stems, first, each its own stroke: the foliage closes over them above
  // the base.
  const s0 = b.strokes;
  const stem = rgba("rgba(98,82,64,0.9)");
  for (const [a, c] of grown.stems) b.stroke(a, c, [0.16, 1, 0], stem, GOLD_8, true);
  b.strokeRun(s0, 0);

  const t0 = b.tri.length;
  const l0 = b.line.length;
  const F6 = fan(6);
  for (const sp of grown.sprays) {
    const leaves = b.shapes(sp.c, sp.off, 6, F6, rgba(sp.col), rgba(sp.gold));
    if (!sp.inner) b.outline(leaves, 6);
  }
  b.tris(t0, true, false);
  b.lines(l0, INK_EDGE, GOLD_EDGE, false, b.once());
}

function whiteDawn(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const grown = growWhiteDawn(x, z, h, rw, rot, id);
  // The runners, as one path.
  const s0 = b.strokes;
  const stem = rgba(WHITE_DAWN_COLOURS.stem);
  const stemG = rgba(WHITE_DAWN_GOLD.stem);
  for (const path of grown.runners) b.path(path, [rw * 0.012, 0.4, 0], stem, stemG);
  b.strokeRun(s0, b.once());

  const F = fan(WHITE_DAWN_LEAF.length);
  const n = WHITE_DAWN_LEAF.length;
  const [plain, gold] = WD_TONES;
  // The shaded heart, under the rest, a step of tone at a time.
  let m0 = 0;
  const t0 = b.tri.length;
  for (; m0 < grown.sprigs.length && grown.sprigs[m0].inner; m0++) {
    const sp = grown.sprigs[m0];
    b.shapes(sp.c, sp.leaves, n, F, rgba(plain[WD_LEVELS + sp.tone]), rgba(gold[WD_LEVELS + sp.tone]));
  }
  b.tris(t0, false, false);
  const t1 = b.tri.length;
  for (let i = m0; i < grown.sprigs.length; i++) {
    const sp = grown.sprigs[i];
    b.shapes(sp.c, sp.leaves, n, F, rgba(plain[sp.tone]), rgba(gold[sp.tone]));
  }
  b.tris(t1, true, false);

  const f0 = b.flowers;
  for (const [fx, fy, fz, r] of grown.flowers) b.flower([fx, fy, fz], null, r, fx, 0);
  const pal = (c: typeof WHITE_DAWN_COLOURS) => flowerPalette({ flower: [c.flower], floret: [c.floret], eye: c.eye }, rgba);
  b.flowerRun(f0, 0, 0.05, 0.2, pal(WHITE_DAWN_COLOURS), pal(WHITE_DAWN_GOLD));
}

function lantana(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string, yellow: boolean) {
  const grown = yellow ? growYellowLantana(x, z, h, rw, rot, id) : growPurpleLantana(x, z, h, rw, rot, id);
  const COL = yellow ? YELLOW_LANTANA_COLOURS : PURPLE_LANTANA_COLOURS;
  const GOLD = yellow ? YELLOW_LANTANA_GOLD : PURPLE_LANTANA_GOLD;
  const [plain, gold] = yellow ? YL_TONES : PL_TONES;
  const LEAF = yellow ? YELLOW_LEAF : PURPLE_LEAF;

  const t0 = b.tri.length;
  core(b, grown.core, rgba(COL.core), rgba(GOLD.core));
  b.tris(t0, false, false);

  const F = fan(LEAF.length);
  const n = LEAF.length;
  let m0 = 0;
  const t1 = b.tri.length;
  for (; m0 < grown.sprigs.length && grown.sprigs[m0].inner; m0++) {
    const sp = grown.sprigs[m0];
    b.shapes(sp.c, sp.leaves, n, F, rgba(plain.inner[sp.tone]), rgba(gold.inner[sp.tone]), sp);
  }
  b.tris(t1, false, true);
  const t2 = b.tri.length;
  for (let i = m0; i < grown.sprigs.length; i++) {
    const sp = grown.sprigs[i];
    b.shapes(sp.c, sp.leaves, n, F, rgba(plain.leaf[sp.tone]), rgba(gold.leaf[sp.tone]), sp);
  }
  b.tris(t2, true, true);

  const f0 = b.flowers;
  const fl = grown.flowers;
  for (let o = 0; o < fl.length; o += 8) {
    const spin = fl[o];
    // The yellow's florets crowd its heads unevenly, by a jitter the canvas
    // works out from where the head is; worked out here once, as the
    // card's sines aren't the browser's.
    const jit = yellow
      ? Array.from({ length: 7 }, (_, k) => (Math.sin(spin * 53 + k * 12.9898) * 43758.5453) % 1)
      : undefined;
    b.flower(fl.subarray(o, o + 3), fl.subarray(o + 4, o + 7), fl[o + 3], spin, fl[o + 7], jit);
  }
  const pal = (t: typeof plain, c: typeof COL) =>
    flowerPalette(
      { flower: t.flower, lit: t.flowerLit, floret: t.floret, bud: (t as { bud?: string[] }).bud, eye: c.eye },
      rgba,
    );
  b.flowerRun(f0, yellow ? 2 : 1, yellow ? 0.1 : 0.05, 0.4, pal(plain, COL), pal(gold, GOLD));
}

function yellowBells(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const grown = growYellowBells(x, z, h, rw, rot, id);
  const s0 = b.strokes;
  const stem = rgba("rgba(78,62,48,0.9)");
  for (const [a, c] of grown.stems) b.stroke(a, c, [0.1, 0.8, 0], stem, GOLD_8, true);
  b.strokeRun(s0, 0);

  const t0 = b.tri.length;
  const leafEdges: number[][] = [];
  const bloomEdges: number[][] = [];
  for (const pt of grown.parts) {
    const tris = pt.corners === TRUMPET.length ? TRI_YB_TRUMPET : TRI_YB_LEAF;
    const shapes = b.shapes(pt.c, pt.pts, pt.corners, tris, rgba(pt.col[0]), rgba(pt.col[1]), pt);
    if (pt.kind === "bloom") bloomEdges.push(shapes, [pt.corners]);
    else if (pt.kind === "leaf") leafEdges.push(shapes, [pt.corners]);
  }
  b.tris(t0, true, false);
  // Outlines on the near side only, the leaves' and the trumpets' apart.
  const once = b.once();
  const l0 = b.line.length;
  for (let i = 0; i < leafEdges.length; i += 2) b.outline(leafEdges[i], leafEdges[i + 1][0]);
  b.lines(l0, INK_EDGE, GOLD_EDGE, true, once);
  const l1 = b.line.length;
  for (let i = 0; i < bloomEdges.length; i += 2) b.outline(bloomEdges[i], bloomEdges[i + 1][0]);
  b.lines(l1, rgba("rgba(112,72,12,0.85)"), GOLD_8, true, once);
}

function redBird(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const grown = growRedBird(x, z, h, rw, rot, id);
  const pal = RED_BIRD_COLOURS;
  const gpal = RED_BIRD_GOLD;
  const s0 = b.strokes;
  for (const [a, c] of grown.stems) b.stroke(a, c, [0.08, 0.7, 0], rgba(pal.stem), rgba(gpal.stem), true);
  b.strokeRun(s0, 0);

  const t0 = b.tri.length;
  const fronds: number[] = [];
  const blooms: number[] = [];
  for (const pt of grown.parts) {
    if (pt.kind === "stalk") continue;
    const tris = pt.kind === "bloom" ? TRI_RB_BLOOM : TRI_RB_FROND;
    const [s] = b.shapes(pt.c, pt.pts, pt.corners, tris, rgba(pt.col[0]), rgba(pt.col[1]));
    if (pt.kind === "frond") fronds.push(s);
    else if (pt.kind === "bloom") blooms.push(s);
  }
  b.tris(t0, true, false);
  const once = b.once();
  const l0 = b.line.length;
  b.outline(fronds, FROND.length);
  b.lines(l0, INK_EDGE, GOLD_EDGE, false, once);
  const l1 = b.line.length;
  b.outline(blooms, BLOOM.length);
  b.lines(l1, rgba(pal.edge), rgba(gpal.edge), false, once);

  // The flower stalks, each its own stroke, then the stamens.
  const s1 = b.strokes;
  for (const pt of grown.parts) {
    if (pt.kind !== "stalk") continue;
    const tip = [pt.c[0] + pt.pts[3], pt.c[1] + pt.pts[4], pt.c[2] + pt.pts[5]];
    b.stroke(pt.c, tip, [0.03, 0, 0.8], rgba(pt.col[0]), rgba(pt.col[1]), true);
  }
  b.strokeRun(s1, 0);
  const s2 = b.strokes;
  for (const pt of grown.parts) {
    if (!pt.lines) continue;
    const ln = pt.lines;
    for (let o = 0; o < ln.length; o += 6) {
      b.stroke(pt.c, [pt.c[0] + ln[o + 3], pt.c[1] + ln[o + 4], pt.c[2] + ln[o + 5]], [0, 0.4, 0.6], rgba(pal.stamen), rgba(gpal.stamen), true);
    }
  }
  b.strokeRun(s2, b.once());
}

function jojoba(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const grown = growJojoba(x, z, h, rw, rot, id);
  const pal = JOJOBA_COLOURS;
  const gpal = JOJOBA_GOLD;
  const t0 = b.tri.length;
  core(b, jojobaCoreRing(x, z, h, rw), rgb3(pal.core), rgb3(gpal.core));
  b.tris(t0, false, false);

  // Stems and twigs, under every leaf, each set one path.
  const s0 = b.strokes;
  for (const [a, c] of grown.stems) b.stroke(a, c, [0.045, 0.5, 0], rgba(pal.stem), rgba(gpal.stem), true);
  b.strokeRun(s0, b.once());
  const s1 = b.strokes;
  for (const sp of grown.sprigs) {
    if (sp.inner) continue;
    b.stroke(sp.c, [sp.c[0] + sp.tip[0], sp.c[1] + sp.tip[1], sp.c[2] + sp.tip[2]], [0.025, 0.4, 0], rgba(pal.twig), rgba(gpal.twig), true);
  }
  b.strokeRun(s1, b.once());

  const t1 = b.tri.length;
  const l0 = b.line.length;
  const F = fan(JOJOBA_LEAF.length);
  for (const sp of grown.sprigs) {
    const leaves = b.shapes(sp.c, sp.leaves, JOJOBA_LEAF.length, F, rgba(sp.col[0]), rgba(sp.col[1]), sp);
    if (!sp.inner) b.outline(leaves, JOJOBA_LEAF.length);
  }
  b.tris(t1, true, false);
  b.lines(l0, INK_EDGE, GOLD_EDGE, true, b.once());
}

function bottlebrush(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const grown = growBottlebrush(x, z, h, rw, rot, id);
  const pal = BOTTLEBRUSH_COLOURS;
  const gpal = BOTTLEBRUSH_GOLD;
  const t0 = b.tri.length;
  core(b, bottlebrushCoreRing(x, z, h, rw), rgb3(pal.core), rgb3(gpal.core));
  b.tris(t0, false, false);

  const s0 = b.strokes;
  for (const path of grown.arms) b.path(path, [0.05, 0.6, 0], rgba(pal.stem), rgba(gpal.stem));
  b.strokeRun(s0, b.once());

  const t1 = b.tri.length;
  const l0 = b.line.length;
  const n = BOTTLEBRUSH_LEAF.length;
  const F = fan(n);
  for (const pt of grown.parts) {
    if (pt.kind === "brush") continue;
    const needles = b.shapes(pt.c, pt.pts, n, F, rgba(pt.col[0]), rgba(pt.col[1]), pt);
    if (pt.kind !== "inner") b.outline(needles, n);
  }
  b.tris(t1, true, false);
  b.lines(l0, INK_EDGE, GOLD_EDGE, true, b.once());

  // The brushes: a round stroke down each one's axis, then its stamens
  // bristling across the axis as it lies on screen. Each stands inside
  // its shoot's whorls, which the canvas paints it over whole as their
  // middles sort; here the needles round it would hide it, so it's drawn
  // half a needle's length nearer (a whole one clears them all).
  const near = rw * 0.08;
  const s1 = b.strokes;
  const ends = grown.parts
    .filter((pt) => pt.kind === "brush")
    .map((pt) => {
      const q = pt.pts;
      const a = [pt.c[0] + q[0], pt.c[1] + q[1], pt.c[2] + q[2]];
      const c = [pt.c[0] + q[3], pt.c[1] + q[4], pt.c[2] + q[5]];
      return { a, c, q };
    });
  for (const { a, c } of ends) b.stroke(a, c, [0.1, 1, 0], rgba(pal.brush), rgba(gpal.brush), true);
  b.strokeRun(s1, 0, undefined, near);
  const s2 = b.strokes;
  for (const { a, c, q } of ends) {
    for (let o = 6; o < q.length; o += 3) {
      b.strokeMode(a, c, [0.016, 0, 0.8], 1, rgba(pal.stamen), rgba(gpal.stamen), [q[o], q[o + 1], q[o + 2], 0]);
    }
  }
  b.strokeRun(s2, b.once(), [0.12, 2.5], near);
}
