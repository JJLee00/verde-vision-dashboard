// Firestick as the WebGL layer draws it: grown by the grower the canvas
// uses (see `drawFirestickBody` in LivingBlueprint), placed by its local
// map at half height, in its passes — the far side's sticks, then the near
// side's, then close up each near stick's lit side — each pass widest
// first, a colour at a time. Its colours are opaque, so each stick simply
// goes over the last, as on the canvas.

import { FS_BATCH, FS_N, FS_TONES, FS_WIDTHS, growFirestick } from "../bodies/firestick";
import { rgba, type Rgba } from "./geom";
import { step, type Cam, type MeshBuilder } from "./mesh";

type V3 = [number, number, number];
type Pal = [Rgba, Rgba];

const tone = (colour: number, t: number): Pal => [rgba(FS_TONES[0][colour][t]), rgba(FS_TONES[1][colour][t])];
// The sticks in the order the canvas strokes them: by batch.
const ORDER = Array.from({ length: FS_N }, (_, i) => i).sort((a, b) => FS_BATCH[a] - FS_BATCH[b] || a - b);

export function firestick(b: MeshBuilder, x: number, z: number, h: number, rot: number) {
  const g = growFirestick(x, z, h, rot);
  const c: V3 = [x, h * 0.5, z];
  const foot: V3 = [x, 0, z];
  // Close up from where its height is 150 pixels — a foot up, on screen, at
  // its middle.
  const near = 150 / h;
  const o = { local: c, frame: (cam: Cam) => ({ foot: step(cam, c, 1) }), cull: 1 as const };
  const stick = (i: number, side: number, w: number, floor: number, col: Pal, win: [number, number], shift = 0) => {
    const k = i * 6;
    // Near when its middle is on the eye's side of the plant, across the
    // ground.
    const nx = g[k] + g[k + 3] - 2 * x;
    const nz = g[k + 2] + g[k + 5] - 2 * z;
    const nl = Math.hypot(nx, nz) || 1;
    b.strokeMode([g[k], g[k + 1], g[k + 2]], [g[k + 3], g[k + 4], g[k + 5]], [w * h, 0, floor], 0, col[0], col[1], [1, 0, 0, 0], {
      ca: c,
      cb: c,
      na: [(nx / nl) * side, 0, (nz / nl) * side],
      pa: foot,
      win,
      shift,
    });
  };
  const all: [number, number] = [0, Infinity];

  // The far side's, in their shade.
  const s0 = b.strokes;
  for (const i of ORDER) stick(i, -1, FS_WIDTHS[(FS_BATCH[i] / 3) | 0], 0.7, tone(FS_BATCH[i] % 3, 0), all);
  b.strokeRun(s0, 0, undefined, 0, o);
  // The near side's: in their shade too close up, under the lit side; in
  // their middle tone further off.
  const s1 = b.strokes;
  for (const i of ORDER) {
    const w = FS_WIDTHS[(FS_BATCH[i] / 3) | 0];
    const col = FS_BATCH[i] % 3;
    stick(i, 1, w, 0.7, tone(col, 0), [near, Infinity]);
    stick(i, 1, w, 0.7, tone(col, 1), [0, near]);
  }
  b.strokeRun(s1, 0, undefined, 0, o);
  // Close up, each near stick's lit side: under half as wide, up and left.
  const s2 = b.strokes;
  for (const i of ORDER) {
    const w = FS_WIDTHS[(FS_BATCH[i] / 3) | 0];
    stick(i, 1, w * 0.45, 0.7 * 0.45, tone(FS_BATCH[i] % 3, 2), [near, Infinity], 0.18 / 0.45);
  }
  b.strokeRun(s2, 0, undefined, 0, o);
}
