// The plants with no model of their own, drawn as their kind's plain glyph — a palm, a saguaro, a
// rosette — in the scene's feet. Shared by the canvas viewer and its WebGL layer, so both draw the same
// plant.

type V3 = [number, number, number];

/** A palm: the top of its trunk, and its seven fronds arching out and down
 *  from it, each a quadratic from the top — its tip, and the point it's
 *  drawn toward. `gr` is how grown it is (1 mature). */
export function palmFronds(x: number, z: number, h: number, gr: number): { top: V3; fronds: [V3, V3][] } {
  const fronds: [V3, V3][] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.4;
    fronds.push([
      [x + Math.cos(a) * 4.2 * gr, h - 1.9 * gr, z + Math.sin(a) * 4.2 * gr],
      [x + Math.cos(a) * 1.7 * gr, h + 1.2 * gr, z + Math.sin(a) * 1.7 * gr],
    ]);
  }
  return { top: [x, h, z], fronds };
}

/** A saguaro's stem's radius, feet. */
export const saguaroR = (rw: number) => Math.min(rw, 0.9);

/** A saguaro's two arms, each out from the stem and up: three points. */
export function saguaroArms(x: number, z: number, h: number, gr: number): V3[][] {
  return [
    [1.9, 0.42, 0.74],
    [-1.9, 0.52, 0.66],
  ].map(([dx, y0, y1]) => [
    [x, h * y0, z],
    [x + dx * gr, h * y0, z],
    [x + dx * gr, h * y1, z],
  ]);
}

/** A rosette's nine leaves, each a quadratic up from its foot at the
 *  plant's middle: its tip, and the point it's drawn toward. */
export function rosetteLeaves(x: number, z: number, h: number, rw: number): [V3, V3][] {
  const out: [V3, V3][] = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.2;
    const lift = 0.55 + 0.45 * Math.abs(Math.sin(k * 1.7));
    out.push([
      [x + Math.cos(a) * rw, h * lift, z + Math.sin(a) * rw],
      [x + Math.cos(a) * rw * 0.25, h * 0.95, z + Math.sin(a) * rw * 0.25],
    ]);
  }
  return out;
}
