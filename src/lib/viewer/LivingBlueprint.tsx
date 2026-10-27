"use client";

// Living-blueprint 3D viewer: draws the ProjectFile the Vision Pro app
// syncs (placements, boundary, features, hardscape) as a stylized
// architectural drawing — sand paper, verde ink, gold selection. The
// headset owns photorealism; this is the blueprint come to life.
//
// Hand-rolled canvas projection on purpose: the stylized look needs no
// meshes, lighting, or textures, so three.js would be dead weight. If we
// ever want real 3D assets in the browser, that's the moment to switch.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import type { ProjectFileJSON } from "./types";
import { buildScene, buildRail, type Instance } from "./scene";
import {
  symbolFor,
  drawPlanSymbol,
  symbolPath3D,
  edgeRadius,
  rngFor,
  type PlanSymbol,
} from "./symbols";

/* ── Brand-locked palette (matches globals.css / the marketing site).
      The viewer is a Verde Vision document — it does not follow the OS
      theme the way the rest of the dashboard does. ───────────────── */
const SAND = "#ebe0cb";
const GROUND = "#e4d8bc";
const VERDE = "#2e5d43";
const INK = "#1c2a21";
const GOLD = "#a87b2f";
const WATER_FILL = "rgba(122,163,178,0.55)";
const WATER_LINE = "#5e93a8";
const CLAY = "#b0552f";

// A succulent's leaves are opaque and they overlap. Everything else in this
// viewer is drawn in outline and left see-through, but a rosette drawn that
// way shows every hidden leaf base at once and collapses into a tangle —
// the overlap IS the plant. Near-opaque paper under the tint lets the front
// bracts cover the ones behind, which is what the depth sort is for.
const LEAF_BODY = "rgba(235,224,203,0.93)";

const verde = (a: number) => `rgba(46,93,67,${a})`;
const gold = (a: number) => `rgba(168,123,47,${a})`;
const ink = (a: number) => `rgba(28,42,33,${a})`;

/* ── Component ──────────────────────────────────────────────────── */

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type LivingBlueprintProps = {
  project: ProjectFileJSON;
  projectName: string;
  estimateAmount?: number | null;
  /** The org's grid prices, "plant_key|size" → price (PriceBook.prices). A
   *  blank cell is $0, as on the estimate and the headset. */
  priceOverrides?: Record<string, number>;
  showPrices: boolean;
  backHref?: string | null;
  /**
   * Called instead of following backHref when the editor has unpublished
   * changes. Those live only in this tab, so leaving loses them — and the
   * one place that knows is the editor, not this component.
   */
  onBeforeLeave?: (() => boolean) | null;
  // Hrefs for the project's PDF documents (2D blueprint, itemized
  // estimate). Null/absent entries render no button.
  documents?: { blueprint: string | null; estimate: string | null } | null;
  // Canvas-only preview: no header, rail, or interaction — a slow orbit
  // instead. Used as the clickable 3D card on the project page.
  embed?: boolean;

  // ── Editing ──
  // Supplied by the design editor that wraps this component. The viewer
  // stays a renderer: it reports which plant was clicked and draws the
  // selection and the ghosts, but owns none of the edit state.
  editing?: boolean;
  selectedId?: string | null;
  onSelectInstance?: (id: string | null) => void;
  /** Absent means the Edit control isn't offered at all. */
  onToggleEditing?: () => void;
  /** Replaces the plant-material rail while editing. The rail groups by
   *  species, so it can't address the single plant an editor works on. */
  editorPanel?: React.ReactNode;
};



/** Convex hull, Andrew's monotone chain. A barrel cactus is a convex body,
 *  so its outline on screen is the hull of its surface — which stays right
 *  at any camera angle, where a drawn ellipse is only right from straight
 *  on and goes wrong the moment the view tips. */
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number],
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src: [number, number][]) => {
    const out: [number, number][] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0)
        out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** How one agave species is put together, as fractions of its own mature
 *  width and height. Every number is a pair read [youngest, oldest]: a
 *  rosette's leaves differ by age, and the SPREAD between those two numbers
 *  is most of what tells two agaves apart. */
type AgaveShape = {
  /** leaves */
  n: number;
  /** leaf length, of the half-width */
  len: [number, number];
  /** where the tip ends up, of the height */
  tip: [number, number];
  /** how much the old leaves lift before they fall away, of the height */
  arch: number;
  /** half-width at the belly, of the plant's half-width */
  width: [number, number];
  /** how far along the leaf that belly sits */
  belly: number;
  /** how the leaf ends. 1 tapers all the way to a needle; higher holds the
   *  width almost to the end and stops — which is the whole point of a
   *  truncata, and the difference between a blade and a paddle. */
  taper: number;
  /** terminal spine beyond the blade, of the leaf's length. A blunt leaf
   *  still ends in one hard dark point. */
  spine: number;
  /** sawn margins. Americana's are obvious; the artichoke's are nearly
   *  smooth and drawing them only muddies it. */
  teeth: boolean;
  /** how far out the leaves attach, of the half-width. A crown, not a
   *  point: seventeen outlines meeting at one spot is a dark knot. */
  root: number;
  /** width at the attachment, of the belly width. A bract is broad where it
   *  joins; a blade comes to nothing. */
  stub: number;
};

/** Lantana is a groundcover, not a shrub with a canopy: a low spreading
 *  mound carrying dozens of small flower clusters, which is what the scan
 *  shows and what the plan symbol's scalloped rim says. */
const LANTANAS = new Set(["WhiteDawnLantana", "PurpleLantana", "YellowLantana"]);

/** One of the two places this viewer leaves its ink-on-sand palette (the
 *  other is the aloe's bloom, below).
 *
 *  With lantana the colour IS the species — three plants identical in habit
 *  and size, told apart by nothing else — so a client looking at the 3D view
 *  cannot read the design without it. It is confined to the flower heads:
 *  stems, ground and everything else stay in verde, so the drawing still
 *  reads as a drawing. Muted to sit on the sand rather than sing against it.
 *
 *  Deliberately NOT applied to the plan symbol. The blueprint is the thing
 *  that gets printed, photocopied and marked up on a tailgate, and colour is
 *  the first thing to fail there — the three keep their dashed rims, which
 *  survive a monochrome print. */
const LANTANA_BLOOM: Record<string, string> = {
  WhiteDawnLantana: "rgba(252,248,238,0.85)",
  PurpleLantana: "rgba(138,118,176,0.78)",
  YellowLantana: "rgba(216,166,63,0.8)",
};

/** The aloe's flower spikes, on the lantana's terms: confined to the flowers,
 *  muted to sit on the sand, and absent from the plan symbol. A tall stalk of
 *  hanging yellow tubes is what tells an aloe from an agave at a glance —
 *  in ink alone the spike is a bottle brush of any colour. Open flowers, and
 *  the greener buds still closed at the tip. */
const ALOE_BLOOM = "rgba(222,184,74,0.88)";
const ALOE_BUD = "rgba(178,180,98,0.88)";

/** Shrub foliage, on the same terms: muted, 3D only, gold under selection.
 *  A shrub is a mass of leaves, and in ink alone one shrub is every shrub —
 *  the green, and how it goes from lit to shadow, is most of what tells a
 *  hopseed from a sage at a glance. RGB, mixed per spray by its light. */
const HOPSEED_LEAF = {
  lit: [118, 148, 88],
  shade: [50, 82, 54],
  fresh: [160, 182, 104], // the paler new growth at the top
  core: [36, 60, 42], // the shadow inside the mass
};
const HOPSEED_GOLD = {
  lit: [226, 192, 120],
  shade: [152, 114, 54],
  fresh: [236, 212, 146],
  core: [118, 86, 40],
};

const AGAVE_SHAPES: Record<string, AgaveShape> = {
  // Long leaves that differ hugely by age: a tall spike of young ones in the
  // middle, old ones flung flat and sagging to the ground.
  AgaveAmericana: {
    n: 11,
    len: [0.34, 1],
    tip: [0.96, 0.1],
    arch: 0.13,
    width: [0.07, 0.29],
    belly: 0.22,
    taper: 1,
    spine: 0,
    teeth: true,
    root: 0.05,
    stub: 0,
  },
  // The artichoke agave: short, broad, rigid leaves of nearly one length,
  // packed into a tight symmetrical dome and overlapping like bracts. Almost
  // no droop, and wide enough along their whole length to read as armour.
  AgaveTruncata: {
    n: 15,
    len: [0.6, 0.95],
    // Even the oldest leaves finish well above the ground: this is a ball,
    // not a skirt. Dropping them to the soil the way americana's fall is
    // what made the first attempt read as the wrong plant.
    tip: [1, 0.45],
    arch: 0.06,
    width: [0.19, 0.38],
    belly: 0.46,
    taper: 5,
    spine: 0.08,
    teeth: false,
    root: 0.2,
    stub: 0.38,
  },
};

export function LivingBlueprint({
  project,
  projectName,
  estimateAmount,
  priceOverrides = {},
  showPrices,
  backHref,
  onBeforeLeave,
  documents,
  embed = false,
  editing = false,
  selectedId = null,
  onSelectInstance,
  onToggleEditing,
  editorPanel,
}: LivingBlueprintProps) {
  const scene = useMemo(() => buildScene(project), [project]);
  const rail = useMemo(
    () => buildRail(scene, priceOverrides),
    [scene, priceOverrides]
  );

  const [mode, setMode] = useState<"3d" | "plan">("3d");
  // Symbols draw at MATURE spread, which is what a landscape plan is for:
  // the diameter is how you catch two trees planted twelve feet apart that
  // both reach twenty. It also means a 5 gal and a 24" Box of the same tree
  // draw identically — correct, because they become the same tree. The
  // container belongs in the callout and the schedule, not in the symbol.
  //
  // The mature/at-planting toggle was removed Sep 2026; pinning everything
  // to 0.45 of mature, which is what replaced it, was neither convention.
  const [selected, setSelected] = useState<string | null>(null);

  type Cam = { az: number; el: number; dist: number; fov: number };
  // panX/panZ slide the point the camera looks at across the ground, so the
  // yard can be bigger than the screen without the view being stuck on its
  // centre. They are deliberately NOT part of saved3d: switching modes keeps
  // you over the same patch of ground, it just changes the angle on it.
  type View = Cam & {
    zoom: number;
    planT: number;
    growth: number;
    panX: number;
    panZ: number;
  };
  const camRef = useRef<{
    cur: View;
    tgt: View;
    saved3d: Cam;
  } | null>(null);

  const hoverRef = useRef<string | null>(null);

  const onSelectRef = useRef(onSelectInstance);
  useEffect(() => {
    onSelectRef.current = onSelectInstance;
  }, [onSelectInstance]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // Mirror interactive state into refs so the rAF loop never restarts.
  const stateRef = useRef({
    mode,
    selected,
    editing,
    selectedId,
  });
  useEffect(() => {
    stateRef.current = {
      mode,
      selected,
      editing,
      selectedId,
    };
  }, [mode, selected, editing, selectedId]);

  const selectSpecies = useCallback((model: string | null) => {
    setSelected((prev) => (prev === model ? null : model));
  }, []);

  useEffect(() => {
    if (!selected) return;
    rowRefs.current.get(selected)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  /* ── Canvas renderer ──────────────────────────────────────────── */
  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const K = reducedMotion ? 1 : 0.14;
    // Wide enough to read a single plant's symbol at one end and to see a
    // whole acre at the other. The old ceiling of 2.6 was the reason the
    // viewer felt stuck.
    const ZOOM_MIN = 0.3;
    const ZOOM_MAX = 10;

    const R = scene.radius;
    const [cx, cz] = scene.center;
    // The point the camera looks at stays INSIDE the design, so that however
    // far you pan and however far you zoom, there is always something under
    // the middle of the screen. Corners are still reachable — they sit near
    // the frame edge when you are centred on the bound. Zooming toward the
    // cursor obeys the same limit.
    const PAN_LIMIT = R * 0.9;
    const V3D = { az: -30, el: 30, dist: R * 2.6, fov: 40 };
    const VPLAN = { az: 0, el: 88.5, dist: R * 10.2, fov: 10 };
    // The camera lives OUTSIDE this effect. Editing a design hands down a new
    // `project`, which rebuilds `scene`, which re-runs this whole effect — and
    // a camera created in here would snap back to its opening angle on every
    // size tap. It survives across rebuilds and is only created once.
    if (!camRef.current) {
      camRef.current = {
        cur: { ...V3D, zoom: 1, planT: 0, growth: 1, panX: 0, panZ: 0 },
        tgt: { ...V3D, zoom: 1, planT: 0, growth: 1, panX: 0, panZ: 0 },
        saved3d: { ...V3D },
      };
    }
    const cam = camRef.current;
    // A camera carried over from before panning existed has no offset.
    for (const v of [cam.cur, cam.tgt]) {
      if (!Number.isFinite(v.panX)) v.panX = 0;
      if (!Number.isFinite(v.panZ)) v.panZ = 0;
    }
    const cur = cam.cur;
    const tgt = cam.tgt;
    let lastMode: "3d" | "plan" = "3d";

    let W = 0;
    let H = 0;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(wrap);

    /* camera */
    let eye = [0, 0, 0];
    let rt = [1, 0, 0];
    let up = [0, 1, 0];
    let fw = [0, 0, -1];
    let focal = 1000;
    const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a: number[], b: number[]) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const dot = (a: number[], b: number[]) =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = (a: number[]) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    };
    function updateCam() {
      const ar = (cur.az * Math.PI) / 180;
      const er = (cur.el * Math.PI) / 180;
      const target = [cx + cur.panX, 0, cz + cur.panZ];
      eye = [
        target[0] + cur.dist * Math.cos(er) * Math.sin(ar),
        cur.dist * Math.sin(er),
        target[2] + cur.dist * Math.cos(er) * Math.cos(ar),
      ];
      fw = norm(sub(target, eye));
      rt = norm(cross(fw, [0, 1, 0]));
      up = cross(rt, fw);
      focal = ((H / 2) / Math.tan(((cur.fov / 2) * Math.PI) / 180)) * cur.zoom;
    }
    const P = (x: number, y: number, z: number): [number, number, number] => {
      const d = sub([x, y, z], eye);
      const zc = Math.max(dot(d, fw), 1);
      return [
        W / 2 + (dot(d, rt) * focal) / zc,
        H / 2 - (dot(d, up) * focal) / zc,
        zc,
      ];
    };
    /** The inverse of P for the ground plane: where a screen point lands on
     *  y=0, or null when the ray misses it (at or above the horizon). This
     *  is what makes dragging feel like moving the ground rather than the
     *  camera — the spot under the cursor stays under the cursor. */
    const groundAt = (sx: number, sy: number): [number, number] | null => {
      const u = (sx - W / 2) / focal;
      const v = (sy - H / 2) / focal;
      const dy = fw[1] + rt[1] * u - up[1] * v;
      if (dy > -1e-4) return null;
      const t = -eye[1] / dy;
      if (!Number.isFinite(t) || t < 0) return null;
      return [
        eye[0] + (fw[0] + rt[0] * u - up[0] * v) * t,
        eye[2] + (fw[2] + rt[2] * u - up[2] * v) * t,
      ];
    };
    /** How many screen pixels a foot covers at a point on the ground.
     *
     *  Measured ACROSS the view, never along the world's X axis. Measuring
     *  along X was the bug behind flower heads and tree trunks that shrank
     *  from some angles and not others: orbit until X points at the camera
     *  and that offset foreshortens to nothing, so everything sized by it
     *  collapsed. The camera's right vector is horizontal and always square
     *  to the view, so a foot along it is never foreshortened — which is
     *  what "a foot, on screen, here" has to mean. */
    const ftPx = (x: number, z: number, r: number) => {
      const a = P(x, 0, z);
      const b = P(x + rt[0] * r, 0, z + rt[2] * r);
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };

    /* path helpers */
    function pathPoly(pts: [number, number][], y = 0) {
      ctx!.beginPath();
      pts.forEach(([x, z], i) => {
        const s = P(x, y, z);
        if (i) ctx!.lineTo(s[0], s[1]);
        else ctx!.moveTo(s[0], s[1]);
      });
      ctx!.closePath();
    }
    function screenBBox(pts: [number, number][]) {
      let x0 = 1e9,
        y0 = 1e9,
        x1 = -1e9,
        y1 = -1e9;
      for (const [x, z] of pts) {
        const s = P(x, 0, z);
        x0 = Math.min(x0, s[0]);
        y0 = Math.min(y0, s[1]);
        x1 = Math.max(x1, s[0]);
        y1 = Math.max(y1, s[1]);
      }
      return [x0, y0, x1, y1];
    }
    function hatch(pts: [number, number][], color: string, spacing: number) {
      ctx!.save();
      pathPoly(pts);
      ctx!.clip();
      const [x0, y0, x1, y1] = screenBBox(pts);
      const span = y1 - y0;
      ctx!.strokeStyle = color;
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      for (let x = x0 - span; x < x1; x += spacing) {
        ctx!.moveTo(x, y0);
        ctx!.lineTo(x + span, y1);
      }
      ctx!.stroke();
      ctx!.restore();
    }
    function dots(pts: [number, number][], color: string, spacing: number) {
      ctx!.save();
      pathPoly(pts);
      ctx!.clip();
      const [x0, y0, x1, y1] = screenBBox(pts);
      ctx!.fillStyle = color;
      for (let x = x0; x < x1; x += spacing)
        for (let y = y0 + ((x / spacing) % 2) * (spacing / 2); y < y1; y += spacing) {
          ctx!.beginPath();
          ctx!.arc(x, y, 1.1, 0, 7);
          ctx!.fill();
        }
      ctx!.restore();
    }
    function shrink(pts: [number, number][], f: number): [number, number][] {
      let sx = 0,
        sz = 0;
      for (const [x, z] of pts) {
        sx += x;
        sz += z;
      }
      sx /= pts.length;
      sz /= pts.length;
      return pts.map(([x, z]) => [sx + (x - sx) * f, sz + (z - sz) * f]);
    }
    function centroid(pts: [number, number][]): [number, number] {
      let sx = 0,
        sz = 0;
      for (const [x, z] of pts) {
        sx += x;
        sz += z;
      }
      return [sx / pts.length, sz / pts.length];
    }
    function circle3D(x: number, y: number, z: number, r: number, n = 22) {
      ctx!.beginPath();
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const s = P(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
        if (k) ctx!.lineTo(s[0], s[1]);
        else ctx!.moveTo(s[0], s[1]);
      }
      ctx!.closePath();
    }

    /* per-frame screen cache for hit testing */
    const hits: { model: string; id: string; sx: number; sy: number; r: number }[] = [];

    function drawExtruded(pts: [number, number][], hFt: number, label: string | null, t: number) {
      const quads = pts
        .map((p, i) => {
          const q = pts[(i + 1) % pts.length];
          const mid = P((p[0] + q[0]) / 2, hFt / 2, (p[1] + q[1]) / 2);
          return { p, q, depth: mid[2] };
        })
        .sort((a, b) => b.depth - a.depth);
      for (const { p, q } of quads) {
        const a = P(p[0], 0, p[1]);
        const b = P(q[0], 0, q[1]);
        const c = P(q[0], hFt, q[1]);
        const d = P(p[0], hFt, p[1]);
        ctx!.beginPath();
        ctx!.moveTo(a[0], a[1]);
        ctx!.lineTo(b[0], b[1]);
        ctx!.lineTo(c[0], c[1]);
        ctx!.lineTo(d[0], d[1]);
        ctx!.closePath();
        ctx!.fillStyle = "#ddd0b2";
        ctx!.fill();
        ctx!.strokeStyle = verde(0.45);
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }
      pathPoly(pts, hFt);
      ctx!.fillStyle = "#e6dbc0";
      ctx!.fill();
      ctx!.strokeStyle = verde(0.5);
      ctx!.lineWidth = 1.1;
      ctx!.stroke();
      if (label) {
        const [gx, gz] = centroid(pts);
        const s = P(gx, hFt, gz);
        ctx!.font = "500 10px ui-monospace, Menlo, monospace";
        ctx!.textAlign = "center";
        ctx!.fillStyle = ink(0.45 + 0.2 * t);
        ctx!.fillText(label.toUpperCase(), s[0], s[1]);
        ctx!.textAlign = "left";
      }
    }

    /** Agave americana, from the scan.
     *
     *  Not the generic rosette: that is nine single strokes, and a stroke has
     *  no width, so a yard of them reads as tufts of grass. An agave's leaves
     *  are BROAD — a hand's width at the base, tapering to one hard terminal
     *  spine — and that width is most of what identifies the plant.
     *
     *  Leaves sit on the golden angle, which is how a rosette actually packs
     *  itself, and age outward: the first ones out are the oldest, flung
     *  nearly flat and sagging to the ground, while the youngest stand almost
     *  upright in a tight spike at the middle. That spread — low skirt, hard
     *  vertical core — is the silhouette in the photograph.
     */
    /** A trunk, rather than a line.
     *
     *  Every tree stood on a single stroke of constant width, which reads as
     *  a pole holding up a canopy. A real one is thick at the ground, thins
     *  as it rises, and forks low — on a mesquite low enough that the fork
     *  is most of what you see of the wood. Drawn as tapered quads so the
     *  width can actually change along the limb, which a stroke cannot do.
     */
    /** A barrel cactus, from the scan: a squat ribbed dome under a spiny
     *  skin, with a woolly crown. It was a plain ellipse, which is the right
     *  silhouette and nothing else — none of the ribbing that makes a barrel
     *  a barrel, and no clue which way is up. */
    /** A lantana: the mound as its flower heads, since that is all you see
     *  of one. Clusters sit on a flattened dome, spaced on the golden angle
     *  so they spread evenly instead of banding, and are drawn back to front
     *  so the near ones sit over the far ones. */
    function drawLantanaBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      stroke: string,
      fill: string,
      lw: number,
      bloom: string | undefined,
    ) {
      const N = 24;
      const headR = Math.max(ftPx(x, z, rw * 0.18), 1.6);
      const heads: { sx: number; sy: number; depth: number; r: number }[] = [];
      for (let k = 0; k < N; k++) {
        // sqrt spreads them evenly by area rather than crowding the middle
        const rr = Math.sqrt((k + 0.5) / N);
        const a = rot + k * 2.399963;
        const q = P(
          x + Math.cos(a) * rw * rr * 0.72,
          h * (0.52 - 0.38 * rr * rr),
          z + Math.sin(a) * rw * rr * 0.72,
        );
        // Clusters are not all one size, and drawing them that way reads as
        // a pattern rather than a plant. Varied off the index, so a given
        // lantana looks the same every frame.
        const vary = 0.74 + 0.52 * ((k * 0.6180339887) % 1);
        heads.push({ sx: q[0], sy: q[1], depth: q[2], r: headR * vary });
      }
      heads.sort((p1, p2) => p2.depth - p1.depth);
      ctx!.lineWidth = lw * 0.8;
      ctx!.strokeStyle = stroke;
      for (const head of heads) {
        ctx!.beginPath();
        ctx!.arc(head.sx, head.sy, head.r, 0, 7);
        // Paper first, so a near cluster still covers the one behind it,
        // then the bloom over it — which both keeps the occlusion and lets
        // the colour settle into the document instead of sitting on top.
        ctx!.fillStyle = LEAF_BODY;
        ctx!.fill();
        ctx!.fillStyle = bloom ?? fill;
        ctx!.fill();
        ctx!.stroke();
      }
      ctx!.lineWidth = lw;
    }

    function drawBarrelBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      stroke: string,
      fill: string,
      lw: number,
    ) {
      // The plant as a surface of revolution — a sphere squashed to its own
      // height. t runs 0 at the crown to 1 at the soil.
      const surf = (t: number, a: number) => {
        const th = t * Math.PI;
        const r = rw * Math.sin(th);
        return P(x + Math.cos(a) * r, (h / 2) * (1 + Math.cos(th)), z + Math.sin(a) * r);
      };

      const cloud: [number, number][] = [];
      for (let i = 0; i <= 8; i++)
        for (let k = 0; k < 18; k++) {
          const q = surf(i / 8, (k / 18) * Math.PI * 2);
          cloud.push([q[0], q[1]]);
        }
      const hull = convexHull(cloud);
      if (hull.length < 3) return;

      ctx!.beginPath();
      ctx!.moveTo(hull[0][0], hull[0][1]);
      for (let i = 1; i < hull.length; i++) ctx!.lineTo(hull[i][0], hull[i][1]);
      ctx!.closePath();
      ctx!.fillStyle = LEAF_BODY;
      ctx!.fill();
      ctx!.fillStyle = fill;
      ctx!.fill();
      ctx!.strokeStyle = stroke;
      ctx!.lineWidth = lw;
      ctx!.lineJoin = "round";
      ctx!.stroke();

      // Spines: short ticks standing off the rim at an even spacing round
      // the outline, which is what the serrations in the plan mark are.
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
      let carry = 0;
      ctx!.lineWidth = lw * 0.6;
      ctx!.beginPath();
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
          ctx!.moveTo(px, py);
          ctx!.lineTo(px + (nx / nl) * spike, py + (ny / nl) * spike);
        }
        carry = step - ((seg - carry) % step);
      }
      ctx!.stroke();

      // Ribs, but only the ones facing us: the body is opaque, so drawing
      // the far side as well would read as a wireframe.
      const mid = P(x, h / 2, z);
      ctx!.lineWidth = lw * 0.7;
      for (let k = 0; k < 13; k++) {
        const a = rot + (k / 13) * Math.PI * 2;
        if (surf(0.5, a)[2] >= mid[2]) continue;
        ctx!.beginPath();
        for (let i = 0; i <= 9; i++) {
          const q = surf(0.08 + (i / 9) * 0.86, a);
          if (i) ctx!.lineTo(q[0], q[1]);
          else ctx!.moveTo(q[0], q[1]);
        }
        ctx!.stroke();
      }

      // The crown: the wool and new spines sit in a tight ring on top.
      ctx!.beginPath();
      for (let k = 0; k <= 16; k++) {
        const q = surf(0.17, (k / 16) * Math.PI * 2);
        if (k) ctx!.lineTo(q[0], q[1]);
        else ctx!.moveTo(q[0], q[1]);
      }
      ctx!.closePath();
      ctx!.lineWidth = lw * 0.7;
      ctx!.stroke();
      ctx!.lineWidth = lw;
    }

    function drawTrunk(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      stroke: string,
      lw: number,
    ) {
      // Taper in feet, floored in pixels so a tree on an acre plan still has
      // a visible stem.
      const limbQuad = (
        ay: number,
        by: number,
        ar: number,
        br: number,
        aOut: number,
        bOut: number,
        az: number,
      ) => {
        const ca = Math.cos(az);
        const sa = Math.sin(az);
        const A = P(x + ca * aOut, ay, z + sa * aOut);
        const B = P(x + ca * bOut, by, z + sa * bOut);
        const dx = B[0] - A[0];
        const dy = B[1] - A[1];
        const L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L;
        const ny = dx / L;
        const wa = Math.max(ftPx(x, z, ar), 0.9);
        const wb = Math.max(ftPx(x, z, br), 0.6);
        ctx!.beginPath();
        ctx!.moveTo(A[0] + nx * wa, A[1] + ny * wa);
        ctx!.lineTo(B[0] + nx * wb, B[1] + ny * wb);
        ctx!.lineTo(B[0] - nx * wb, B[1] - ny * wb);
        ctx!.lineTo(A[0] - nx * wa, A[1] - ny * wa);
        ctx!.closePath();
        ctx!.fillStyle = LEAF_BODY;
        ctx!.fill();
        ctx!.fillStyle = verde(0.22);
        ctx!.fill();
        ctx!.strokeStyle = stroke;
        ctx!.lineWidth = lw * 0.8;
        ctx!.lineJoin = "round";
        ctx!.stroke();
      };

      const forkY = h * 0.27;
      const r0 = Math.max(rw * 0.055, 0.16); // half-width at the ground, ft
      const r1 = r0 * 0.66; // at the fork
      // Bole first, then the limbs over it, so the joint is covered.
      limbQuad(0, forkY, r0, r1, 0, 0, 0);
      for (let k = 0; k < 3; k++) {
        const az = rot + (k / 3) * Math.PI * 2;
        limbQuad(forkY, h * (0.56 + 0.1 * (k % 2)), r1 * 0.78, r1 * 0.24, 0, rw * 0.27, az);
      }
    }

    function drawAgaveBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      stroke: string,
      fill: string,
      lw: number,
      shape: AgaveShape,
    ) {
      // Few enough leaves that the overlaps stay legible: every leaf is a
      // translucent fill laid over the last, and fifteen americana leaves
      // turned the middle into a blot.
      const N = shape.n;
      const lerp = (p: [number, number], age: number) => p[0] + (p[1] - p[0]) * age;
      const y0 = h * 0.06; // leaves spring from a short stem, not the soil
      // No zoom test here on purpose. Detail used to switch on above a
      // projected size, so a plant grew teeth and a midrib as you leaned in
      // and lost them as you pulled back. What a leaf carries is now a
      // property of the leaf.

      type Leaf = {
        pts: [number, number][];
        rib: [number, number][];
        spine: [number, number][];
        depth: number;
      };
      const leaves: Leaf[] = [];

      for (let k = 0; k < N; k++) {
        const a = k * 2.399963; // golden angle — no two leaves shadow each other
        const age = 1 - k / (N - 1); // 1 = oldest and outermost, 0 = youngest
        const L = rw * lerp(shape.len, age);
        const yTip = h * lerp(shape.tip, age);
        const arch = h * shape.arch * age; // the old ones lift before they fall
        // Width is the giveaway, and it is NOT uniform: the old outer leaves
        // are a hand across, the young middle ones are narrow spikes. Scaling
        // width with age is what turns a dark scribble into a rosette.
        const halfW = rw * lerp(shape.width, age);
        // The long outer leaves carry the margin and a midrib; on the short
        // inner ones that detail would just be ink. Age, not zoom.
        const detailed = age > 0.45;
        const ca = Math.cos(a);
        const sa = Math.sin(a);

        // The margin of an agave leaf is sawn, and the sawtooth is the
        // difference between a leaf and a petal. It has to be built from
        // real alternating vertices — a smooth curve modulated by a sine and
        // then sampled coarsely just aliases into crumpled paper.
        const S = age > 0.45 ? 10 : 7;
        const spineLen = shape.spine * L;
        const r0 = rw * shape.root; // leaves ring a crown, they do not all
                                    // meet at one point — that knots the middle
        const at = (i: number, side: number): [number, number] => {
          const t = i / S;
          const r = r0 + (L - r0) * t;
          const y = y0 + (yTip - y0) * t + arch * 4 * t * (1 - t);
          const notch =
            shape.teeth && detailed && side !== 0 && i > 1 && i < S && i % 2 === 1
              ? 0.88
              : 1;
          // A leaf is narrow where it attaches, bellies out about a quarter
          // of the way along, then runs to the terminal spine. Taking it as
          // widest at the base is what made eleven leaves into one blot.
          // Rise to the belly, then run out. How fast it runs out is the
          // species: taper 1 closes to a needle, taper 5 is still most of
          // its width at nine tenths along and then stops square.
          const rise =
            shape.stub + (1 - shape.stub) * Math.pow(Math.min(1, t / shape.belly), 0.8);
          const belly = rise * Math.pow(1 - Math.pow(t, shape.taper), 0.55);
          const w = halfW * belly * notch * side;
          const q = P(x + ca * r - sa * w, y, z + sa * r + ca * w);
          return [q[0], q[1]];
        };

        const pts: [number, number][] = [];
        for (let i = 0; i <= S; i++) pts.push(at(i, 1));
        for (let i = S; i >= 0; i--) pts.push(at(i, -1));

        const rib: [number, number][] = [];
        if (detailed) {
          const from = Math.round(S * 0.35);
          for (let i = from; i <= S; i += Math.max(1, Math.round(S / 5))) rib.push(at(i, 0));
          rib.push(at(S, 0));
        }

        const tip = P(x + ca * L, y0 + (yTip - y0), z + sa * L);
        // The terminal spine: its own short, heavier stroke carrying on past
        // the blunt end of the blade, lifted a little the way a real one
        // hooks up off the leaf.
        const spine: [number, number][] = [];
        if (spineLen > 0) {
          const nose = P(
            x + ca * (L + spineLen),
            y0 + (yTip - y0) + spineLen * 0.35,
            z + sa * (L + spineLen),
          );
          spine.push(at(S, 0), [nose[0], nose[1]]);
        }
        leaves.push({ pts, rib, spine, depth: tip[2] });
      }

      // Far leaves first, so the near ones lie over them.
      leaves.sort((p, q) => q.depth - p.depth);

      for (const leaf of leaves) {
        ctx!.beginPath();
        ctx!.moveTo(leaf.pts[0][0], leaf.pts[0][1]);
        for (let i = 1; i < leaf.pts.length; i++) ctx!.lineTo(leaf.pts[i][0], leaf.pts[i][1]);
        ctx!.closePath();
        ctx!.fillStyle = LEAF_BODY;
        ctx!.fill();
        ctx!.fillStyle = fill;
        ctx!.fill();
        ctx!.strokeStyle = stroke;
        ctx!.lineWidth = lw;
        ctx!.lineJoin = "round";
        ctx!.stroke();

        if (leaf.rib.length > 1) {
          ctx!.beginPath();
          ctx!.moveTo(leaf.rib[0][0], leaf.rib[0][1]);
          for (let i = 1; i < leaf.rib.length; i++) ctx!.lineTo(leaf.rib[i][0], leaf.rib[i][1]);
          ctx!.lineWidth = lw * 0.5;
          ctx!.stroke();
          ctx!.lineWidth = lw;
        }
        if (leaf.spine.length === 2) {
          ctx!.beginPath();
          ctx!.moveTo(leaf.spine[0][0], leaf.spine[0][1]);
          ctx!.lineTo(leaf.spine[1][0], leaf.spine[1][1]);
          ctx!.lineWidth = lw * 1.15;
          ctx!.lineCap = "round";
          ctx!.stroke();
          ctx!.lineCap = "butt";
          ctx!.lineWidth = lw;
        }
      }
    }

    /** Aloe vera, after the app's model.
     *
     *  It drew as the generic rosette: nine bare strokes, a tuft of grass.
     *  The headset's Aloe Vera is a low fountain, about two-thirds as tall
     *  as it is wide (0.53 m by 0.81 m): an upright core of young leaves,
     *  older ones arching out around it, and the oldest swept nearly flat
     *  at the edge, some with their tips hooked over. Fifteen leaves on the
     *  golden angle, aged outward, reproduce that.
     *
     *  An aloe leaf is a succulent's: thick and full of water, where an
     *  agave's is a hard flat blade. So each leaf is drawn as a solid — a
     *  channelled upper face (two halves, margins raised above the midline)
     *  over a rounded underside that bellies out below the margins — four
     *  faces, each tinted by its own outward normal against the sheet's
     *  light (the boulder's). Seen from above it is a trough; from the side or
     *  from under its arch it shows its depth, which is what reads as
     *  fleshy. Small teeth on the older leaves' margins, and the pale flecks
     *  vera carries.
     *
     *  And it is in flower: two slender stalks out of the crown, about twice
     *  the height of the leaves, each ending in a spike of hanging yellow
     *  tubes with the buds still pointing up at the tip. Nothing else in the
     *  yard has that, so it is the quickest way to know the plant is an aloe.
     *
     *  Spread is the catalog's, so the outermost tips land on the plan mark's
     *  rim; height follows the model's proportion from there, capped by the
     *  catalog's.
     */
    function drawAloeBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      tint: (a: number) => string,
      stroke: string,
      lw: number,
      inColour: boolean,
    ) {
      const rng = rngFor("aloe:" + seed);
      // Up and to the left, the light every drawing on this sheet is under.
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const N = 15;
      const S = 14; // stations along a leaf; the odd ones carry the teeth
      const FOLD = 0.3; // margins above the midline, of the half-width
      const BELLY = 0.95; // underside below the margins, of the half-width
      const deg = Math.PI / 180;

      type V3 = [number, number, number];
      type Pt = [number, number];
      type Face = { pts: Pt[]; edges: { line: Pt[]; w: number; a: number | null }[]; flecks: Pt[][]; d: number; lit: number };

      // Centre lines first, in feet: a leaf leaves the crown at its own
      // angle and bends down along its length, the old ones the most.
      const leaves: { c: V3[]; psi: number[]; halfW: number; age: number; flecked: boolean }[] = [];
      let top = 0;
      for (let k = 0; k < N; k++) {
        const age = 1 - k / (N - 1); // 1 = oldest and outermost, 0 = youngest
        const a = rot + k * 2.399963 + (rng() - 0.5) * 0.35; // golden angle
        // Most leaves fan out long and open, as the model's do; only the
        // last few stand up in the core.
        const e0 = (80 - 44 * Math.pow(age, 0.7) + (rng() - 0.5) * 10) * deg;
        const bend = (8 + 56 * Math.pow(age, 1.2) + (rng() - 0.5) * 12) * deg;
        // A few tips hook over, as the model's do.
        const hook = rng() < 0.35 ? (15 + rng() * 25) * deg : 0;
        const sway = (rng() - 0.5) * 28 * deg;
        const L =
          rw * (1.45 - 0.45 * age) * (0.78 + 0.22 * Math.min(1, age / 0.2)) * (0.92 + 0.16 * rng());
        const r0 = rw * 0.08; // a crown, not a point
        const c: V3[] = [];
        const psi: number[] = [];
        let y = 0;
        let px = x + Math.cos(a) * r0;
        let pz = z + Math.sin(a) * r0;
        for (let i = 0; i <= S; i++) {
          const t = i / S;
          const ps = a + sway * t * t;
          if (i > 0) {
            const tm = (i - 0.5) / S;
            const e =
              e0 - bend * Math.pow(tm, 1.5) - hook * Math.max(0, (tm - 0.7) / 0.3) ** 2;
            const step = L / S;
            px += Math.cos(e) * Math.cos(ps) * step;
            pz += Math.cos(e) * Math.sin(ps) * step;
            y += Math.sin(e) * step;
          }
          c.push([px, Math.max(y, 0), pz]);
          psi.push(ps);
          top = Math.max(top, y);
        }
        // Drawn broader than life, as the agaves are: at plan scale a
        // true-width leaf thins back into a stroke and the succulent is lost.
        const halfW = rw * (0.11 + 0.07 * age) * (0.9 + 0.2 * rng());
        leaves.push({ c, psi, halfW, age, flecked: rng() < 0.35 });
      }
      // Height follows the model's proportion; the catalog's is a ceiling.
      const ys = top > h * 0.95 ? (h * 0.95) / top : 1;

      const faces: Face[] = [];
      const proj = (v: V3): Pt => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      };
      const depth = (v: V3) => P(v[0], v[1], v[2])[2];
      for (const lf of leaves) {
        const c = lf.c.map(([cx, cy, cz]): V3 => [cx, cy * ys, cz]);
        // Broad at the clasp and holding its width most of the way out —
        // a fleshy leaf, not a needle — then closing to a point.
        const width = (t: number) => lf.halfW * Math.pow(1 - t, 0.7) * (0.85 + 0.15 * Math.min(1, t / 0.07));
        const marginL: V3[] = [];
        const marginR: V3[] = [];
        const keel: V3[] = [];
        const frames: { T: V3; Sd: V3; Nn: V3 }[] = [];
        for (let i = 0; i <= S; i++) {
          const t = i / S;
          const p0 = c[Math.max(0, i - 1)];
          const p1 = c[Math.min(S, i + 1)];
          const dx = p1[0] - p0[0];
          const dy = p1[1] - p0[1];
          const dz = p1[2] - p0[2];
          const tl = Math.hypot(dx, dy, dz) || 1;
          const T: V3 = [dx / tl, dy / tl, dz / tl];
          const Sd: V3 = [-Math.sin(lf.psi[i]), 0, Math.cos(lf.psi[i])]; // across, level
          // Sd x T: the upper face's normal — in toward the crown on an
          // upright leaf, up on an open one.
          let Nn: V3 = [Sd[1] * T[2] - Sd[2] * T[1], Sd[2] * T[0] - Sd[0] * T[2], Sd[0] * T[1] - Sd[1] * T[0]];
          const nl = Math.hypot(...Nn) || 1;
          Nn = [Nn[0] / nl, Nn[1] / nl, Nn[2] / nl];
          frames.push({ T, Sd, Nn });
          const w = width(t);
          // A tooth is a margin vertex pushed out, on the older leaves.
          const tooth = lf.age > 0.25 && i % 2 === 1 && i > 1 && i < S - 1 ? lf.halfW * 0.12 * (1 - 0.6 * t) : 0;
          const at = (side: number, across: number, up: number): V3 => [
            c[i][0] + Sd[0] * side * across + Nn[0] * up,
            c[i][1] + Nn[1] * up,
            c[i][2] + Sd[2] * side * across + Nn[2] * up,
          ];
          marginL.push(at(1, w + tooth, FOLD * w));
          marginR.push(at(-1, w + tooth, FOLD * w));
          keel.push(at(1, 0, -BELLY * w));
        }
        const fold = c;
        const k = Math.round(S * 0.35);
        // The middle of the leaf's section, for pointing each face's normal
        // OUT of the leaf. Not the boulder's absolute value: that lights an
        // underside facing the ground as brightly as a top facing the sky,
        // and the dark belly under a light trough is what reads as thick.
        const mid: V3 = [
          c[k][0] - frames[k].Nn[0] * BELLY * width(k / S) * 0.4,
          c[k][1] - frames[k].Nn[1] * BELLY * width(k / S) * 0.4,
          c[k][2] - frames[k].Nn[2] * BELLY * width(k / S) * 0.4,
        ];
        const litOf = (a: V3, b: V3) => {
          const T = frames[k].T;
          const ac: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          let nx = T[1] * ac[2] - T[2] * ac[1];
          let ny = T[2] * ac[0] - T[0] * ac[2];
          let nz = T[0] * ac[1] - T[1] * ac[0];
          const out = [(a[0] + b[0]) / 2 - mid[0], (a[1] + b[1]) / 2 - mid[1], (a[2] + b[2]) / 2 - mid[2]];
          if (nx * out[0] + ny * out[1] + nz * out[2] < 0) [nx, ny, nz] = [-nx, -ny, -nz];
          const d = (nx * LX + ny * LY + nz * LZ) / (Math.hypot(nx, ny, nz) || 1);
          return 0.3 + 0.7 * Math.max(0, d); // a floor, so a face in shade is still paper
        };
        const strip = (a: V3[], b: V3[]) => [...a.map(proj), ...[...b].reverse().map(proj)];
        const meanDepth = (a: V3[], b: V3[]) =>
          (a.reduce((s, v) => s + depth(v), 0) + b.reduce((s, v) => s + depth(v), 0)) / (a.length + b.length);
        for (const [margin, side] of [[marginL, 1], [marginR, -1]] as [V3[], number][]) {
          // Upper half: the midline to the raised margin. Flecks sit here.
          const flecks: Pt[][] = [];
          if (lf.flecked) {
            const n = 2 + Math.floor(rng() * 2);
            for (let f = 0; f < n; f++) {
              const i = 2 + Math.floor(rng() * (S * 0.45));
              const s0 = 0.25 + rng() * 0.35;
              const w = width(i / S);
              const { Sd, Nn } = frames[i];
              const pt = (s: number): V3 => [
                c[i][0] + Sd[0] * side * w * s + Nn[0] * FOLD * w * s,
                c[i][1] + Nn[1] * FOLD * w * s,
                c[i][2] + Sd[2] * side * w * s + Nn[2] * FOLD * w * s,
              ];
              flecks.push([proj(pt(s0)), proj(pt(s0 + 0.28))]);
            }
          }
          faces.push({
            pts: strip(fold, margin),
            edges: [
              { line: fold.map(proj), w: 0.5, a: 0.45 },
              { line: margin.map(proj), w: 1, a: null },
            ],
            flecks,
            d: meanDepth(fold, margin),
            lit: litOf(fold[k], margin[k]),
          });
          // Underside half: the margin round to the keel. This is the
          // succulent's body, and what an agave blade has no room for.
          faces.push({
            pts: strip(margin, keel),
            edges: [
              { line: keel.map(proj), w: 0.6, a: 0.55 },
              { line: margin.map(proj), w: 1, a: null },
            ],
            flecks: [],
            d: meanDepth(margin, keel),
            lit: litOf(margin[k], keel[k]),
          });
        }
      }

      const line = (pts: Pt[]) => {
        ctx!.beginPath();
        ctx!.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx!.lineTo(pts[i][0], pts[i][1]);
      };
      const drawFace = (f: Face) => {
        line(f.pts);
        ctx!.closePath();
        // Paper under every face, or the translucent tints stack and the
        // far leaves show through the near ones.
        ctx!.fillStyle = LEAF_BODY;
        ctx!.fill();
        ctx!.fillStyle = tint(0.04 + 0.42 * (1 - f.lit));
        ctx!.fill();
        if (f.flecks.length) {
          ctx!.strokeStyle = "rgba(246,240,226,0.85)";
          ctx!.lineWidth = Math.max(lw * 0.8, 1);
          ctx!.lineCap = "round";
          for (const fl of f.flecks) {
            line(fl);
            ctx!.stroke();
          }
          ctx!.lineCap = "butt";
        }
        for (const e of f.edges) {
          line(e.line);
          ctx!.strokeStyle = e.a === null ? stroke : tint(e.a);
          ctx!.lineWidth = lw * e.w;
          ctx!.stroke();
        }
      };
      // Leaves, stalks and flowers go through one depth sort, so a near leaf
      // still covers the foot of a stalk rising behind it.
      const items: { d: number; draw: () => void }[] = faces.map((f) => ({ d: f.d, draw: () => drawFace(f) }));
      const seg = (a: V3, b: V3, w: number, col: string, cap: CanvasLineCap = "round") => {
        const pa = proj(a);
        const pb = proj(b);
        ctx!.beginPath();
        ctx!.moveTo(pa[0], pa[1]);
        ctx!.lineTo(pb[0], pb[1]);
        ctx!.lineWidth = w;
        ctx!.strokeStyle = col;
        ctx!.lineCap = cap;
        ctx!.stroke();
        ctx!.lineCap = "butt";
      };

      // The blooms. Each stalk leaves the crown from among the leaves, leans
      // a little outward and away from its partner, and carries its flowers
      // on the top third: open tubes hanging at the bottom of the spike,
      // shorter and turning up toward the buds at the tip.
      const leafTop = top * ys;
      const stalkW = Math.max(ftPx(x, z, 0.04), lw * 0.9);
      const tubeW = Math.max(ftPx(x, z, 0.035), 1.6);
      const open = inColour ? ALOE_BLOOM : tint(0.3);
      const bud = inColour ? ALOE_BUD : tint(0.22);
      const lean0 = rot + rng() * Math.PI * 2;
      for (let st = 0; st < 2; st++) {
        const la = lean0 + st * (Math.PI * 0.8 + rng() * 0.6);
        const lean = Math.sin((5 + rng() * 9) * deg);
        const tall = leafTop * (1.85 + rng() * 0.3);
        const bx = x + Math.cos(la) * rw * 0.05;
        const bz = z + Math.sin(la) * rw * 0.05;
        const by = leafTop * 0.08;
        const along = (t: number): V3 => {
          const off = tall * lean * Math.pow(t, 1.4); // bends out more toward the top
          return [bx + Math.cos(la) * off, by + (tall - by) * t, bz + Math.sin(la) * off];
        };
        const SEGS = 10;
        for (let i = 0; i < SEGS; i++) {
          const a = along(i / SEGS);
          const b = along((i + 1) / SEGS);
          const w = stalkW * (1 - 0.35 * (i / SEGS));
          // Butt ends: the stalk is drawn in pieces for the depth sort, and
          // round caps on a translucent ink overlap into beads at every joint.
          items.push({ d: (depth(a) + depth(b)) / 2, draw: () => seg(a, b, w, tint(0.7), "butt") });
        }
        const M = 16; // whorls up the spike
        for (let j = 0; j < M; j++) {
          const u = j / (M - 1); // 0 = the lowest, open flowers; 1 = the tip
          const ax = along(0.68 + 0.315 * u);
          const tilt = (-62 + 102 * Math.pow(u, 1.3)) * deg; // hanging, then up
          const len = rw * (0.12 - 0.075 * u);
          const col = u > 0.72 ? bud : open;
          for (let m = 0; m < 3; m++) {
            const phi = st * 1.3 + j * 2.399963 + (m * Math.PI * 2) / 3;
            const hx = Math.cos(phi);
            const hz = Math.sin(phi);
            const base: V3 = [ax[0] + hx * rw * 0.02, ax[1], ax[2] + hz * rw * 0.02];
            const tip: V3 = [
              base[0] + hx * Math.cos(tilt) * len,
              base[1] + Math.sin(tilt) * len,
              base[2] + hz * Math.cos(tilt) * len,
            ];
            items.push({
              d: (depth(base) + depth(tip)) / 2,
              draw: () => {
                // The lantana's order: ink edge, paper, then the colour.
                seg(base, tip, tubeW + lw * 0.7, tint(0.6));
                seg(base, tip, tubeW, LEAF_BODY);
                seg(base, tip, tubeW, col);
              },
            });
          }
        }
      }

      // Far first, so the near ones lie over them.
      items.sort((p, q) => q.d - p.d);
      ctx!.lineJoin = "round";
      for (const it of items) it.draw();
    }

    // A hopseed's leaves don't move when the camera does, so they are grown
    // once per plant and kept: hundreds of sprays of rng and vector maths
    // every frame was most of what a hedge of them cost.
    type HopseedSpray = {
      c: [number, number, number];
      /** leaf corners, as offsets from c: 5 leaves x 6 corners x xyz */
      off: Float32Array;
      inner: boolean;
      col: string;
      gold: string;
    };
    const hopseedGrown = new Map<string, { stems: [number, number, number][][]; sprays: HopseedSpray[] }>();

    function growHopseed(x: number, z: number, h: number, rw: number, rot: number, seed: string) {
      const rng = rngFor("hopseed:" + seed);
      const LX = -0.44;
      const LY = 0.79;
      const LZ = -0.43;
      const rgb = (c: number[]) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
      const smooth = (e0: number, e1: number, v: number) => {
        const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      type V3 = [number, number, number];
      const nrm = (v: V3): V3 => {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      const crs = (a: V3, b: V3): V3 => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      // The column, as a radius of its spread at each fraction of its
      // height: pinched where the stems gather, full and nearly straight-
      // sided through the middle, rounding off over the top quarter. Rounding
      // from a third of the way down made an egg; the model is a column.
      const prof = (u: number) =>
        (0.42 + 0.58 * smooth(0.05, 0.24, u)) *
        (u > 0.72 ? Math.pow(Math.max(0, 1 - ((u - 0.72) / 0.28) ** 2), 0.4) : 1);

      const stems: V3[][] = [];
      for (let k = 0; k < 5; k++) {
        const a = rot + k * 2.399963 + rng() * 0.5;
        stems.push([
          [x + Math.cos(a) * rw * 0.04, 0, z + Math.sin(a) * rw * 0.04],
          [x + Math.cos(a) * rw * 0.3, h * 0.24, z + Math.sin(a) * rw * 0.3],
        ]);
      }

      // Two layers: an inner one in shadow, which is what you see through
      // the gaps, and the outer skin. Depth from leaves, not from a shape —
      // a filled hull behind them read as a dark can, however small. Placed
      // by area (fewer where the column is narrow), with a little lumpiness
      // round it so the outline is tufted, not turned.
      const NI = 140;
      const NS = 240;
      const s1 = rng() * 6.28;
      const s2 = rng() * 6.28;
      const sprays: HopseedSpray[] = [];
      for (let tries = 0; sprays.length < NS + NI && tries < (NS + NI) * 4; tries++) {
        const inner = sprays.length < NI;
        const u = 0.1 + 0.88 * rng();
        if (rng() > prof(u)) continue;
        const th = rng() * Math.PI * 2;
        const tuft = 1 + 0.07 * Math.sin(4 * th + 9 * u + s1) + 0.05 * Math.sin(7 * th - 5 * u + s2);
        const r = rw * prof(u) * (inner ? 0.5 + 0.3 * rng() : 0.86 + 0.16 * rng()) * tuft;
        const c: V3 = [x + Math.cos(th) * r, u * h, z + Math.sin(th) * r];
        const n = nrm([Math.cos(th), (u - 0.45) * 1.2, Math.sin(th)]); // tipped up toward the crown
        const lit = Math.max(0, n[0] * LX + n[1] * LY + n[2] * LZ);
        const shade = (0.3 + 0.7 * lit) * (0.5 + 0.5 * smooth(0.05, 0.75, u));
        const fresh = !inner && u > 0.6 && rng() < 0.3;
        const tone = (pal: typeof HOPSEED_LEAF) => {
          let col = mix(pal.shade, pal.lit, shade);
          if (inner) col = mix(pal.core, col, 0.35);
          else if (fresh) col = mix(col, pal.fresh, 0.55);
          return rgb(col);
        };
        // A spray points up and a little out; its leaves alternate up it and
        // one finishes it. Each is a lance, widest a third of the way out and
        // drawn to a point — four corners made a diamond, which is a privet.
        const tw = nrm([n[0] * 0.35 + (rng() - 0.5) * 0.3, 1, n[2] * 0.35 + (rng() - 0.5) * 0.3]);
        const side = nrm(crs(tw, n));
        const L = rw * 0.2 * (0.85 + 0.3 * rng());
        const twig = rw * 0.32;
        const w = L * 0.14; // narrow, willow-like
        const off = new Float32Array(5 * 6 * 3);
        let o = 0;
        [0.15, 0.35, 0.55, 0.75, 1].forEach((t, j) => {
          const sg = j % 2 ? 1 : -1;
          const a = j === 4 ? 1 : 0.7071;
          const b = j === 4 ? 0 : 0.7071 * sg;
          const dir = nrm([
            tw[0] * a + side[0] * b + n[0] * 0.15,
            tw[1] * a + side[1] * b + n[1] * 0.15,
            tw[2] * a + side[2] * b + n[2] * 0.15,
          ]);
          const perp = nrm(crs(dir, n));
          for (const [f, q] of [[0, 0], [0.3, 1], [0.7, 0.5], [1, 0], [0.7, -0.5], [0.3, -1]]) {
            for (let i = 0; i < 3; i++) off[o++] = tw[i] * twig * t + dir[i] * L * f + perp[i] * w * q;
          }
        });
        sprays.push({ c, off, inner, col: tone(HOPSEED_LEAF), gold: tone(HOPSEED_GOLD) });
      }
      return { stems, sprays };
    }

    /** Green hopseed, after the app's model.
     *
     *  Shrubs drew as the trees do, the plan mark lifted onto a canopy disc,
     *  which says something round and green is here and nothing about which
     *  shrub. The headset's hopseed is a dense upright column: a few bare
     *  stems out of a tight base, then foliage from knee height to a softly
     *  rounded, tufted top, all of it narrow willow-like leaves in sprays
     *  that point up.
     *
     *  So that is what is drawn: the stems; an inner layer of sprays in
     *  shade, so the gaps read as depth rather than holes; and sprays of five
     *  narrow leaves over the column's skin, far first. Each spray takes its
     *  green from where it sits — its outward normal against the sheet's
     *  light (the boulder's), darker low down — and a few near the top carry
     *  the paler new growth. Leaves are drawn larger than life, as the
     *  agave's are, or at yard scale they would be dust.
     *
     *  Cost: each spray projects four points (its centre, and a foot along
     *  each axis) and places its thirty leaf corners from those, which is
     *  exact enough at leaf size and a seventh of the projections. The inner
     *  layer is filled only; an outline on a leaf in shadow is just noise.
     */
    function drawHopseedBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = hopseedGrown.get(key);
      if (!grown) {
        if (hopseedGrown.size > 400) hopseedGrown.clear(); // growth and edits mint new keys
        grown = growHopseed(x, z, h, rw, rot, seed);
        hopseedGrown.set(key, grown);
      }

      // Stems, first: the foliage closes over them above the base.
      ctx!.strokeStyle = sel ? gold(0.8) : "rgba(98,82,64,0.9)";
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.16), lw);
      ctx!.lineCap = "round";
      for (const [a, b] of grown.stems) {
        const p0 = P(a[0], a[1], a[2]);
        const p1 = P(b[0], b[1], b[2]);
        ctx!.beginPath();
        ctx!.moveTo(p0[0], p0[1]);
        ctx!.lineTo(p1[0], p1[1]);
        ctx!.stroke();
      }
      ctx!.lineCap = "butt";

      const order = grown.sprays.map((sp) => {
        const [cx, cy, cz] = sp.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { sp, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      ctx!.lineJoin = "round";
      ctx!.lineWidth = lw * 0.45;
      ctx!.strokeStyle = sel ? gold(0.6) : ink(0.4);
      for (const { sp, q, J } of order) {
        const off = sp.off;
        ctx!.beginPath();
        for (let o = 0; o < off.length; o += 18) {
          for (let k = 0; k < 6; k++) {
            const i = o + k * 3;
            const sx = q[0] + J[0] * off[i] + J[2] * off[i + 1] + J[4] * off[i + 2];
            const sy = q[1] + J[1] * off[i] + J[3] * off[i + 1] + J[5] * off[i + 2];
            if (k) ctx!.lineTo(sx, sy);
            else ctx!.moveTo(sx, sy);
          }
          ctx!.closePath();
        }
        ctx!.fillStyle = sel ? sp.gold : sp.col;
        ctx!.fill();
        if (!sp.inner) ctx!.stroke();
      }
      ctx!.lineWidth = lw;
    }

    /** Ocotillo: canes, and nothing else.
     *
     *  A fan of bare whips out of one woody crown — no trunk, no canopy, no
     *  rosette. It drew as a nine-blade agave until now, because its glyph
     *  kind is `rosette` and that is the fallback body; with this plant the
     *  silhouette IS the species, so it gets its own.
     *
     *  The plant is a fountain: canes leave a crown barely a foot across
     *  already leaning, rise steeply, and flare in the top third. So each
     *  one is a near-straight whip whose control point is pulled INSIDE the
     *  chord — bowing it the other way gave a splayed bowl, which is a yucca.
     *
     *  Height, lean and spacing are drawn independently of where a cane
     *  stands. Tying them to its angle (the first pass took all three off a
     *  golden-angle sweep) walked the tips around the plant in a spiral
     *  staircase, which is the one thing an ocotillo never does: its canes
     *  are a ragged handful of similar lengths, a few of them young and
     *  short.
     */
    function drawOcotilloBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      stroke: string,
      fill: string,
      lw: number,
    ) {
      const rng = rngFor("oco:" + seed);
      const N = 17;
      const S = 8; // samples per cane — the projection has to curve, not kink
      const r0 = rw * 0.055; // the crown is a knot, not a ring
      const canes: { pts: [number, number][]; depth: number; w: number }[] = [];
      for (let k = 0; k < N; k++) {
        // Even round the crown, then jittered: canes come in a ragged
        // handful, and a perfect ring reads as a manufactured object.
        const a = rot + ((k + 0.5) / N) * Math.PI * 2 + (rng() - 0.5) * 0.62;
        const young = rng() < 0.28; // the short ones coming up through
        const yTip = h * (young ? 0.4 + rng() * 0.22 : 0.76 + rng() * 0.24);
        const rTip = rw * (young ? 0.3 + rng() * 0.22 : 0.52 + rng() * 0.48);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // Pulled inside the chord: steep out of the crown, flaring late.
        const cr = (r0 + rTip) / 2 - rTip * (0.16 + rng() * 0.1);
        const cy = yTip * 0.52;
        const pts: [number, number][] = [];
        let depth = 0;
        for (let i = 0; i <= S; i++) {
          const t = i / S;
          const u = 1 - t;
          const r = u * u * r0 + 2 * u * t * cr + t * t * rTip;
          const y = 2 * u * t * cy + t * t * yTip;
          const q = P(x + ca * r, y, z + sa * r);
          pts.push([q[0], q[1]]);
          if (i === 0) depth = q[2];
        }
        canes.push({ pts, depth, w: lw * (0.85 + rng() * 0.45) });
      }
      canes.sort((p, q) => q.depth - p.depth);

      const budR = Math.max(ftPx(x, z, rw * 0.045), 1.3);
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      ctx!.strokeStyle = stroke;
      for (const cane of canes) {
        ctx!.beginPath();
        ctx!.moveTo(cane.pts[0][0], cane.pts[0][1]);
        for (let i = 1; i < cane.pts.length; i++)
          ctx!.lineTo(cane.pts[i][0], cane.pts[i][1]);
        ctx!.lineWidth = cane.w;
        ctx!.stroke();
        const tip = cane.pts[cane.pts.length - 1];
        ctx!.beginPath();
        ctx!.arc(tip[0], tip[1], budR, 0, 7);
        // Paper first, so a near cane's bud covers the one behind it.
        ctx!.fillStyle = LEAF_BODY;
        ctx!.fill();
        ctx!.fillStyle = fill;
        ctx!.fill();
        ctx!.lineWidth = lw * 0.8;
        ctx!.stroke();
      }

      // The crown: the one woody part of the plant, and what tells a viewer
      // where the canes are rooted once the drawing tilts.
      const c = P(x, 0, z);
      const cr = Math.max(ftPx(x, z, r0 * 2.1), 1.6);
      ctx!.beginPath();
      ctx!.ellipse(c[0], c[1], cr, cr * 0.42, 0, 0, Math.PI * 2);
      ctx!.fillStyle = fill;
      ctx!.fill();
      ctx!.lineWidth = lw;
      ctx!.stroke();
      ctx!.lineCap = "butt";
    }

    /** A boulder: a real faceted solid, lit.
     *
     *  It drew at a hardcoded 1.2 ft whatever the rock — an AZ Boulder is
     *  3.4 ft across in the headset and came out at a third of that, with a
     *  height derived from the same wrong width — and it drew as a plain
     *  ellipse, which is the one shape a rock is not.
     *
     *  Now it is built: four rings of vertices (a buried foot, the shoulder
     *  where the rock is widest, a brow, and a cap that leans off centre),
     *  every one of them jittered off the placement's own id, joined into
     *  quads and painted far to near. Each face takes its tint from its true normal
     *  against a fixed light, which is what makes a flat drawing read as
     *  stone rather than a blob — one drawn ellipse has no faces to catch it.
     *
     *  The ring radii come from the plant's OWN plan mark, so the body and
     *  the mark it cross-fades into stay one rock, and the size is the
     *  catalog's spread, like every other species here.
     */
    function drawBoulderBody(
      x: number,
      z: number,
      wFt: number,
      hFt: number,
      rot: number,
      sym: PlanSymbol | null,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const R = wFt / 2;
      const N = 13; // facets around — enough to read as cut, not as a circle
      const rng = rngFor("rock:" + seed);
      const leanA = rng() * Math.PI * 2;
      const lean = 0.13 + rng() * 0.12; // how far the crown sits off centre

      type V = { sx: number; sy: number; d: number; wx: number; wy: number; wz: number };
      const ring = (frac: number, yFrac: number, jitter: number, off: number): V[] =>
        Array.from({ length: N }, (_, i) => {
          // The spokes are jittered too. On even ones the facets came out
          // as regular as a cut gem, and a 3 ft boulder read as a tent.
          const th = ((i + (rng() - 0.5) * 0.45) / N) * Math.PI * 2;
          const r =
            R * (sym ? edgeRadius(sym, th - rot) : 1) * frac *
            (1 - jitter / 2 + rng() * jitter);
          const wx = x + Math.cos(leanA) * R * off + Math.cos(th) * r;
          const wz = z + Math.sin(leanA) * R * off + Math.sin(th) * r;
          const wy = hFt * yFrac * (0.84 + rng() * 0.32);
          const q = P(wx, wy, wz);
          return { sx: q[0], sy: q[1], d: q[2], wx, wy, wz };
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
      const faces: { vs: V[]; d: number; lit: number }[] = [];
      const face = (vs: V[]) => {
        const ax = vs[1].wx - vs[0].wx;
        const ay = vs[1].wy - vs[0].wy;
        const az = vs[1].wz - vs[0].wz;
        const bx = vs[2].wx - vs[0].wx;
        const by = vs[2].wy - vs[0].wy;
        const bz = vs[2].wz - vs[0].wz;
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        const L = Math.hypot(nx, ny, nz) || 1;
        // Absolute, so the quad's winding — which flips round the back of
        // the rock — cannot turn a face into a hole.
        const lit = Math.abs((nx * LX + ny * LY + nz * LZ) / L);
        faces.push({ vs, d: vs.reduce((s, v) => s + v.d, 0) / vs.length, lit });
      };
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        face([foot[i], foot[j], shoulder[j], shoulder[i]]);
        face([shoulder[i], shoulder[j], brow[j], brow[i]]);
        face([brow[i], brow[j], cap[j], cap[i]]);
      }
      face(cap);
      faces.sort((p, q) => q.d - p.d); // far first, so near stone covers it

      const tint = sel ? gold : verde;
      ctx!.lineJoin = "round";
      for (const f of faces) {
        ctx!.beginPath();
        ctx!.moveTo(f.vs[0].sx, f.vs[0].sy);
        for (let i = 1; i < f.vs.length; i++) ctx!.lineTo(f.vs[i].sx, f.vs[i].sy);
        ctx!.closePath();
        // Paper under every face, or the translucent tints stack and the
        // far side of the rock shows through the near one.
        ctx!.fillStyle = LEAF_BODY;
        ctx!.fill();
        ctx!.fillStyle = tint(0.05 + 0.2 * (1 - f.lit));
        ctx!.fill();
        // The facet edges carry the drawing: at a hairline they dissolved
        // into the fills and the rock went back to being a blob.
        ctx!.strokeStyle = tint(0.5);
        ctx!.lineWidth = lw * 0.85;
        ctx!.stroke();
      }

      // The silhouette, drawn over the facets at full weight: the edge of a
      // rock is a hard line, and face strokes alone leave it furry.
      const hull = convexHull(
        [...foot, ...shoulder, ...brow, ...cap].map((v): [number, number] => [v.sx, v.sy]),
      );
      if (hull.length < 3) return;
      ctx!.beginPath();
      ctx!.moveTo(hull[0][0], hull[0][1]);
      for (let i = 1; i < hull.length; i++) ctx!.lineTo(hull[i][0], hull[i][1]);
      ctx!.closePath();
      ctx!.strokeStyle = sel ? GOLD : verde(0.7);
      ctx!.lineWidth = lw * 1.2;
      ctx!.stroke();
    }

    function drawInstance(inst: Instance, g: number, t: number) {
      const { meta } = inst;
      const st = stateRef.current;
      // Editing addresses ONE plant; browsing still highlights the species,
      // which is how a designer finds where they put the hopseeds.
      const sel = st.editing
        ? st.selectedId === inst.id
        : st.selected === inst.model;
      // Nothing else says a plant is clickable, or WHICH one a click would
      // land on — the hit radius is generous and the symbols crowd.
      const hover = st.editing && !sel && hoverRef.current === inst.id;
      const grows = !["boulder", "poolPrefab", "light"].includes(meta.kind);
      const gr = grows ? g : 1;
      const stroke = sel || hover ? GOLD : verde(0.85);
      const fill = sel ? gold(0.14) : hover ? gold(0.07) : verde(0.08);
      const lw = sel ? 2 : hover ? 1.8 : 1.4;
      const h = meta.renderHeightFt * gr;
      const rw = (meta.matureWidthFt / 2) * gr;
      const { x, z } = inst;
      const planSym = symbolFor(inst.model, meta.kind);
      const symRot = (inst.yawDeg * Math.PI) / 180;

      // A plant's 3D body and its flat plan mark are two drawings of the
      // same thing, and neither survives the other's camera: tilted, the
      // mark smears across the floor; from straight above, the body sits on
      // top of the mark it belongs to. So they trade places as the camera
      // swings, rather than both being drawn at once.
      //   A pool has no plan symbol of its own — its footprint IS the body,
      //   so it stays drawn. A light's cone is the only thing showing where
      //   the fixture aims, so the cone stays too.
      const bodyA = meta.kind === "poolPrefab" ? 1 : 1 - t;
      const markA = meta.kind === "light" ? 1 : t;

      ctx!.globalAlpha = bodyA;
      if (LANTANAS.has(inst.model)) {
        // Selection still wins: a gold plant has been picked, and that has
        // to read louder than the species colour.
        drawLantanaBody(
          x, z, h, rw, symRot, stroke, fill, lw,
          sel ? undefined : LANTANA_BLOOM[inst.model],
        );
      } else if (inst.model === "GreenHopseed") {
        drawHopseedBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
      } else if (meta.kind === "tree" || meta.kind === "shrub") {
        const isShrub = meta.kind === "shrub";
        if (!isShrub) drawTrunk(x, z, h, rw, symRot, sel ? GOLD : verde(0.7), lw);
        ctx!.lineWidth = lw;
        ctx!.strokeStyle = stroke;
        ctx!.fillStyle = fill;
        // The canopy carries the WHOLE plan mark, lifted — outline and the
        // branching inside it. The silhouette alone is the generic shape of
        // a canopy; the limbs are what say which tree it is.
        const canopyY = h * (isShrub ? 0.45 : 0.66);
        // A symbol with no outline has no canopy disc either: on a mulga the
        // branches ARE the canopy, and a disc behind them is a shape the
        // tree does not have.
        const massed = planSym?.edge !== "none";
        if (massed) {
          symbolPath3D(ctx!, P, x, canopyY, z, rw, planSym, symRot);
          ctx!.fill();
        }
        if (planSym) {
          drawPlanSymbol(ctx!, P, x, z, rw, planSym, {
            rot: symRot,
            stroke,
            detail: sel ? GOLD : verde(0.42),
            lw,
            markR: ftPx(x, z, rw),
            seed: inst.model,
            y: canopyY,
          });
        } else {
          ctx!.stroke();
        }
        if (massed) {
          symbolPath3D(ctx!, P, x, h * (isShrub ? 0.8 : 0.92), z, rw * 0.55, planSym, symRot, 48);
          ctx!.fill();
          ctx!.stroke();
        }
      } else if (meta.kind === "palm") {
        const top = [x, h, z] as const;
        const tp = P(...top);
        const base = P(x, 0, z);
        ctx!.strokeStyle = verde(0.7);
        ctx!.lineWidth = Math.max(ftPx(x, z, 0.3), 1.2);
        ctx!.beginPath();
        ctx!.moveTo(base[0], base[1]);
        ctx!.lineTo(tp[0], tp[1]);
        ctx!.stroke();
        ctx!.strokeStyle = stroke;
        ctx!.lineWidth = lw;
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + 0.4;
          const tip = P(
            top[0] + Math.cos(a) * 4.2 * gr,
            top[1] - 1.9 * gr,
            top[2] + Math.sin(a) * 4.2 * gr
          );
          const c = P(
            top[0] + Math.cos(a) * 1.7 * gr,
            top[1] + 1.2 * gr,
            top[2] + Math.sin(a) * 1.7 * gr
          );
          ctx!.beginPath();
          ctx!.moveTo(tp[0], tp[1]);
          ctx!.quadraticCurveTo(c[0], c[1], tip[0], tip[1]);
          ctx!.stroke();
        }
      } else if (meta.kind === "saguaro" || meta.kind === "columnar") {
        const base = P(x, 0, z);
        const top = P(x, h, z);
        const bodyR = Math.min(rw, 0.9);
        ctx!.strokeStyle = stroke;
        ctx!.lineCap = "round";
        ctx!.lineWidth = Math.max(ftPx(x, z, bodyR) * 2, 3);
        ctx!.beginPath();
        ctx!.moveTo(base[0], base[1]);
        ctx!.lineTo(top[0], top[1]);
        ctx!.stroke();
        if (meta.kind === "saguaro") {
          ctx!.lineWidth = Math.max(ftPx(x, z, bodyR) * 1.2, 2);
          for (const [dx, y0, y1] of [
            [1.9, 0.42, 0.74],
            [-1.9, 0.52, 0.66],
          ]) {
            const j0 = P(x, h * y0, z);
            const j1 = P(x + dx * gr, h * y0, z);
            const j2 = P(x + dx * gr, h * y1, z);
            ctx!.beginPath();
            ctx!.moveTo(j0[0], j0[1]);
            ctx!.lineTo(j1[0], j1[1]);
            ctx!.lineTo(j2[0], j2[1]);
            ctx!.stroke();
          }
        }
        ctx!.lineCap = "butt";
      } else if (meta.kind === "barrel") {
        drawBarrelBody(x, z, h, rw, symRot, stroke, fill, lw);
      } else if (meta.kind === "boulder") {
        drawBoulderBody(x, z, rw * 2, meta.renderHeightFt, symRot, planSym, inst.id, sel, lw);
      } else if (inst.model === "Ocotillo") {
        drawOcotilloBody(x, z, h, rw, symRot, inst.id, stroke, fill, lw);
      } else if (inst.model === "Aloe Vera") {
        drawAloeBody(x, z, h, rw, symRot, inst.id, sel || hover ? gold : verde, stroke, lw, !(sel || hover));
      } else if (meta.kind === "rosette" && AGAVE_SHAPES[inst.model]) {
        drawAgaveBody(x, z, h, rw, stroke, fill, lw, AGAVE_SHAPES[inst.model]);
      } else if (meta.kind === "rosette") {
        const bp = P(x, 0, z);
        ctx!.strokeStyle = stroke;
        ctx!.lineWidth = Math.max(lw - 0.2, 1.2);
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2 + 0.2;
          const lift = 0.55 + 0.45 * Math.abs(Math.sin(k * 1.7));
          const tip = P(
            x + Math.cos(a) * rw,
            h * lift,
            z + Math.sin(a) * rw
          );
          const c = P(x + Math.cos(a) * rw * 0.25, h * 0.95, z + Math.sin(a) * rw * 0.25);
          ctx!.beginPath();
          ctx!.moveTo(bp[0], bp[1]);
          ctx!.quadraticCurveTo(c[0], c[1], tip[0], tip[1]);
          ctx!.stroke();
        }
      } else if (meta.kind === "light") {
        const base = P(x, 0, z);
        const top = P(x, Math.max(h, 0.5), z);
        ctx!.strokeStyle = sel ? GOLD : verde(0.7);
        ctx!.lineWidth = 1.4;
        ctx!.beginPath();
        ctx!.moveTo(base[0], base[1]);
        ctx!.lineTo(top[0], top[1]);
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(top[0], top[1], 2.5, 0, 7);
        ctx!.fillStyle = sel ? GOLD : gold(0.7);
        ctx!.fill();
      } else if (meta.kind === "poolPrefab") {
        // Footprint rectangle 10ft × 6ft × scale, rotated by yaw.
        const L = 5 * inst.scale;
        const Wd = 3 * inst.scale;
        const a = (inst.yawDeg * Math.PI) / 180;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const corners: [number, number][] = (
          [
            [-L, -Wd],
            [L, -Wd],
            [L, Wd],
            [-L, Wd],
          ] as [number, number][]
        ).map(([px, pz]) => [x + px * ca - pz * sa, z + px * sa + pz * ca]);
        pathPoly(corners);
        ctx!.fillStyle = WATER_FILL;
        ctx!.fill();
        ctx!.strokeStyle = sel ? GOLD : verde(0.5);
        ctx!.lineWidth = lw;
        ctx!.stroke();
        pathPoly(shrink(corners, 0.75));
        ctx!.strokeStyle = WATER_LINE;
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }

      ctx!.globalAlpha = 1;

      /* ground symbol + label + hit target */
      const symR = Math.max(rw, meta.kind === "poolPrefab" ? 5 * inst.scale : 1);
      const c0 = P(x, 0.02, z);
      // The plan symbol: the mark the blueprint prints, drawn flat on the
      // ground — so plan mode here and the printed sheet are one drawing.
      ctx!.globalAlpha = markA;
      if (planSym && markA > 0.004) {
        drawPlanSymbol(ctx!, P, x, z, symR, planSym, {
          rot: symRot,
          stroke: sel ? GOLD : verde(meta.kind === "boulder" ? 0.45 : 0.62),
          detail: sel ? GOLD : verde(0.4),
          lw: sel ? 1.6 : 1,
          markR: ftPx(x, z, symR),
          seed: inst.model,
        });
      }
      ctx!.globalAlpha = 1;
      const labelA = Math.max(t, sel ? 1 : 0);
      if (labelA > 0.45) {
        ctx!.font = "600 10px ui-monospace, Menlo, monospace";
        ctx!.fillStyle = sel ? GOLD : ink(0.6 * labelA);
        const label =
          sel && inst.containerType
            ? `${meta.code} · ${inst.containerType}`
            : meta.code;
        ctx!.fillText(label, c0[0] + ftPx(x, z, symR) * 0.72 + 4, c0[1] - 4);
      }
      ctx!.setLineDash([]);
      hits.push({
        model: inst.model,
        id: inst.id,
        sx: c0[0],
        sy: c0[1],
        r: Math.max(ftPx(x, z, symR), 16),
      });
    }

    function render() {
      updateCam();
      const t = cur.planT;
      const g = cur.growth;
      ctx!.clearRect(0, 0, W, H);
      ctx!.fillStyle = SAND;
      ctx!.fillRect(0, 0, W, H);
      hits.length = 0;

      /* ground + grid clipped to boundary (or content bounds) */
      const groundPts: [number, number][] =
        scene.boundary.length >= 3
          ? scene.boundary
          : [
              [cx - R, cz - R],
              [cx + R, cz - R],
              [cx + R, cz + R],
              [cx - R, cz + R],
            ];
      pathPoly(groundPts);
      ctx!.fillStyle = GROUND;
      ctx!.fill();
      ctx!.save();
      pathPoly(groundPts);
      ctx!.clip();
      ctx!.strokeStyle = verde(0.09);
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      const gx0 = Math.floor((cx - R) / 5) * 5;
      const gz0 = Math.floor((cz - R) / 5) * 5;
      for (let x = gx0; x <= cx + R; x += 5) {
        const a = P(x, 0, cz - R);
        const b = P(x, 0, cz + R);
        ctx!.moveTo(a[0], a[1]);
        ctx!.lineTo(b[0], b[1]);
      }
      for (let z = gz0; z <= cz + R; z += 5) {
        const a = P(cx - R, 0, z);
        const b = P(cx + R, 0, z);
        ctx!.moveTo(a[0], a[1]);
        ctx!.lineTo(b[0], b[1]);
      }
      ctx!.stroke();
      ctx!.restore();

      /* hardscape areas */
      for (const hs of scene.hardscape) {
        pathPoly(hs.pts);
        if (hs.style === "pool") {
          ctx!.fillStyle = WATER_FILL;
          ctx!.fill();
        } else {
          ctx!.fillStyle = "#e8ddc2";
          ctx!.fill();
          if (hs.style === "turf") hatch(hs.pts, verde(0.18), 5);
          else if (hs.style === "decomposedGranite" || hs.style === "flagstone")
            dots(hs.pts, verde(0.22), 9);
          else hatch(hs.pts, verde(0.13), 8);
        }
        pathPoly(hs.pts);
        ctx!.strokeStyle = verde(0.4);
        ctx!.lineWidth = 1;
        ctx!.stroke();
        if (t > 0.5) {
          const [lx, lz] = centroid(hs.pts);
          const s = P(lx, 0.02, lz);
          ctx!.font = "500 10px ui-monospace, Menlo, monospace";
          ctx!.textAlign = "center";
          ctx!.fillStyle = ink(0.55 * t);
          ctx!.fillText(
            `${hs.label.toUpperCase()} · ${Math.round(hs.sqFt)} SF`,
            s[0],
            s[1]
          );
          ctx!.textAlign = "left";
        }
      }

      /* flat features (everything except extruded structures) */
      const flat = scene.features.filter(
        (f) => !["House", "Garage", "Shed"].includes(f.kind)
      );
      for (const f of flat) {
        if (f.kind === "Pool") {
          pathPoly(f.pts);
          ctx!.fillStyle = WATER_FILL;
          ctx!.fill();
          ctx!.strokeStyle = verde(0.4);
          ctx!.lineWidth = 1.2;
          ctx!.stroke();
          for (const factor of [0.82, 0.6]) {
            pathPoly(shrink(f.pts, factor));
            ctx!.strokeStyle = WATER_LINE;
            ctx!.lineWidth = 1;
            ctx!.stroke();
          }
        } else if (["Patio", "Driveway", "Walkway", "Deck"].includes(f.kind)) {
          pathPoly(f.pts);
          ctx!.fillStyle = "#e8ddc2";
          ctx!.fill();
          ctx!.strokeStyle = verde(0.35);
          ctx!.lineWidth = 1;
          ctx!.stroke();
          if (f.kind === "Walkway") dots(f.pts, verde(0.2), 8);
          else hatch(f.pts, verde(0.12), 8);
        } else {
          pathPoly(f.pts);
          ctx!.strokeStyle = verde(0.45);
          ctx!.lineWidth = 1.2;
          ctx!.setLineDash([4, 3]);
          ctx!.stroke();
          ctx!.setLineDash([]);
        }
        if (t > 0.5 && f.kind !== "Pool") {
          const [lx, lz] = centroid(f.pts);
          const s = P(lx, 0.02, lz);
          ctx!.font = "500 10px ui-monospace, Menlo, monospace";
          ctx!.textAlign = "center";
          ctx!.fillStyle = ink(0.5 * t);
          ctx!.fillText(f.label.toUpperCase(), s[0], s[1]);
          ctx!.textAlign = "left";
        }
      }

      /* boundary */
      if (scene.boundary.length >= 3) {
        pathPoly(scene.boundary);
        ctx!.strokeStyle = verde(0.85);
        ctx!.lineWidth = 1.6;
        ctx!.setLineDash([7, 4]);
        ctx!.stroke();
        ctx!.setLineDash([]);
      }

      /* removal markers */
      for (const rm of scene.removals) {
        const s = P(rm.x, 0.02, rm.z);
        ctx!.strokeStyle = CLAY;
        ctx!.lineWidth = 1.4;
        circle3D(rm.x, 0.02, rm.z, rm.r);
        ctx!.stroke();
        const d = ftPx(rm.x, rm.z, rm.r) * 0.7;
        ctx!.beginPath();
        ctx!.moveTo(s[0] - d, s[1] - d * 0.5);
        ctx!.lineTo(s[0] + d, s[1] + d * 0.5);
        ctx!.stroke();
      }

      /* extruded structures + instances, painter-sorted */
      const items: { d: number; draw: () => void }[] = scene.instances.map(
        (inst) => ({
          d: P(inst.x, 0, inst.z)[2],
          draw: () => drawInstance(inst, g, t),
        })
      );
      for (const f of scene.features) {
        if (!["House", "Garage", "Shed"].includes(f.kind)) continue;
        const [fx, fz] = centroid(f.pts);
        const hFt = f.kind === "Shed" ? 8 : 9;
        items.push({
          d: P(fx, hFt / 2, fz)[2],
          draw: () => drawExtruded(f.pts, hFt, f.label, t),
        });
      }
      items.sort((a, b) => b.d - a.d);
      for (const it of items) it.draw();
    }

    /* ── interaction ── */
    const pointers = new Map<number, [number, number]>();
    let dragDist = 0;
    let lastPinch = 0;
    let lastMid: [number, number] | null = null;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    function canvasXY(e: { clientX: number; clientY: number }): [number, number] {
      const r = cv!.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    /** Slide the ground so the point under `from` ends up under `to`. */
    const panBy = (from: [number, number], to: [number, number]) => {
      const a = groundAt(from[0], from[1]);
      const b = groundAt(to[0], to[1]);
      if (!a || !b) return;
      const lim = PAN_LIMIT;
      tgt.panX = clamp(tgt.panX - (b[0] - a[0]), -lim, lim);
      tgt.panZ = clamp(tgt.panZ - (b[1] - a[1]), -lim, lim);
      cur.panX = tgt.panX;
      cur.panZ = tgt.panZ;
    };
    function nearestAt(mx: number, my: number) {
      let best: { model: string; id: string } | null = null;
      let bd = 1e9;
      for (const h of hits) {
        const d = Math.hypot(h.sx - mx, h.sy - my);
        if (d < h.r && d < bd) {
          bd = d;
          best = { model: h.model, id: h.id };
        }
      }
      return best;
    }
    const nearest = (e: PointerEvent) => {
      const [mx, my] = canvasXY(e);
      return nearestAt(mx, my);
    };

    const onDown = (e: PointerEvent) => {
      cv!.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      dragDist = 0;
      cv!.style.cursor = "grabbing";
    };
    const onLeave = () => {
      hoverRef.current = null;
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) {
        const over = nearest(e);
        cv!.style.cursor = over ? "pointer" : "grab";
        hoverRef.current = over?.id ?? null;
        return;
      }
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
        const mid: [number, number] = [
          (pts[0][0] + pts[1][0]) / 2,
          (pts[0][1] + pts[1][1]) / 2,
        ];
        if (lastPinch) tgt.zoom = clamp((tgt.zoom * d) / lastPinch, ZOOM_MIN, ZOOM_MAX);
        // Two fingers drag the ground as well as pinch it, which is what
        // every map does and what hands expect.
        if (lastMid)
          panBy(
            canvasXY({ clientX: lastMid[0], clientY: lastMid[1] }),
            canvasXY({ clientX: mid[0], clientY: mid[1] }),
          );
        lastPinch = d;
        lastMid = mid;
        return;
      }
      const dx = e.clientX - prev[0];
      const dy = e.clientY - prev[1];
      dragDist += Math.abs(dx) + Math.abs(dy);
      // Plan is a map, so a plain drag moves it. 3D is a model on a turntable,
      // so a plain drag spins it and panning is the held-modifier gesture —
      // shift, the right button or the middle one.
      const pans =
        stateRef.current.mode === "plan" ||
        e.shiftKey ||
        (e.buttons & 2) !== 0 ||
        (e.buttons & 4) !== 0;
      if (pans) {
        panBy(
          canvasXY({ clientX: prev[0], clientY: prev[1] }),
          canvasXY(e),
        );
      } else if (stateRef.current.mode === "3d") {
        tgt.az = cur.az - dx * 0.4;
        tgt.el = clamp(cur.el + dy * 0.3, 8, 80);
        cur.az = tgt.az;
        cur.el = tgt.el;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastPinch = 0;
      lastMid = null;
      cv!.style.cursor = "grab";
      if (dragDist < 6) {
        const hit = nearest(e);
        if (stateRef.current.editing) {
          onSelectRef.current?.(hit?.id ?? null);
        } else if (hit) {
          selectSpecies(hit.model);
        } else {
          setSelected(null);
        }
      }
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastPinch = 0;
      lastMid = null;
      cv!.style.cursor = "grab";
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const before = tgt.zoom;
      const next = clamp(before * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX);
      if (next === before) return;
      tgt.zoom = next;
      // Zoom toward what the cursor is over, not the middle of the screen:
      // pull the look-at point part of the way to it, by exactly the amount
      // the magnification would otherwise push it off-screen.
      const g = groundAt(...canvasXY(e));
      if (!g) return;
      const k = 1 - before / next;
      tgt.panX = clamp(tgt.panX + (g[0] - (cx + cur.panX)) * k, -PAN_LIMIT, PAN_LIMIT);
      tgt.panZ = clamp(tgt.panZ + (g[1] - (cz + cur.panZ)) * k, -PAN_LIMIT, PAN_LIMIT);
    };
    // Framing got lost? Put it back. This never declines — a double click on
    // a plant means nothing else here, and a reset that refuses when you are
    // lost is worse than one that fires when you did not mean it.
    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      Object.assign(tgt, stateRef.current.mode === "plan" ? VPLAN : V3D);
      tgt.zoom = 1;
      tgt.panX = 0;
      tgt.panZ = 0;
      cam.saved3d = { ...V3D };
    };
    // Right-drag is a pan, so it must not also raise the browser menu.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    if (!embed) {
      cv.addEventListener("pointerdown", onDown);
      cv.addEventListener("pointermove", onMove);
      cv.addEventListener("pointerleave", onLeave);
      cv.addEventListener("pointerup", onUp);
      cv.addEventListener("pointercancel", onCancel);
      cv.addEventListener("wheel", onWheel, { passive: false });
      cv.addEventListener("dblclick", onDblClick);
      cv.addEventListener("contextmenu", onContextMenu);
    }

    /* ── loop ── */
    let raf = 0;
    const frame = () => {
      if (embed && !reducedMotion) {
        cur.az += 0.05; // slow ambient orbit for the preview card
        tgt.az = cur.az;
      }
      const m = stateRef.current.mode;
      if (m !== lastMode) {
        if (lastMode === "3d")
          cam.saved3d = { az: cur.az, el: cur.el, dist: cur.dist, fov: cur.fov };
        Object.assign(tgt, m === "plan" ? VPLAN : cam.saved3d);
        tgt.planT = m === "plan" ? 1 : 0;
        lastMode = m;
      }
      tgt.growth = 1;
      for (const k of ["az", "el", "dist", "fov", "zoom", "planT", "growth", "panX", "panZ"] as const) {
        cur[k] += (tgt[k] - cur[k]) * K;
        if (Math.abs(tgt[k] - cur[k]) < 0.0005) cur[k] = tgt[k];
      }
      if (W > 0 && H > 0) render();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onCancel);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("dblclick", onDblClick);
      cv.removeEventListener("contextmenu", onContextMenu);
    };
    // scene is the only real dependency; selectSpecies is stable.
  }, [scene, selectSpecies, embed]);

  /* ── UI ───────────────────────────────────────────────────────── */

  const seg = (active: boolean) =>
    `px-3.5 py-1.5 text-[13px] transition ${
      active
        ? "bg-ink/[0.07] font-semibold text-ink"
        : "text-muted hover:text-ink"
    }`;

  const canvasPane = (
    <div
      ref={wrapRef}
      className={embed ? "relative h-full w-full" : "relative min-h-0 flex-1"}
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full touch-none ${
          embed ? "" : "cursor-grab"
        }`}
        role="img"
        aria-label={`Interactive plan of ${projectName}. Drag to orbit, tap a plant to highlight that species.`}
      />
      {!embed && editing && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 border-2 border-accent/70"
        />
      )}
      {!embed && onToggleEditing && (
        <button
          type="button"
          onClick={onToggleEditing}
          aria-pressed={editing}
          // Being in a mode is not an action to take. While editing, this
          // is a quiet escape hatch — the one filled green button on screen
          // is Publish, which is the thing that actually finishes the work.
          // Both being filled green made them fight over "done".
          className={`absolute left-3.5 top-3 rounded-lg border px-3.5 py-1.5 text-[13px] font-semibold backdrop-blur transition ${
            editing
              ? "border-accent/40 bg-card/85 text-accent-dim hover:bg-card"
              : "border-rule-strong bg-card/90 text-ink shadow-[0_6px_18px_-10px_rgba(28,42,33,0.6)] hover:bg-card"
          }`}
        >
          {editing ? "✕ Exit editing" : "Edit design"}
        </button>
      )}
      {!embed && (
        <>
          <p className="pointer-events-none absolute right-3.5 top-3 text-right font-mono text-[11px] leading-relaxed text-faint">
            {mode === "plan"
              ? "drag to pan · scroll to zoom"
              : "drag to orbit · shift-drag to pan · scroll to zoom"}
            <br />
            double-click to reset the view
            <br />
            {editing ? "click a plant to edit it" : "tap a plant to find its kind"}
          </p>
          <p className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            {projectName} · drawn to scale from headset data · Verde Vision
          </p>
        </>
      )}
    </div>
  );

  if (embed) return canvasPane;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#ebe0cb] text-ink">
      {/* top bar */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-4 py-2.5 sm:px-5">
        {backHref && (
          <Link
            href={backHref}
            onClick={(e) => {
              // The guard returns true when it has taken over — it puts up
              // its own prompt, so this navigation must not also happen.
              if (onBeforeLeave?.()) e.preventDefault();
            }}
            className="flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
          >
            <span aria-hidden>←</span> Dashboard
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg text-ink sm:text-xl">
          {projectName}
        </h1>

        <div className="flex items-center gap-2.5">
          <div className="flex overflow-hidden rounded-lg border border-rule bg-card">
            <button
              type="button"
              className={seg(mode === "3d")}
              aria-pressed={mode === "3d"}
              onClick={() => setMode("3d")}
            >
              3D
            </button>
            <button
              type="button"
              className={seg(mode === "plan")}
              aria-pressed={mode === "plan"}
              onClick={() => setMode("plan")}
            >
              Plan
            </button>
          </div>
          {(documents?.blueprint || documents?.estimate) && (
            <div className="flex overflow-hidden rounded-lg border border-rule bg-card">
              {documents.blueprint && (
                <a
                  href={documents.blueprint}
                  target="_blank"
                  rel="noopener"
                  className={seg(false)}
                >
                  Blueprint PDF
                </a>
              )}
              {documents.estimate && (
                <a
                  href={documents.estimate}
                  target="_blank"
                  rel="noopener"
                  className={seg(false)}
                >
                  Estimate PDF
                </a>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {canvasPane}

        {/* rail — or the editor, while editing */}
        <aside className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-rule bg-card/60 md:max-h-none md:w-[320px] md:border-l md:border-t-0">
          {editing && editorPanel ? (
            editorPanel
          ) : (
          <>
          <div className="border-b border-rule px-4 py-3">
            <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-faint">
              Plant material
            </h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rail.rows.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted">
                Nothing placed yet — plants will appear here after the next
                sync from the headset.
              </p>
            )}
            {rail.rows.map((row) => {
              const isSel = selected === row.model;
              return (
                <button
                  key={row.model}
                  type="button"
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.model, el);
                    else rowRefs.current.delete(row.model);
                  }}
                  onClick={() => selectSpecies(row.model)}
                  aria-pressed={isSel}
                  className={`flex w-full items-center gap-3 border-b border-rule px-4 py-2.5 text-left transition ${
                    isSel ? "bg-gold/10" : "hover:bg-ink/[0.04]"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold ${
                      isSel
                        ? "border-gold text-gold"
                        : "border-accent/50 text-accent"
                    }`}
                  >
                    {row.meta.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {row.meta.name}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      ×{row.qty}
                      {row.unitLabel && ` · ${row.unitLabel}`}
                      {showPrices && row.unitPrice != null && (
                        <> · {currency.format(row.unitPrice)} ea</>
                      )}
                    </span>
                  </span>
                  {showPrices && (
                    <span
                      className={`shrink-0 font-mono text-sm tabular-nums ${
                        isSel ? "font-semibold text-gold" : "text-body"
                      }`}
                    >
                      {row.lineTotal != null ? currency.format(row.lineTotal) : "—"}
                    </span>
                  )}
                </button>
              );
            })}
            {scene.removals.length > 0 && (
              <div className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-clay/50 font-mono text-[10px] font-semibold text-clay">
                  RM
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">
                    Existing plant removal
                  </span>
                  <span className="block text-xs text-muted">
                    ×{scene.removals.length} marked in the yard
                  </span>
                </span>
              </div>
            )}
          </div>
          {showPrices && (
            <div className="border-t border-rule px-4 py-3">
              {rail.subtotal != null && (
                <div className="flex items-baseline justify-between">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-faint">
                    Materials subtotal
                  </span>
                  <span className="font-mono text-sm tabular-nums text-body">
                    {currency.format(rail.subtotal)}
                  </span>
                </div>
              )}
              {estimateAmount != null && (
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-faint">
                    Project estimate
                  </span>
                  <span className="font-mono text-lg font-semibold tabular-nums text-ink">
                    {currency.format(estimateAmount)}
                  </span>
                </div>
              )}
            </div>
          )}
          </>
          )}
        </aside>
      </div>
    </div>
  );
}
