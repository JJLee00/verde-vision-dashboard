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
// INTERIORS ARE LEVEL-OF-DETAIL. A 2 ft barrel cactus is ~19 px across on a
// printed 60 ft yard; ribs drawn at that size are a smudge. Interiors are
// skipped below INTERIOR_MIN_PX of projected radius.

export const INTERIOR_MIN_PX = 22;

export type EdgeKind =
  | "plain"
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

export type Interior =
  | { kind: "radial"; n: number; thick: number; inner: number; outer: number }
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
};

/* ---------- edges: r(theta) in [0,1] ---------- */

export function edgeRadius(sym: PlanSymbol, t: number): number {
  const { edge, n, d } = sym;
  switch (edge) {
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
  HoneyMesquite: TREE(22, 0.07, branch(4, 3, 138)),
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
  AgaveAmericana: ROSETTE(9, 0.4, 3.4),
  AgaveTruncata: ROSETTE(7, 0.42, 4.2, 0.88),
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
  GoldenBarrel: { edge: "tooth", n: 34, d: 0.07, interior: radial(24, 0.8, 0.62, 0.94), centre: "dot" },
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
  /** projected radius in screen px, for the level-of-detail cut */
  screenR: number;
  /** stable jitter seed; the model name is a good one */
  seed: string;
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
  const P = (wx: number, wz: number) => project(wx, GROUND_Y, wz);
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
      if (sym.stems && o.screenR > INTERIOR_MIN_PX * 0.6) {
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
  ring3D(ctx, P, x, z, R, sym, o.rot);
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
  if (it && o.screenR >= INTERIOR_MIN_PX) {
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
      const tries = Math.round(it.density * o.screenR * 0.9);
      ctx.fillStyle = o.detail;
      for (let i = 0; i < tries; i++) {
        const a = rng() * Math.PI * 2;
        const rr = R * Math.sqrt(rng()) * 0.9;
        if (rr <= R * edgeRadius(sym, a - o.rot) * 0.9) {
          const s = P(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
          ctx.beginPath();
          ctx.arc(s[0], s[1], 0.7, 0, 7);
          ctx.fill();
        }
      }
    }
  }

  /* centre mark */
  const c = P(x, z);
  ctx.fillStyle = o.stroke;
  ctx.strokeStyle = o.stroke;
  if (sym.centre === "dot") {
    ctx.beginPath();
    ctx.arc(c[0], c[1], 1.6, 0, 7);
    ctx.fill();
  } else if (sym.centre === "hub") {
    ctx.beginPath();
    ctx.arc(c[0], c[1], Math.max(2, o.screenR * 0.16), 0, 7);
    ctx.fill();
  } else if (sym.centre === "plus") {
    const s = 3.5;
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
