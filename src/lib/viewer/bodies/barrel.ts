// A barrel cactus with no model of its own (the Fire Barrel), as a sphere squashed to its height in the
// scene's feet. Shared by the canvas viewer and its WebGL layer, so both draw the same plant.

type V3 = [number, number, number];

/** A point on the barrel: `t` 0 at the crown to 1 at the soil, `a` round
 *  it. */
export function barrelAt(x: number, z: number, h: number, rw: number, t: number, a: number): V3 {
  const th = t * Math.PI;
  const r = rw * Math.sin(th);
  return [x + Math.cos(a) * r, (h / 2) * (1 + Math.cos(th)), z + Math.sin(a) * r];
}

/** The points its outline on screen is the hull of: nine rings of
 *  eighteen, crown to soil. */
export function barrelCloud(x: number, z: number, h: number, rw: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= 8; i++) for (let k = 0; k < 18; k++) out.push(barrelAt(x, z, h, rw, i / 8, (k / 18) * Math.PI * 2));
  return out;
}

export const BARREL_RIBS = 13;

/** Rib `k`'s way round, turned by `rot`. */
export const barrelRibAngle = (rot: number, k: number) => rot + (k / BARREL_RIBS) * Math.PI * 2;

/** Rib `k` down the side, crown to soil: ten points. */
export function barrelRib(x: number, z: number, h: number, rw: number, rot: number, k: number): V3[] {
  const a = barrelRibAngle(rot, k);
  return Array.from({ length: 10 }, (_, i) => barrelAt(x, z, h, rw, 0.08 + (i / 9) * 0.86, a));
}

/** The crown's ring, where the wool and new spines sit: seventeen points,
 *  the last the first again. */
export function barrelCrown(x: number, z: number, h: number, rw: number): V3[] {
  return Array.from({ length: 17 }, (_, k) => barrelAt(x, z, h, rw, 0.17, (k / 16) * Math.PI * 2));
}

/** Spines: short ticks standing off the outline on screen at an even
 *  spacing round it, which is what the serrations in the plan mark are.
 *  Each [x0, y0, x1, y1], pixels. */
export function barrelSpikes(hull: [number, number][]): [number, number, number, number][] {
  let perim = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const cxs = hull.reduce((t, q) => t + q[0], 0) / hull.length;
  const cys = hull.reduce((t, q) => t + q[1], 0) / hull.length;
  const spike = Math.max(2, Math.min(perim * 0.018, 9));
  const step = perim / 26;
  const out: [number, number, number, number][] = [];
  let carry = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    for (let d = carry; d < seg; d += step) {
      const u = d / seg;
      const px = a[0] + (b[0] - a[0]) * u;
      const py = a[1] + (b[1] - a[1]) * u;
      const nx = px - cxs;
      const ny = py - cys;
      const nl = Math.hypot(nx, ny) || 1;
      out.push([px, py, px + (nx / nl) * spike, py + (ny / nl) * spike]);
    }
    carry = step - ((seg - carry) % step);
  }
  return out;
}
