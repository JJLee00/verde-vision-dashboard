// A boulder's body, grown as a faceted solid in the scene's feet. Shared by
// the canvas viewer and its WebGL layer, so both draw the same rock.

import { edgeRadius, rngFor, type PlanSymbol } from "../symbols";

type V3 = [number, number, number];

/** A boulder that hasn't been scanned: four rings of vertices round it and
 *  its faces between them, each a list of corners (indices into `pts`) and
 *  how squarely it takes the light. */
export type BoulderPlant = {
  /** the foot, shoulder, brow and cap rings, `BOULDER_N` a ring */
  pts: V3[];
  faces: { vs: number[]; lit: number }[];
};
export const BOULDER_N = 13; // facets around — enough to read as cut, not as a circle

/** The rock's rings and faces (see `drawBoulderBody` in LivingBlueprint). */
export function growBoulder(x: number, z: number, wFt: number, hFt: number, rot: number, sym: PlanSymbol | null, seed: string): BoulderPlant {
  const R = wFt / 2;
  const N = BOULDER_N;
  const rng = rngFor("rock:" + seed);
  const leanA = rng() * Math.PI * 2;
  const lean = 0.13 + rng() * 0.12; // how far the crown sits off centre

  const pts: V3[] = [];
  const ring = (frac: number, yFrac: number, jitter: number, off: number): number[] =>
    Array.from({ length: N }, (_, i) => {
      // The spokes are jittered too. On even ones the facets came out
      // as regular as a cut gem, and a 3 ft boulder read as a tent.
      const th = ((i + (rng() - 0.5) * 0.45) / N) * Math.PI * 2;
      const r = R * (sym ? edgeRadius(sym, th - rot) : 1) * frac * (1 - jitter / 2 + rng() * jitter);
      const wx = x + Math.cos(leanA) * R * off + Math.cos(th) * r;
      const wz = z + Math.sin(leanA) * R * off + Math.sin(th) * r;
      const wy = hFt * yFrac * (0.84 + rng() * 0.32);
      pts.push([wx, wy, wz]);
      return pts.length - 1;
    });
  // Four rings, not three: a rock has a shoulder AND a brow, and the
  // band between them is where most of its faces are. With the crown
  // taken straight off the shoulder, every face ran the full height and
  // the drawing came out a cone.
  const foot = ring(0.88, 0, 0.1, 0); // the rock settles into the soil
  const shoulder = ring(1, 0.3, 0.17, lean * 0.3);
  const brow = ring(0.82, 0.63, 0.2, lean * 0.7);
  const cap = ring(0.5, 0.86, 0.26, lean);

  // Up and to the left, the light every drawing on this sheet is under.
  const LX = -0.44;
  const LY = 0.79;
  const LZ = -0.43;
  const faces: BoulderPlant["faces"] = [];
  const face = (vs: number[]) => {
    const [p0, p1, p2] = [pts[vs[0]], pts[vs[1]], pts[vs[2]]];
    const ax = p1[0] - p0[0];
    const ay = p1[1] - p0[1];
    const az = p1[2] - p0[2];
    const bx = p2[0] - p0[0];
    const by = p2[1] - p0[1];
    const bz = p2[2] - p0[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const L = Math.hypot(nx, ny, nz) || 1;
    // Absolute, so the quad's winding — which flips round the back of
    // the rock — cannot turn a face into a hole.
    const lit = Math.abs((nx * LX + ny * LY + nz * LZ) / L);
    faces.push({ vs, lit });
  };
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    face([foot[i], foot[j], shoulder[j], shoulder[i]]);
    face([shoulder[i], shoulder[j], brow[j], brow[i]]);
    face([brow[i], brow[j], cap[j], cap[i]]);
  }
  face(cap);
  return { pts, faces };
}
