// The plants with no model of their own as the WebGL layer draws them: the
// plain glyph of their kind the canvas draws (see `drawBarrelBody`,
// `drawTrunk`, and the tree, palm, saguaro, rosette, light and pool in
// LivingBlueprint's `drawInstance`), from the same shapes, in its order.
// Nothing here is written in depth: like the canvas, each part goes over
// the last, and a nearer plant over the lot.

import { BARREL_RIBS, barrelCloud, barrelCrown, barrelRib, barrelRibAngle, barrelSpikes } from "../bodies/barrel";
import { palmFronds, rosetteLeaves, saguaroArms, saguaroR } from "../bodies/glyphs";
import { trunkLimbs, trunkWidths } from "../bodies/trunk";
import { rngFor, stipple, symbolFor, symbolRing } from "../symbols";
import { convexHull, edgesOf, gold, hull3, overPaper, rgba, verde, type Rgba } from "./geom";
import type { MeshBuilder } from "./mesh";
import { WATER_FILL, WATER_LINE } from "./yard";

type V3 = [number, number, number];
type Pal = [Rgba, Rgba];

const GOLD = rgba("#a87b2f");
/** A plant's own stroke: the ink at 0.85, or the gold whole. */
const STROKE: Pal = [verde(0.85), GOLD];
/** A plant's fill: green, or gold — half as strong only hovered, so
 *  picked, `MORE` goes over it. */
const FILL: Pal = [verde(0.08), gold(0.07)];
const MORE = gold(1 - (1 - 0.14) / (1 - 0.07));

/** The models drawn here. */
export const GLYPH_MODELS = new Set([
  "Firebarrel",
  "MexFanPalm",
  "SaguaroSpear",
  "AgaveGeminiflora",
  "DesertSpoonLg",
  "DesertSpoonSm",
  "HesperaloeLg",
  "HesperaloeMd",
  "HesperaloeSm",
  "MoroccanMound",
  "SantaRitaPricklyPear",
  "Orange_Tree",
  "NightUplight",
  "NightFloodlight",
  "NightPathlight",
  "SwimmingPool",
]);

/** Lays out the glyph of `model`'s kind; `scale` is a pool's size. */
export function buildGlyph(b: MeshBuilder, model: string, x: number, z: number, h: number, rw: number, rot: number, g: number, scale: number) {
  if (model === "Firebarrel") barrel(b, x, z, h, rw, rot);
  else if (model === "MexFanPalm") palm(b, x, z, h, g);
  else if (model === "SaguaroSpear") saguaro(b, x, z, h, rw, g);
  else if (model === "Orange_Tree") tree(b, model, x, z, h, rw, rot);
  else if (model.startsWith("Night")) light(b, x, z, h);
  else if (model === "SwimmingPool") pool(b, x, z, rot, scale);
  else rosette(b, x, z, h, rw);
}

/** A closed ring of points, inked once round, its joins round. */
function ring(b: MeshBuilder, pts: V3[], w: [number, number, number], col: Pal, o?: { pickedGold?: boolean }) {
  const s0 = b.strokes;
  for (let k = 1; k < pts.length; k++) b.stroke(pts[k - 1], pts[k], w, col[0], col[1], true);
  b.strokeRun(s0, b.once(), undefined, 0, o);
}

/** A flat convex shape filled: green, or gold, stronger picked. */
function disc(b: MeshBuilder, pts: V3[]) {
  for (const [col, gol, picked] of [[...FILL, false], [MORE, MORE, true]] as const) {
    const t0 = b.tri.length;
    const base = b.verts;
    for (const p of pts) b.vert(p[0], p[1], p[2], col, gol);
    for (let k = 1; k + 1 < pts.length; k++) b.tri.push(base, base + k, base + k + 1);
    b.tris(t0, false, false, { picked });
  }
}

/** A plain tree: the trunk, then its plan mark lifted to the canopy —
 *  filled, outlined, its inner ring, stipple and centre mark — and a
 *  smaller disc over it all near the top. The trunk, the inner ring and
 *  the stipple turn gold only picked. */
function tree(b: MeshBuilder, model: string, x: number, z: number, h: number, rw: number, rot: number) {
  const sym = symbolFor(model, "tree")!;
  const trunk = overPaper(verde(0.22));
  const bark: Pal = [verde(0.7), GOLD];
  const detail: Pal = [verde(0.42), GOLD];
  // The trunk: each piece a quad on screen, filled, then outlined, laid
  // out each frame — its widths floored in pixels.
  const limbs = trunkLimbs(h, rw, rot);
  b.dyn(
    (cam, d) => {
      const ft = cam.ft(x, z);
      for (const l of limbs) {
        const ca = Math.cos(l.az);
        const sa = Math.sin(l.az);
        const A: V3 = [x + ca * l.aOut, l.ay, z + sa * l.aOut];
        const B: V3 = [x + ca * l.bOut, l.by, z + sa * l.bOut];
        const [wa, wb] = trunkWidths(l, (r) => ft * r);
        // Filled: a ribbon A to B, these widths with the feet-to-pixels
        // at 1.
        const f0 = d.strokes;
        d.strokeMode(A, B, [wa, wb, 0], 6, trunk, trunk, [0, 0, 0, 0], { ca: A, cb: B });
        d.strokeRun(f0, 0);
        // Outlined round its corners, from A on screen.
        const pa = cam.P(...A);
        const pb = cam.P(...B);
        const dx = pb[0] - pa[0];
        const dy = pb[1] - pa[1];
        const L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L;
        const ny = dx / L;
        const q = [
          [nx * wa, ny * wa],
          [dx + nx * wb, dy + ny * wb],
          [dx - nx * wb, dy - ny * wb],
          [-nx * wa, -ny * wa],
        ];
        const o0 = d.strokes;
        for (let k = 0; k < 4; k++) {
          const [u, v] = [q[k], q[(k + 1) % 4]];
          d.strokeMode(A, A, [0, 0.8, 0], 9, bark[0], bark[1], [u[0], u[1], v[0], v[1]]);
        }
        d.strokeRun(o0, d.once());
      }
    },
    { pickedGold: true },
  );

  // The canopy, at two-thirds up: filled, then its outline, the inner
  // ring, and the stipple.
  const cy = h * 0.66;
  disc(b, symbolRing(x, cy, z, rw, sym, rot));
  ring(b, symbolRing(x, cy, z, rw, sym, rot, 96), [0, 1, 0], STROKE);
  if (sym.edge === "double") ring(b, symbolRing(x, cy, z, rw * 0.87, sym, rot, 96), [0, 0.65, 0], detail, { pickedGold: true });
  if (sym.interior?.kind === "tex") {
    const s0 = b.strokes;
    for (const [dx, dz] of stipple(sym, sym.interior.density, rw, rot, rngFor(model))) {
      const p: V3 = [x + dx, cy, z + dz];
      b.stroke(p, p, [0, 0, 1.6], detail[0], detail[1], true);
    }
    b.strokeRun(s0, 0, undefined, 0, { pickedGold: true });
  }
  // Its centre mark, a plus on screen as long as the canopy is wide —
  // a fifteenth of it, 2.8 pixels at least.
  const c: V3 = [x, cy, z];
  b.dyn((cam, d) => {
    const s = Math.max(2.8, cam.ft(x, z) * rw * 0.07);
    d.strokeMode(c, c, [0, 1, 0], 2, STROKE[0], STROKE[1], [-s, 0, s, 0]);
    d.strokeMode(c, c, [0, 1, 0], 2, STROKE[0], STROKE[1], [0, -s, 0, s]);
    d.strokeRun(0, d.once());
  });

  // The crown's top, near the top: filled and outlined.
  const top = symbolRing(x, h * 0.92, z, rw * 0.55, sym, rot, 48);
  disc(b, top);
  ring(b, top, [0, 1, 0], STROKE);
}

/** A night light: its stem, and the lamp at its top — gold only picked. */
function light(b: MeshBuilder, x: number, z: number, h: number) {
  const top: V3 = [x, Math.max(h, 0.5), z];
  const s0 = b.strokes;
  b.stroke([x, 0, z], top, [0, 0, 1.4], verde(0.7), GOLD, false);
  b.stroke(top, top, [0, 0, 5], gold(0.7), GOLD, true);
  b.strokeRun(s0, 0, undefined, 0, { pickedGold: true });
}

/** A pool: its footprint, 10 by 6 feet a unit of `scale`, turned by
 *  `rot` — water, its edge, and a line round the water a quarter in. */
function pool(b: MeshBuilder, x: number, z: number, rot: number, scale: number) {
  const L = 5 * scale;
  const W = 3 * scale;
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const at = (f: number) =>
    [
      [-L, -W],
      [L, -W],
      [L, W],
      [-L, W],
      [-L, -W],
    ].map(([px, pz]): V3 => [x + (px * ca - pz * sa) * f, 0, z + (px * sa + pz * ca) * f]);
  const t0 = b.tri.length;
  const base = b.verts;
  for (const p of at(1).slice(0, 4)) b.vert(p[0], p[1], p[2], WATER_FILL, WATER_FILL);
  b.tri.push(base, base + 1, base + 2, base, base + 2, base + 3);
  b.tris(t0, false, false);
  ring(b, at(1), [0, 1, 0], [verde(0.5), GOLD], { pickedGold: true });
  ring(b, at(0.75), [0, 0, 1], [WATER_LINE, WATER_LINE]);
}

/** A barrel: its outline filled, paper and tint, and stroked; spines
 *  standing off it on screen; the ribs facing the camera; the crown. */
function barrel(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number) {
  const cloud = barrelCloud(x, z, h, rw);
  // The poles are a ring of one point each.
  const seen = new Set<string>();
  const pts = cloud.filter((p) => {
    const k = p.map((v) => v.toFixed(6)).join();
    return !seen.has(k) && !!seen.add(k);
  });
  const hull = hull3(pts);
  const faces: { n: V3; c: V3 }[] = [];
  for (let f = 0; f < hull.length; f += 3) {
    const [p, q, r] = [pts[hull[f]], pts[hull[f + 1]], pts[hull[f + 2]]];
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n: V3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1;
    faces.push({ n: [n[0] / l, n[1] / l, n[2] / l], c: [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3] });
  }
  // The faces toward the eye: together, the outline on screen, once.
  const fill = (col: Rgba, gol: Rgba, picked?: boolean) => {
    const t0 = b.tri.length;
    faces.forEach(({ n, c }, i) => {
      for (let k = 0; k < 3; k++) {
        const p = pts[hull[i * 3 + k]];
        b.vert(p[0], p[1], p[2], col, gol, n, c);
      }
      b.tri.push(b.verts - 3, b.verts - 2, b.verts - 1);
    });
    b.tris(t0, false, true, { picked });
  };
  // Paper, and its tint: green, or gold — half as strong only hovered,
  // so picked, a second gold goes over the first.
  fill(overPaper(verde(0.08)), overPaper(gold(0.07)));
  const more = gold(1 - (1 - 0.14) / (1 - 0.07));
  fill(more, more, true);

  // The outline: the hull's edges where one side faces the eye and the
  // other doesn't, inked once.
  const s0 = b.strokes;
  for (const [p, q, fs] of edgesOf(hull)) {
    if (fs.length !== 2) continue;
    const [f0, f1] = [faces[fs[0]], faces[fs[1]]];
    b.strokeX(pts[p], pts[q], [0, 1, 0], STROKE[0], STROKE[1], { round: true, na: f0.n, nb: f1.n, pa: f0.c, pb: f1.c });
  }
  b.strokeRun(s0, b.once(), undefined, 0, { cull: 3 });

  // The spines, laid out round the outline on screen each frame.
  const mid: V3 = [x, h / 2, z];
  b.dyn((cam, d) => {
    const q = cam.P(...mid);
    const on = convexHull(
      cloud.map((p): [number, number] => {
        const s = cam.P(...p);
        return [s[0], s[1]];
      }),
    );
    if (on.length < 3) return;
    for (const [x0, y0, x1, y1] of barrelSpikes(on)) d.strokeMode(mid, mid, [0, 0.6, 0], 2, STROKE[0], STROKE[1], [x0 - q[0], y0 - q[1], x1 - q[0], y1 - q[1]]);
  });

  // The ribs facing the camera, each one line, its joins round and its
  // ends square: inked once between them, the inner pieces round-capped.
  const s1 = b.strokes;
  for (let k = 0; k < BARREL_RIBS; k++) {
    const a = barrelRibAngle(rot, k);
    const n: V3 = [Math.cos(a), 0, Math.sin(a)];
    const rib = barrelRib(x, z, h, rw, rot, k);
    for (let i = 1; i < rib.length; i++) {
      b.strokeX(rib[i - 1], rib[i], [0, 0.7, 0], STROKE[0], STROKE[1], { round: i > 1 && i < rib.length - 1, na: n, thr: 0 });
    }
  }
  b.strokeRun(s1, b.once(), undefined, 0, { cull: 2 });
  // The crown's ring.
  const s2 = b.strokes;
  const crown = barrelCrown(x, z, h, rw);
  for (let k = 1; k < crown.length; k++) b.strokeX(crown[k - 1], crown[k], [0, 0.7, 0], STROKE[0], STROKE[1], { round: true });
  b.strokeRun(s2, b.once());
}

/** A palm: a trunk, and the fronds over it. */
function palm(b: MeshBuilder, x: number, z: number, h: number, g: number) {
  const { top, fronds } = palmFronds(x, z, h, g);
  const s0 = b.strokes;
  const trunk = verde(0.7);
  b.stroke([x, 0, z], top, [0.3, 0, 1.2], trunk, trunk, false);
  for (const [tip, c] of fronds) b.curve(top, c, tip, [0, 1, 0], STROKE[0], STROKE[1]);
  b.strokeRun(s0, 0);
}

/** A saguaro: its stem, and an arm each side, each one line. */
function saguaro(b: MeshBuilder, x: number, z: number, h: number, rw: number, g: number) {
  const r = saguaroR(rw);
  const s0 = b.strokes;
  b.stroke([x, 0, z], [x, h, z], [r * 2, 0, 3], STROKE[0], STROKE[1], true);
  b.strokeRun(s0, 0);
  for (const arm of saguaroArms(x, z, h, g)) {
    const s = b.strokes;
    for (let i = 1; i < arm.length; i++) b.stroke(arm[i - 1], arm[i], [r * 1.2, 0, 2], STROKE[0], STROKE[1], true);
    b.strokeRun(s, b.once());
  }
}

/** A rosette: nine leaves up from its middle, each a curve a line width
 *  less a fifth of a pixel wide, a pixel and a fifth at least. */
function rosette(b: MeshBuilder, x: number, z: number, h: number, rw: number) {
  const s0 = b.strokes;
  const foot: V3 = [x, 0, z];
  for (const [tip, c] of rosetteLeaves(x, z, h, rw)) b.curve(foot, c, tip, [0, 1, 1.4], STROKE[0], STROKE[1], { add: -0.2 });
  b.strokeRun(s0, 0);
}
