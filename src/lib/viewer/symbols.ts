// Plan symbols — the marks a plant draws on the ground.
//
// A symbol is never artwork: it is an EDGE (a radius function r(theta), in
// [0,1]) plus an optional INTERIOR (radial leaves, branching limbs, or
// stipple) plus a centre mark. The same definition is meant to drive the
// blueprint PDF in the visionOS app and this viewer, so that plan mode here
// and the printed sheet are the same drawing.
//
// Keyed by PlacedPlant.plantModelName, with a fallback derived from the
// viewer catalog's GlyphKind so a model nobody has classified yet still
// draws something sensible.
//
// A SYMBOL IS ONE DRAWING AT EVERY SIZE. Interiors used to be skipped below
// a projected radius, and the stipple was counted from the plant's size on
// screen — so detail blinked in and out as the camera moved and a plant was
// not the same mark twice. Everything here is now decided by the symbol
// itself, never by how large it happens to be rendered. The cost is that a
// small symbol is denser than it would otherwise be; the gain is that the
// drawing holds still.

export type EdgeKind =
  | "plain"
  | "poly"
  | "double"
  | "broken"
  | "scallop"
  | "tooth"
  | "spiky"
  | "notch"
  | "lumpy"
  | "cluster"
  | "pads"
  | "wand"
  | "uplight"
  | "flood"
  | "pathlight";

/** A line segment in unit-symbol space: x1, y1, x2, y2, each in [-1,1]. */
export type Seg = [number, number, number, number];

export type Interior =
  | { kind: "radial"; n: number; thick: number; inner: number; outer: number }
  | { kind: "lines"; segs: Seg[]; fine?: Seg[] }
  | { kind: "branch"; limbs: number; depth: number; spread: number }
  | { kind: "tex"; density: number };

export type CentreMark = "dot" | "plus" | "hub" | "none";

export type PlanSymbol = {
  edge: EdgeKind;
  /** bump / tooth / point count, or how many circles in a cluster */
  n: number;
  /** how deep those bumps cut, 0..1 */
  d: number;
  interior?: Interior;
  centre: CentreMark;
  /** dashed outline, for groundcover masses */
  dash?: [number, number];
  /** cluster: a dot per stem */
  stems?: boolean;
  /** cluster: pulled in tight, for a mound rather than a ring */
  tight?: boolean;
  /** edge "poly": the outline's own vertices, unit radius, drawn as given.
   *  A list, because some marks are several closed shapes rather than one
   *  silhouette — an artichoke agave is four overlapping leaves. */
  polys?: [number, number][][];
  /** weight of the `lines` interior's `fine` set, against the main one.
   *  Defaults to the 0.6 most of the drawings use. */
  fineScale?: number;
  /** centre mark radius as a fraction of the symbol's, when the drawing
   *  calls for its own. A barrel's areole is a quarter of the plant. */
  centreR?: number;
};

/* ---------- edges: r(theta) in [0,1] ---------- */

export function edgeRadius(sym: PlanSymbol, t: number): number {
  const { edge, n, d } = sym;
  switch (edge) {
    case "poly":
      if (!sym.polys) return 1;
      return Math.max(...sym.polys.map((ring) => polyRadius(ring, t)));
    case "scallop":
      return 1 - d + d * (0.5 + 0.5 * Math.cos(n * t));
    case "tooth":
      return 1 - d * (((t * n) / (2 * Math.PI)) % 1);
    case "spiky": {
      const f = ((t * n) / (2 * Math.PI)) % 1;
      return 1 - d + d * Math.pow(1 - Math.abs(2 * f - 1), 2);
    }
    case "notch": {
      const f = ((t * n) / (2 * Math.PI)) % 1;
      return 1 - d * Math.exp(-Math.pow(f - 0.5, 2) / 0.004);
    }
    case "lumpy":
      return (
        1 -
        d * 0.5 +
        d * 0.5 * (Math.sin(n * t + 0.7) + 0.6 * Math.sin(2.3 * n * t)) * 0.5
      );
    default:
      return 1;
  }
}

/** Where the ray at angle `t` leaves an explicit outline. Lets a hand-drawn
 *  polygon answer the same r(theta) question the generated edges do, so the
 *  generic callers (canopy discs, stipple clipping) keep working. */
function polyRadius(poly: [number, number][], t: number): number {
  const dx = Math.cos(t);
  const dy = Math.sin(t);
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const u = (ax * ey - ay * ex) / den; // distance along the ray
    const v = (ax * dy - ay * dx) / den; // position along the edge, 0..1
    if (u >= 0 && v >= 0 && v <= 1) return u;
  }
  return 1;
}

/* ---------- stable per-plant jitter ---------- */

function rngFor(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return function () {
    h += 0x6d2b79f5;
    let v = h;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- hand-drawn artwork ---------- */

// Agave Americana — traced from agave-symbol.svg (800x800 box, tips at r=370),
// normalised to unit radius. Eight leaves: the outline, the fold down the
// middle of each leaf and the split between them, then the shoulder creases.
// Kept exactly as supplied, including the slight asymmetry of the hand trace.

const AGAVE_OUTLINE: [number, number][] = [
  [0, -1], [0.1216, -0.3243], [0.6892, -0.7162], [0.3649, -0.1486],
  [1, 0], [0.3649, 0.1486], [0.7162, 0.7162], [0.1216, 0.3378],
  [0, 1], [-0.1351, 0.3649], [-0.7162, 0.6757], [-0.3378, 0.1486],
  [-1, 0], [-0.3243, -0.1486], [-0.6892, -0.7297], [-0.1351, -0.3243],
];

// Leaf splits (centre to each valley) and the long centre folds (centre to
// each tip) — the SVG draws both at stroke-width 5.
const AGAVE_FOLDS: Seg[] = [
  [0, 0, -0.1351, -0.3243], [0, 0, 0.1216, -0.3243], [0, 0, 0.3649, -0.1486],
  [0, 0, 0.3649, 0.1486], [0, 0, 0.1216, 0.3378], [0, 0, -0.1351, 0.3649],
  [0, 0, -0.3378, 0.1486], [0, 0, -0.3243, -0.1486], [0, 0, 0, -1],
  [0, 0, 0, 1], [0, 0, -0.6892, -0.7297], [0, 0, 0.7162, 0.7162],
  [0, 0, -1, 0], [0, 0, 1, 0], [0, 0, -0.7162, 0.6757],
  [0, 0, 0.6892, -0.7162],
];

// Shoulder creases — stroke-width 3 in the SVG, so 0.6 of the main weight.
const AGAVE_SHOULDERS: Seg[] = [
  [-0.1351, -0.3243, 0, -0.6892], [0, -0.6892, 0.1216, -0.3243],
  [0.1216, -0.3243, 0.4595, -0.4865], [0.4595, -0.4865, 0.3649, -0.1486],
  [0.3649, -0.1486, 0.6892, 0], [0.6892, 0, 0.3649, 0.1486],
  [0.3649, 0.1486, 0.4459, 0.4595], [0.4459, 0.4595, 0.1216, 0.3378],
  [0.1216, 0.3378, 0, 0.6757], [0, 0.6757, -0.1351, 0.3649],
  [-0.1351, 0.3649, -0.4595, 0.4459], [-0.4595, 0.4459, -0.3378, 0.1486],
  [-0.3378, 0.1486, -0.6757, 0], [-0.6757, 0, -0.3243, -0.1486],
  [-0.3243, -0.1486, -0.4595, -0.473], [-0.4595, -0.473, -0.1351, -0.3243],
];

// Agave Truncata — traced from agave-truncata-symbol.svg (800x800 box),
// normalised so the mark exactly fills a unit radius. An artichoke agave is
// not a star: it is four broad overlapping leaves seen from above, with the
// tips of the rank behind showing in the gaps between them. The leaves are
// curves in the source, flattened to points here because every vertex is
// projected onto the ground individually — a canvas bezier would be drawn
// in screen space and would not lie flat.

const TRUNCATA_LEAVES: [number, number][][] = [
  [
    [0, 0], [-0.0029, -0.0414], [-0.0048, -0.0856], [-0.006, -0.1321],
    [-0.0067, -0.1801], [-0.0075, -0.2289], [-0.0087, -0.2778], [-0.0105, -0.3261],
    [-0.0135, -0.3731], [-0.0179, -0.418], [-0.0241, -0.4603], [-0.0324, -0.4992],
    [-0.0433, -0.5339], [-0.061, -0.5707], [-0.0854, -0.6019], [-0.1166, -0.628],
    [-0.1545, -0.6494], [-0.1992, -0.6666], [-0.2507, -0.68], [-0.3092, -0.6902],
    [-0.3747, -0.6975], [-0.4471, -0.7024], [-0.5267, -0.7053], [-0.6133, -0.7067],
    [-0.7071, -0.7071], [-0.7067, -0.6133], [-0.7053, -0.5267], [-0.7024, -0.4471],
    [-0.6975, -0.3747], [-0.6902, -0.3092], [-0.68, -0.2507], [-0.6666, -0.1992],
    [-0.6494, -0.1545], [-0.628, -0.1166], [-0.6019, -0.0854], [-0.5707, -0.061],
    [-0.5339, -0.0433], [-0.4992, -0.0324], [-0.4603, -0.0241], [-0.418, -0.0179],
    [-0.3731, -0.0135], [-0.3261, -0.0105], [-0.2778, -0.0087], [-0.2289, -0.0075],
    [-0.1801, -0.0067], [-0.1321, -0.006], [-0.0856, -0.0048], [-0.0414, -0.0029],
  ],
  [
    [0, 0], [0.0029, -0.0414], [0.0048, -0.0856], [0.006, -0.1321],
    [0.0067, -0.1801], [0.0075, -0.2289], [0.0087, -0.2778], [0.0105, -0.3261],
    [0.0135, -0.3731], [0.0179, -0.418], [0.0241, -0.4603], [0.0324, -0.4992],
    [0.0433, -0.5339], [0.061, -0.5707], [0.0854, -0.6019], [0.1166, -0.628],
    [0.1545, -0.6494], [0.1992, -0.6666], [0.2507, -0.68], [0.3092, -0.6902],
    [0.3747, -0.6975], [0.4471, -0.7024], [0.5267, -0.7053], [0.6133, -0.7067],
    [0.7071, -0.7071], [0.7067, -0.6133], [0.7053, -0.5267], [0.7024, -0.4471],
    [0.6975, -0.3747], [0.6902, -0.3092], [0.68, -0.2507], [0.6666, -0.1992],
    [0.6494, -0.1545], [0.628, -0.1166], [0.6019, -0.0854], [0.5707, -0.061],
    [0.5339, -0.0433], [0.4992, -0.0324], [0.4603, -0.0241], [0.418, -0.0179],
    [0.3731, -0.0135], [0.3261, -0.0105], [0.2778, -0.0087], [0.2289, -0.0075],
    [0.1801, -0.0067], [0.1321, -0.006], [0.0856, -0.0048], [0.0414, -0.0029],
  ],
  [
    [0, 0], [0.0414, 0.0029], [0.0856, 0.0048], [0.1321, 0.006],
    [0.1801, 0.0067], [0.2289, 0.0075], [0.2778, 0.0087], [0.3261, 0.0105],
    [0.3731, 0.0135], [0.418, 0.0179], [0.4603, 0.0241], [0.4992, 0.0324],
    [0.5339, 0.0433], [0.5707, 0.061], [0.6019, 0.0854], [0.628, 0.1166],
    [0.6494, 0.1545], [0.6666, 0.1992], [0.68, 0.2507], [0.6902, 0.3092],
    [0.6975, 0.3747], [0.7024, 0.4471], [0.7053, 0.5267], [0.7067, 0.6133],
    [0.7071, 0.7071], [0.6133, 0.7067], [0.5267, 0.7053], [0.4471, 0.7024],
    [0.3747, 0.6975], [0.3092, 0.6902], [0.2507, 0.68], [0.1992, 0.6666],
    [0.1545, 0.6494], [0.1166, 0.628], [0.0854, 0.6019], [0.061, 0.5707],
    [0.0433, 0.5339], [0.0324, 0.4992], [0.0241, 0.4603], [0.0179, 0.418],
    [0.0135, 0.3731], [0.0105, 0.3261], [0.0087, 0.2778], [0.0075, 0.2289],
    [0.0067, 0.1801], [0.006, 0.1321], [0.0048, 0.0856], [0.0029, 0.0414],
  ],
  [
    [0, 0], [-0.0414, 0.0029], [-0.0856, 0.0048], [-0.1321, 0.006],
    [-0.1801, 0.0067], [-0.2289, 0.0075], [-0.2778, 0.0087], [-0.3261, 0.0105],
    [-0.3731, 0.0135], [-0.418, 0.0179], [-0.4603, 0.0241], [-0.4992, 0.0324],
    [-0.5339, 0.0433], [-0.5707, 0.061], [-0.6019, 0.0854], [-0.628, 0.1166],
    [-0.6494, 0.1545], [-0.6666, 0.1992], [-0.68, 0.2507], [-0.6902, 0.3092],
    [-0.6975, 0.3747], [-0.7024, 0.4471], [-0.7053, 0.5267], [-0.7067, 0.6133],
    [-0.7071, 0.7071], [-0.6133, 0.7067], [-0.5267, 0.7053], [-0.4471, 0.7024],
    [-0.3747, 0.6975], [-0.3092, 0.6902], [-0.2507, 0.68], [-0.1992, 0.6666],
    [-0.1545, 0.6494], [-0.1166, 0.628], [-0.0854, 0.6019], [-0.061, 0.5707],
    [-0.0433, 0.5339], [-0.0324, 0.4992], [-0.0241, 0.4603], [-0.0179, 0.418],
    [-0.0135, 0.3731], [-0.0105, 0.3261], [-0.0087, 0.2778], [-0.0075, 0.2289],
    [-0.0067, 0.1801], [-0.006, 0.1321], [-0.0048, 0.0856], [-0.0029, 0.0414],
  ],
];

const TRUNCATA_TIPS: Seg[] = [
  [-0.3896, -0.7071, 0, -0.9957],
  [0, -0.9957, 0.3896, -0.7071],
  [0.7071, -0.3896, 0.9957, 0],
  [0.9957, 0, 0.7071, 0.3896],
  [0.3896, 0.7071, 0, 0.9957],
  [0, 0.9957, -0.3896, 0.7071],
  [-0.7071, 0.3896, -0.9957, 0],
  [-0.9957, 0, -0.7071, -0.3896],
];

const TRUNCATA_FOLDS: Seg[] = [
  [-0.7071, -0.7071, 0.7071, 0.7071],
  [0.7071, -0.7071, -0.7071, 0.7071],
];

// Honey Mesquite — traced from mesquite-symbol.svg. One canopy section,
// repeated on the quarter turns: a mesquite reads as a few big soft masses
// with gaps between them, not as one outline. Normalised to a unit radius.
//
// The source draws the section with 481 points, roughly one every 2.5 units
// of 800. Simplified to 101 by Douglas-Peucker at 0.6 units, which is 0.03 pt
// on a printed symbol and a third of a pixel at the viewer's deepest zoom —
// every undulation of the edge survives, and four sections cost 400 points
// per plant per frame instead of 1,900.

const MESQUITE_SECTION: [number, number][] = [
  [0.0123, -0.0879], [0.0036, -0.1429], [-0.0275, -0.2055], [-0.0439, -0.2641],
  [-0.0588, -0.2832], [-0.0962, -0.312], [-0.1087, -0.3251], [-0.1161, -0.3399],
  [-0.1241, -0.3842], [-0.1328, -0.3987], [-0.1471, -0.4108], [-0.182, -0.4319],
  [-0.1943, -0.4445], [-0.2002, -0.466], [-0.1964, -0.5101], [-0.1993, -0.5268],
  [-0.2077, -0.5412], [-0.2308, -0.5673], [-0.2371, -0.5828], [-0.2347, -0.6077],
  [-0.2067, -0.677], [-0.2028, -0.7303], [-0.1946, -0.7557], [-0.1711, -0.7902],
  [-0.0819, -0.8949], [-0.0426, -0.9314], [0.0123, -0.9717], [0.0312, -0.9737],
  [0.0893, -0.9897], [0.1182, -0.9887], [0.1368, -0.9822], [0.1814, -0.959],
  [0.1995, -0.9533], [0.2184, -0.9516], [0.2685, -0.956], [0.2976, -0.9527],
  [0.3236, -0.9393], [0.3628, -0.9078], [0.3795, -0.8987], [0.3977, -0.8934],
  [0.4477, -0.8879], [0.4667, -0.8829], [0.4914, -0.8678], [0.5308, -0.8222],
  [0.5453, -0.81], [0.5622, -0.8012], [0.6101, -0.7862], [0.6357, -0.7719],
  [0.6547, -0.7496], [0.6788, -0.7055], [0.6907, -0.6907], [0.7055, -0.6788],
  [0.7496, -0.6547], [0.7719, -0.6357], [0.7862, -0.6101], [0.8012, -0.5622],
  [0.81, -0.5453], [0.8222, -0.5308], [0.8678, -0.4914], [0.8829, -0.4667],
  [0.8879, -0.4477], [0.8934, -0.3977], [0.8987, -0.3795], [0.9078, -0.3628],
  [0.9393, -0.3236], [0.9527, -0.2976], [0.956, -0.2685], [0.9516, -0.2184],
  [0.9533, -0.1995], [0.959, -0.1814], [0.9822, -0.1368], [0.9887, -0.1182],
  [0.9897, -0.0893], [0.9737, -0.0312], [0.9717, -0.0123], [0.9314, -0.0673],
  [0.901, -0.1008], [0.7692, -0.2115], [0.7364, -0.2263], [0.6893, -0.2292],
  [0.6706, -0.2332], [0.6146, -0.2571], [0.5885, -0.2623], [0.5673, -0.2554],
  [0.5366, -0.229], [0.5215, -0.2223], [0.504, -0.2211], [0.466, -0.2248],
  [0.4445, -0.219], [0.4319, -0.2066], [0.4108, -0.1717], [0.3987, -0.1574],
  [0.3842, -0.1488], [0.3399, -0.1407], [0.3251, -0.1334], [0.312, -0.1209],
  [0.2832, -0.0834], [0.2641, -0.0685], [0.2055, -0.0521], [0.1429, -0.021],
  [0.0879, -0.0123],
];

/** The same ring on all four quarter turns. */
const quarters = (ring: [number, number][]): [number, number][][] =>
  [0, 1, 2, 3].map((k) => {
    const a = (k * Math.PI) / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return ring.map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]);
  });

// Golden Barrel — from golden-barrel-symbol.svg. That drawing is exactly
// regular, so it is generated from its own figures rather than stored as 72
// points: 36 teeth on five degree steps from straight up, alternating the
// full radius with 0.915149 of it, six ribs on the sixties, and a solid
// centre at 0.0909. Rebuilt this way every vertex lands within a thousandth
// of a unit of the source — the shape IS the arithmetic.

const GOLDEN_BARREL_RING: [number, number][] = Array.from(
  { length: 72 },
  (_, i): [number, number] => {
    const a = -Math.PI / 2 + (i * Math.PI) / 36;
    const r = i % 2 === 0 ? 1 : 0.915149;
    return [Math.cos(a) * r, Math.sin(a) * r];
  },
);

// Drawn at 5 against the outline's 4 in the source. They carry the symbol's
// main weight here; a quarter more on a rib is not a difference a plan holds.
const GOLDEN_BARREL_RIBS: Seg[] = Array.from({ length: 6 }, (_, k): Seg => {
  const a = -Math.PI / 2 + (k * Math.PI) / 3;
  return [0, 0, Math.cos(a), Math.sin(a)];
});

const GOLDEN_BARREL: PlanSymbol = {
  edge: "poly",
  n: 36,
  d: 0,
  polys: [GOLDEN_BARREL_RING],
  interior: { kind: "lines", segs: GOLDEN_BARREL_RIBS },
  centre: "dot",
  centreR: 0.0909,
};

const MESQUITE: PlanSymbol = {
  edge: "poly",
  n: 4,
  d: 0,
  polys: quarters(MESQUITE_SECTION),
  centre: "dot",
};

const AGAVE_TRUNCATA: PlanSymbol = {
  edge: "poly",
  n: 4,
  d: 0,
  polys: TRUNCATA_LEAVES,
  interior: { kind: "lines", segs: TRUNCATA_TIPS, fine: TRUNCATA_FOLDS },
  fineScale: 0.8, // the folds are 4 against the outlines' 5
  centre: "dot",
};

const AGAVE_STAR: PlanSymbol = {
  edge: "poly",
  n: 8,
  d: 0,
  polys: [AGAVE_OUTLINE],
  interior: { kind: "lines", segs: AGAVE_FOLDS, fine: AGAVE_SHOULDERS },
  centre: "dot",
};

/* ---------- the catalog ---------- */

const radial = (
  n: number,
  thick: number,
  inner = 0.05,
  outer = 0.9,
): Interior => ({ kind: "radial", n, thick, inner, outer });
const branch = (limbs: number, depth: number, spread: number): Interior => ({
  kind: "branch",
  limbs,
  depth,
  spread,
});
const tex = (density: number): Interior => ({ kind: "tex", density });

const TREE = (n: number, d: number, i: Interior): PlanSymbol => ({
  edge: "scallop",
  n,
  d,
  interior: i,
  centre: "plus",
});
const ROSETTE = (n: number, d: number, thick: number, outer = 0.9): PlanSymbol => ({
  edge: "spiky",
  n,
  d,
  interior: radial(n, thick, 0.05, outer),
  centre: "dot",
});
const CLUSTER = (n: number, stems = true, tight = false): PlanSymbol => ({
  edge: "cluster",
  n,
  d: 0,
  centre: "none",
  stems,
  tight,
});

export const SYMBOLS: Record<string, PlanSymbol> = {
  /* trees — branch interiors; limb count and forking describe the canopy */
  PaloVerde: TREE(9, 0.13, branch(4, 3, 125)),
  TexasEbonyLg: TREE(14, 0.1, branch(5, 3, 150)),
  TexasEbonyMd: TREE(14, 0.1, branch(5, 3, 150)),
  TexasEbonySm: TREE(14, 0.1, branch(5, 3, 150)),
  HoneyMesquite: MESQUITE,
  Vitex: { edge: "notch", n: 7, d: 0.17, interior: branch(3, 2, 105), centre: "plus" },
  Orange_Tree: { edge: "double", n: 0, d: 0, interior: tex(10), centre: "plus" },
  MulgaAcaciaLg: { edge: "tooth", n: 26, d: 0.07, interior: branch(3, 2, 92), centre: "plus" },
  MulgaAcaciaSm: { edge: "tooth", n: 26, d: 0.07, interior: branch(3, 2, 92), centre: "plus" },

  /* shrubs */
  YellowBells: { edge: "scallop", n: 16, d: 0.13, interior: branch(4, 2, 130), centre: "dot" },
  Jojoba: { edge: "scallop", n: 26, d: 0.06, interior: tex(7), centre: "dot" },
  TexasSage: { edge: "tooth", n: 30, d: 0.08, interior: tex(13), centre: "dot" },
  GreenHopseed: { edge: "tooth", n: 18, d: 0.11, interior: branch(3, 2, 118), centre: "dot" },
  LittleJohnBottlebrush: { edge: "double", n: 0, d: 0, centre: "dot" },

  /* rosettes — leaf count and thickness ARE the species */
  AgaveAmericana: AGAVE_STAR,
  AgaveTruncata: AGAVE_TRUNCATA,
  TropicalAgave: ROSETTE(12, 0.36, 2.4),
  AloeFerox: ROSETTE(13, 0.34, 2.2),
  "Aloe Vera": ROSETTE(11, 0.32, 2.0),
  BlueGlowAgave: ROSETTE(14, 0.3, 1.6),
  BlackTipAgave: ROSETTE(16, 0.3, 1.3),
  AgaveGeminiflora: ROSETTE(24, 0.3, 0.9),
  YuccaRostrataMd: ROSETTE(18, 0.34, 1.0, 0.94),
  YuccaRostrataSm: ROSETTE(18, 0.34, 1.0, 0.94),
  HesperaloeLg: { edge: "spiky", n: 20, d: 0.4, interior: radial(20, 0.9, 0.1, 0.98), centre: "dot" },
  HesperaloeMd: { edge: "spiky", n: 20, d: 0.4, interior: radial(20, 0.9, 0.1, 0.98), centre: "dot" },
  HesperaloeSm: { edge: "spiky", n: 20, d: 0.4, interior: radial(20, 0.9, 0.1, 0.98), centre: "dot" },
  DesertSpoonLg: ROSETTE(32, 0.22, 0.7),
  DesertSpoonSm: ROSETTE(32, 0.22, 0.7),

  /* columnar and barrel — clumps are clusters, ribs sit at the rim */
  OrganPipe: CLUSTER(7),
  ArgentineToothpick: CLUSTER(5),
  MexicanFencePost: CLUSTER(4),
  MoroccanMound: CLUSTER(6, false, true),
  MadagascarPalm: { edge: "spiky", n: 14, d: 0.48, interior: radial(14, 1.1, 0.14, 0.96), centre: "hub" },
  TotemPole: { edge: "lumpy", n: 7, d: 0.19, centre: "hub" },
  GoldenBarrel: GOLDEN_BARREL,
  Firebarrel: { edge: "tooth", n: 20, d: 0.11, interior: radial(14, 1.4, 0.55, 0.92), centre: "dot" },

  /* pads and wands — no canopy to outline */
  SantaRitaPricklyPear: { edge: "pads", n: 5, d: 0, centre: "none" },
  Ocotillo: { edge: "wand", n: 14, d: 0, centre: "none" },
  Firestick: { edge: "wand", n: 9, d: 0, centre: "none" },

  /* groundcover masses — dash as well as colour, so they survive mono printing */
  WhiteDawnLantana: { edge: "broken", n: 0, d: 0, interior: tex(6), centre: "none", dash: [7, 4] },
  PurpleLantana: { edge: "broken", n: 0, d: 0, interior: tex(6), centre: "none", dash: [2, 3] },
  YellowLantana: { edge: "broken", n: 0, d: 0, interior: tex(6), centre: "none", dash: [11, 4] },

  /* rock */
  AZBoulder1: { edge: "lumpy", n: 5, d: 0.15, centre: "none" },
  GrayBoulder: { edge: "lumpy", n: 5, d: 0.15, centre: "none" },
  FlatBoulder: { edge: "lumpy", n: 4, d: 0.11, centre: "none" },

  /* catalog entries this viewer knows that the app no longer ships */
  MexFanPalm: { edge: "spiky", n: 11, d: 0.5, interior: radial(11, 1.2, 0.1, 1.0), centre: "hub" },
  SaguaroSpear: { edge: "tooth", n: 22, d: 0.08, centre: "hub" },

  /* lighting — equipment, not planting */
  NightUplight: { edge: "uplight", n: 0, d: 0, centre: "none" },
  NightFloodlight: { edge: "flood", n: 0, d: 0, centre: "none" },
  NightPathlight: { edge: "pathlight", n: 0, d: 0, centre: "none" },
};

const BY_KIND: Record<string, PlanSymbol> = {
  tree: TREE(14, 0.1, branch(4, 3, 130)),
  shrub: { edge: "scallop", n: 20, d: 0.09, interior: tex(8), centre: "dot" },
  rosette: ROSETTE(13, 0.33, 2.0),
  columnar: CLUSTER(5),
  barrel: { edge: "tooth", n: 26, d: 0.09, interior: radial(18, 1.0, 0.6, 0.94), centre: "dot" },
  boulder: { edge: "lumpy", n: 5, d: 0.15, centre: "none" },
  palm: { edge: "spiky", n: 11, d: 0.5, interior: radial(11, 1.2, 0.1, 1.0), centre: "hub" },
  saguaro: { edge: "tooth", n: 22, d: 0.08, centre: "hub" },
  light: { edge: "pathlight", n: 0, d: 0, centre: "none" },
};

/** The symbol for a placed model. `null` means "draw nothing here" — the
 *  pool prefab brings its own footprint. */
export function symbolFor(modelName: string, kind: string): PlanSymbol | null {
  if (kind === "poolPrefab") return null;
  return SYMBOLS[modelName] ?? BY_KIND[kind] ?? BY_KIND.rosette;
}

/* ---------- drawing ---------- */

type Project = (x: number, y: number, z: number) => [number, number, number];

export type DrawOpts = {
  /** the plant's yaw, radians — so a bed of one species reads as individuals */
  rot: number;
  stroke: string;
  /** stroke for the thinner interior linework */
  detail: string;
  lw: number;
  /** the mark's projected radius in px. Used ONLY to keep the centre mark
   *  in proportion as the symbol grows — never to decide what to draw. */
  markR: number;
  /** stable jitter seed; the model name is a good one */
  seed: string;
  /** height to draw at, world units — defaults to the ground. A tree's
   *  canopy carries the same mark, just lifted into the air. */
  y?: number;
};

const GROUND_Y = 0.02;

/** Draw one plan symbol flat on the ground plane, through `project`. */
export function drawPlanSymbol(
  ctx: CanvasRenderingContext2D,
  project: Project,
  x: number,
  z: number,
  R: number,
  sym: PlanSymbol,
  o: DrawOpts,
): void {
  const P = (wx: number, wz: number) => project(wx, o.y ?? GROUND_Y, wz);
  const line = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    w: number,
    col: string,
  ) => {
    const a = P(x1, z1);
    const b = P(x2, z2);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineWidth = w;
    ctx.strokeStyle = col;
    ctx.stroke();
  };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.strokeStyle = o.stroke;
  ctx.lineWidth = o.lw;
  ctx.setLineDash(sym.dash ?? []);

  const rng = rngFor(o.seed);

  if (sym.edge === "cluster") {
    const rr = R * (sym.tight ? 0.4 : 0.44);
    const ring = R * (sym.tight ? 0.46 : 0.54);
    for (let i = 0; i < sym.n; i++) {
      const a = (i / sym.n) * Math.PI * 2 + o.rot;
      const cx = x + Math.cos(a) * ring;
      const cz = z + Math.sin(a) * ring;
      ring3D(ctx, P, cx, cz, rr, null, 0);
      ctx.stroke();
      if (sym.stems) {
        const s = P(cx, cz);
        ctx.beginPath();
        ctx.arc(s[0], s[1], 1.5, 0, 7);
        ctx.fillStyle = o.stroke;
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }

  if (sym.edge === "pads") {
    for (let i = 0; i < sym.n; i++) {
      const a = (i / sym.n) * Math.PI * 2 + o.rot;
      const cx = x + Math.cos(a) * R * 0.42;
      const cz = z + Math.sin(a) * R * 0.42;
      ctx.beginPath();
      for (let k = 0; k <= 28; k++) {
        const th = (k / 28) * Math.PI * 2;
        const px = Math.cos(th) * R * 0.27;
        const pz = Math.sin(th) * R * 0.46;
        const s = P(cx + px * Math.cos(a) - pz * Math.sin(a), cz + px * Math.sin(a) + pz * Math.cos(a));
        if (k) ctx.lineTo(s[0], s[1]);
        else ctx.moveTo(s[0], s[1]);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (sym.edge === "wand") {
    for (let i = 0; i < sym.n; i++) {
      const a = (i / sym.n) * Math.PI * 2 + o.rot + (rng() - 0.5) * 0.28;
      const L = R * (0.74 + rng() * 0.26);
      line(x + Math.cos(a) * R * 0.07, z + Math.sin(a) * R * 0.07, x + Math.cos(a) * L, z + Math.sin(a) * L, o.lw, o.stroke);
    }
    ctx.restore();
    return;
  }

  if (sym.edge === "uplight" || sym.edge === "flood" || sym.edge === "pathlight") {
    drawFixture(ctx, P, x, z, R, sym.edge, o);
    ctx.restore();
    return;
  }

  /* closed outline */
  if (sym.edge === "poly" && sym.polys) {
    // Drawn vertex for vertex, not resampled by angle: a star this sharp
    // loses its points to a 96-step sweep.
    polyRing3D(ctx, P, x, z, R, sym.polys, o.rot);
  } else {
    ring3D(ctx, P, x, z, R, sym, o.rot);
  }
  ctx.stroke();
  if (sym.edge === "double") {
    ring3D(ctx, P, x, z, R * 0.87, sym, o.rot);
    ctx.lineWidth = o.lw * 0.65;
    ctx.strokeStyle = o.detail;
    ctx.stroke();
    ctx.lineWidth = o.lw;
    ctx.strokeStyle = o.stroke;
  }
  ctx.setLineDash([]);

  /* interior, only when there is room for it */
  const it = sym.interior;
  if (it) {
    if (it.kind === "radial") {
      for (let i = 0; i < it.n; i++) {
        const a = (i / it.n) * Math.PI * 2 + o.rot + (rng() - 0.5) * 0.07;
        const ri = R * it.inner;
        const ro = R * it.outer * (0.93 + rng() * 0.07);
        if (it.thick <= 1.2) {
          line(x + Math.cos(a) * ri, z + Math.sin(a) * ri, x + Math.cos(a) * ro, z + Math.sin(a) * ro, o.lw * 0.6, o.detail);
        } else {
          const nx = -Math.sin(a);
          const nz = Math.cos(a);
          const w = it.thick * R * 0.026;
          const p1 = P(x + Math.cos(a) * ri - nx * w, z + Math.sin(a) * ri - nz * w);
          const tip = P(x + Math.cos(a) * ro, z + Math.sin(a) * ro);
          const p2 = P(x + Math.cos(a) * ri + nx * w, z + Math.sin(a) * ri + nz * w);
          ctx.beginPath();
          ctx.moveTo(p1[0], p1[1]);
          ctx.lineTo(tip[0], tip[1]);
          ctx.lineTo(p2[0], p2[1]);
          ctx.lineWidth = o.lw * 0.7;
          ctx.strokeStyle = o.detail;
          ctx.stroke();
        }
      }
    } else if (it.kind === "lines") {
      const cs = Math.cos(o.rot);
      const sn = Math.sin(o.rot);
      const put = (seg: Seg, w: number, col: string) => {
        const [x1, y1, x2, y2] = seg;
        line(
          x + (x1 * cs - y1 * sn) * R,
          z + (x1 * sn + y1 * cs) * R,
          x + (x2 * cs - y2 * sn) * R,
          z + (x2 * sn + y2 * cs) * R,
          w,
          col,
        );
      };
      for (const seg of it.segs) put(seg, o.lw, o.stroke);
      // the lighter weight in the source drawing, against the outline's
      for (const seg of it.fine ?? []) put(seg, o.lw * (sym.fineScale ?? 0.6), o.detail);
    } else if (it.kind === "branch") {
      const grow = (bx: number, bz: number, a: number, L: number, d: number, sp: number) => {
        const x2 = bx + Math.cos(a) * L;
        const z2 = bz + Math.sin(a) * L;
        line(bx, bz, x2, z2, o.lw * (0.35 + 0.35 * d), o.detail);
        if (d > 0) {
          for (const s of [-1, 1]) {
            grow(x2, z2, a + (s * (sp * Math.PI)) / 360 * (0.55 + rng() * 0.6), L * (0.55 + rng() * 0.15), d - 1, sp * 0.85);
          }
        }
      };
      for (let i = 0; i < it.limbs; i++) {
        grow(x, z, (i / it.limbs) * Math.PI * 2 + o.rot + (rng() - 0.5) * 0.5, R * 0.4, it.depth, it.spread);
      }
    } else {
      // A fixed count placed in the symbol's own frame: the same dots in the
      // same places whatever the zoom, rather than more of them as it grows.
      const tries = Math.round(it.density * 20);
      ctx.fillStyle = o.detail;
      for (let i = 0; i < tries; i++) {
        const a = rng() * Math.PI * 2;
        const rr = R * Math.sqrt(rng()) * 0.9;
        if (rr <= R * edgeRadius(sym, a - o.rot) * 0.9) {
          const s = P(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
          ctx.beginPath();
          ctx.arc(s[0], s[1], 0.8, 0, 7);
          ctx.fill();
        }
      }
    }
  }

  /* centre mark */
  const c = P(x, z);
  ctx.fillStyle = o.stroke;
  ctx.strokeStyle = o.stroke;
  // Centre marks ride the symbol's own size, with a floor so they survive
  // on a plan of a whole acre. A fixed 1.6 px dot looked like a speck once
  // the symbol was any bigger than its printed size — but the fraction has
  // to be small, because it is a fraction of a 25 ft canopy as readily as a
  // 2 ft barrel. The drawn symbols put their own centre at about a
  // twenty-fifth of the radius, so that is the figure.
  if (sym.centre === "dot") {
    ctx.beginPath();
    ctx.arc(c[0], c[1], Math.max(1.3, o.markR * (sym.centreR ?? 0.04)), 0, 7);
    ctx.fill();
  } else if (sym.centre === "hub") {
    ctx.beginPath();
    ctx.arc(c[0], c[1], Math.max(2, o.markR * 0.16), 0, 7);
    ctx.fill();
  } else if (sym.centre === "plus") {
    const s = Math.max(2.8, o.markR * 0.07);
    ctx.beginPath();
    ctx.moveTo(c[0] - s, c[1]);
    ctx.lineTo(c[0] + s, c[1]);
    ctx.moveTo(c[0], c[1] - s);
    ctx.lineTo(c[0], c[1] + s);
    ctx.lineWidth = o.lw;
    ctx.stroke();
  }
  ctx.restore();
}

/** Build (not stroke) the symbol's outline at a given height, so callers
 *  keep their own fill/stroke. Used for a tree's canopy discs, which then
 *  carry the same edge as the mark on the ground beneath them. */
export function symbolPath3D(
  ctx: CanvasRenderingContext2D,
  project: Project,
  x: number,
  y: number,
  z: number,
  R: number,
  sym: PlanSymbol | null,
  rot: number,
  steps = 72,
): void {
  const flat = sym && (sym.edge === "cluster" || sym.edge === "pads" || sym.edge === "wand");
  ctx.beginPath();
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    const rr = R * (sym && !flat ? edgeRadius(sym, a - rot) : 1);
    const s = project(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr);
    if (k) ctx.lineTo(s[0], s[1]);
    else ctx.moveTo(s[0], s[1]);
  }
  ctx.closePath();
}

function ring3D(
  ctx: CanvasRenderingContext2D,
  P: (x: number, z: number) => [number, number, number],
  x: number,
  z: number,
  R: number,
  sym: PlanSymbol | null,
  rot: number,
  steps = 96,
) {
  ctx.beginPath();
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    const rr = R * (sym ? edgeRadius(sym, a - rot) : 1);
    const s = P(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
    if (k) ctx.lineTo(s[0], s[1]);
    else ctx.moveTo(s[0], s[1]);
  }
  ctx.closePath();
}

/** An explicit outline, placed on the ground and rotated with the plant. */
function polyRing3D(
  ctx: CanvasRenderingContext2D,
  P: (x: number, z: number) => [number, number, number],
  x: number,
  z: number,
  R: number,
  polys: [number, number][][],
  rot: number,
) {
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  ctx.beginPath();
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [px, py] = poly[i];
      const s = P(x + (px * cs - py * sn) * R, z + (px * sn + py * cs) * R);
      if (i) ctx.lineTo(s[0], s[1]);
      else ctx.moveTo(s[0], s[1]);
    }
    ctx.closePath();
  }
}

function drawFixture(
  ctx: CanvasRenderingContext2D,
  P: (x: number, z: number) => [number, number, number],
  x: number,
  z: number,
  R: number,
  kind: "uplight" | "flood" | "pathlight",
  o: DrawOpts,
) {
  // A fixture is drawn at a legible minimum, not at its true 3 inch footprint.
  const r = Math.max(R, 1.1);
  if (kind === "pathlight") {
    for (const f of [0.95, 0.6]) {
      ring3D(ctx, P, x, z, r * f, null, 0, 40);
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = o.lw * 0.8;
      ctx.strokeStyle = o.detail;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const c = P(x, z);
    ctx.beginPath();
    ctx.arc(c[0], c[1], 2.2, 0, 7);
    ctx.fillStyle = o.stroke;
    ctx.fill();
    return;
  }
  const half = kind === "uplight" ? 0.38 : 0.8; // radians of beam
  const c = P(x, z);
  ctx.beginPath();
  ctx.moveTo(c[0], c[1]);
  for (let k = 0; k <= 16; k++) {
    const a = o.rot - half + (2 * half * k) / 16;
    const s = P(x + Math.cos(a) * r * 2.2, z + Math.sin(a) * r * 2.2);
    ctx.lineTo(s[0], s[1]);
  }
  ctx.closePath();
  ctx.setLineDash([2, 2]);
  ctx.lineWidth = o.lw * 0.8;
  ctx.strokeStyle = o.detail;
  ctx.stroke();
  ctx.setLineDash([]);
  // the fixture itself: a small solid triangle pointing where it aims
  const tip = P(x + Math.cos(o.rot) * r * 0.9, z + Math.sin(o.rot) * r * 0.9);
  const b1 = P(x + Math.cos(o.rot + 2.4) * r * 0.7, z + Math.sin(o.rot + 2.4) * r * 0.7);
  const b2 = P(x + Math.cos(o.rot - 2.4) * r * 0.7, z + Math.sin(o.rot - 2.4) * r * 0.7);
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(b1[0], b1[1]);
  ctx.lineTo(b2[0], b2[1]);
  ctx.closePath();
  ctx.fillStyle = o.stroke;
  ctx.fill();
}
