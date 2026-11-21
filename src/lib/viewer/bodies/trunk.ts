// A plain tree's trunk — a tree with no model of its own (the orange), drawn as a bole and three limbs
// under its canopy, in the scene's feet. Shared by the canvas viewer and its WebGL layer, so both draw
// the same tree.

/** A piece of the trunk: from height `ay` to `by`, half as wide as `ar`
 *  there and `br` here, `aOut` and `bOut` out from the axis, the way round
 *  `az` — all feet but the angle. */
export type TrunkLimb = { ay: number; by: number; ar: number; br: number; aOut: number; bOut: number; az: number };

/** The bole to the fork, then the three limbs out and up from it, in the
 *  order they're drawn — the bole first, so the limbs cover the joint. */
export function trunkLimbs(h: number, rw: number, rot: number): TrunkLimb[] {
  const forkY = h * 0.27;
  const r0 = Math.max(rw * 0.055, 0.16); // half-width at the ground, ft
  const r1 = r0 * 0.66; // at the fork
  const out: TrunkLimb[] = [{ ay: 0, by: forkY, ar: r0, br: r1, aOut: 0, bOut: 0, az: 0 }];
  for (let k = 0; k < 3; k++) {
    out.push({ ay: forkY, by: h * (0.56 + 0.1 * (k % 2)), ar: r1 * 0.78, br: r1 * 0.24, aOut: 0, bOut: rw * 0.27, az: rot + (k / 3) * Math.PI * 2 });
  }
  return out;
}

/** A trunk piece's half-widths on screen, pixels, given how many pixels
 *  `ft` feet across are: in feet, floored so a tree on an acre plan still
 *  has a stem. */
export const trunkWidths = (l: TrunkLimb, px: (ft: number) => number): [number, number] => [Math.max(px(l.ar), 0.9), Math.max(px(l.br), 0.6)];
