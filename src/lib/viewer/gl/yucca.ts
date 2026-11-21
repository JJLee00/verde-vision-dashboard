// Beaked yucca as the WebGL layer draws it: grown by the grower the canvas
// uses (see `drawBeakedYuccaBody` in LivingBlueprint) and laid out in its
// passes — the far side of the ball, the trunk and the skirt, a dark
// heart, then the near blades a band at a time.
//
// Its fifteen hundred blades are kept on the card once. Which pass each
// goes in turns with the camera, so the blade shader works it out (see
// `blades` in layer.ts) and each pass draws the ones that are its own.

import { BEAKED_YUCCA_COLOURS, BEAKED_YUCCA_GOLD, BY_R, growBeakedYucca } from "../bodies/yucca";
import { hull3, rgba, type Rgba } from "./geom";
import { footPx, type Cam, type MeshBuilder } from "./mesh";

type V3 = [number, number, number];
type Pal = [Rgba, Rgba];

const C = BEAKED_YUCCA_COLOURS;
const G = BEAKED_YUCCA_GOLD;
const pal = (c: string, g: string): Pal => [rgba(c), rgba(g)];

/** A segment clipped to the trunk on screen: within `tr` of its axis
 *  either side and between its ends. Points are from the trunk's foot, in
 *  its frame — along it, across it. */
function clip(a: [number, number], b: [number, number], len: number, tr: number): [[number, number], [number, number]] | null {
  let t0 = 0;
  let t1 = 1;
  for (const [p, d, lo, hi] of [
    [a[0], b[0] - a[0], 0, len],
    [a[1], b[1] - a[1], -tr, tr],
  ]) {
    if (d === 0) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let e0 = (lo - p) / d;
    let e1 = (hi - p) / d;
    if (e0 > e1) [e0, e1] = [e1, e0];
    t0 = Math.max(t0, e0);
    t1 = Math.min(t1, e1);
    if (t0 >= t1) return null;
  }
  const at = (t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return [at(t0), at(t1)];
}

export function beakedYucca(b: MeshBuilder, x: number, z: number, h: number, rw: number, rot: number, id: string) {
  const g = growBeakedYucca(h, rw, rot, id);
  const ball: V3 = [x, g.gy, z];
  const sk: V3 = [x, g.sy, z];
  const gPx = (cam: Cam) => footPx(cam, ball);
  const sPx = (cam: Cam) => footPx(cam, sk);
  const wPx = (cam: Cam) => g.bladeW * gPx(cam);

  const r0 = b.bladeCount;
  const bl = g.blades;
  for (let o = 0; o < bl.length; o += 7) b.blade([bl[o], bl[o + 1], bl[o + 2]], [bl[o + 3], bl[o + 4], bl[o + 5]], bl[o + 6]);
  /** One colour's pass: kites close up, strokes far off. */
  const pass = (pick: [number, number, number, number], kite: Pal, line: Pal) => {
    const o = { at: ball, sun: sk, len: g.bladeLen, wd: g.bladeW };
    b.bladeRun(r0, { ...o, pick, mode: 1, colour: kite[0], gold: kite[1], frame: (cam) => ({ show: wPx(cam) >= 2.4, foot: gPx(cam) }) });
    b.bladeRun(r0, {
      ...o,
      pick: [pick[0], 0, -1, 0],
      mode: 0,
      colour: line[0],
      gold: line[1],
      frame: (cam) => ({ show: wPx(cam) < 2.4, foot: gPx(cam) }),
    });
  };
  const back = [pal(C.back[0], G.back[0]), pal(C.back[1], G.back[1])];
  const blade = C.blade.map((c, t) => pal(c, G.blade[t]));

  // The far side of the ball, a tone darker.
  for (let t = 0; t < 5; t++) {
    const c = t < 2 ? back[t] : blade[t - 2];
    pass([t, 0, -1, 0], c, c);
  }

  // The trunk, what shows of it under the skirt: laid out on screen each
  // frame, as the canvas lays it — its lit side, and close up the lattice
  // of old leaf bases.
  const trunk = pal(C.trunk, G.trunk);
  const trunkLit = pal(C.trunkLit, G.trunkLit);
  const trunkLine = pal(C.trunkLine, G.trunkLine);
  b.dyn((cam, d) => {
    const s = sPx(cam);
    const p0 = cam.P(x, 0, z);
    const p1 = cam.P(x, g.trunkTop, z);
    const tdx = p1[0] - p0[0];
    const tdy = p1[1] - p0[1];
    const tdl = Math.hypot(tdx, tdy) || 1;
    const ux = tdx / tdl;
    const uy = tdy / tdl;
    const tr = Math.max(0.8, g.trunkR * s);
    const foot: V3 = [x, 0, z];
    d.stroke(foot, [x, g.trunkTop, z], [0, 0, 2 * tr], trunk[0], trunk[1], false);
    // The sun's way across the screen, by the skirt's local map.
    const q = cam.P(x, g.sy, z);
    const qx = cam.P(x + 1, g.sy, z);
    const qz = cam.P(x, g.sy, z + 1);
    const lsx = (qx[0] - q[0]) * -0.44 + (qz[0] - q[0]) * -0.43;
    const lsy = (qx[1] - q[1]) * -0.44 + (qz[1] - q[1]) * -0.43;
    const side = -uy * lsx + ux * lsy > 0 ? 1 : -1;
    // Across the trunk, toward its lit side.
    const nx = -uy * side;
    const ny = ux * side;
    if (tr > 2) {
      const k = tr * 0.55;
      d.strokeMode(foot, foot, [0, 0, tr * 0.6], 2, trunkLit[0], trunkLit[1], [nx * k, ny * k, tdx + nx * k, tdy + ny * k]);
    }
    if (tr > 5) {
      const step = tr * 0.32;
      const w = Math.max(0.7, tr * 0.05);
      for (let at = -tr * 2; at < tdl + tr * 2; at += step) {
        for (const sg of [-1, 1]) {
          const seg = clip([at, -sg * tr * 1.2], [at + tr * 0.7, sg * tr * 1.2], tdl, tr);
          if (!seg) continue;
          const [[a0, a1], [b0, b1]] = seg;
          // Back from the trunk's frame (along, across) to the screen.
          const ax = ux * a0 - uy * a1;
          const ay = uy * a0 + ux * a1;
          const bx = ux * b0 - uy * b1;
          const by = uy * b0 + ux * b1;
          d.strokeMode(foot, foot, [0, 0, w], 2, trunkLine[0], trunkLine[1], [ax, ay, bx, by]);
        }
      }
    }
  });

  // The skirt: its outline in straw, the side to the sun paler.
  const skirt = (scale: number, shift: number, c: Pal) => {
    const pts: V3[] = [];
    for (let i = 0; i < g.skirt.length; i += 2) {
      const y = g.skirt[i];
      const r = g.skirt[i + 1];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        pts.push([x + Math.cos(a) * r * scale - 0.44 * shift * r, y, z + Math.sin(a) * r * scale - 0.43 * shift * r]);
      }
    }
    const t0 = b.tri.length;
    const base = b.verts;
    for (const p of pts) b.vert(p[0], p[1], p[2], c[0], c[1], undefined, undefined, sk);
    for (const i of hull3(pts)) b.tri.push(base + i);
    b.tris(t0, false, false, { local: sk });
  };
  skirt(1, 0, pal(C.skirt, G.skirt));
  skirt(0.78, 0.3, pal(C.skirtLit, G.skirtLit));
  // Close up, the hanging leaves themselves, those on the near side: each
  // a curve, in four pieces.
  const s0 = b.strokes;
  const st = g.straw;
  for (let t = 0; t < 3; t++) {
    const c = pal(C.straw[t], G.straw[t]);
    for (let o = 0; o < st.length; o += 8) {
      if (st[o + 6] !== t) continue;
      const top: V3 = [x + st[o], g.sy + st[o + 1], z + st[o + 2]];
      const tip: V3 = [x + st[o + 3], g.sy + st[o + 4], z + st[o + 5]];
      const ol = Math.hypot(st[o], st[o + 2]) || 1;
      const out: V3 = [st[o] / ol, 0, st[o + 2] / ol];
      for (let k = 0; k < 4; k++) b.strokeMode(top, tip, [0.018 * (rw / BY_R), 0, 0.6], 5, c[0], c[1], [st[o + 7], k, 0, 0], { ca: sk, cb: sk, na: out, thr: 0 });
    }
  }
  b.strokeRun(s0, 0, undefined, 0, {
    local: sk,
    cull: 2,
    frame: (cam) => {
      const s = sPx(cam);
      return { show: g.strawLen * s >= 3, foot: s };
    },
  });

  // The ball's dark heart, so gaps between near blades read as depth.
  const e0 = b.ellipses;
  const core = pal(C.core, G.core);
  b.ellipse(ball, [0, 0, 0], [g.coreR, 0, 0], [0, 0, 0], [0, 0, 0], core[0], core[1], null);
  b.ellipseRun(e0, { local: ball, mode: 2, depth: false });

  // The near blades, a band at a time far to near, each blade's shaded
  // half a tone darker than its sunny one; close up, each one's shaded edge.
  const edge = pal(C.edge, G.edge);
  for (let band = 1; band <= 4; band++) {
    const b0 = band * 5;
    for (let t = 0; t < 5; t++) pass([b0 + t, t === 0 ? 0 : 1, t < 4 ? b0 + t + 1 : -1, -1], blade[t], t ? blade[t - 1] : back[1]);
    b.bladeRun(r0, {
      at: ball,
      sun: sk,
      len: g.bladeLen,
      wd: g.bladeW,
      pick: [band, 0, -1, 0],
      mode: 2,
      colour: edge[0],
      gold: edge[1],
      frame: (cam) => ({ show: wPx(cam) >= 3, foot: gPx(cam) }),
    });
  }
}
