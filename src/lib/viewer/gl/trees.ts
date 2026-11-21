// The trees as the WebGL layer draws them: each grown by the same grower
// the canvas uses, then laid out in the order the canvas paints it (see
// each species' `draw…Body` in LivingBlueprint) — the limbs by order, the
// lobes of foliage far first, the flecks of leaf a tone at a time.
//
// Nothing in a tree is drawn in depth against the rest of it: the canvas
// paints a tree back to front by those steps, not leaf by leaf, so the
// flecks lie over the lobes and the lobes over the limbs from any side.
// Each step is still hidden behind the house where it stands behind it.

import { growPaloVerde, PALO_VERDE_COLOURS, PALO_VERDE_GOLD, PV_LEVELS, PV_TONES } from "../bodies/paloVerde";
import { growMesquite, MESQUITE_COLOURS, MESQUITE_GOLD, MQ_LEVELS, MQ_TONES } from "../bodies/mesquite";
import { EB_LEVELS, EB_PUFF_TONES, EB_TONES, EBONY_COLOURS, EBONY_GOLD, EBONY_MODELS, growEbony } from "../bodies/ebony";
import { growMulga, MU_LEVELS, MU_TONES, MULGA_COLOURS, MULGA_GOLD, MULGA_MODELS } from "../bodies/mulga";
import { CHASTE_COLOURS, CHASTE_GOLD, CT_LEAF_TONES, CT_LEVELS, CT_SPIKE_LEVELS, CT_SPIKE_TONES, growChaste } from "../bodies/chaste";
import { hull3, rgb3, rgba } from "./geom";
import type { MeshBuilder } from "./mesh";

type V3 = [number, number, number];

/** The trees the layer can draw. */
export const TREE_MODELS = new Set(["PaloVerde", "HoneyMesquite", ...EBONY_MODELS, ...MULGA_MODELS, "Vitex"]);

/** Lays out the tree `model`, if it's one. */
export function buildTree(b: MeshBuilder, model: string, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  if (model === "PaloVerde") paloVerde(b, x, z, h, rw, rot, id);
  else if (model === "HoneyMesquite") mesquite(b, x, z, h, rw, rot, id);
  else if (EBONY_MODELS.has(model)) ebony(b, x, z, h, rw, rot, id);
  else if (MULGA_MODELS.has(model)) mulga(b, x, z, h, rw, rot, id);
  else if (model === "Vitex") chaste(b, x, z, h, rw, rot, id);
}

/** Limbs by order, each order one stroke of its own width — feet at the
 *  tree, floored in pixels — and colour, inking each pixel once. */
function limbs(b: MeshBuilder, orders: V3[][][], widths: number[], floors: number[], colour: (order: number) => [string, string]) {
  orders.forEach((segs, order) => {
    const [c, g] = colour(order);
    const s0 = b.strokes;
    for (const [a, e] of segs) b.stroke(a, e, [widths[order], 0, floors[order]], rgba(c), rgba(g), true);
    b.strokeRun(s0, b.once());
  });
}

/** Lobes of foliage, translucent, each filled over the ones behind it. */
function lobes(b: MeshBuilder, list: { c: V3; rx: number; ry: number; col: [string, string] }[]) {
  const l0 = b.lobes;
  for (const L of list) b.lobe(L.c, L.rx, L.ry, rgba(L.col[0]), rgba(L.col[1]));
  b.lobeRun(l0, false, 0);
}

/** Flecks of one tone ramp, group by group, each placed by its lobe. */
function flecks(
  b: MeshBuilder,
  centres: V3[],
  lobe: Uint16Array,
  off: Float32Array,
  slant: Float32Array,
  from: number,
  to: number,
  starts: Int32Array,
  tones: [string[], string[]],
) {
  let gi = 0;
  for (let i = from; i < to; i++) {
    while (i >= starts[gi + 1]) gi++;
    b.fleck(centres[lobe[i]], off.subarray(i * 3, i * 3 + 3), slant[i], rgba(tones[0][gi]), rgba(tones[1][gi]));
  }
}

function paloVerde(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const t = growPaloVerde(x, z, h, rw, rot, id);
  const pal = PALO_VERDE_COLOURS;
  const gpal = PALO_VERDE_GOLD;
  limbs(b, t.limbs, [0.9, 0.45, 0.22, 0.09, 0.04], [2.2, 1.5, 1, 0.6, 0.45], (o) =>
    o === 0 ? [pal.trunk, gpal.trunk] : o < 3 ? [pal.limb, gpal.limb] : [pal.twig, gpal.twig],
  );
  lobes(b, t.lobes);
  const c = t.lobes.map((L) => L.c);
  const g = t.groupStart;
  const k0 = b.flecks;
  flecks(b, c, t.fleckLobe, t.fleckOff, t.fleckSlant, g[0], g[PV_LEVELS], g, [PV_TONES[0], PV_TONES[1]]);
  b.fleckRun(k0, { shape: 0, ft: 0.42, floor: 1.4, mul: 1, wd: 0.45, cull: 0 });
  // Then the flowers, a little smaller.
  const k1 = b.flecks;
  const bloom: [string[], string[]] = [Array(PV_LEVELS + 1).fill(pal.bloom), Array(PV_LEVELS + 1).fill(gpal.bloom)];
  flecks(b, c, t.fleckLobe, t.fleckOff, t.fleckSlant, g[PV_LEVELS], g[PV_LEVELS + 1], g, bloom);
  b.fleckRun(k1, { shape: 0, ft: 0.42, floor: 1.4, mul: 0.8, wd: 0.45, cull: 0 });
}

function mesquite(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const t = growMesquite(x, z, h, rw, rot, id);
  const pal = MESQUITE_COLOURS;
  const gpal = MESQUITE_GOLD;
  limbs(b, t.limbs, [1.5, 0.6, 0.28, 0.1], [2.6, 1.7, 1, 0.6], (o) =>
    o === 0 ? [pal.trunk, gpal.trunk] : o < 3 ? [pal.limb, gpal.limb] : [pal.twig, gpal.twig],
  );
  lobes(b, t.lobes);
  // The weeping strands, one stroke: the canvas's curve through each
  // strand's three points, in short straight pieces.
  const s0 = b.strokes;
  const col = rgba(pal.strand);
  const gold = rgba(gpal.strand);
  const N = 8;
  for (const [A, B, C] of t.strands) {
    let prev: V3 = A;
    for (let k = 1; k <= N; k++) {
      const u = k / N;
      const a = (1 - u) * (1 - u);
      const m = 2 * u * (1 - u);
      const e = u * u;
      const q: V3 = [a * A[0] + m * B[0] + e * C[0], a * A[1] + m * B[1] + e * C[1], a * A[2] + m * B[2] + e * C[2]];
      b.stroke(prev, q, [0.06, 0, 0.6], col, gold, true);
      prev = q;
    }
  }
  b.strokeRun(s0, b.once());
  const c = t.lobes.map((L) => L.c);
  const g = t.groupStart;
  const k0 = b.flecks;
  flecks(b, c, t.fleckLobe, t.fleckOff, t.fleckSlant, g[0], g[MQ_LEVELS], g, [MQ_TONES[0], MQ_TONES[1]]);
  b.fleckRun(k0, { shape: 0, ft: 0.4, floor: 1.4, mul: 1, wd: 0.4, cull: 0 });
  // Catkins are longer and thinner than the leaflets.
  const k1 = b.flecks;
  const bloom: [string[], string[]] = [Array(MQ_LEVELS + 1).fill(pal.bloom), Array(MQ_LEVELS + 1).fill(gpal.bloom)];
  flecks(b, c, t.fleckLobe, t.fleckOff, t.fleckSlant, g[MQ_LEVELS], g[MQ_LEVELS + 1], g, bloom);
  b.fleckRun(k1, { shape: 0, ft: 0.4, floor: 1.4, mul: 1.3, wd: 0.25, cull: 0 });
}

function ebony(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const t = growEbony(x, z, h, rw, rot, id);
  const pal = EBONY_COLOURS;
  const gpal = EBONY_GOLD;
  limbs(b, t.limbs, [1.6, 0.8], [2.6, 1.8], (o) => (o === 0 ? [pal.trunk, gpal.trunk] : [pal.limb, gpal.limb]));
  // The crown's set-back shell, one dark silhouette.
  const t0 = b.tri.length;
  const base = b.verts;
  const cc = rgb3(pal.core);
  const cg = rgb3(gpal.core);
  for (const p of t.coreRing) b.vert(p[0], p[1], p[2], cc, cg);
  for (const i of hull3(t.coreRing)) b.tri.push(base + i);
  b.tris(t0, false, false);
  // Puffs, ragged, in five bands far to near and each band a tone at a time.
  const l0 = b.lobes;
  for (const L of t.puffs) b.lobe(L.c, L.rx, L.ry, rgba(EB_PUFF_TONES[0][L.level]), rgba(EB_PUFF_TONES[1][L.level]), L.level, L.jit);
  b.lobeRun(l0, true, 5);
  // Leaflets and pods, on the near side of the crown only.
  const c = t.puffs.map((L) => L.c);
  const g = t.groupStart;
  const centre: V3 = [x, h * 0.55, z];
  const k0 = b.flecks;
  flecks(b, c, t.fleckPuff, t.fleckOff, t.fleckSlant, g[0], g[EB_LEVELS], g, [EB_TONES[0], EB_TONES[1]]);
  b.fleckRun(k0, { shape: 0, ft: 0.3, floor: 1.2, mul: 1, wd: 0.7, cull: 1, centre });
  const k1 = b.flecks;
  const pod: [string[], string[]] = [Array(EB_LEVELS + 1).fill(pal.pod), Array(EB_LEVELS + 1).fill(gpal.pod)];
  flecks(b, c, t.fleckPuff, t.fleckOff, t.fleckSlant, g[EB_LEVELS], g[EB_LEVELS + 1], g, pod);
  b.fleckRun(k1, { shape: 0, ft: 0.3, floor: 1.2, mul: 1.5, wd: 0.28, cull: 1, centre });
}

function mulga(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const t = growMulga(x, z, h, rw, rot, id);
  const pal = MULGA_COLOURS;
  const gpal = MULGA_GOLD;
  limbs(b, t.limbs, [0.75, 0.4, 0.16, 0.07], [2.2, 1.6, 0.9, 0.6], (o) =>
    o === 0 ? [pal.trunk, gpal.trunk] : o < 3 ? [pal.limb, gpal.limb] : [pal.twig, gpal.twig],
  );
  lobes(b, t.lobes);
  // Phyllodes: thin needles.
  const g = t.groupStart;
  const k0 = b.flecks;
  flecks(b, t.lobes.map((L) => L.c), t.fleckLobe, t.fleckOff, t.fleckSlant, g[0], g[MU_LEVELS], g, [MU_TONES[0], MU_TONES[1]]);
  b.fleckRun(k0, { shape: 0, ft: 0.32, floor: 1.3, mul: 1, wd: 0.22, cull: 0 });
}

function chaste(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const t = growChaste(x, z, h, rw, rot, id);
  const pal = CHASTE_COLOURS;
  const gpal = CHASTE_GOLD;
  limbs(b, t.limbs, [0.42, 0.22, 0.08], [2, 1.2, 0.6], (o) => (o === 0 ? [pal.trunk, gpal.trunk] : [pal.limb, gpal.limb]));
  lobes(b, t.lobes);
  // Leaves and spikes on the side of their mass facing the eye.
  const k0 = b.flecks;
  let gi = 0;
  for (let i = 0; i < t.leafStart[CT_LEVELS]; i++) {
    while (i >= t.leafStart[gi + 1]) gi++;
    const L = t.lobes[t.leafLobe[i]];
    b.fleck(L.c, t.leafOff.subarray(i * 3, i * 3 + 3), t.leafSlant[i], rgba(CT_LEAF_TONES[0][gi]), rgba(CT_LEAF_TONES[1][gi]), undefined, L.n);
  }
  b.fleckRun(k0, { shape: 1, ft: 0.8, floor: 1.6, mul: 1, wd: 0.5, cull: 2, slack: 0 });
  const k1 = b.flecks;
  gi = 0;
  for (let i = 0; i < t.spikeStart[CT_SPIKE_LEVELS]; i++) {
    while (i >= t.spikeStart[gi + 1]) gi++;
    const L = t.lobes[t.spikeLobe[i]];
    b.fleck(
      L.c,
      t.spikeOff.subarray(i * 3, i * 3 + 3),
      0,
      rgba(CT_SPIKE_TONES[0][gi]),
      rgba(CT_SPIKE_TONES[1][gi]),
      t.spikeDir.subarray(i * 3, i * 3 + 3),
      L.n,
    );
  }
  b.fleckRun(k1, { shape: 2, ft: 0, floor: 0, mul: 1, wd: 0, cull: 2, slack: 0.25 });
}
