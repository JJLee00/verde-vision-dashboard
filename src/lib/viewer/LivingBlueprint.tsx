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
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { METERS_TO_FEET, type ProjectFileJSON } from "./types";
import { buildScene, buildRail, localToScene, sceneToLocal, type Instance } from "./scene";
import { sizeFactor, speciesMeta } from "./catalog";
import { growTexasSage, sageCoreRing, SAGE_COLOURS, SAGE_GOLD, type SageTuft } from "./bodies/sage";
import { WHITE_DAWN_COLOURS, WHITE_DAWN_GOLD, type WhiteDawnSprig, type WhiteDawnPlant, WHITE_DAWN_LEAF, WHITE_DAWN_KITE, WD_LEVELS, WD_TONES, growWhiteDawn } from "./bodies/whiteDawn";
import { PURPLE_LANTANA_COLOURS, PURPLE_LANTANA_GOLD, YELLOW_LANTANA_COLOURS, YELLOW_LANTANA_GOLD, type PurpleSprig, type PurplePlant, PURPLE_LEAF, PURPLE_KITE, PL_TONES, growPurpleLantana, type YellowSprig, type YellowPlant, YELLOW_LEAF, YELLOW_KITE, YL_TONES, growYellowLantana } from "./bodies/lantana";
import { type HopseedSpray, growHopseed } from "./bodies/hopseed";
import { type YellowBellsPart, growYellowBells } from "./bodies/yellowBells";
import { RED_BIRD_COLOURS, RED_BIRD_GOLD, type RedBirdPart, growRedBird } from "./bodies/redBird";
import { JOJOBA_COLOURS, JOJOBA_GOLD, type JojobaSprig, JOJOBA_LEAF, jojobaCoreRing, growJojoba } from "./bodies/jojoba";
import { BOTTLEBRUSH_COLOURS, BOTTLEBRUSH_GOLD, type BottlebrushPart, BOTTLEBRUSH_LEAF, bottlebrushCoreRing, growBottlebrush } from "./bodies/bottlebrush";
import { PALO_VERDE_COLOURS, PALO_VERDE_GOLD, type PaloVerdeTree, PV_LEVELS, PV_TONES, growPaloVerde } from "./bodies/paloVerde";
import { MESQUITE_COLOURS, MESQUITE_GOLD, type MesquiteTree, MQ_LEVELS, MQ_TONES, growMesquite } from "./bodies/mesquite";
import { EBONY_COLOURS, EBONY_MODELS, EBONY_GOLD, type EbonyTree, EB_LEVELS, EB_PUFF, EB_TONES, EB_PUFF_TONES, growEbony } from "./bodies/ebony";
import { MULGA_COLOURS, MULGA_GOLD, MULGA_MODELS, type MulgaTree, MU_LEVELS, MU_TONES, growMulga } from "./bodies/mulga";
import { CHASTE_COLOURS, CHASTE_GOLD, type ChasteTree, CT_LEVELS, CT_SPIKE_LEVELS, CT_LEAF_TONES, CT_SPIKE_TONES, CT_FINGERS, growChaste } from "./bodies/chaste";
import { FENCE_POST_COLOURS, FENCE_POST_GOLD, type FencePostClump, FP_RIBS, FP_TONES, growFencePost } from "./bodies/fencePost";
import { ORGAN_PIPE_COLOURS, ORGAN_PIPE_GOLD, type OrganPipeClump, OP_LEVELS, OP_PTS, OP_BANDS, OP_TONES, growOrganPipe } from "./bodies/organPipe";
import { TOOTHPICK_COLOURS, TOOTHPICK_GOLD, type ToothpickPlant, TP_LEVELS, TP_PTS, TP_TONES, growToothpick } from "./bodies/toothpick";
import { TOTEM_COLOURS, TOTEM_GOLD, type TotemPlant, TT_TONES, TT_N, growTotem } from "./bodies/totem";
import { TROPICAL_AGAVE_COLOURS, TROPICAL_AGAVE_GOLD, TA_LEAVES, TA_PTS, TA_STRIPE, TA_TONES, type TropicalAgavePlant, growTropicalAgave } from "./bodies/tropicalAgave";
import { AMERICANA_COLOURS, AMERICANA_GOLD, AM_PTS, AM_FACES, AM_FACE_LINES, AM_TEETH, AM_DEAD, AM_DEAD_PTS, AM_TONES, type AmericanaPlant, growAmericana } from "./bodies/americana";
import { TRUNCATA_COLOURS, TRUNCATA_GOLD, TC_PTS, TC_SPLIT, TC_FACES, TC_FACE_LINES, TC_TEETH, TC_TONES, TC_MODEL, type TruncataPlant, TC_DOME, growTruncata } from "./bodies/truncata";
import { GOLDEN_BARREL_COLOURS, GOLDEN_BARREL_GOLD, GB_RIBS, type BarrelPlant, GB_ST, growGoldenBarrel } from "./bodies/goldenBarrel";
import { BLUE_GLOW_COLOURS, BLUE_GLOW_GOLD, BG_PTS, BG_SPLIT, BG_FACES, BG_FACE_LINES, BG_TONES, BG_MODEL, type BlueGlowPlant, growBlueGlow } from "./bodies/blueGlow";
import { BLACK_TIP_COLOURS, BLACK_TIP_GOLD, BT_PTS, BT_FACE_LINES, BT_TONES, type BlackTipPlant, BT_ALL, growBlackTip } from "./bodies/blackTip";
import { FEROX_COLOURS, FEROX_GOLD, AF_PTS, AF_FACES, AF_FACE_LINES, AF_TEETH, AF_DEAD, AF_DEAD_PTS, AF_TONES, type FeroxPlant, growFerox } from "./bodies/ferox";
import { OCOTILLO_COLOURS, OCOTILLO_GOLD, OC_CANES, type OcotilloPlant, growOcotillo } from "./bodies/ocotillo";
import { BEAKED_YUCCA_COLOURS, BEAKED_YUCCA_GOLD, type YuccaPlant, BY_R, growBeakedYucca } from "./bodies/yucca";
import { ALOE_BLOOM, ALOE_BUD, type AloePlant, growAloe } from "./bodies/aloe";
import { MADAGASCAR_COLOURS, MADAGASCAR_GOLD, MP_LEVELS, MP_SIDES, MP_PTS, MP_LEAVES, MP_SPINES, MP_TONES, MP_RINGS, type MadagascarPlant, growMadagascar } from "./bodies/madagascar";
import { BARREL_RIBS, barrelAt, barrelCloud, barrelCrown, barrelRib, barrelRibAngle, barrelSpikes } from "./bodies/barrel";
import { palmFronds, rosetteLeaves, saguaroArms, saguaroR } from "./bodies/glyphs";
import { FS_N, FS_WIDTHS, FS_BATCH, FS_BATCHES, FS_TONES, growFirestick } from "./bodies/firestick";
import { type BoulderPlant, growBoulder } from "./bodies/boulder";
import { AZ_ROCK_COLOURS, AZ_ROCK_GOLD, AZR_F, AZR_NV, AZR_NF, AZR_TONES, AZR_CREASES, AZR_FLECKS, azrFleckFace, azrFleckSize, azrFleckLight, type AzRock, growAzRock } from "./bodies/azBoulder";
import { trunkLimbs, trunkWidths } from "./bodies/trunk";
import { createGLLayer, GL_MODELS, type GLLayer, type GLPlant, type GLYard } from "./gl/layer";
import { convexHull } from "./gl/geom";
import {
  symbolFor,
  drawPlanSymbol,
  symbolPath3D,
  type PlanSymbol,
} from "./symbols";

/* ── Brand-locked palette (matches globals.css / the marketing site).
      The viewer is a Verde Vision document — it does not follow the OS
      theme the way the rest of the dashboard does. ───────────────── */
const SAND = "#ebe0cb";
const GROUND = "#e4d8bc";
const VERDE = "#2e5d43";
/** What a move between a flat plan and 3D carries; the zoom follows. */
const TWEENED = ["az", "el", "dist", "fov", "planT", "panX", "panZ"] as const;
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

/** How light the 3D view draws while it moves, learned from how this
 *  machine keeps up and kept for the page. At 0 every frame is drawn in
 *  full; at 1 a moving view draws its plants from snapshots (see `fromSnap`
 *  in the renderer); at 2, a plant drawn as ever while it moves (one too big
 *  for a snapshot, or mid-tween) draws every other leaf. A view that stops
 *  is drawn again in full, so a still view looks the same on every machine. */
const motion = { level: 0, gaps: [] as number[] };
const MOTION_LEVELS = 2;
/** A moving view still this long is drawn again in full. */
const SETTLE_MS = 150;
/** What a moving frame spends taking snapshots again, ms. */
const SNAP_BUDGET_MS = 4;

/** Counts a gap between two moving frames. Most of a dozen running long —
 *  under about 38 a second — and moving frames draw a level lighter. One
 *  slow frame (a plant grown for the first time, a pause) doesn't count. */
function keepPace(gap: number) {
  motion.gaps.push(gap);
  if (motion.gaps.length < 12) return;
  const sorted = [...motion.gaps].sort((a, b) => a - b);
  motion.gaps = [];
  if (sorted[6] > 26 && motion.level < MOTION_LEVELS) motion.level++;
}

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
  /** With embed: the canvas still orbits, pans, zooms and picks under the
   *  pointer, and holds still on its own — the site plan's 3D view. */
  interactive?: boolean;

  // ── Editing ──
  // Supplied by the design editor that wraps this component. The viewer
  // stays a renderer: it reports which plant was clicked and draws the
  // selection and the ghosts, but owns none of the edit state.
  editing?: boolean;
  selectedId?: string | null;
  /** Several picked at once (the site plan's designer); drawn like the one. */
  selectedIds?: string[];
  /** `add`: a shift-click, which picks another as well. */
  onSelectInstance?: (id: string | null, add?: boolean) => void;
  /** Absent means the Edit control isn't offered at all. */
  onToggleEditing?: () => void;
  /** Replaces the plant-material rail while editing. The rail groups by
   *  species, so it can't address the single plant an editor works on. */
  editorPanel?: React.ReactNode;
  /** The site plan's 3D designer (with `embed interactive editing`). */
  designer?: Designer3D | null;
  /** Opens over this spot instead of at the usual angle: straight down, as
   *  the site plan's 2D sheet showed it, then down into 3D over the same
   *  ground. Read once, when the view opens. */
  openFrom?: CameraSpot | null;
  /** The way back to 2D (`CameraHandle.flatten`). */
  cameraRef?: React.Ref<CameraHandle>;
  /** "webgl", the default, draws the yard and the plants it knows on the
   *  graphics card, under this canvas — which draws everything itself
   *  wherever WebGL can't be had, or is lost. "canvas" is the canvas alone
   *  (the WebGL test page's comparison). */
  renderer?: "canvas" | "webgl";
};

/** A spot on the ground as a flat plan shows it: the point in the middle
 *  (the project's own metres), how many screen pixels a metre takes there,
 *  and which way along the ground is up the screen. */
export type CameraSpot = { at: [number, number]; pxPerM: number; north: [number, number] };

export type CameraHandle = {
  /** Tilts up to straight down with `north` up the screen, the ground in
   *  the middle holding its size, and says which spot that ends on — for
   *  the 2D sheet to take up. Null before the view has a size. */
  flatten(north: [number, number]): Omit<CameraSpot, "north"> | null;
};

/**
 * Designing in 3D. A click on the ground plants `placing` there, ghosted
 * under the cursor until then; with nothing to plant, a plant dragged
 * moves along the ground. Positions come back in the project's own
 * metres, the frame its placements are in. The viewer still owns none of
 * the design: it reports, and the new project comes back down.
 */
export type Designer3D = {
  placing: { model: string; scale: number } | null;
  onPlace: (x: number, z: number) => void;
  /** Every plant the drag carried: the one held, or all the picked ones. */
  onMove: (moves: { id: string; x: number; z: number }[]) => void;
  /** Where the picked plants are on screen, as the view moves — null when
   *  nothing is picked, or while it's being dragged — for the buttons that
   *  float beside them. */
  onAnchor?: (at: { x0: number; y0: number; x1: number; y1: number } | null) => void;
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
  interactive = false,
  editing = false,
  selectedId = null,
  selectedIds,
  onSelectInstance,
  onToggleEditing,
  editorPanel,
  designer = null,
  openFrom = null,
  cameraRef,
  renderer = "webgl",
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
  type Tweened = Pick<View, "az" | "el" | "dist" | "fov" | "planT" | "panX" | "panZ">;
  const camRef = useRef<{
    cur: View;
    tgt: View;
    saved3d: Cam;
    // A timed move between a flat plan and 3D, eased in and out, the
    // ground in the middle held at `hold` pixels a foot all the way.
    tween?: { from: Tweened; to: Tweened; start: number; dur: number; hold: number };
    // The scene's middle when the camera last looked at it.
    center?: [number, number];
    // It has opened from `openFrom` already.
    opened?: boolean;
  } | null>(null);

  const hoverRef = useRef<string | null>(null);

  const onSelectRef = useRef(onSelectInstance);
  useEffect(() => {
    onSelectRef.current = onSelectInstance;
  }, [onSelectInstance]);

  const designerRef = useRef(designer);
  // Only the first counts: the camera is made once.
  const openFromRef = useRef(openFrom);
  const flattenRef = useRef<CameraHandle["flatten"] | null>(null);
  useImperativeHandle(cameraRef, () => ({ flatten: (north) => flattenRef.current?.(north) ?? null }), []);
  useEffect(() => {
    designerRef.current = designer;
  }, [designer]);
  // In the designer, in scene feet: the plants being dragged (held where
  // they were let go until the moved design comes back) — where each
  // started, and how far the one held has gone — and where the plant about
  // to be planted is under the cursor.
  const dragRef = useRef<{
    from: Map<string, [number, number]>;
    /** The one pressed on. */
    held: string;
    dx: number;
    dz: number;
    ox: number;
    oz: number;
    moved: boolean;
    done: boolean;
  } | null>(null);
  const ghostRef = useRef<[number, number] | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef(renderer);
  useEffect(() => {
    rendererRef.current = renderer;
  }, [renderer]);
  // The WebGL layer, kept across the scene's changes so its plants stay
  // grown on the card: an edit regrows only the plants it touched.
  const glLayerRef = useRef<{ layer: GLLayer | null; failed: boolean } | null>(null);
  useEffect(
    () => () => {
      glLayerRef.current?.layer?.dispose();
      glLayerRef.current = null;
    },
    [],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // Mirror interactive state into refs so the rAF loop never restarts.
  const picks = selectedIds?.join() ?? "";
  const stateRef = useRef({
    mode,
    selected,
    editing,
    selectedId,
    picks,
  });
  useEffect(() => {
    stateRef.current = {
      mode,
      selected,
      editing,
      selectedId,
      picks,
    };
  }, [mode, selected, editing, selectedId, picks]);

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
    const screen = cv.getContext("2d");
    if (!screen) return;
    // What drawing goes to: the screen, or for a moment a plant's snapshot.
    let ctx = screen;

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
    /** The camera's turn that puts this way along the ground (local) up
     *  the screen. */
    const facing = ([x, z]: [number, number]) => {
      const [nx, nz] = localToScene(scene, x, z);
      return (Math.atan2(-nx, -nz) * 180) / Math.PI;
    };
    // Opened from the 2D sheet: straight down over the spot it showed, the
    // way it faced, at its scale; then down into 3D over the same ground.
    const from = openFromRef.current;
    if (from && !cam.tween && cam.cur.planT === 0 && !cam.opened) {
      cam.opened = true;
      const [sx, sz] = localToScene(scene, from.at[0], from.at[1]);
      const az = facing(from.north);
      const flat: Tweened = {
        ...VPLAN,
        az,
        planT: 1,
        panX: Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, sx - cx)),
        panZ: Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, sz - cz)),
      };
      Object.assign(cam.cur, flat);
      Object.assign(cam.tgt, flat);
      cam.saved3d = { az, el: V3D.el, dist: V3D.dist, fov: V3D.fov };
      cam.tween = {
        from: flat,
        to: { ...flat, el: V3D.el, dist: V3D.dist, fov: V3D.fov, planT: 0 },
        // A beat to fade in over the sheet first.
        start: performance.now() + 180,
        dur: 750,
        hold: from.pxPerM / METERS_TO_FEET,
      };
    }
    // A camera carried over from before panning existed has no offset.
    for (const v of [cam.cur, cam.tgt]) {
      if (!Number.isFinite(v.panX)) v.panX = 0;
      if (!Number.isFinite(v.panZ)) v.panZ = 0;
    }
    // A design being worked on moves its own middle as it grows: hold the
    // view over the same ground rather than sliding it along.
    if (cam.center) {
      for (const v of [cam.cur, cam.tgt]) {
        v.panX += cam.center[0] - cx;
        v.panZ += cam.center[1] - cz;
      }
    }
    cam.center = [cx, cz];
    // The design came back with the dragged plant where it was let go.
    dragRef.current = null;
    const cur = cam.cur;
    const tgt = cam.tgt;
    let lastMode: "3d" | "plan" = "3d";

    let W = 0;
    let H = 0;
    /** The screen's pixels per CSS pixel, up to 2. */
    let dpr = 1;
    /** Leaves drawn on the leafy shrubs: every one, or every 2nd while a
     *  slow machine's view moves (see `motion`) — and their outlines left
     *  off then. */
    let thin = 1;
    /** The canvas at s pixels per CSS pixel. Setting a canvas's size wipes
     *  it, even to the size it has, so only a real change is set. */
    const sizeTo = (s: number) => {
      const w = Math.round(W * s);
      const h = Math.round(H * s);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      screen.setTransform(s, 0, 0, s, 0, 0);
    };
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      sizeTo(dpr);
      drawn = ""; // a resized canvas is blank: draw it again
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
    // Below 1 while the designer's ghost is drawn.
    let fade = 1;
    // The designer's plants picked together, this frame.
    let picked = new Set<string>();
    // The WebGL layer under this canvas, made the first time it's asked
    // for, and the plants it drew this frame (their bodies aren't drawn
    // here).
    const glCv = glRef.current;
    let glDrawn = new Set<string>();
    const glLayer = () => {
      if (rendererRef.current !== "webgl" || !glCv) return null;
      const gs = (glLayerRef.current ??= { layer: null, failed: false });
      if (gs.failed) return null;
      if (!gs.layer) {
        try {
          gs.layer = createGLLayer(glCv);
        } catch (e) {
          console.warn("WebGL layer:", e);
          gs.layer = null;
        }
        gs.failed = !gs.layer;
      }
      gs.layer?.resize(W, H, dpr);
      return gs.layer;
    };
    // The yard as WebGL takes it; the same all this scene.
    const glYard: GLYard = {
      ground: {
        pts:
          scene.boundary.length >= 3
            ? scene.boundary
            : [
                [cx - R, cz - R],
                [cx + R, cz - R],
                [cx + R, cz + R],
                [cx - R, cz + R],
              ],
        x0: cx - R,
        x1: cx + R,
        z0: cz - R,
        z1: cz + R,
      },
      boundary: scene.boundary,
      features: scene.features.map((f) => ({ kind: f.kind, pts: f.pts })),
      hardscape: scene.hardscape.map((h) => ({ style: h.style, pts: h.pts })),
      removals: scene.removals,
    };

    function drawExtruded(pts: [number, number][], hFt: number, label: string | null, t: number, body = true) {
      const quads = (body ? pts : [])
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
      if (body) {
        pathPoly(pts, hFt);
        ctx!.fillStyle = "#e6dbc0";
        ctx!.fill();
        ctx!.strokeStyle = verde(0.5);
        ctx!.lineWidth = 1.1;
        ctx!.stroke();
      }
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

    // White Dawn, grown once per plant and kept, as the shrubs are.
    const whiteDawnGrown = new Map<string, WhiteDawnPlant>();
    // Scratch, reused plant to plant.
    let wdDepth = new Float32Array(1024);
    let wdOrder = new Int32Array(1024);

    /** White Dawn lantana, after the app's model.
     *
     *  A trailing groundcover, low and open — nothing like a mound: wiry
     *  runners out of a small crown, arching up and over and trailing out
     *  across the ground, forking as they go, with their tips lifting and
     *  here and there one standing right up at the edge. Small mid-dark
     *  leaves in clusters all along them, the soil showing between, and
     *  white posies with a yellow eye scattered over it, mostly at the
     *  tips. An oval, a fifth narrower across than along, as the scan is.
     *
     *  Drawn as the runners, then the shaded heart of the mat, then every
     *  leaf cluster and flower far to near, each cluster lit by where it
     *  sits; all through one local map at the crown. Grown once and cached.
     */
    function drawWhiteDawnBody(
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
      let grown = whiteDawnGrown.get(key);
      if (!grown) {
        if (whiteDawnGrown.size > 400) whiteDawnGrown.clear(); // growth and edits mint new keys
        grown = growWhiteDawn(x, z, h, rw, rot, seed);
        whiteDawnGrown.set(key, grown);
      }
      const pal = sel ? WHITE_DAWN_GOLD : WHITE_DAWN_COLOURS;

      // The local map at the crown: screen x, y and depth per foot.
      const cy = h * 0.2;
      const q = P(x, cy, z);
      const qx = P(x + 1, cy, z);
      const qy = P(x, cy + 1, z);
      const qz = P(x, cy, z + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const sx = (px: number, py: number, pz: number) => q[0] + J[0] * (px - x) + J[1] * (py - cy) + J[2] * (pz - z);
      const sy = (px: number, py: number, pz: number) => q[1] + J[3] * (px - x) + J[4] * (py - cy) + J[5] * (pz - z);
      const depth = (px: number, py: number, pz: number) => q[2] + J[6] * (px - x) + J[7] * (py - cy) + J[8] * (pz - z);

      ctx!.strokeStyle = pal.stem;
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      ctx!.lineWidth = Math.max(ftPx(x, z, rw * 0.012), lw * 0.4);
      ctx!.beginPath();
      for (const path of grown.runners) {
        for (let i = 0; i < path.length; i++) {
          const [px, py, pz] = path[i];
          if (i) ctx!.lineTo(sx(px, py, pz), sy(px, py, pz));
          else ctx!.moveTo(sx(px, py, pz), sy(px, py, pz));
        }
      }
      ctx!.stroke();
      ctx!.lineCap = "butt";

      const tones = WD_TONES[sel ? 1 : 0];
      // Kites while the leaves are under six pixels long.
      const kite = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5])) * rw * 0.085 < 6;
      const n = kite ? WHITE_DAWN_KITE.length : WHITE_DAWN_LEAF.length;
      const leafPath = (sp: WhiteDawnSprig) => {
        const [cx, cy2, cz] = sp.c;
        const ox = sx(cx, cy2, cz);
        const oy = sy(cx, cy2, cz);
        const pts = kite ? sp.kites : sp.leaves;
        for (let o = 0; o < pts.length; o += n * 3 * thin) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const px = ox + J[0] * pts[i] + J[1] * pts[i + 1] + J[2] * pts[i + 2];
            const py = oy + J[3] * pts[i] + J[4] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(px, py);
            else ctx!.moveTo(px, py);
          }
          ctx!.closePath();
        }
      };
      const { sprigs, flowers } = grown;
      const m = sprigs.length;
      const all = m + flowers.length;
      if (wdDepth.length < all) {
        wdDepth = new Float32Array(all * 2);
        wdOrder = new Int32Array(all * 2);
      }
      let fill = "";
      const paint = (col: string) => {
        if (col !== fill) ctx!.fillStyle = fill = col;
        ctx!.fill();
      };

      // The shaded heart first.
      let m0 = 0;
      for (; m0 < m && sprigs[m0].inner; m0++) {
        if (m0 % thin) continue;
        ctx!.beginPath();
        leafPath(sprigs[m0]);
        paint(tones[WD_LEVELS + sprigs[m0].tone]);
      }

      // The rest far to near, the flowers in with the leaves — a little
      // nearer than they stand, as they sit up over them.
      let count = 0;
      for (let i = m0; i < m; i++) {
        const sp = sprigs[i];
        wdDepth[i] = depth(sp.c[0], sp.c[1], sp.c[2]);
        wdOrder[count++] = i;
      }
      for (let i = 0; i < flowers.length; i++) {
        const f = flowers[i];
        wdDepth[m + i] = depth(f[0], f[1], f[2]) - 0.05;
        wdOrder[count++] = m + i;
      }
      const order = wdOrder.subarray(0, count).sort((a, b) => wdDepth[b] - wdDepth[a]);
      // Pixels a foot across the view: the longer of the two ground axes on
      // screen, which holds from overhead too (a foot up shrinks to nothing).
      const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]));
      for (const i of order) {
        if (i < m) {
          ctx!.beginPath();
          leafPath(sprigs[i]);
          paint(tones[sprigs[i].tone]);
          continue;
        }
        // A flat posy: the disc, and close up its ring of florets round a
        // yellow eye.
        // Far off, never under a pixel and a bit across: the white is
        // what tells this lantana from the other two.
        const [fx, fy, fz, r0] = flowers[i - m];
        const r = Math.max(r0, 1.5 / footPx);
        const ox = sx(fx, fy, fz);
        const oy = sy(fx, fy, fz);
        const ax = J[0] * r;
        const ay = J[3] * r;
        const bx = J[2] * r;
        const by = J[5] * r;
        ctx!.beginPath();
        for (let k = 0; k < 10; k++) {
          const t = (k / 10) * Math.PI * 2;
          const c = Math.cos(t);
          const s2 = Math.sin(t);
          if (k) ctx!.lineTo(ox + ax * c + bx * s2, oy + ay * c + by * s2);
          else ctx!.moveTo(ox + ax * c + bx * s2, oy + ay * c + by * s2);
        }
        ctx!.closePath();
        paint(pal.flower);
        const px = footPx * r;
        if (px > 5) {
          ctx!.beginPath();
          for (let k = 0; k < 6; k++) {
            const t = (k / 6) * Math.PI * 2 + fx;
            const cx = ox + (ax * Math.cos(t) + bx * Math.sin(t)) * 0.55;
            const cy3 = oy + (ay * Math.cos(t) + by * Math.sin(t)) * 0.55;
            ctx!.moveTo(cx + px * 0.36, cy3);
            ctx!.arc(cx, cy3, px * 0.36, 0, Math.PI * 2);
          }
          paint(pal.floret);
        }
        if (px > 2.5) {
          ctx!.beginPath();
          ctx!.arc(ox, oy, Math.max(0.8, px * 0.22), 0, Math.PI * 2);
          paint(pal.eye);
        }
      }
      ctx!.lineJoin = "miter";
      ctx!.lineWidth = lw;
    }

    const purpleGrown = new Map<string, PurplePlant>();
    // Scratch, reused plant to plant.
    let plDepth = new Float32Array(2048);
    let plOrder = new Int32Array(2048);

    /** Purple lantana, after the app's model.
     *
     *  A dense groundcover mound, low and broad and lumpy — an oval a
     *  quarter narrower across than along, as the scan is — made of small
     *  olive leaves in clusters, down in shadow between the lumps, with a
     *  few shoots trailing out past its edge. Lavender flower heads all
     *  over it, the sides as well as the top: close up, a ring of florets
     *  each with a pale eye.
     *
     *  Drawn as a dark core, then a shaded layer of leaves, then the skin's
     *  leaf clusters and the flowers far to near, the far side passed over;
     *  all through one local map at the mound. Grown once and cached.
     */
    function drawPurpleLantanaBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = purpleGrown.get(key);
      if (!grown) {
        if (purpleGrown.size > 400) purpleGrown.clear(); // growth and edits mint new keys
        grown = growPurpleLantana(x, z, h, rw, rot, seed);
        purpleGrown.set(key, grown);
      }
      const pal = sel ? PURPLE_LANTANA_GOLD : PURPLE_LANTANA_COLOURS;
      const tones = PL_TONES[sel ? 1 : 0];

      // The local map at the mound: screen x, y and depth per foot.
      const cy = h * 0.4;
      const q = P(x, cy, z);
      const qx = P(x + 1, cy, z);
      const qy = P(x, cy + 1, z);
      const qz = P(x, cy, z + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const sx = (px: number, py: number, pz: number) => q[0] + J[0] * (px - x) + J[1] * (py - cy) + J[2] * (pz - z);
      const sy = (px: number, py: number, pz: number) => q[1] + J[3] * (px - x) + J[4] * (py - cy) + J[5] * (pz - z);
      const depth = (px: number, py: number, pz: number) => q[2] + J[6] * (px - x) + J[7] * (py - cy) + J[8] * (pz - z);
      const facing = (c: ArrayLike<number>, n: ArrayLike<number>) =>
        n[0] * (eye[0] - c[0]) + n[1] * (eye[1] - c[1]) + n[2] * (eye[2] - c[2]) >= 0;

      const hull = convexHull(grown.core.map((v): [number, number] => [sx(v[0], v[1], v[2]), sy(v[0], v[1], v[2])]));
      ctx!.beginPath();
      for (let i = 0; i < hull.length; i++) {
        if (i) ctx!.lineTo(hull[i][0], hull[i][1]);
        else ctx!.moveTo(hull[i][0], hull[i][1]);
      }
      ctx!.fillStyle = pal.core;
      ctx!.fill();

      // Kites while the leaves are under six pixels long.
      const kite = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5])) * rw * 0.06 < 6;
      const n = kite ? PURPLE_KITE.length : PURPLE_LEAF.length;
      const leafPath = (sp: PurpleSprig) => {
        const [cx, cy2, cz] = sp.c;
        const ox = sx(cx, cy2, cz);
        const oy = sy(cx, cy2, cz);
        const pts = kite ? sp.kites : sp.leaves;
        for (let o = 0; o < pts.length; o += n * 3 * thin) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const px = ox + J[0] * pts[i] + J[1] * pts[i + 1] + J[2] * pts[i + 2];
            const py = oy + J[3] * pts[i] + J[4] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(px, py);
            else ctx!.moveTo(px, py);
          }
          ctx!.closePath();
        }
      };
      const { sprigs, flowers } = grown;
      const m = sprigs.length;
      const nf = flowers.length / 8;
      if (plDepth.length < m + nf) {
        plDepth = new Float32Array((m + nf) * 2);
        plOrder = new Int32Array((m + nf) * 2);
      }
      let fill = "";
      const paint = (col: string) => {
        if (col !== fill) ctx!.fillStyle = fill = col;
        ctx!.fill();
      };

      // The shaded layer.
      let m0 = 0;
      for (; m0 < m && sprigs[m0].inner; m0++) {
        const sp = sprigs[m0];
        if (m0 % thin || !facing(sp.c, sp.n)) continue;
        ctx!.beginPath();
        leafPath(sp);
        paint(tones.inner[sp.tone]);
      }

      // The skin and the flowers far to near, the flowers a little nearer
      // than they stand, as they sit up over the leaves.
      let count = 0;
      for (let i = m0; i < m; i++) {
        const sp = sprigs[i];
        if (!facing(sp.c, sp.n)) continue;
        plDepth[i] = depth(sp.c[0], sp.c[1], sp.c[2]);
        plOrder[count++] = i;
      }
      for (let i = 0; i < nf; i++) {
        const f = flowers.subarray(i * 8, i * 8 + 8);
        if (!facing(f, f.subarray(4))) continue;
        plDepth[m + i] = depth(f[0], f[1], f[2]) - 0.05;
        plOrder[count++] = m + i;
      }
      const order = plOrder.subarray(0, count).sort((a, b) => plDepth[b] - plDepth[a]);
      // Pixels a foot across the view: the longer of the two ground axes on
      // screen, which holds from overhead too (a foot up shrinks to nothing).
      const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]));
      for (const i of order) {
        if (i < m) {
          ctx!.beginPath();
          leafPath(sprigs[i]);
          paint(tones.leaf[sprigs[i].tone]);
          continue;
        }
        // A ball of florets: the head, lit on its upper side, and close up
        // its ring of florets each with a pale eye.
        const o = (i - m) * 8;
        const ox = sx(flowers[o], flowers[o + 1], flowers[o + 2]);
        const oy = sy(flowers[o], flowers[o + 1], flowers[o + 2]);
        // Far off, a head is a fleck of its lit colour, never under a pixel
        // and a bit across: the purple is what tells this lantana from the
        // other two.
        const pr = Math.max(1.3, flowers[o + 3] * footPx);
        const t = flowers[o + 7];
        ctx!.beginPath();
        ctx!.arc(ox, oy, pr, 0, Math.PI * 2);
        paint(pr < 2 ? tones.flowerLit[t] : tones.flower[t]);
        if (pr > 7) {
          ctx!.beginPath();
          for (let k = 0; k < 7; k++) {
            const a = (k / 6) * Math.PI * 2 + flowers[o];
            const fx = k < 6 ? ox + Math.cos(a) * pr * 0.52 : ox;
            const fy = k < 6 ? oy + Math.sin(a) * pr * 0.46 : oy;
            ctx!.moveTo(fx + pr * 0.32, fy);
            ctx!.arc(fx, fy, pr * 0.32, 0, Math.PI * 2);
          }
          paint(tones.floret[t]);
          ctx!.beginPath();
          for (let k = 0; k < 7; k++) {
            const a = (k / 6) * Math.PI * 2 + flowers[o];
            const fx = k < 6 ? ox + Math.cos(a) * pr * 0.52 : ox;
            const fy = k < 6 ? oy + Math.sin(a) * pr * 0.46 : oy;
            ctx!.moveTo(fx + pr * 0.06, fy);
            ctx!.arc(fx, fy, pr * 0.06, 0, Math.PI * 2);
          }
          paint(pal.eye);
        } else if (pr > 1.6) {
          ctx!.beginPath();
          ctx!.arc(ox - pr * 0.22, oy - pr * 0.25, pr * 0.55, 0, Math.PI * 2);
          paint(tones.flowerLit[t]);
        }
      }
    }

    const yellowGrown = new Map<string, YellowPlant>();
    // Scratch, reused plant to plant.
    let ylDepth = new Float32Array(2048);
    let ylOrder = new Int32Array(2048);

    /** Yellow lantana, after the app's model.
     *
     *  A full round cushion, held high nearly to its edge and steep down to
     *  the ground — an oval a fifth narrower across than along, as the scan
     *  is — of dark green leaves in clusters, a few leafy shoots standing up
     *  out of its top. Smothered in golden heads, a third of them in pairs:
     *  close up, a ring of open florets round a deeper amber heart of buds.
     *
     *  Drawn as a dark core, then a shaded layer of leaves, then the skin's
     *  leaf clusters and the flowers far to near, the far side passed over;
     *  all through one local map at the cushion. Grown once and cached.
     */
    function drawYellowLantanaBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = yellowGrown.get(key);
      if (!grown) {
        if (yellowGrown.size > 400) yellowGrown.clear(); // growth and edits mint new keys
        grown = growYellowLantana(x, z, h, rw, rot, seed);
        yellowGrown.set(key, grown);
      }
      const pal = sel ? YELLOW_LANTANA_GOLD : YELLOW_LANTANA_COLOURS;
      const tones = YL_TONES[sel ? 1 : 0];

      // The local map at the cushion: screen x, y and depth per foot.
      const cy = h * 0.4;
      const q = P(x, cy, z);
      const qx = P(x + 1, cy, z);
      const qy = P(x, cy + 1, z);
      const qz = P(x, cy, z + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const sx = (px: number, py: number, pz: number) => q[0] + J[0] * (px - x) + J[1] * (py - cy) + J[2] * (pz - z);
      const sy = (px: number, py: number, pz: number) => q[1] + J[3] * (px - x) + J[4] * (py - cy) + J[5] * (pz - z);
      const depth = (px: number, py: number, pz: number) => q[2] + J[6] * (px - x) + J[7] * (py - cy) + J[8] * (pz - z);
      const facing = (c: ArrayLike<number>, n: ArrayLike<number>) =>
        n[0] * (eye[0] - c[0]) + n[1] * (eye[1] - c[1]) + n[2] * (eye[2] - c[2]) >= 0;

      const hull = convexHull(grown.core.map((v): [number, number] => [sx(v[0], v[1], v[2]), sy(v[0], v[1], v[2])]));
      ctx!.beginPath();
      for (let i = 0; i < hull.length; i++) {
        if (i) ctx!.lineTo(hull[i][0], hull[i][1]);
        else ctx!.moveTo(hull[i][0], hull[i][1]);
      }
      ctx!.fillStyle = pal.core;
      ctx!.fill();

      // Pixels a foot across the view: the longer of the two ground axes on
      // screen, which holds from overhead too (a foot up shrinks to nothing).
      const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]));
      // Kites while the leaves are under six pixels long.
      const kite = footPx * rw * 0.062 < 6;
      const n = kite ? YELLOW_KITE.length : YELLOW_LEAF.length;
      const leafPath = (sp: YellowSprig) => {
        const [cx, cy2, cz] = sp.c;
        const ox = sx(cx, cy2, cz);
        const oy = sy(cx, cy2, cz);
        const pts = kite ? sp.kites : sp.leaves;
        for (let o = 0; o < pts.length; o += n * 3 * thin) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const px = ox + J[0] * pts[i] + J[1] * pts[i + 1] + J[2] * pts[i + 2];
            const py = oy + J[3] * pts[i] + J[4] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(px, py);
            else ctx!.moveTo(px, py);
          }
          ctx!.closePath();
        }
      };
      const { sprigs, flowers } = grown;
      const m = sprigs.length;
      const nf = flowers.length / 8;
      if (ylDepth.length < m + nf) {
        ylDepth = new Float32Array((m + nf) * 2);
        ylOrder = new Int32Array((m + nf) * 2);
      }
      let fill = "";
      const paint = (col: string) => {
        if (col !== fill) ctx!.fillStyle = fill = col;
        ctx!.fill();
      };

      // The shaded layer.
      let m0 = 0;
      for (; m0 < m && sprigs[m0].inner; m0++) {
        const sp = sprigs[m0];
        if (m0 % thin || !facing(sp.c, sp.n)) continue;
        ctx!.beginPath();
        leafPath(sp);
        paint(tones.inner[sp.tone]);
      }

      // The skin and the flowers far to near, the flowers a little nearer
      // than they stand, as they sit up over the leaves.
      let count = 0;
      for (let i = m0; i < m; i++) {
        const sp = sprigs[i];
        if (!facing(sp.c, sp.n)) continue;
        ylDepth[i] = depth(sp.c[0], sp.c[1], sp.c[2]);
        ylOrder[count++] = i;
      }
      for (let i = 0; i < nf; i++) {
        const f = flowers.subarray(i * 8, i * 8 + 8);
        if (!facing(f, f.subarray(4))) continue;
        ylDepth[m + i] = depth(f[0], f[1], f[2]) - 0.1;
        ylOrder[count++] = m + i;
      }
      const order = ylOrder.subarray(0, count).sort((a, b) => ylDepth[b] - ylDepth[a]);
      for (const i of order) {
        if (i < m) {
          ctx!.beginPath();
          leafPath(sprigs[i]);
          paint(tones.leaf[sprigs[i].tone]);
          continue;
        }
        // A dome of florets: the head, lit on its upper side, and close up
        // its ring of open florets, each with an eye, round the buds.
        const o = (i - m) * 8;
        const ox = sx(flowers[o], flowers[o + 1], flowers[o + 2]);
        const oy = sy(flowers[o], flowers[o + 1], flowers[o + 2]);
        // Far off, a head is a fleck of its lit colour, never under a pixel
        // and a bit across: the gold is what tells this lantana from the
        // other two.
        const pr = Math.max(1.4, flowers[o + 3] * footPx);
        const t = flowers[o + 7];
        // Nearer, the florets make the head's edge, so the head under them
        // is drawn smaller, and set down a little where it is in shadow.
        ctx!.beginPath();
        if (pr > 7) ctx!.arc(ox, oy, pr * 0.74, 0, Math.PI * 2);
        else if (pr > 3) ctx!.arc(ox + pr * 0.1, oy + pr * 0.12, pr * 0.8, 0, Math.PI * 2);
        else ctx!.arc(ox, oy, pr, 0, Math.PI * 2);
        paint(pr <= 3 ? tones.flowerLit[t] : tones.flower[t]);
        if (pr > 7) {
          // Florets crowd the head unevenly, lit on its upper side, a deeper
          // throat in each; the buds in the middle a warmer amber.
          const spin = flowers[o];
          const at = (k: number): [number, number, number] => {
            const a = (k / 7) * Math.PI * 2 + spin;
            const jit = (Math.sin(spin * 53 + k * 12.9898) * 43758.5453) % 1;
            const rr = pr * (0.55 + 0.12 * jit);
            return [ox + Math.cos(a) * rr, oy + Math.sin(a) * rr * 0.9, pr * (0.27 + 0.07 * Math.abs(jit))];
          };
          for (const lit of [false, true]) {
            ctx!.beginPath();
            for (let k = 0; k < 7; k++) {
              const [fx, fy, fr] = at(k);
              if ((fx - ox + (fy - oy) * 1.2 < 0) !== lit) continue;
              ctx!.moveTo(fx + fr, fy);
              ctx!.arc(fx, fy, fr, 0, Math.PI * 2);
            }
            paint(lit ? tones.flowerLit[t] : tones.floret[t]);
          }
          ctx!.beginPath();
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2 + spin + 0.5;
            ctx!.moveTo(ox + Math.cos(a) * pr * 0.16 + pr * 0.2, oy + Math.sin(a) * pr * 0.14);
            ctx!.arc(ox + Math.cos(a) * pr * 0.16, oy + Math.sin(a) * pr * 0.14, pr * 0.2, 0, Math.PI * 2);
          }
          paint(tones.bud[t]);
          ctx!.beginPath();
          for (let k = 0; k < 7; k++) {
            const [fx, fy] = at(k);
            ctx!.moveTo(fx + pr * 0.05, fy);
            ctx!.arc(fx, fy, pr * 0.05, 0, Math.PI * 2);
          }
          paint(pal.eye);
        } else if (pr > 3) {
          // Further off, a knot of lit florets making the head's lumpy edge,
          // matte: one lit disc on a darker one reads as a bead.
          ctx!.beginPath();
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + flowers[o];
            const fr = pr * (k ? 0.48 : 0.4);
            const fx = ox - pr * 0.05 + Math.cos(a) * pr * 0.42;
            const fy = oy - pr * 0.06 + Math.sin(a) * pr * 0.38;
            ctx!.moveTo(fx + fr, fy);
            ctx!.arc(fx, fy, fr, 0, Math.PI * 2);
          }
          paint(tones.flowerLit[t]);
        }
      }
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
      // height (see `barrelAt`); its outline on screen is the hull of it.
      const hull = convexHull(barrelCloud(x, z, h, rw).map((p): [number, number] => {
        const q = P(...p);
        return [q[0], q[1]];
      }));
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

      // Spines: short ticks standing off the rim.
      ctx!.lineWidth = lw * 0.6;
      ctx!.beginPath();
      for (const [x0, y0, x1, y1] of barrelSpikes(hull)) {
        ctx!.moveTo(x0, y0);
        ctx!.lineTo(x1, y1);
      }
      ctx!.stroke();

      // Ribs, but only the ones facing us: the body is opaque, so drawing
      // the far side as well would read as a wireframe.
      const mid = P(x, h / 2, z);
      ctx!.lineWidth = lw * 0.7;
      for (let k = 0; k < BARREL_RIBS; k++) {
        if (P(...barrelAt(x, z, h, rw, 0.5, barrelRibAngle(rot, k)))[2] >= mid[2]) continue;
        ctx!.beginPath();
        barrelRib(x, z, h, rw, rot, k).forEach((p, i) => {
          const q = P(...p);
          if (i) ctx!.lineTo(q[0], q[1]);
          else ctx!.moveTo(q[0], q[1]);
        });
        ctx!.stroke();
      }

      // The crown: the wool and new spines sit in a tight ring on top.
      ctx!.beginPath();
      barrelCrown(x, z, h, rw).forEach((p, k) => {
        const q = P(...p);
        if (k) ctx!.lineTo(q[0], q[1]);
        else ctx!.moveTo(q[0], q[1]);
      });
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
      // The bole, then the limbs over it (see `trunkLimbs`), each a quad
      // on screen tapering in feet, floored in pixels.
      for (const l of trunkLimbs(h, rw, rot)) {
        const ca = Math.cos(l.az);
        const sa = Math.sin(l.az);
        const A = P(x + ca * l.aOut, l.ay, z + sa * l.aOut);
        const B = P(x + ca * l.bOut, l.by, z + sa * l.bOut);
        const dx = B[0] - A[0];
        const dy = B[1] - A[1];
        const L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L;
        const ny = dx / L;
        const [wa, wb] = trunkWidths(l, (r) => ftPx(x, z, r));
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
      }
    }

    const aloeGrown = new Map<string, AloePlant>();

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
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = aloeGrown.get(key);
      if (!grown) {
        if (aloeGrown.size > 400) aloeGrown.clear(); // growth and edits mint new keys
        grown = growAloe(x, z, h, rw, rot, seed);
        aloeGrown.set(key, grown);
      }

      type V3 = [number, number, number];
      type Pt = [number, number];
      type Face = { pts: Pt[]; edges: { line: Pt[]; w: number; a: number | null }[]; flecks: Pt[][]; d: number; lit: number };

      const proj = (v: V3): Pt => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      };
      const depth = (v: V3) => P(v[0], v[1], v[2])[2];
      const strip = (a: V3[], b: V3[]) => [...a.map(proj), ...[...b].reverse().map(proj)];
      const meanDepth = (a: V3[], b: V3[]) =>
        (a.reduce((s, v) => s + depth(v), 0) + b.reduce((s, v) => s + depth(v), 0)) / (a.length + b.length);
      const faces: Face[] = grown.faces.map((f) => ({
        pts: strip(f.a, f.b),
        edges: f.edges.map((e) => ({ line: e.line.map(proj), w: e.w, a: e.a })),
        flecks: f.flecks.map((fl) => [proj(fl[0]), proj(fl[1])]),
        d: meanDepth(f.a, f.b),
        lit: f.lit,
      }));

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

      // The blooms: each stalk in pieces, and its flowers.
      const stalkW = Math.max(ftPx(x, z, 0.04), lw * 0.9);
      const tubeW = Math.max(ftPx(x, z, 0.035), 1.6);
      const open = inColour ? ALOE_BLOOM : tint(0.3);
      const bud = inColour ? ALOE_BUD : tint(0.22);
      for (const st of grown.stalks) {
        for (const pc of st.pieces) {
          const { a, b } = pc;
          const w = stalkW * pc.w;
          // Butt ends: the stalk is drawn in pieces for the depth sort, and
          // round caps on a translucent ink overlap into beads at every joint.
          items.push({ d: (depth(a) + depth(b)) / 2, draw: () => seg(a, b, w, tint(0.7), "butt") });
        }
        for (const tb of st.tubes) {
          const { base, tip } = tb;
          const col = tb.open ? open : bud;
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

      // Far first, so the near ones lie over them.
      items.sort((p, q) => q.d - p.d);
      ctx!.lineJoin = "round";
      for (const it of items) it.draw();
    }

    const hopseedGrown = new Map<string, { stems: [number, number, number][][]; sprays: HopseedSpray[] }>();

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
        for (let o = 0; o < off.length; o += 18 * thin) {
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
        if (!sp.inner && thin === 1) ctx!.stroke();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the hopseed is.
    const sageGrown = new Map<string, SageTuft[]>();

    /** Texas sage, after the app's model.
     *
     *  Not the hopseed's column: a low dome sitting right on the soil, no
     *  stems showing, wider than it is tall, its outline broken all over by
     *  short upright spikes of lavender bloom. Under the flowers, the soft
     *  woolly silver leaves that are the plant the rest of the year, showing
     *  most toward the bottom where the bloom thins out.
     *
     *  Drawn as tufts over the dome — a few small oval silver leaves, and on
     *  most of them two or three slim bloom spikes rising out of the leaves —
     *  over a mass of soft clumps of foliage a step into shadow, lavender
     *  where it's in flower, which makes it a solid mound rather than a
     *  cloud. Far first.
     *  Every tuft takes its colour from where it sits against the sheet's
     *  light (the boulder's), some flowers paler where they've opened.
     *  Leaves and spikes are drawn larger than life, as the hopseed's are.
     *
     *  Same economy as the hopseed: grown once and cached, four projections
     *  per tuft, the mass fill-only, and the core one filled silhouette.
     */
    function drawTexasSageBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}`;
      let tufts = sageGrown.get(key);
      if (!tufts) {
        if (sageGrown.size > 400) sageGrown.clear(); // growth and edits mint new keys
        tufts = growTexasSage(x, z, h, rw, seed);
        sageGrown.set(key, tufts);
      }
      const order = tufts.map((t) => {
        const [cx, cy, cz] = t.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { t, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      // A sage is a dense mound, not an airy column like the hopseed: from
      // the front, the leaves facing you never quite cover the skin they sit
      // on, and scattered at random they left sand showing through the
      // middle. So the core is filled solid first — set back inside the
      // tufts, which always break its edge, so it never reads as a shape.
      const core = convexHull(sageCoreRing(x, z, h, rw).map((v): [number, number] => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      }));
      if (core.length > 2) {
        ctx!.beginPath();
        ctx!.moveTo(core[0][0], core[0][1]);
        for (let i = 1; i < core.length; i++) ctx!.lineTo(core[i][0], core[i][1]);
        ctx!.closePath();
        const c = sel ? SAGE_GOLD.core : SAGE_COLOURS.core;
        ctx!.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx!.fill();
      }

      const g = sel ? 1 : 0;
      ctx!.lineJoin = "round";
      ctx!.lineWidth = lw * 0.45;
      ctx!.strokeStyle = sel ? gold(0.6) : ink(0.4);
      const shapes = (pts: Float32Array, corners: number, q: number[], J: number[]) => {
        ctx!.beginPath();
        for (let o = 0; o < pts.length; o += corners * 3 * thin) {
          for (let k = 0; k < corners; k++) {
            const i = o + k * 3;
            const sx = q[0] + J[0] * pts[i] + J[2] * pts[i + 1] + J[4] * pts[i + 2];
            const sy = q[1] + J[1] * pts[i] + J[3] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(sx, sy);
            else ctx!.moveTo(sx, sy);
          }
          ctx!.closePath();
        }
      };
      for (const { t, q, J } of order) {
        shapes(t.leaves, 8, q, J);
        ctx!.fillStyle = t.leafCol[g];
        ctx!.fill();
        if (t.inner) continue; // an outline on a tuft in shadow is noise
        if (thin === 1) ctx!.stroke();
        if (t.spikes.length) {
          shapes(t.spikes, 7, q, J);
          ctx!.fillStyle = t.spikeCol[g];
          ctx!.fill();
          if (thin === 1) ctx!.stroke();
        }
      }
      ctx!.lineWidth = lw;
    }

    const yellowBellsGrown = new Map<string, { stems: [number, number, number][][]; parts: YellowBellsPart[] }>();

    /** Yellow bells ('Sundance'), after the app's model.
     *
     *  An upright oval, a third again as tall as it is wide: a handful of
     *  thin dark stems out of a tight base, then dense deep-green foliage —
     *  compound leaves of broad oval leaflets, nothing like the hopseed's
     *  willow blades — with clusters of golden trumpets scattered over the
     *  outside, thickest toward the top and on shoots standing proud of it.
     *
     *  Drawn as the stems; a deep inner layer of leaves in shade, which is
     *  what you see through the gaps (a filled core behind them showed as a
     *  smooth green pillar — this is a leafy shrub, nearer the hopseed than
     *  the sage); the outer leaves; and the trumpet clusters, each trumpet
     *  hanging from its own place on a short stalk. All sorted far first and
     *  lit by where they sit against the sheet's light. Grown once and
     *  cached; four projections a part.
     */
    function drawYellowBellsBody(
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
      let grown = yellowBellsGrown.get(key);
      if (!grown) {
        if (yellowBellsGrown.size > 400) yellowBellsGrown.clear(); // growth and edits mint new keys
        grown = growYellowBells(x, z, h, rw, rot, seed);
        yellowBellsGrown.set(key, grown);
      }
      ctx!.strokeStyle = sel ? gold(0.8) : "rgba(78,62,48,0.9)";
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.1), lw * 0.8);
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

      const order = grown.parts.map((pt) => {
        const [cx, cy, cz] = pt.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { pt, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      const g = sel ? 1 : 0;
      // Built once a frame and only assigned when they change: a fresh
      // colour string on every part is re-parsed by the canvas each time,
      // and that doubled what the plant cost.
      const leafEdge = sel ? gold(0.6) : ink(0.4);
      const bloomEdge = sel ? gold(0.8) : "rgba(112,72,12,0.85)";
      let edge = "";
      ctx!.lineJoin = "round";
      ctx!.lineWidth = lw * 0.45;
      for (const { pt, q, J } of order) {
        const pts = pt.pts;
        const n = pt.corners;
        ctx!.beginPath();
        for (let o = 0; o < pts.length; o += n * 3 * thin) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const sx = q[0] + J[0] * pts[i] + J[2] * pts[i + 1] + J[4] * pts[i + 2];
            const sy = q[1] + J[1] * pts[i] + J[3] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(sx, sy);
            else ctx!.moveTo(sx, sy);
          }
          ctx!.closePath();
        }
        ctx!.fillStyle = pt.col[g];
        ctx!.fill();
        if (pt.kind === "inner" || thin > 1) continue; // an outline on a leaf in shadow is noise
        // Nor on the far side: those leaves are under the near ones, and
        // outlining them was a third of the plant's cost for nothing seen.
        if (pt.n[0] * (eye[0] - pt.c[0]) + pt.n[1] * (eye[1] - pt.c[1]) + pt.n[2] * (eye[2] - pt.c[2]) < 0) continue;
        const want = pt.kind === "bloom" ? bloomEdge : leafEdge;
        if (want !== edge) {
          ctx!.strokeStyle = want;
          edge = want;
        }
        ctx!.stroke();
      }
      ctx!.lineWidth = lw;
    }

    const redBirdGrown = new Map<string, { stems: [number, number, number][][]; parts: RedBirdPart[] }>();

    /** Red bird of paradise, after the app's model.
     *
     *  Nothing like the other shrubs' masses: an open vase of thin pale
     *  stems from a narrow base, carrying fine, feathery fronds held out
     *  nearly level in tiers out to a broad, flat top — the layering is the
     *  plant. Above it, loose clusters of ruffled scarlet blooms edged in
     *  gold rise on thin stalks, long red stamens arching out of them.
     *
     *  Drawn as the stems; fronds as long scalloped sprays laid nearly flat,
     *  the ones deep in the canopy darker; then the flower stalks and their
     *  blooms with stamens — all sorted far first. No core: this is the
     *  airiest shrub in the catalog, and you should see through its layers.
     *  Grown once and cached; four projections a part, styles set once a
     *  frame.
     */
    function drawRedBirdBody(
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
      let grown = redBirdGrown.get(key);
      if (!grown) {
        if (redBirdGrown.size > 400) redBirdGrown.clear(); // growth and edits mint new keys
        grown = growRedBird(x, z, h, rw, rot, seed);
        redBirdGrown.set(key, grown);
      }
      const pal = sel ? RED_BIRD_GOLD : RED_BIRD_COLOURS;

      ctx!.strokeStyle = pal.stem;
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.08), lw * 0.7);
      ctx!.lineCap = "round";
      for (const [a, b] of grown.stems) {
        const p0 = P(a[0], a[1], a[2]);
        const p1 = P(b[0], b[1], b[2]);
        ctx!.beginPath();
        ctx!.moveTo(p0[0], p0[1]);
        ctx!.lineTo(p1[0], p1[1]);
        ctx!.stroke();
      }

      const order = grown.parts.map((pt) => {
        const [cx, cy, cz] = pt.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { pt, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      const g = sel ? 1 : 0;
      const leafEdge = sel ? gold(0.6) : ink(0.4);
      const stalkW = Math.max(ftPx(x, z, 0.03), 0.8);
      let edge = "";
      const setEdge = (c: string) => {
        if (c !== edge) {
          ctx!.strokeStyle = c;
          edge = c;
        }
      };
      ctx!.lineJoin = "round";
      let nth = 0;
      for (const { pt, q, J } of order) {
        if ((pt.kind === "frond" || pt.kind === "inner") && nth++ % thin) continue;
        const pts = pt.pts;
        const at = (i: number): [number, number] => [
          q[0] + J[0] * pts[i] + J[2] * pts[i + 1] + J[4] * pts[i + 2],
          q[1] + J[1] * pts[i] + J[3] * pts[i + 1] + J[5] * pts[i + 2],
        ];
        if (pt.kind === "stalk") {
          const b = at(3);
          ctx!.beginPath();
          ctx!.moveTo(q[0], q[1]);
          ctx!.lineTo(b[0], b[1]);
          ctx!.lineWidth = stalkW;
          setEdge(pt.col[g]);
          ctx!.stroke();
          continue;
        }
        ctx!.beginPath();
        for (let k = 0; k < pt.corners; k++) {
          const [sx, sy] = at(k * 3);
          if (k) ctx!.lineTo(sx, sy);
          else ctx!.moveTo(sx, sy);
        }
        ctx!.closePath();
        ctx!.fillStyle = pt.col[g];
        ctx!.fill();
        if (pt.kind === "inner") continue; // an outline on a frond in shadow is noise
        ctx!.lineWidth = lw * 0.45;
        setEdge(pt.kind === "bloom" ? pal.edge : leafEdge);
        if (thin === 1) ctx!.stroke();
        if (pt.lines) {
          const ln = pt.lines;
          ctx!.beginPath();
          for (let o = 0; o < ln.length; o += 6) {
            const [sx, sy] = [
              q[0] + J[0] * ln[o + 3] + J[2] * ln[o + 4] + J[4] * ln[o + 5],
              q[1] + J[1] * ln[o + 3] + J[3] * ln[o + 4] + J[5] * ln[o + 5],
            ];
            ctx!.moveTo(q[0], q[1]);
            ctx!.lineTo(sx, sy);
          }
          ctx!.lineWidth = Math.max(lw * 0.4, 0.6);
          setEdge(pal.stamen);
          ctx!.stroke();
        }
      }
      ctx!.lineCap = "butt";
      ctx!.lineWidth = lw;
    }

    const jojobaGrown = new Map<string, { stems: [number, number, number][][]; sprigs: JojobaSprig[] }>();

    /** Jojoba, after the app's model.
     *
     *  A broad, lumpy mound a third again as wide as it is tall, leafy right
     *  down to the soil, its sides near straight and its crown rounded — and
     *  its outline broken all round by twigs standing out of it. Not the
     *  sage's smooth dome: dull grey-green, no flowers, and leaves held the
     *  way only jojoba holds them — small blunt ovals in opposite pairs up
     *  short twigs, turned edge-on to the sun, so from the side you see their
     *  faces and from above, their edges.
     *
     *  Drawn as a set-back core (it's dense, like the sage, and leaves alone
     *  left sand showing through the middle); the stems and twigs, under
     *  every leaf, so what shows of them is through the gaps and at the
     *  bare base of a twig standing proud; a deep layer of sprigs in shadow,
     *  fill only; and the outer sprigs — far first, each lit by where it
     *  sits against the sheet's light and mottled a little, as the scan is.
     *  Grown once and cached; four projections a sprig, styles set once a
     *  frame.
     */
    function drawJojobaBody(
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
      let grown = jojobaGrown.get(key);
      if (!grown) {
        if (jojobaGrown.size > 400) jojobaGrown.clear(); // growth and edits mint new keys
        grown = growJojoba(x, z, h, rw, rot, seed);
        jojobaGrown.set(key, grown);
      }
      const pal = sel ? JOJOBA_GOLD : JOJOBA_COLOURS;

      const core = convexHull(jojobaCoreRing(x, z, h, rw).map((v): [number, number] => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      }));
      if (core.length > 2) {
        ctx!.beginPath();
        ctx!.moveTo(core[0][0], core[0][1]);
        for (let i = 1; i < core.length; i++) ctx!.lineTo(core[i][0], core[i][1]);
        ctx!.closePath();
        ctx!.fillStyle = `rgb(${pal.core[0]},${pal.core[1]},${pal.core[2]})`;
        ctx!.fill();
      }

      const order = grown.sprigs.map((sp) => {
        const [cx, cy, cz] = sp.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { sp, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      ctx!.strokeStyle = pal.stem;
      ctx!.lineCap = "round";
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.045), lw * 0.5);
      ctx!.beginPath();
      for (const [a, b] of grown.stems) {
        const p0 = P(a[0], a[1], a[2]);
        const p1 = P(b[0], b[1], b[2]);
        ctx!.moveTo(p0[0], p0[1]);
        ctx!.lineTo(p1[0], p1[1]);
      }
      ctx!.stroke();
      ctx!.strokeStyle = pal.twig;
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.025), lw * 0.4);
      ctx!.beginPath();
      for (const { sp, q, J } of order) {
        if (sp.inner) continue;
        const [tx, ty, tz] = sp.tip;
        ctx!.moveTo(q[0], q[1]);
        ctx!.lineTo(q[0] + J[0] * tx + J[2] * ty + J[4] * tz, q[1] + J[1] * tx + J[3] * ty + J[5] * tz);
      }
      ctx!.stroke();
      ctx!.lineCap = "butt";

      const g = sel ? 1 : 0;
      const n = JOJOBA_LEAF.length;
      ctx!.lineJoin = "round";
      ctx!.lineWidth = lw * 0.45;
      ctx!.strokeStyle = sel ? gold(0.6) : ink(0.4);
      for (const { sp, q, J } of order) {
        const pts = sp.leaves;
        ctx!.beginPath();
        for (let o = 0; o < pts.length; o += n * 3 * thin) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const sx = q[0] + J[0] * pts[i] + J[2] * pts[i + 1] + J[4] * pts[i + 2];
            const sy = q[1] + J[1] * pts[i] + J[3] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(sx, sy);
            else ctx!.moveTo(sx, sy);
          }
          ctx!.closePath();
        }
        ctx!.fillStyle = sp.col[g];
        ctx!.fill();
        if (sp.inner || thin > 1) continue; // an outline on a sprig in shadow is noise
        if (sp.n[0] * (eye[0] - sp.c[0]) + sp.n[1] * (eye[1] - sp.c[1]) + sp.n[2] * (eye[2] - sp.c[2]) < 0) continue;
        ctx!.stroke();
      }
      ctx!.lineWidth = lw;
    }

    const bottlebrushGrown = new Map<string, { arms: [number, number, number][][]; parts: BottlebrushPart[] }>();

    /** Little John bottlebrush, after the app's model.
     *
     *  Not a mound of leaves like the jojoba or the sage: a fan of stiff
     *  shoots out of a tight base, each one bristling all the way round
     *  with short needle leaves — a bottlebrush of foliage — and clubbed at
     *  the end with paler new growth. The long shoots splay out low and
     *  reach the rim halfway up; the short ones stand nearly upright to the
     *  top, so the plant is widest at mid-height with open sky between its
     *  arms. Dark blue-green, and here and there on the shoots, just behind
     *  the tip, the crimson brush it's named for. The scan was taken out of
     *  flower; the brushes are what say "bottlebrush" from across a yard.
     *
     *  Drawn as the shoots themselves, under everything; a set-back core and
     *  a layer of big shaded whorls for the dense heart of the plant; then
     *  the whorls up every shoot and the brushes, far first, each lit by
     *  where it sits against the sheet's light. A brush is a cylinder, so
     *  it's drawn the way a cylinder looks from anywhere: a dark round-capped
     *  stroke down its axis, and stamens bristling out either side of it,
     *  across the axis as it lies on screen — drawn smooth, it was a red
     *  pill. Grown once and cached; four projections a part, styles set once
     *  a frame.
     */
    function drawBottlebrushBody(
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
      let grown = bottlebrushGrown.get(key);
      if (!grown) {
        if (bottlebrushGrown.size > 400) bottlebrushGrown.clear(); // growth and edits mint new keys
        grown = growBottlebrush(x, z, h, rw, rot, seed);
        bottlebrushGrown.set(key, grown);
      }
      const pal = sel ? BOTTLEBRUSH_GOLD : BOTTLEBRUSH_COLOURS;

      const core = convexHull(bottlebrushCoreRing(x, z, h, rw).map((v): [number, number] => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      }));
      if (core.length > 2) {
        ctx!.beginPath();
        ctx!.moveTo(core[0][0], core[0][1]);
        for (let i = 1; i < core.length; i++) ctx!.lineTo(core[i][0], core[i][1]);
        ctx!.closePath();
        ctx!.fillStyle = `rgb(${pal.core[0]},${pal.core[1]},${pal.core[2]})`;
        ctx!.fill();
      }

      // The shoots, under every needle: what shows of them is their bare
      // bases and the stretches between whorls.
      ctx!.strokeStyle = pal.stem;
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.05), lw * 0.6);
      ctx!.beginPath();
      for (const path of grown.arms) {
        for (let i = 0; i < path.length; i++) {
          const q = P(path[i][0], path[i][1], path[i][2]);
          if (i) ctx!.lineTo(q[0], q[1]);
          else ctx!.moveTo(q[0], q[1]);
        }
      }
      ctx!.stroke();

      const order = grown.parts.map((pt) => {
        const [cx, cy, cz] = pt.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { pt, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      order.sort((a, b) => b.q[2] - a.q[2]); // far first

      const g = sel ? 1 : 0;
      const n = BOTTLEBRUSH_LEAF.length;
      const leafEdge = sel ? gold(0.6) : ink(0.4);
      // Larger than life, as the needles are, or they vanish at plan zoom.
      const brushW = Math.max(ftPx(x, z, 0.1), lw);
      const stamenL = Math.max(ftPx(x, z, 0.12), 2.5);
      const stamenW = Math.max(ftPx(x, z, 0.016), 0.8);
      const leafW = lw * 0.45;
      ctx!.lineWidth = leafW;
      ctx!.strokeStyle = leafEdge;
      for (const { pt, q, J } of order) {
        const pts = pt.pts;
        if (pt.kind === "brush") {
          const ax = q[0] + J[0] * pts[0] + J[2] * pts[1] + J[4] * pts[2];
          const ay = q[1] + J[1] * pts[0] + J[3] * pts[1] + J[5] * pts[2];
          const bx = q[0] + J[0] * pts[3] + J[2] * pts[4] + J[4] * pts[5];
          const by = q[1] + J[1] * pts[3] + J[3] * pts[4] + J[5] * pts[5];
          ctx!.lineCap = "round";
          ctx!.beginPath();
          ctx!.moveTo(ax, ay);
          ctx!.lineTo(bx, by);
          ctx!.lineWidth = brushW;
          ctx!.strokeStyle = pal.brush;
          ctx!.stroke();
          const dx = bx - ax;
          const dy = by - ay;
          const dl = Math.hypot(dx, dy) || 1;
          const ux = dx / dl;
          const uy = dy / dl;
          ctx!.beginPath();
          for (let o = 6; o < pts.length; o += 3) {
            const sx = ax + dx * pts[o];
            const sy = ay + dy * pts[o];
            const lean = pts[o + 1];
            const side = pts[o + 2];
            const ex = (-uy * side + ux * lean) * stamenL;
            const ey = (ux * side + uy * lean) * stamenL;
            ctx!.moveTo(sx, sy);
            ctx!.lineTo(sx + ex, sy + ey);
          }
          ctx!.lineWidth = stamenW;
          ctx!.strokeStyle = pal.stamen;
          ctx!.stroke();
          ctx!.lineCap = "butt";
          ctx!.lineWidth = leafW;
          ctx!.strokeStyle = leafEdge;
          continue;
        }
        ctx!.beginPath();
        for (let o = 0; o < pts.length; o += n * 3 * thin) {
          for (let k = 0; k < n; k++) {
            const i = o + k * 3;
            const sx = q[0] + J[0] * pts[i] + J[2] * pts[i + 1] + J[4] * pts[i + 2];
            const sy = q[1] + J[1] * pts[i] + J[3] * pts[i + 1] + J[5] * pts[i + 2];
            if (k) ctx!.lineTo(sx, sy);
            else ctx!.moveTo(sx, sy);
          }
          ctx!.closePath();
        }
        ctx!.fillStyle = pt.col[g];
        ctx!.fill();
        if (pt.kind === "inner" || thin > 1) continue; // an outline on a whorl in shadow is noise
        if (pt.n[0] * (eye[0] - pt.c[0]) + pt.n[1] * (eye[1] - pt.c[1]) + pt.n[2] * (eye[2] - pt.c[2]) < 0) continue;
        ctx!.stroke();
      }
      ctx!.lineCap = "butt";
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the shrubs are.
    const paloVerdeGrown = new Map<string, PaloVerdeTree>();

    /** Blue palo verde, after the app's model.
     *
     *  Not a canopy disc: one short pale trunk, forking a fifth of the way
     *  up into a vase of limbs that fork twice more out to a broad dome,
     *  widest a little above halfway with its rim drooping to a third of
     *  the height — a tree a good deal wider than it is tall, its every twig
     *  ending in a fan of fine ones. The canopy is mostly air, a sage mist
     *  you see the limbs through, with a light scatter of yellow bloom near
     *  the outside, as the model has.
     *
     *  Drawn as the limbs by order, trunk to fine twig, each a single stroke
     *  of its own width; then a translucent lobe of foliage round each
     *  branch's twigs, far first, thickening the crown where they overlap
     *  and dimming the limbs behind them; then a thousand flecks of leaf,
     *  a tone at a time, and the flowers. Drawn leaf by leaf, as the shrubs
     *  are, it was either a scatter of confetti or three times the cost —
     *  a tree this size is seen as a texture, not as leaves. No solid core:
     *  this canopy is see-through, and a filled one would make it a lollipop.
     *  Grown once and cached.
     */
    function drawPaloVerdeBody(
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
      let grown = paloVerdeGrown.get(key);
      if (!grown) {
        if (paloVerdeGrown.size > 400) paloVerdeGrown.clear(); // growth and edits mint new keys
        grown = growPaloVerde(x, z, h, rw, rot, seed);
        paloVerdeGrown.set(key, grown);
      }
      const pal = sel ? PALO_VERDE_GOLD : PALO_VERDE_COLOURS;
      const g = sel ? 1 : 0;

      // Limbs, thickest first: trunk, main limbs, branches, twigs, fine twigs.
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      const widths = [0.9, 0.45, 0.22, 0.09, 0.04];
      const floors = [2.2, 1.5, 1, 0.6, 0.45];
      grown.limbs.forEach((segs, order) => {
        ctx!.strokeStyle = order === 0 ? pal.trunk : order < 3 ? pal.limb : pal.twig;
        ctx!.lineWidth = Math.max(ftPx(x, z, widths[order]), floors[order]);
        ctx!.beginPath();
        for (const [a, b] of segs) {
          const p0 = P(a[0], a[1], a[2]);
          const p1 = P(b[0], b[1], b[2]);
          ctx!.moveTo(p0[0], p0[1]);
          ctx!.lineTo(p1[0], p1[1]);
        }
        ctx!.stroke();
      });
      ctx!.lineCap = "butt";

      const proj = grown.lobes.map((L) => {
        const [cx, cy, cz] = L.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { L, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      const lobes = proj.slice().sort((a, b) => b.q[2] - a.q[2]); // far first
      for (const { L, q, J } of lobes) {
        // An ellipsoid seen through the camera's local (affine) map is an
        // ellipse: its axes from the 2×2 spread of the three mapped radii.
        const ax = [J[0] * L.rx, J[2] * L.ry, J[4] * L.rx];
        const ay = [J[1] * L.rx, J[3] * L.ry, J[5] * L.rx];
        const c11 = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
        const c22 = ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2];
        const c12 = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        ctx!.beginPath();
        ctx!.ellipse(q[0], q[1], Math.sqrt(mid + d), Math.sqrt(Math.max(0, mid - d)), 0.5 * Math.atan2(2 * c12, c11 - c22), 0, Math.PI * 2);
        ctx!.fillStyle = L.col[g];
        ctx!.fill();
      }

      // Flecks: a slanted dash of leaf each, a fixed size on the ground plan
      // at this spot, placed by its lobe's projection and filled a tone at a
      // time, then the flowers.
      const { fleckLobe, fleckOff, fleckSlant, groupStart } = grown;
      const half = Math.max(ftPx(x, z, 0.42), 1.4);
      const tones = PV_TONES[g];
      for (let gi = 0; gi <= PV_LEVELS; gi++) {
        const from = groupStart[gi];
        const to = groupStart[gi + 1];
        if (from >= to) continue;
        const s = gi === PV_LEVELS ? half * 0.8 : half;
        ctx!.fillStyle = gi === PV_LEVELS ? pal.bloom : tones[gi];
        ctx!.beginPath();
        for (let i = from; i < to; i++) {
          const { q, J } = proj[fleckLobe[i]];
          const ox = fleckOff[i * 3];
          const oy = fleckOff[i * 3 + 1];
          const oz = fleckOff[i * 3 + 2];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          const a = fleckSlant[i];
          const ux = Math.cos(a) * s;
          const uy = Math.sin(a) * s;
          ctx!.moveTo(px + ux, py + uy);
          ctx!.lineTo(px - uy * 0.45, py + ux * 0.45);
          ctx!.lineTo(px - ux, py - uy);
          ctx!.lineTo(px + uy * 0.45, py - ux * 0.45);
          ctx!.closePath();
        }
        ctx!.fillStyle = gi === PV_LEVELS ? pal.bloom : tones[gi];
        ctx!.fill();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per tree and kept, as the palo verde is.
    const mesquiteGrown = new Map<string, MesquiteTree>();

    /** Honey mesquite, after the app's model.
     *
     *  Not the palo verde's misty vase: a short, stout, dark trunk with a
     *  lean, forking low into a few big rough limbs that run out nearly
     *  level and crook upward, under a broad, lumpy, low dome of fresh
     *  yellow-green that you see into rather than through — widest a third
     *  of the way up, a lobe or two standing above it — and its edge
     *  weeping: the feathery branchlets hang a fifth of the height below
     *  the crown, as a mesquite's do. Pale catkins hang among the leaves.
     *
     *  Drawn as the limbs by order, trunk to twig, each one stroke of its
     *  own width; then translucent puffs of foliage round each branch's
     *  twigs, far first; the weeping strands in one stroke; then the
     *  leaflets as near-vertical hanging dashes, a tone at a time, and the
     *  catkins. Grown once and cached; flecks placed by their puff's
     *  projection, as the palo verde's are.
     */
    function drawMesquiteBody(
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
      let grown = mesquiteGrown.get(key);
      if (!grown) {
        if (mesquiteGrown.size > 400) mesquiteGrown.clear(); // growth and edits mint new keys
        grown = growMesquite(x, z, h, rw, rot, seed);
        mesquiteGrown.set(key, grown);
      }
      const pal = sel ? MESQUITE_GOLD : MESQUITE_COLOURS;
      const g = sel ? 1 : 0;

      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      const widths = [1.5, 0.6, 0.28, 0.1];
      const floors = [2.6, 1.7, 1, 0.6];
      grown.limbs.forEach((segs, order) => {
        ctx!.strokeStyle = order === 0 ? pal.trunk : order < 3 ? pal.limb : pal.twig;
        ctx!.lineWidth = Math.max(ftPx(x, z, widths[order]), floors[order]);
        ctx!.beginPath();
        for (const [a, b] of segs) {
          const p0 = P(a[0], a[1], a[2]);
          const p1 = P(b[0], b[1], b[2]);
          ctx!.moveTo(p0[0], p0[1]);
          ctx!.lineTo(p1[0], p1[1]);
        }
        ctx!.stroke();
      });

      const proj = grown.lobes.map((L) => {
        const [cx, cy, cz] = L.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { L, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      for (const { L, q, J } of proj.slice().sort((a, b) => b.q[2] - a.q[2])) {
        // An ellipsoid through the local (affine) map is an ellipse.
        const ax = [J[0] * L.rx, J[2] * L.ry, J[4] * L.rx];
        const ay = [J[1] * L.rx, J[3] * L.ry, J[5] * L.rx];
        const c11 = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
        const c22 = ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2];
        const c12 = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        ctx!.beginPath();
        ctx!.ellipse(q[0], q[1], Math.sqrt(mid + d), Math.sqrt(Math.max(0, mid - d)), 0.5 * Math.atan2(2 * c12, c11 - c22), 0, Math.PI * 2);
        ctx!.fillStyle = L.col[g];
        ctx!.fill();
      }

      ctx!.strokeStyle = pal.strand;
      ctx!.lineWidth = Math.max(ftPx(x, z, 0.06), 0.6);
      ctx!.beginPath();
      for (const [A, B, C] of grown.strands) {
        const a = P(A[0], A[1], A[2]);
        const b = P(B[0], B[1], B[2]);
        const c = P(C[0], C[1], C[2]);
        ctx!.moveTo(a[0], a[1]);
        ctx!.quadraticCurveTo(b[0], b[1], c[0], c[1]);
      }
      ctx!.stroke();
      ctx!.lineCap = "butt";

      const { fleckLobe, fleckOff, fleckSlant, groupStart } = grown;
      const half = Math.max(ftPx(x, z, 0.4), 1.4);
      const tones = MQ_TONES[g];
      for (let gi = 0; gi <= MQ_LEVELS; gi++) {
        const from = groupStart[gi];
        const to = groupStart[gi + 1];
        if (from >= to) continue;
        // Catkins are longer and thinner than the leaflets.
        const s = gi === MQ_LEVELS ? half * 1.3 : half;
        const wd = gi === MQ_LEVELS ? 0.25 : 0.4;
        ctx!.fillStyle = gi === MQ_LEVELS ? pal.bloom : tones[gi];
        ctx!.beginPath();
        for (let i = from; i < to; i++) {
          // Filled a hundred and fifty at a time: one path of a thousand
          // overlapping dashes cost five times as much to fill.
          if (i > from && (i - from) % 150 === 0) {
            ctx!.fill();
            ctx!.beginPath();
          }
          const { q, J } = proj[fleckLobe[i]];
          const ox = fleckOff[i * 3];
          const oy = fleckOff[i * 3 + 1];
          const oz = fleckOff[i * 3 + 2];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          const a = fleckSlant[i];
          const ux = Math.cos(a) * s;
          const uy = Math.sin(a) * s;
          ctx!.moveTo(px + ux, py + uy);
          ctx!.lineTo(px - uy * wd, py + ux * wd);
          ctx!.lineTo(px - ux, py - uy);
          ctx!.lineTo(px + uy * wd, py - ux * wd);
          ctx!.closePath();
        }
        ctx!.fill();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per tree and kept, as the other trees are.
    const ebonyGrown = new Map<string, EbonyTree>();

    /** Texas ebony, after the app's model.
     *
     *  Nothing like the palo verde's mist or the mesquite's weeping dome: a
     *  dense, dark, upright egg of a crown — taller than wide, widest three
     *  fifths of the way up, starting low, a seventh of the way up a short,
     *  stout, pale trunk that forks into three thick limbs — so dense you
     *  see none of the tree inside it. Near-black green, lit by a speckle of
     *  small bright leaflets where the light falls, with brown pods hanging
     *  here and there.
     *
     *  Drawn as the trunk and limbs; the crown's shell set back and filled
     *  as one dark silhouette — like the sage, this is a dense plant, and
     *  without it the sand shows between the puffs; then near-opaque puffs
     *  over its skin, far first, for the lumpy outline and the light and
     *  shade; then the leaflet flecks a tone at a time, and the pods. Grown
     *  once and cached; flecks placed by their puff's projection.
     */
    function drawEbonyBody(
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
      let grown = ebonyGrown.get(key);
      if (!grown) {
        if (ebonyGrown.size > 400) ebonyGrown.clear(); // growth and edits mint new keys
        grown = growEbony(x, z, h, rw, rot, seed);
        ebonyGrown.set(key, grown);
      }
      const pal = sel ? EBONY_GOLD : EBONY_COLOURS;
      const g = sel ? 1 : 0;

      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      const widths = [1.6, 0.8];
      const floors = [2.6, 1.8];
      grown.limbs.forEach((segs, order) => {
        ctx!.strokeStyle = order === 0 ? pal.trunk : pal.limb;
        ctx!.lineWidth = Math.max(ftPx(x, z, widths[order]), floors[order]);
        ctx!.beginPath();
        for (const [a, b] of segs) {
          const p0 = P(a[0], a[1], a[2]);
          const p1 = P(b[0], b[1], b[2]);
          ctx!.moveTo(p0[0], p0[1]);
          ctx!.lineTo(p1[0], p1[1]);
        }
        ctx!.stroke();
      });
      ctx!.lineCap = "butt";

      const core = convexHull(grown.coreRing.map((v): [number, number] => {
        const q = P(v[0], v[1], v[2]);
        return [q[0], q[1]];
      }));
      if (core.length > 2) {
        ctx!.beginPath();
        ctx!.moveTo(core[0][0], core[0][1]);
        for (let i = 1; i < core.length; i++) ctx!.lineTo(core[i][0], core[i][1]);
        ctx!.closePath();
        ctx!.fillStyle = `rgb(${pal.core[0]},${pal.core[1]},${pal.core[2]})`;
        ctx!.fill();
      }

      const proj = grown.puffs.map((L) => {
        const [cx, cy, cz] = L.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { L, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      const sorted = proj.slice().sort((a, b) => b.q[2] - a.q[2]); // far first
      const puffTones = EB_PUFF_TONES[g];
      const trace = ({ L, q, J }: (typeof proj)[number]) => {
        // An ellipsoid through the local (affine) map is an ellipse.
        const ax = [J[0] * L.rx, J[2] * L.ry, J[4] * L.rx];
        const ay = [J[1] * L.rx, J[3] * L.ry, J[5] * L.rx];
        const c11 = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
        const c22 = ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2];
        const c12 = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        const ea = Math.sqrt(mid + d);
        const eb = Math.sqrt(Math.max(0, mid - d));
        const ang = 0.5 * Math.atan2(2 * c12, c11 - c22);
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        // Round that ellipse, each point pushed in or out by its own amount.
        for (let k = 0; k < EB_PUFF; k++) {
          const t = (k / EB_PUFF) * Math.PI * 2;
          const ex = Math.cos(t) * ea * L.jit[k];
          const ey = Math.sin(t) * eb * L.jit[k];
          const px = q[0] + ex * ca - ey * sa;
          const py = q[1] + ex * sa + ey * ca;
          if (k) ctx!.lineTo(px, py);
          else ctx!.moveTo(px, py);
        }
        ctx!.closePath();
      };
      // Far to near in a few bands, each band a tone at a time: puffs this
      // small barely overlap their neighbours in depth.
      const BANDS = 5;
      const byTone: (typeof proj)[] = Array.from({ length: EB_LEVELS }, () => []);
      for (let band = 0; band < BANDS; band++) {
        for (const list of byTone) list.length = 0;
        const from = Math.floor((sorted.length * band) / BANDS);
        const to = Math.floor((sorted.length * (band + 1)) / BANDS);
        for (let o = from; o < to; o++) byTone[sorted[o].L.level].push(sorted[o]);
        byTone.forEach((list, level) => {
          if (!list.length) return;
          ctx!.beginPath();
          for (const p of list) trace(p);
          ctx!.fillStyle = puffTones[level];
          ctx!.fill();
        });
      }

      // Flecks on the near side only: on the far side they'd be under the
      // near puffs anyway.
      const { fleckPuff, fleckOff, fleckSlant, groupStart } = grown;
      const half = Math.max(ftPx(x, z, 0.3), 1.2);
      const tones = EB_TONES[g];
      const puffs = grown.puffs;
      for (let gi = 0; gi <= EB_LEVELS; gi++) {
        const from = groupStart[gi];
        const to = groupStart[gi + 1];
        if (from >= to) continue;
        const pod = gi === EB_LEVELS;
        const s = pod ? half * 1.5 : half;
        const wd = pod ? 0.28 : 0.7;
        ctx!.fillStyle = pod ? pal.pod : tones[gi];
        ctx!.beginPath();
        for (let i = from; i < to; i++) {
          // Filled a hundred and fifty at a time, as the mesquite's are.
          if (i > from && (i - from) % 150 === 0) {
            ctx!.fill();
            ctx!.beginPath();
          }
          const pf = puffs[fleckPuff[i]];
          const ox = fleckOff[i * 3];
          const oy = fleckOff[i * 3 + 1];
          const oz = fleckOff[i * 3 + 2];
          const wx = pf.c[0] + ox;
          const wy = pf.c[1] + oy;
          const wz = pf.c[2] + oz;
          if ((wx - x) * (eye[0] - wx) + (wy - h * 0.55) * (eye[1] - wy) + (wz - z) * (eye[2] - wz) < 0) continue;
          const { q, J } = proj[fleckPuff[i]];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          const a = fleckSlant[i];
          const ux = Math.cos(a) * s;
          const uy = Math.sin(a) * s;
          ctx!.moveTo(px + ux, py + uy);
          ctx!.lineTo(px - uy * wd, py + ux * wd);
          ctx!.lineTo(px - ux, py - uy);
          ctx!.lineTo(px + uy * wd, py - ux * wd);
          ctx!.closePath();
        }
        ctx!.fill();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per tree and kept, as the other trees are.
    const mulgaGrown = new Map<string, MulgaTree>();

    /** Mulga, after the app's mature model.
     *
     *  Unlike the three trees before it: narrow and upright, a single
     *  reddish-brown leader running nearly to the top with branches rising
     *  steeply off it, the low ones longest — so the crown is widest a
     *  third of the way up and tapers from there to a point, a cone over an
     *  oval. The palest crown in the catalog, a see-through silver mist of
     *  fine upright phyllodes with the red-brown limbs showing through.
     *
     *  Drawn as the trunk, leader, branches and twigs, each order one
     *  stroke; faint silver puffs, taller than wide, along the outer half
     *  of every branch, far first; then the phyllodes as thin needles
     *  slanting up, a tone at a time. Grown once and cached; flecks placed
     *  by their puff's projection, as the palo verde's are.
     */
    function drawMulgaBody(
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
      let grown = mulgaGrown.get(key);
      if (!grown) {
        if (mulgaGrown.size > 400) mulgaGrown.clear(); // growth and edits mint new keys
        grown = growMulga(x, z, h, rw, rot, seed);
        mulgaGrown.set(key, grown);
      }
      const pal = sel ? MULGA_GOLD : MULGA_COLOURS;
      const g = sel ? 1 : 0;

      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      const widths = [0.75, 0.4, 0.16, 0.07];
      const floors = [2.2, 1.6, 0.9, 0.6];
      grown.limbs.forEach((segs, order) => {
        ctx!.strokeStyle = order === 0 ? pal.trunk : order < 3 ? pal.limb : pal.twig;
        ctx!.lineWidth = Math.max(ftPx(x, z, widths[order]), floors[order]);
        ctx!.beginPath();
        for (const [a, b] of segs) {
          const p0 = P(a[0], a[1], a[2]);
          const p1 = P(b[0], b[1], b[2]);
          ctx!.moveTo(p0[0], p0[1]);
          ctx!.lineTo(p1[0], p1[1]);
        }
        ctx!.stroke();
      });
      ctx!.lineCap = "butt";

      const proj = grown.lobes.map((L) => {
        const [cx, cy, cz] = L.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { L, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      for (const { L, q, J } of proj.slice().sort((a, b) => b.q[2] - a.q[2])) {
        // An ellipsoid through the local (affine) map is an ellipse.
        const ax = [J[0] * L.rx, J[2] * L.ry, J[4] * L.rx];
        const ay = [J[1] * L.rx, J[3] * L.ry, J[5] * L.rx];
        const c11 = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
        const c22 = ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2];
        const c12 = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        ctx!.beginPath();
        ctx!.ellipse(q[0], q[1], Math.sqrt(mid + d), Math.sqrt(Math.max(0, mid - d)), 0.5 * Math.atan2(2 * c12, c11 - c22), 0, Math.PI * 2);
        ctx!.fillStyle = L.col[g];
        ctx!.fill();
      }

      const { fleckLobe, fleckOff, fleckSlant, groupStart } = grown;
      const half = Math.max(ftPx(x, z, 0.32), 1.3);
      const tones = MU_TONES[g];
      for (let gi = 0; gi < MU_LEVELS; gi++) {
        const from = groupStart[gi];
        const to = groupStart[gi + 1];
        if (from >= to) continue;
        ctx!.fillStyle = tones[gi];
        ctx!.beginPath();
        for (let i = from; i < to; i++) {
          // Filled a hundred and fifty at a time, as the mesquite's are.
          if (i > from && (i - from) % 150 === 0) {
            ctx!.fill();
            ctx!.beginPath();
          }
          const { q, J } = proj[fleckLobe[i]];
          const ox = fleckOff[i * 3];
          const oy = fleckOff[i * 3 + 1];
          const oz = fleckOff[i * 3 + 2];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          const a = fleckSlant[i];
          const ux = Math.cos(a) * half;
          const uy = Math.sin(a) * half;
          // A needle: long and thin.
          ctx!.moveTo(px + ux, py + uy);
          ctx!.lineTo(px - uy * 0.22, py + ux * 0.22);
          ctx!.lineTo(px - ux, py - uy);
          ctx!.lineTo(px + uy * 0.22, py - ux * 0.22);
          ctx!.closePath();
        }
        ctx!.fill();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per tree and kept, as the other trees are.
    const chasteGrown = new Map<string, ChasteTree>();

    /** Chaste tree, after the app's model.
     *
     *  The one tree in flower: a broad, soft dome, wider than it is tall,
     *  its edge drooping to a third of the way up, held on four or five
     *  slim grey-brown trunks that splay from one foot into a vase — and
     *  over the top of it, standing up out of the leaves, hundreds of
     *  lavender flower spikes. Grey-green palmate leaves, five fingers to
     *  a hand, hang off every part of the crown.
     *
     *  Drawn as the trunks, branches and twigs, each order one stroke;
     *  translucent masses of foliage over the crown's skin, far first, so
     *  the crown fills where they pile up and the trunks show through
     *  where they don't; the leaves a tone at a time; then the spikes.
     *  Grown once and cached; leaves and spikes placed by their mass's
     *  projection, as the palo verde's flecks are.
     */
    function drawChasteBody(
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
      let grown = chasteGrown.get(key);
      if (!grown) {
        if (chasteGrown.size > 400) chasteGrown.clear(); // growth and edits mint new keys
        grown = growChaste(x, z, h, rw, rot, seed);
        chasteGrown.set(key, grown);
      }
      const pal = sel ? CHASTE_GOLD : CHASTE_COLOURS;
      const g = sel ? 1 : 0;

      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      const widths = [0.42, 0.22, 0.08];
      const floors = [2, 1.2, 0.6];
      grown.limbs.forEach((segs, order) => {
        ctx!.strokeStyle = order === 0 ? pal.trunk : pal.limb;
        ctx!.lineWidth = Math.max(ftPx(x, z, widths[order]), floors[order]);
        ctx!.beginPath();
        for (const [a, b] of segs) {
          const p0 = P(a[0], a[1], a[2]);
          const p1 = P(b[0], b[1], b[2]);
          ctx!.moveTo(p0[0], p0[1]);
          ctx!.lineTo(p1[0], p1[1]);
        }
        ctx!.stroke();
      });
      ctx!.lineCap = "butt";

      const proj = grown.lobes.map((L) => {
        const [cx, cy, cz] = L.c;
        const q = P(cx, cy, cz);
        const qx = P(cx + 1, cy, cz);
        const qy = P(cx, cy + 1, cz);
        const qz = P(cx, cy, cz + 1);
        return { L, q, J: [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]] };
      });
      for (const { L, q, J } of proj.slice().sort((a, b) => b.q[2] - a.q[2])) {
        // An ellipsoid through the local (affine) map is an ellipse.
        const ax = [J[0] * L.rx, J[2] * L.ry, J[4] * L.rx];
        const ay = [J[1] * L.rx, J[3] * L.ry, J[5] * L.rx];
        const c11 = ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2];
        const c22 = ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2];
        const c12 = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        ctx!.beginPath();
        ctx!.ellipse(q[0], q[1], Math.sqrt(mid + d), Math.sqrt(Math.max(0, mid - d)), 0.5 * Math.atan2(2 * c12, c11 - c22), 0, Math.PI * 2);
        ctx!.fillStyle = L.col[g];
        ctx!.fill();
      }

      // Leaves and spikes on the side facing the eye only: on the far side
      // they'd be under the near foliage anyway. Judged by the skin's
      // normal at their mass — a crown this flat isn't a ball, and judged
      // from its middle the whole far half of its top would go bare.
      const lobes = grown.lobes;
      const near = (L: (typeof lobes)[number], ox: number, oy: number, oz: number, slack: number) => {
        const ex = eye[0] - L.c[0] - ox;
        const ey = eye[1] - L.c[1] - oy;
        const ez = eye[2] - L.c[2] - oz;
        return L.n[0] * ex + L.n[1] * ey + L.n[2] * ez >= -slack * Math.hypot(ex, ey, ez);
      };

      const { leafLobe, leafOff, leafSlant, leafStart } = grown;
      const len = Math.max(ftPx(x, z, 0.8), 1.6);
      // Too small to see five fingers, a hand is one leaf-shaped fleck.
      const hands = len > 4.5;
      const leafTones = CT_LEAF_TONES[g];
      for (let gi = 0; gi < CT_LEVELS; gi++) {
        const from = leafStart[gi];
        const to = leafStart[gi + 1];
        if (from >= to) continue;
        ctx!.fillStyle = leafTones[gi];
        ctx!.beginPath();
        let n = 0;
        for (let i = from; i < to; i++) {
          const L = lobes[leafLobe[i]];
          const ox = leafOff[i * 3];
          const oy = leafOff[i * 3 + 1];
          const oz = leafOff[i * 3 + 2];
          if (!near(L, ox, oy, oz, 0)) continue;
          // Filled a hundred and fifty fingers at a time, as the mesquite's
          // flecks are.
          if (++n % (hands ? 30 : 150) === 0) {
            ctx!.fill();
            ctx!.beginPath();
          }
          const { q, J } = proj[leafLobe[i]];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          if (!hands) {
            const a = leafSlant[i];
            const ux = Math.cos(a) * len * 0.6;
            const uy = Math.sin(a) * len * 0.6;
            ctx!.moveTo(px + ux, py + uy);
            ctx!.lineTo(px - uy * 0.5, py + ux * 0.5);
            ctx!.lineTo(px - ux, py - uy);
            ctx!.lineTo(px + uy * 0.5, py - ux * 0.5);
            ctx!.closePath();
            continue;
          }
          // A hand of five narrow fingers from one point.
          for (const [turn, f] of CT_FINGERS) {
            const a = leafSlant[i] + turn;
            const dx = Math.cos(a) * len * f;
            const dy = Math.sin(a) * len * f;
            ctx!.moveTo(px, py);
            ctx!.lineTo(px + dx * 0.45 - dy * 0.12, py + dy * 0.45 + dx * 0.12);
            ctx!.lineTo(px + dx, py + dy);
            ctx!.lineTo(px + dx * 0.45 + dy * 0.12, py + dy * 0.45 - dx * 0.12);
            ctx!.closePath();
          }
        }
        ctx!.fill();
      }

      const { spikeLobe, spikeOff, spikeDir, spikeStart } = grown;
      const spikeTones = CT_SPIKE_TONES[g];
      for (let gi = 0; gi < CT_SPIKE_LEVELS; gi++) {
        const from = spikeStart[gi];
        const to = spikeStart[gi + 1];
        if (from >= to) continue;
        ctx!.fillStyle = spikeTones[gi];
        ctx!.beginPath();
        for (let i = from; i < to; i++) {
          if (i > from && (i - from) % 150 === 0) {
            ctx!.fill();
            ctx!.beginPath();
          }
          const L = lobes[spikeLobe[i]];
          const ox = spikeOff[i * 3];
          const oy = spikeOff[i * 3 + 1];
          const oz = spikeOff[i * 3 + 2];
          // A spike stands clear of the leaves, so it shows a little past
          // the crown's edge.
          if (!near(L, ox, oy, oz, 0.25)) continue;
          const { q, J } = proj[spikeLobe[i]];
          const px = q[0] + J[0] * ox + J[2] * oy + J[4] * oz;
          const py = q[1] + J[1] * ox + J[3] * oy + J[5] * oz;
          const vx = spikeDir[i * 3];
          const vy = spikeDir[i * 3 + 1];
          const vz = spikeDir[i * 3 + 2];
          const dx = J[0] * vx + J[2] * vy + J[4] * vz;
          const dy = J[1] * vx + J[3] * vy + J[5] * vz;
          const l = Math.hypot(dx, dy) || 1;
          // Thickest a quarter of the way up, tapering to its tip.
          const w = Math.max(l * 0.09, 0.6) / l;
          ctx!.moveTo(px - dx * 0.1, py - dy * 0.1);
          ctx!.lineTo(px + dx * 0.25 - dy * w, py + dy * 0.25 + dx * w);
          ctx!.lineTo(px + dx, py + dy);
          ctx!.lineTo(px + dx * 0.25 + dy * w, py + dy * 0.25 - dx * w);
          ctx!.closePath();
        }
        ctx!.fill();
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per clump and kept, as the trees are.
    const fencePostGrown = new Map<string, FencePostClump>();
    // Scratch for one stem's projected points, reused stem to stem.
    const fpScreen = new Float32Array(4 * 12 * 2);
    const fpSeen = new Float32Array(4 * 12);

    /** Mexican fence post, after the app's model.
     *
     *  Four stems from one foot, the tallest nearly the whole height and
     *  the others at seven, six and four tenths of it, each a column of six
     *  blunt ribs under a rounded dome — and down every rib crest a white
     *  stripe, the felt of its areoles, which is what anyone recognises the
     *  plant by. Mid green, lit on the side toward the light and turning
     *  through the shade around the far side.
     *
     *  Drawn stem by stem, far first: every face turned toward the eye
     *  filled in its own tone, the most oblique first so the faces either
     *  side of a groove overlap the right way round; then the felt down
     *  every crest that shows, the lit crests and the shaded ones a stroke
     *  each. Grown once and cached; each ring placed by its stem's
     *  projection.
     */
    function drawFencePostBody(
      x: number,
      z: number,
      h: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rot}`;
      let grown = fencePostGrown.get(key);
      if (!grown) {
        if (fencePostGrown.size > 400) fencePostGrown.clear(); // growth and edits mint new keys
        grown = growFencePost(x, z, h, rot);
        fencePostGrown.set(key, grown);
      }
      const pal = sel ? FENCE_POST_GOLD : FENCE_POST_COLOURS;
      const tones = FP_TONES[sel ? 1 : 0];

      // Far first by how far each foot stands from the eye across the ground:
      // the stems stand upright, so that's the order they hide each other in.
      // (Each stem's depth halfway up let a tall one behind, its middle up
      // toward the eye, cover a short one in front.)
      const order = grown.stems
        .map((st) => ({ st, d: Math.hypot(st.sx - eye[0], st.sz - eye[2]) }))
        .sort((a, b) => b.d - a.d);
      ctx!.lineJoin = "round";
      ctx!.lineCap = "round";
      for (const { st } of order) {
        const lc = st.ys.map((y) => P(st.sx, y, st.sz));
        const ym = st.ys[1] * 0.5;
        const q = lc[0];
        const qx = P(st.sx + 1, 0, st.sz);
        const qz = P(st.sx, 0, st.sz + 1);
        const jx0 = qx[0] - q[0];
        const jx1 = qx[1] - q[1];
        const jz0 = qz[0] - q[0];
        const jz1 = qz[1] - q[1];
        for (let l = 0; l < 4; l++) {
          for (let j = 0; j < 12; j++) {
            const i = l * 12 + j;
            const ox = st.ring[i * 2];
            const oz = st.ring[i * 2 + 1];
            fpScreen[i * 2] = lc[l][0] + jx0 * ox + jz0 * oz;
            fpScreen[i * 2 + 1] = lc[l][1] + jx1 * ox + jz1 * oz;
          }
        }
        let vx = eye[0] - st.sx;
        let vy = eye[1] - ym;
        let vz = eye[2] - st.sz;
        const vl = Math.hypot(vx, vy, vz) || 1;
        vx /= vl;
        vy /= vl;
        vz /= vl;
        const faces: number[] = [];
        for (let f = 0; f < 48; f++) {
          const d = st.faceN[f * 3] * vx + st.faceN[f * 3 + 1] * vy + st.faceN[f * 3 + 2] * vz;
          fpSeen[f] = d;
          if (d > 0) faces.push(f);
        }
        faces.sort((a, b) => fpSeen[a] - fpSeen[b]);
        let cur = -1;
        for (const f of faces) {
          const b = (f / 12) | 0;
          const j = f % 12;
          const j1 = (j + 1) % 12;
          const t = st.faceTone[f];
          if (t !== cur) {
            ctx!.fillStyle = tones[t];
            cur = t;
          }
          ctx!.beginPath();
          ctx!.moveTo(fpScreen[(b * 12 + j) * 2], fpScreen[(b * 12 + j) * 2 + 1]);
          ctx!.lineTo(fpScreen[(b * 12 + j1) * 2], fpScreen[(b * 12 + j1) * 2 + 1]);
          if (b === 3) {
            ctx!.lineTo(lc[4][0], lc[4][1]);
          } else {
            ctx!.lineTo(fpScreen[((b + 1) * 12 + j1) * 2], fpScreen[((b + 1) * 12 + j1) * 2 + 1]);
            ctx!.lineTo(fpScreen[((b + 1) * 12 + j) * 2], fpScreen[((b + 1) * 12 + j) * 2 + 1]);
          }
          ctx!.closePath();
          // A hairline of its own colour closes the seams between faces.
          ctx!.fill();
        }

        // The felt: down each crest wherever a face beside it shows.
        ctx!.lineWidth = Math.max(ftPx(st.sx, st.sz, 0.12), 0.7);
        for (const lit of [0, 1]) {
          ctx!.beginPath();
          for (let k = 0; k < FP_RIBS; k++) {
            if (st.crestLit[k] !== lit) continue;
            const j = 2 * k;
            const jl = (j + 11) % 12;
            let pen = false;
            for (let b = 0; b < 4; b++) {
              const shows = fpSeen[b * 12 + j] > 0 || fpSeen[b * 12 + jl] > 0;
              if (!shows) {
                pen = false;
                continue;
              }
              if (!pen) ctx!.moveTo(fpScreen[(b * 12 + j) * 2], fpScreen[(b * 12 + j) * 2 + 1]);
              if (b === 3) ctx!.lineTo(lc[4][0], lc[4][1]);
              else ctx!.lineTo(fpScreen[((b + 1) * 12 + j) * 2], fpScreen[((b + 1) * 12 + j) * 2 + 1]);
              pen = true;
            }
          }
          ctx!.strokeStyle = lit ? pal.felt : pal.feltShade;
          ctx!.stroke();
        }
      }
      ctx!.lineCap = "butt";
      ctx!.lineWidth = lw;
    }

    // Grown once per clump and kept, as the trees are.
    const organPipeGrown = new Map<string, OrganPipeClump>();
    // Scratch for one stem's projected points, reused stem to stem.
    const opScreen = new Float32Array(5 * OP_PTS * 2);
    const opSeen = new Float32Array(OP_BANDS * OP_PTS);
    const opBuckets: number[][] = Array.from({ length: OP_LEVELS * 2 }, () => []);

    /** Organ pipe cactus, after the app's model.
     *
     *  Nothing like the fence post's four bright striped columns: six
     *  stems from one base — three tall ones, the tallest the whole height,
     *  leaning a little apart as they rise, and three short ones round
     *  their feet — each a thick column of fourteen low ribs, so it reads
     *  as finely fluted rather than paneled. A dark grey-green, its ribs
     *  turning through light and shade, paler at the rounded tips where
     *  the new growth and grey spines are.
     *
     *  Drawn stem by stem, far first: its silhouette filled dark, so the
     *  seams between faces read as the grooves they are; then every face
     *  turned toward the eye, a tone at a time; then, close enough to see
     *  them, the grey spine clusters spaced down every rib that shows.
     *  Grown once and cached; each ring placed by its stem's projection.
     */
    function drawOrganPipeBody(
      x: number,
      z: number,
      h: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rot}`;
      let grown = organPipeGrown.get(key);
      if (!grown) {
        if (organPipeGrown.size > 400) organPipeGrown.clear(); // growth and edits mint new keys
        grown = growOrganPipe(x, z, h, rot);
        organPipeGrown.set(key, grown);
      }
      const tones = OP_TONES[sel ? 1 : 0];

      const order = grown.stems
        .map((st) => ({ st, d: P(st.axis[3], st.axis[4], st.axis[5])[2] }))
        .sort((a, b) => b.d - a.d);
      for (const { st } of order) {
        const lc: [number, number, number][] = [];
        for (let l = 0; l < 6; l++) lc.push(P(st.axis[l * 3], st.axis[l * 3 + 1], st.axis[l * 3 + 2]));
        const q = lc[0];
        const qx = P(st.axis[0] + 1, 0, st.axis[2]);
        const qz = P(st.axis[0], 0, st.axis[2] + 1);
        const jx0 = qx[0] - q[0];
        const jx1 = qx[1] - q[1];
        const jz0 = qz[0] - q[0];
        const jz1 = qz[1] - q[1];
        for (let l = 0; l < 5; l++) {
          for (let j = 0; j < OP_PTS; j++) {
            const i = l * OP_PTS + j;
            const ox = st.ring[i * 2];
            const oz = st.ring[i * 2 + 1];
            opScreen[i * 2] = lc[l][0] + jx0 * ox + jz0 * oz;
            opScreen[i * 2 + 1] = lc[l][1] + jx1 * ox + jz1 * oz;
          }
        }
        let vx = eye[0] - st.axis[3];
        let vy = eye[1] - st.axis[4];
        let vz = eye[2] - st.axis[5];
        const vl = Math.hypot(vx, vy, vz) || 1;
        vx /= vl;
        vy /= vl;
        vz /= vl;
        for (const bucket of opBuckets) bucket.length = 0;
        for (let f = 0; f < OP_BANDS * OP_PTS; f++) {
          const d = st.faceN[f * 3] * vx + st.faceN[f * 3 + 1] * vy + st.faceN[f * 3 + 2] * vz;
          opSeen[f] = d;
          if (d > 0) opBuckets[st.faceTone[f]].push(f);
        }

        // The silhouette, dark: the outline of the widest rings and the apex.
        const hull = convexHull(
          Array.from({ length: 3 * OP_PTS + 1 }, (_, k): [number, number] => {
            if (k === 3 * OP_PTS) return [lc[5][0], lc[5][1]];
            const i = k < OP_PTS ? k : k < 2 * OP_PTS ? OP_PTS + (k - OP_PTS) : 2 * OP_PTS + (k - 2 * OP_PTS);
            return [opScreen[i * 2], opScreen[i * 2 + 1]];
          }),
        );
        if (hull.length > 2) {
          ctx!.beginPath();
          ctx!.moveTo(hull[0][0], hull[0][1]);
          for (let i = 1; i < hull.length; i++) ctx!.lineTo(hull[i][0], hull[i][1]);
          ctx!.closePath();
          ctx!.fillStyle = tones[0];
          ctx!.fill();
        }

        opBuckets.forEach((faces, t) => {
          if (!faces.length) return;
          ctx!.beginPath();
          for (const f of faces) {
            const b = (f / OP_PTS) | 0;
            const j = f % OP_PTS;
            const j1 = (j + 1) % OP_PTS;
            ctx!.moveTo(opScreen[(b * OP_PTS + j) * 2], opScreen[(b * OP_PTS + j) * 2 + 1]);
            ctx!.lineTo(opScreen[(b * OP_PTS + j1) * 2], opScreen[(b * OP_PTS + j1) * 2 + 1]);
            if (b === OP_BANDS - 1) {
              ctx!.lineTo(lc[5][0], lc[5][1]);
            } else {
              ctx!.lineTo(opScreen[((b + 1) * OP_PTS + j1) * 2], opScreen[((b + 1) * OP_PTS + j1) * 2 + 1]);
              ctx!.lineTo(opScreen[((b + 1) * OP_PTS + j) * 2], opScreen[((b + 1) * OP_PTS + j) * 2 + 1]);
            }
            ctx!.closePath();
          }
          ctx!.fillStyle = tones[t];
          ctx!.fill();
        });

        // Spine clusters every few inches down each rib, close up only —
        // a speckled line, not a row of dots.
        const rPx = Math.hypot(jx0, jx1) * st.r;
        if (rPx > 7) {
          const dot = Math.max(ftPx(st.axis[0], st.axis[2], 0.07), 0.8);
          const n = Math.max(2, Math.round((st.axis[7] - st.axis[1]) / 0.3));
          ctx!.beginPath();
          for (let j = 0; j < OP_PTS; j += 2) {
            const jl = (j + OP_PTS - 1) % OP_PTS;
            if (opSeen[j] <= 0 && opSeen[jl] <= 0) continue;
            const ax = opScreen[j * 2];
            const ay = opScreen[j * 2 + 1];
            const bx = opScreen[(2 * OP_PTS + j) * 2];
            const by = opScreen[(2 * OP_PTS + j) * 2 + 1];
            for (let k = 0; k < n; k++) {
              // Each a little off its spacing, by a hash of rib and place.
              const t = (k + 0.5 + 0.35 * Math.sin(k * 12.9898 + j * 78.233)) / n;
              ctx!.rect(ax + (bx - ax) * t - dot / 2, ay + (by - ay) * t - dot / 2, dot, dot);
            }
          }
          ctx!.fillStyle = sel ? ORGAN_PIPE_GOLD.spines : ORGAN_PIPE_COLOURS.spines;
          ctx!.fill();
        }
      }
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the trees are.
    const toothpickGrown = new Map<string, ToothpickPlant>();
    // Scratch for one limb's projected points, reused limb to limb.
    const tpScreen = new Float32Array(8 * TP_PTS * 2);
    const tpSeen = new Float32Array(8 * TP_PTS);
    const tpBuckets: number[][] = Array.from({ length: TP_LEVELS }, () => []);

    /** Argentine toothpick, after the app's model.
     *
     *  One trunk nearly the whole height and two arms — the lower out of it
     *  a quarter of the way up, dipping before it turns up, the higher
     *  reaching less far and rising further — each a column of eight
     *  rounded ribs in a light olive green, every rib bristling with the
     *  long tan spines the plant is named for, and a reddish crown of
     *  them at every tip.
     *
     *  Drawn piece by piece, far first — the trunk, and each arm as its
     *  elbow and its upright, each straight enough never to hide part of
     *  itself: the faces turned toward the eye a tone at a time, then,
     *  close enough to see them, the spines out of every rib that shows,
     *  and the crowns. Grown once and cached; each ring placed by its
     *  limb's projection.
     */
    function drawToothpickBody(
      x: number,
      z: number,
      h: number,
      rot: number,
      seed: string,
      sel: boolean,
      lw: number,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rot}`;
      let grown = toothpickGrown.get(key);
      if (!grown) {
        if (toothpickGrown.size > 400) toothpickGrown.clear(); // growth and edits mint new keys
        grown = growToothpick(x, z, h, rot);
        toothpickGrown.set(key, grown);
      }
      const pal = sel ? TOOTHPICK_GOLD : TOOTHPICK_COLOURS;
      const tones = TP_TONES[sel ? 1 : 0];

      const pieces: { li: number; from: number; to: number; d: number }[] = [];
      grown.limbs.forEach((lb, li) => {
        for (const [from, to] of lb.pieces) {
          const k = Math.min(lb.rings - 1, (from + to) >> 1);
          pieces.push({ li, from, to, d: P(lb.c[k * 3], lb.c[k * 3 + 1], lb.c[k * 3 + 2])[2] });
        }
      });
      pieces.sort((a, b) => b.d - a.d);
      ctx!.lineCap = "round";
      let projected = -1;
      let lc: [number, number, number][] = [];
      let J = [0, 0, 0, 0, 0, 0];
      for (const { li, from, to } of pieces) {
        const lb = grown.limbs[li];
        if (projected !== li) {
          // The limb's rings, projected once for both its pieces.
          lc = [];
          for (let k = 0; k <= lb.rings; k++) lc.push(P(lb.c[k * 3], lb.c[k * 3 + 1], lb.c[k * 3 + 2]));
          const q = lc[0];
          const qx = P(lb.c[0] + 1, lb.c[1], lb.c[2]);
          const qy = P(lb.c[0], lb.c[1] + 1, lb.c[2]);
          const qz = P(lb.c[0], lb.c[1], lb.c[2] + 1);
          J = [qx[0] - q[0], qx[1] - q[1], qy[0] - q[0], qy[1] - q[1], qz[0] - q[0], qz[1] - q[1]];
          for (let k = 0; k < lb.rings; k++) {
            for (let j = 0; j < TP_PTS; j++) {
              const i = k * TP_PTS + j;
              const ox = lb.o[i * 3];
              const oy = lb.o[i * 3 + 1];
              const oz = lb.o[i * 3 + 2];
              tpScreen[i * 2] = lc[k][0] + J[0] * ox + J[2] * oy + J[4] * oz;
              tpScreen[i * 2 + 1] = lc[k][1] + J[1] * ox + J[3] * oy + J[5] * oz;
            }
          }
          const mid = Math.min(lb.rings - 1, lb.rings >> 1);
          let vx = eye[0] - lb.c[mid * 3];
          let vy = eye[1] - lb.c[mid * 3 + 1];
          let vz = eye[2] - lb.c[mid * 3 + 2];
          const vl = Math.hypot(vx, vy, vz) || 1;
          vx /= vl;
          vy /= vl;
          vz /= vl;
          for (let f = 0; f < lb.rings * TP_PTS; f++) {
            tpSeen[f] = lb.faceN[f * 3] * vx + lb.faceN[f * 3 + 1] * vy + lb.faceN[f * 3 + 2] * vz;
          }
          projected = li;
        }

        for (const bucket of tpBuckets) bucket.length = 0;
        for (let f = from * TP_PTS; f < to * TP_PTS; f++) if (tpSeen[f] > 0) tpBuckets[lb.faceTone[f]].push(f);
        tpBuckets.forEach((faces, t) => {
          if (!faces.length) return;
          ctx!.beginPath();
          for (const f of faces) {
            const b = (f / TP_PTS) | 0;
            const j = f % TP_PTS;
            const j1 = (j + 1) % TP_PTS;
            ctx!.moveTo(tpScreen[(b * TP_PTS + j) * 2], tpScreen[(b * TP_PTS + j) * 2 + 1]);
            ctx!.lineTo(tpScreen[(b * TP_PTS + j1) * 2], tpScreen[(b * TP_PTS + j1) * 2 + 1]);
            if (b === lb.rings - 1) {
              ctx!.lineTo(lc[lb.rings][0], lc[lb.rings][1]);
            } else {
              ctx!.lineTo(tpScreen[((b + 1) * TP_PTS + j1) * 2], tpScreen[((b + 1) * TP_PTS + j1) * 2 + 1]);
              ctx!.lineTo(tpScreen[((b + 1) * TP_PTS + j) * 2], tpScreen[((b + 1) * TP_PTS + j) * 2 + 1]);
            }
            ctx!.closePath();
          }
          ctx!.fillStyle = tones[t];
          ctx!.fill();
        });

        // The spines, close enough to see them: three out of each areole,
        // every few inches down every rib that shows — one straight out,
        // one tipped toward the limb's end, one across — a small star.
        const rPx = Math.hypot(J[0], J[1]) * lb.r;
        const spine = 0.22;
        const sx = (vx: number, vy: number, vz: number) => J[0] * vx + J[2] * vy + J[4] * vz;
        const sy = (vx: number, vy: number, vz: number) => J[1] * vx + J[3] * vy + J[5] * vz;
        if (rPx > 3.5) {
          ctx!.beginPath();
          for (let b = from; b < Math.min(to, lb.shaft - 1); b++) {
            const tx = lb.c[(b + 1) * 3] - lb.c[b * 3];
            const ty = lb.c[(b + 1) * 3 + 1] - lb.c[b * 3 + 1];
            const tz = lb.c[(b + 1) * 3 + 2] - lb.c[b * 3 + 2];
            const len = Math.hypot(tx, ty, tz) || 1;
            const n = Math.max(1, Math.round(len / 0.3));
            for (let j = 0; j < TP_PTS; j += 2) {
              if (tpSeen[b * TP_PTS + j] <= 0 && tpSeen[b * TP_PTS + ((j + TP_PTS - 1) % TP_PTS)] <= 0) continue;
              const i0 = b * TP_PTS + j;
              const i1 = (b + 1) * TP_PTS + j;
              const ol = Math.hypot(lb.o[i0 * 3], lb.o[i0 * 3 + 1], lb.o[i0 * 3 + 2]) || 1;
              const nx = lb.o[i0 * 3] / ol;
              const ny = lb.o[i0 * 3 + 1] / ol;
              const nz = lb.o[i0 * 3 + 2] / ol;
              const ax = sx(nx * spine, ny * spine, nz * spine);
              const ay = sy(nx * spine, ny * spine, nz * spine);
              const k1 = (spine * 0.8) / len;
              const bx = sx(nx * spine * 0.6 + tx * k1, ny * spine * 0.6 + ty * k1, nz * spine * 0.6 + tz * k1);
              const by = sy(nx * spine * 0.6 + tx * k1, ny * spine * 0.6 + ty * k1, nz * spine * 0.6 + tz * k1);
              // Across: round the limb, the next crest's way.
              const i2 = b * TP_PTS + ((j + 2) % TP_PTS);
              const wx = (lb.o[i2 * 3] - lb.o[i0 * 3]) / ol;
              const wy = (lb.o[i2 * 3 + 1] - lb.o[i0 * 3 + 1]) / ol;
              const wz = (lb.o[i2 * 3 + 2] - lb.o[i0 * 3 + 2]) / ol;
              const cx = sx((nx * 0.6 + wx * 0.7) * spine, (ny * 0.6 + wy * 0.7) * spine, (nz * 0.6 + wz * 0.7) * spine);
              const cy = sy((nx * 0.6 + wx * 0.7) * spine, (ny * 0.6 + wy * 0.7) * spine, (nz * 0.6 + wz * 0.7) * spine);
              for (let k = 0; k < n; k++) {
                const t = (k + (j % 4 ? 0.75 : 0.25)) / n;
                const px = tpScreen[i0 * 2] + (tpScreen[i1 * 2] - tpScreen[i0 * 2]) * t;
                const py = tpScreen[i0 * 2 + 1] + (tpScreen[i1 * 2 + 1] - tpScreen[i0 * 2 + 1]) * t;
                ctx!.moveTo(px, py);
                ctx!.lineTo(px + ax, py + ay);
                ctx!.moveTo(px, py);
                ctx!.lineTo(px + bx, py + by);
                ctx!.moveTo(px, py);
                ctx!.lineTo(px + cx, py + cy);
              }
            }
          }
          ctx!.strokeStyle = pal.spine;
          ctx!.lineWidth = Math.max(ftPx(x, z, 0.02), 0.6);
          ctx!.stroke();
        }
        // The crown of spines at the tip.
        if (to === lb.rings && rPx > 2) {
          const [ax, ay, az] = lb.tip;
          const apex = lc[lb.rings];
          ctx!.beginPath();
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2;
            // Splayed round the tip's line, out of its plane and across it.
            const qx = ay * Math.cos(a);
            const qy = -ax * Math.cos(a);
            const qz = Math.sin(a);
            const dx = (ax * 0.8 + qx * 0.7) * spine;
            const dy = (ay * 0.8 + qy * 0.7) * spine;
            const dz = (az * 0.8 + qz * 0.7) * spine;
            ctx!.moveTo(apex[0], apex[1]);
            ctx!.lineTo(apex[0] + sx(dx, dy, dz), apex[1] + sy(dx, dy, dz));
          }
          ctx!.strokeStyle = pal.tuft;
          ctx!.lineWidth = Math.max(ftPx(x, z, 0.025), 0.7);
          ctx!.stroke();
        }
      }
      ctx!.lineCap = "butt";
      ctx!.lineWidth = lw;
    }

    // Grown once per plant and kept, as the trees are.
    const totemGrown = new Map<string, TotemPlant>();
    // Scratch, reused plant to plant: each knob's place on screen, depth,
    // and the order they're drawn in.
    const ttScreen = new Float32Array(TT_N * 2);
    const ttDepth = new Float32Array(TT_N);
    const ttOrder: number[] = [];

    /** Totem pole cactus, after the app's model.
     *
     *  One young stem and not a spine on it: a leaning column of rounded
     *  knobs on five rough ribs, stacked like drips of wax, each swelling
     *  out at its foot over the one below — and on top, five lobes lying
     *  out over the shoulder in a star, round a small dome. The scan's pale
     *  yellow-sage, the creases between the knobs deep olive.
     *
     *  Drawn as the column's core, dark, then every knob on the near side,
     *  far first: an ellipsoid through the local map is an ellipse, so each
     *  is the shadow it casts just below it, itself in one tone, and — big
     *  enough to see it — a lit shoulder. Grown once and cached.
     */
    function drawTotemBody(x: number, z: number, h: number, rot: number, sel: boolean) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = totemGrown.get(key);
      if (!grown) {
        if (totemGrown.size > 400) totemGrown.clear(); // growth and edits mint new keys
        grown = growTotem(x, z, h, rot);
        totemGrown.set(key, grown);
      }
      const { core, k, out, top, tone, lift } = grown;
      const pal = sel ? TOTEM_GOLD : TOTEM_COLOURS;
      const tones = TT_TONES[sel ? 1 : 0];

      // The local map from feet to pixels, at half height: a stem this
      // small doesn't bend it.
      const m = P(x, h * 0.5, z);
      const mx = P(x + 1, h * 0.5, z);
      const my = P(x, h * 0.5 + 1, z);
      const mz = P(x, h * 0.5, z + 1);
      const J0 = mx[0] - m[0];
      const J1 = mx[1] - m[1];
      const J2 = my[0] - m[0];
      const J3 = my[1] - m[1];
      const J4 = mz[0] - m[0];
      const J5 = mz[1] - m[1];
      const hPx = Math.hypot(J2, J3) * h;

      // The core, filled dark: what shows in the creases.
      const hullPts: [number, number][] = [];
      for (let i = 0; i < 4; i++) {
        const q = P(core[i * 4], core[i * 4 + 1], core[i * 4 + 2]);
        const r = core[i * 4 + 3];
        for (let j = 0; j < 12; j++) {
          const ox = Math.cos((j * Math.PI) / 6) * r;
          const oz = Math.sin((j * Math.PI) / 6) * r;
          hullPts.push([q[0] + J0 * ox + J4 * oz, q[1] + J1 * ox + J5 * oz]);
        }
      }
      const apex = P(core[16], core[17], core[18]);
      hullPts.push([apex[0], apex[1]]);
      const hull = convexHull(hullPts);
      if (hull.length > 2) {
        ctx!.beginPath();
        ctx!.moveTo(hull[0][0], hull[0][1]);
        for (let i = 1; i < hull.length; i++) ctx!.lineTo(hull[i][0], hull[i][1]);
        ctx!.closePath();
        ctx!.fillStyle = pal.crease;
        ctx!.fill();
      }

      // The knobs that face the eye, and those just round the edge that
      // make its lumpy outline.
      ttOrder.length = 0;
      for (let i = 0; i < TT_N; i++) {
        const cx = k[i * 12];
        const cy = k[i * 12 + 1];
        const cz = k[i * 12 + 2];
        if (!top[i]) {
          const vx = eye[0] - cx;
          const vz = eye[2] - cz;
          const vl = Math.hypot(vx, eye[1] - cy, vz) || 1;
          if ((out[i * 2] * vx + out[i * 2 + 1] * vz) / vl < -0.25) continue;
        }
        const q = P(cx, cy, cz);
        ttScreen[i * 2] = q[0];
        ttScreen[i * 2 + 1] = q[1];
        ttDepth[i] = q[2];
        ttOrder.push(i);
      }
      ttOrder.sort((a, b) => ttDepth[b] - ttDepth[a]);

      const layers = hPx > 70 ? 3 : hPx > 24 ? 2 : 1;
      let cur = -1;
      const blob = (cx: number, cy: number, rx: number, ry: number, ang: number, t: number) => {
        if (t !== cur) {
          ctx!.fillStyle = tones[t];
          cur = t;
        }
        ctx!.beginPath();
        ctx!.ellipse(cx, cy, rx, ry, ang, 0, Math.PI * 2);
        ctx!.fill();
      };
      for (const i of ttOrder) {
        const b = i * 12 + 3;
        // An ellipsoid through the local (affine) map is an ellipse.
        const ax0 = J0 * k[b] + J2 * k[b + 1] + J4 * k[b + 2];
        const ax1 = J0 * k[b + 3] + J2 * k[b + 4] + J4 * k[b + 5];
        const ax2 = J0 * k[b + 6] + J2 * k[b + 7] + J4 * k[b + 8];
        const ay0 = J1 * k[b] + J3 * k[b + 1] + J5 * k[b + 2];
        const ay1 = J1 * k[b + 3] + J3 * k[b + 4] + J5 * k[b + 5];
        const ay2 = J1 * k[b + 6] + J3 * k[b + 7] + J5 * k[b + 8];
        const c11 = ax0 * ax0 + ax1 * ax1 + ax2 * ax2;
        const c22 = ay0 * ay0 + ay1 * ay1 + ay2 * ay2;
        const c12 = ax0 * ay0 + ax1 * ay1 + ax2 * ay2;
        const mid = (c11 + c22) / 2;
        const d = Math.sqrt(Math.max(0, mid * mid - (c11 * c22 - c12 * c12)));
        const rx = Math.sqrt(mid + d);
        const ry = Math.sqrt(Math.max(0, mid - d));
        const ang = 0.5 * Math.atan2(2 * c12, c11 - c22);
        const sx = ttScreen[i * 2];
        const sy = ttScreen[i * 2 + 1];
        if (layers === 1) {
          blob(sx, sy, rx, ry, ang, tone[i * 2]);
          continue;
        }
        // The shadow it casts on the knob below, just under its foot (the
        // dome, last, casts none); then the knob, one tone, so knobs facing
        // the same way run together as the scan's do; then, near enough, a
        // soft shoulder of light.
        if (i < TT_N - 1) {
          if (cur !== -2) {
            ctx!.fillStyle = pal.crease;
            cur = -2;
          }
          const drop = Math.max(Math.abs(k[b + 4]) * 0.3, Math.abs(k[b + 7]) * 0.8);
          ctx!.beginPath();
          ctx!.ellipse(sx - J2 * drop, sy - J3 * drop, rx * 0.9, ry * 0.9, ang, 0, Math.PI * 2);
          ctx!.fill();
        }
        blob(sx, sy, rx, ry, ang, tone[i * 2]);
        if (layers === 3) {
          const lx = J0 * lift[i * 3] + J2 * lift[i * 3 + 1] + J4 * lift[i * 3 + 2];
          const ly = J1 * lift[i * 3] + J3 * lift[i * 3 + 1] + J5 * lift[i * 3 + 2];
          blob(sx + lx * 0.32, sy + ly * 0.32, rx * 0.62, ry * 0.62, ang, tone[i * 2 + 1]);
        }
      }
    }

    const madagascarGrown = new Map<string, MadagascarPlant>();
    // Scratch, reused plant to plant.
    const mpScreen = new Float32Array(MP_RINGS.length * MP_SIDES * 2);
    const mpBuckets: number[][] = Array.from({ length: MP_LEVELS }, () => []);
    const mpOrder: number[] = [];
    const mpDepth = new Float32Array(MP_LEAVES + 2);

    /** Madagascar palm, after the app's model.
     *
     *  No palm at all: a thick grey-brown trunk, tapering and leaning a
     *  little, studded with pale spines, and on top a shaggy fountain of
     *  long strap leaves — the youngest standing up out of the middle, the
     *  rest arching out and drooping at their tips, the oldest hanging down
     *  the trunk. Yellow-green on top with a pale midrib, duller beneath.
     *
     *  The trunk, the dark heart of the crown and every leaf are drawn far
     *  to near, so a hanging leaf behind the trunk stays behind it. The
     *  trunk is a ring of shaded faces with, close up, its spines; a leaf
     *  is a twisted ribbon in one tone — its upper face's or its under
     *  face's, whichever shows — and, big enough to see, its midrib.
     *  Grown once and cached; the leaves placed by the local map at the
     *  crown, which a plant this size doesn't bend.
     */
    function drawMadagascarBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = madagascarGrown.get(key);
      if (!grown) {
        if (madagascarGrown.size > 400) madagascarGrown.clear(); // growth and edits mint new keys
        grown = growMadagascar(x, z, h, rot);
        madagascarGrown.set(key, grown);
      }
      const { axis, ring, faceN, faceTone, spines, heart, leaf, mid, leafN, leafTone } = grown;
      const pal = sel ? MADAGASCAR_GOLD : MADAGASCAR_COLOURS;
      const tones = MP_TONES[sel ? 1 : 0];
      const NR = MP_RINGS.length;

      // The local map at the heart: screen x, y and depth per foot.
      const q = P(heart[0], heart[1], heart[2]);
      const qx = P(heart[0] + 1, heart[1], heart[2]);
      const qy = P(heart[0], heart[1] + 1, heart[2]);
      const qz = P(heart[0], heart[1], heart[2] + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const footPx = Math.hypot(J[1], J[4]);

      // Far to near: each leaf by its middle, the trunk by its own, the
      // heart by its.
      mpOrder.length = 0;
      for (let i = 0; i < MP_LEAVES; i++) {
        const dx = mid[i * 3] - heart[0];
        const dy = mid[i * 3 + 1] - heart[1];
        const dz = mid[i * 3 + 2] - heart[2];
        mpDepth[i] = q[2] + J[6] * dx + J[7] * dy + J[8] * dz;
        mpOrder.push(i);
      }
      mpDepth[MP_LEAVES] = P(axis[3], axis[4], axis[5])[2];
      mpOrder.push(MP_LEAVES);
      mpDepth[MP_LEAVES + 1] = q[2];
      mpOrder.push(MP_LEAVES + 1);
      mpOrder.sort((a, b) => mpDepth[b] - mpDepth[a]);

      const midribs = footPx * h > 90;
      const sxOf = (px: number, py: number, pz: number) =>
        q[0] + J[0] * (px - heart[0]) + J[1] * (py - heart[1]) + J[2] * (pz - heart[2]);
      const syOf = (px: number, py: number, pz: number) =>
        q[1] + J[3] * (px - heart[0]) + J[4] * (py - heart[1]) + J[5] * (pz - heart[2]);

      for (const it of mpOrder) {
        if (it === MP_LEAVES) {
          // The trunk: its outline dark, then each face toward the eye.
          const lc: [number, number, number][] = [];
          for (let l = 0; l < NR; l++) lc.push(P(axis[l * 3], axis[l * 3 + 1], axis[l * 3 + 2]));
          const jx0 = qx[0] - q[0];
          const jx1 = qx[1] - q[1];
          const jz0 = qz[0] - q[0];
          const jz1 = qz[1] - q[1];
          for (let l = 0; l < NR; l++) {
            for (let j = 0; j < MP_SIDES; j++) {
              const k2 = (l * MP_SIDES + j) * 2;
              mpScreen[k2] = lc[l][0] + jx0 * ring[k2] + jz0 * ring[k2 + 1];
              mpScreen[k2 + 1] = lc[l][1] + jx1 * ring[k2] + jz1 * ring[k2 + 1];
            }
          }
          const hull = convexHull(Array.from({ length: NR * MP_SIDES }, (_, k): [number, number] => [mpScreen[k * 2], mpScreen[k * 2 + 1]]));
          if (hull.length > 2) {
            ctx!.beginPath();
            ctx!.moveTo(hull[0][0], hull[0][1]);
            for (let k = 1; k < hull.length; k++) ctx!.lineTo(hull[k][0], hull[k][1]);
            ctx!.closePath();
            ctx!.fillStyle = tones[2 * MP_LEVELS];
            ctx!.fill();
          }
          let vx = eye[0] - axis[6];
          let vy = eye[1] - axis[7];
          let vz = eye[2] - axis[8];
          const vl = Math.hypot(vx, vy, vz) || 1;
          vx /= vl;
          vy /= vl;
          vz /= vl;
          for (const bucket of mpBuckets) bucket.length = 0;
          for (let f = 0; f < (NR - 1) * MP_SIDES; f++) {
            if (faceN[f * 3] * vx + faceN[f * 3 + 1] * vy + faceN[f * 3 + 2] * vz > 0) mpBuckets[faceTone[f]].push(f);
          }
          mpBuckets.forEach((faces, t) => {
            if (!faces.length) return;
            ctx!.beginPath();
            for (const f of faces) {
              const b = (f / MP_SIDES) | 0;
              const j = f % MP_SIDES;
              const j1 = (j + 1) % MP_SIDES;
              ctx!.moveTo(mpScreen[(b * MP_SIDES + j) * 2], mpScreen[(b * MP_SIDES + j) * 2 + 1]);
              ctx!.lineTo(mpScreen[(b * MP_SIDES + j1) * 2], mpScreen[(b * MP_SIDES + j1) * 2 + 1]);
              ctx!.lineTo(mpScreen[((b + 1) * MP_SIDES + j1) * 2], mpScreen[((b + 1) * MP_SIDES + j1) * 2 + 1]);
              ctx!.lineTo(mpScreen[((b + 1) * MP_SIDES + j) * 2], mpScreen[((b + 1) * MP_SIDES + j) * 2 + 1]);
              ctx!.closePath();
            }
            ctx!.fillStyle = tones[2 * MP_LEVELS + t];
            ctx!.fill();
          });
          // Spines, close up: short pale points on the side toward the eye.
          if (footPx * 0.05 * h > 4) {
            const len = 0.014 * h;
            ctx!.beginPath();
            for (let i = 0; i < MP_SPINES; i++) {
              const o = i * 6;
              if (spines[o + 3] * vx + spines[o + 5] * vz < 0.1) continue;
              const a = P(spines[o], spines[o + 1], spines[o + 2]);
              ctx!.moveTo(a[0], a[1]);
              ctx!.lineTo(
                a[0] + (J[0] * spines[o + 3] + J[1] * spines[o + 4] + J[2] * spines[o + 5]) * len,
                a[1] + (J[3] * spines[o + 3] + J[4] * spines[o + 4] + J[5] * spines[o + 5]) * len,
              );
            }
            ctx!.strokeStyle = pal.spine;
            ctx!.lineWidth = Math.max(footPx * 0.005 * h, 0.6);
            ctx!.stroke();
          }
        } else if (it === MP_LEAVES + 1) {
          // The heart, where the leaf bases crowd: dark.
          const r = 0.07 * h;
          ctx!.beginPath();
          ctx!.ellipse(q[0], q[1], Math.hypot(J[0], J[3]) * r, Math.hypot(J[1], J[4]) * r * 1.6, 0, 0, Math.PI * 2);
          ctx!.fillStyle = pal.heart;
          ctx!.fill();
        } else {
          const i = it;
          const o0 = i * MP_PTS * 6;
          // Which face shows: up off the leaf, toward the eye or away.
          const up =
            leafN[i * 3] * (eye[0] - mid[i * 3]) +
              leafN[i * 3 + 1] * (eye[1] - mid[i * 3 + 1]) +
              leafN[i * 3 + 2] * (eye[2] - mid[i * 3 + 2]) >
            0;
          ctx!.beginPath();
          for (let j = 0; j < MP_PTS; j++) {
            const o = o0 + j * 6;
            const cx = sxOf(leaf[o], leaf[o + 1], leaf[o + 2]);
            const cy = syOf(leaf[o], leaf[o + 1], leaf[o + 2]);
            const wx = J[0] * leaf[o + 3] + J[1] * leaf[o + 4] + J[2] * leaf[o + 5];
            const wy = J[3] * leaf[o + 3] + J[4] * leaf[o + 4] + J[5] * leaf[o + 5];
            if (j === 0) ctx!.moveTo(cx + wx, cy + wy);
            else ctx!.lineTo(cx + wx, cy + wy);
          }
          for (let j = MP_PTS - 1; j >= 0; j--) {
            const o = o0 + j * 6;
            const cx = sxOf(leaf[o], leaf[o + 1], leaf[o + 2]);
            const cy = syOf(leaf[o], leaf[o + 1], leaf[o + 2]);
            const wx = J[0] * leaf[o + 3] + J[1] * leaf[o + 4] + J[2] * leaf[o + 5];
            const wy = J[3] * leaf[o + 3] + J[4] * leaf[o + 4] + J[5] * leaf[o + 5];
            ctx!.lineTo(cx - wx, cy - wy);
          }
          ctx!.closePath();
          ctx!.fillStyle = tones[leafTone[i * 2 + (up ? 0 : 1)]];
          ctx!.fill();
          if (midribs && up) {
            ctx!.beginPath();
            for (let j = 1; j < MP_PTS - 1; j++) {
              const o = o0 + j * 6;
              const cx = sxOf(leaf[o], leaf[o + 1], leaf[o + 2]);
              const cy = syOf(leaf[o], leaf[o + 1], leaf[o + 2]);
              if (j === 1) ctx!.moveTo(cx, cy);
              else ctx!.lineTo(cx, cy);
            }
            ctx!.strokeStyle = pal.midrib;
            ctx!.lineWidth = Math.max(footPx * 0.004 * h, 0.6);
            ctx!.stroke();
          }
        }
      }
      ctx!.lineWidth = lw;
    }

    const firestickGrown = new Map<string, Float32Array>();
    // Scratch: each stick's ends on screen, and each batch's sticks.
    const fsScreen = new Float32Array(FS_N * 4);
    const fsBuckets: number[][] = Array.from({ length: FS_BATCHES * 2 }, () => []);

    /** Firestick, after the app's model.
     *
     *  Pencil sticks and nothing else: a pale leader up the middle; low
     *  down, branches spreading wide and forking and forking again, each
     *  fork turning further up, into a coral of upturned sticks; higher,
     *  shorter branches held upright, so the top is narrow. Straw-tan, the
     *  old wood pale, the young growth up top green — the scan's colours;
     *  it was captured before its sticks turned red.
     *
     *  Drawn as strokes, one per width, colour and side: the far side's
     *  sticks first, darker, then the near side's. Close up, every stick
     *  gets a lit stripe along it, so it reads round. Grown once and
     *  cached; placed by the local map at half height, which a plant this
     *  size doesn't bend.
     */
    function drawFirestickBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = firestickGrown.get(key);
      if (!grown) {
        if (firestickGrown.size > 400) firestickGrown.clear(); // growth and edits mint new keys
        grown = growFirestick(x, z, h, rot);
        firestickGrown.set(key, grown);
      }
      const tones = FS_TONES[sel ? 1 : 0];

      const cy = h * 0.5;
      const q = P(x, cy, z);
      const qx = P(x + 1, cy, z);
      const qy = P(x, cy + 1, z);
      const qz = P(x, cy, z + 1);
      const J0 = qx[0] - q[0];
      const J1 = qy[0] - q[0];
      const J2 = qz[0] - q[0];
      const J3 = qx[1] - q[1];
      const J4 = qy[1] - q[1];
      const J5 = qz[1] - q[1];
      // Toward the eye across the ground, to tell the near side.
      const ex = eye[0] - x;
      const ez = eye[2] - z;

      for (const b of fsBuckets) b.length = 0;
      for (let i = 0; i < FS_N; i++) {
        const o = i * 6;
        for (let e = 0; e < 2; e++) {
          const dx = grown[o + e * 3] - x;
          const dy = grown[o + e * 3 + 1] - cy;
          const dz = grown[o + e * 3 + 2] - z;
          fsScreen[i * 4 + e * 2] = q[0] + J0 * dx + J1 * dy + J2 * dz;
          fsScreen[i * 4 + e * 2 + 1] = q[1] + J3 * dx + J4 * dy + J5 * dz;
        }
        const near = (grown[o] + grown[o + 3] - 2 * x) * ex + (grown[o + 2] + grown[o + 5] - 2 * z) * ez >= 0;
        fsBuckets[FS_BATCH[i] + (near ? FS_BATCHES : 0)].push(i);
      }

      const footPx = Math.hypot(J1, J4);
      const round = footPx * h > 150;
      ctx!.lineCap = "round";
      const pass = (side: number, tone: number, scale: number, shift: number) => {
        for (let b = 0; b < FS_BATCHES; b++) {
          const sticks = fsBuckets[b + side * FS_BATCHES];
          if (!sticks.length) continue;
          const w = Math.max(FS_WIDTHS[(b / 3) | 0] * h * footPx, 0.7);
          ctx!.beginPath();
          for (const i of sticks) {
            ctx!.moveTo(fsScreen[i * 4] - w * shift, fsScreen[i * 4 + 1] - w * shift);
            ctx!.lineTo(fsScreen[i * 4 + 2] - w * shift, fsScreen[i * 4 + 3] - w * shift);
          }
          ctx!.strokeStyle = tones[b % 3][tone];
          ctx!.lineWidth = w * scale;
          ctx!.stroke();
        }
      };
      pass(0, 0, 1, 0);
      pass(1, round ? 0 : 1, 1, 0);
      if (round) pass(1, 2, 0.45, 0.18);
      ctx!.lineCap = "butt";
      ctx!.lineWidth = lw;
    }

    const feroxGrown = new Map<string, FeroxPlant>();
    // Scratch, reused plant to plant.
    const afOrder: number[] = [];
    const afDepth = new Float32Array(AF_FACES + AF_DEAD + 1);
    const afVis = new Uint8Array(AF_FACES);
    const afDone = new Uint8Array(AF_FACES);

    /** Aloe ferox, after the app's model.
     *
     *  A big open rosette with no trunk yet: twenty-two thick, glaucous leaves,
     *  broad at the base and tapering to a point, the outer ones held out
     *  nearly flat, the middle ones longest and rising, the youngest standing
     *  up in the centre; red-brown teeth down every margin, and a skirt of
     *  dead brown leaves at the foot.
     *
     *  Each leaf is a solid, not a strap: a channelled upper face over a
     *  keeled underside, four faces each in its own tone, so from above it
     *  is a trough and from the side it has thickness. Every face toward
     *  the eye goes through one far-to-near sort with the dead leaves and the
     *  dark heart; then its margin, as a fine red-brown line, and close up
     *  its teeth. Grown once and cached; drawn through the local map at the
     *  heart, which a plant this size doesn't bend.
     */
    function drawFeroxBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = feroxGrown.get(key);
      if (!grown) {
        if (feroxGrown.size > 400) feroxGrown.clear(); // growth and edits mint new keys
        grown = growFerox(x, z, h, rot);
        feroxGrown.set(key, grown);
      }
      const { leaf, faceN, faceMid, faceTone, teeth, dead, deadMid, deadN, deadTone, core } = grown;
      const pal = sel ? FEROX_GOLD : FEROX_COLOURS;
      const tones = AF_TONES[sel ? 1 : 0];

      // The local map at the heart: screen x, y and depth per foot.
      const q = P(core[0], core[1], core[2]);
      const qx = P(core[0] + 1, core[1], core[2]);
      const qy = P(core[0], core[1] + 1, core[2]);
      const qz = P(core[0], core[1], core[2] + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const footPx = Math.hypot(J[1], J[4]);
      const sxOf = (o: Float32Array, i: number) =>
        q[0] + J[0] * (o[i] - core[0]) + J[1] * (o[i + 1] - core[1]) + J[2] * (o[i + 2] - core[2]);
      const syOf = (o: Float32Array, i: number) =>
        q[1] + J[3] * (o[i] - core[0]) + J[4] * (o[i + 1] - core[1]) + J[5] * (o[i + 2] - core[2]);
      const depthOf = (o: Float32Array, i: number) =>
        q[2] + J[6] * (o[i] - core[0]) + J[7] * (o[i + 1] - core[1]) + J[8] * (o[i + 2] - core[2]);

      // Faces toward the eye, the dead leaves and the heart, far to near.
      afOrder.length = 0;
      for (let f = 0; f < AF_FACES; f++) {
        const o = f * 3;
        const vis =
          faceN[o] * (eye[0] - faceMid[o]) + faceN[o + 1] * (eye[1] - faceMid[o + 1]) + faceN[o + 2] * (eye[2] - faceMid[o + 2]) > 0;
        afVis[f] = vis ? 1 : 0;
        afDone[f] = 0;
        if (!vis) continue;
        afDepth[f] = depthOf(faceMid, o);
        afOrder.push(f);
      }
      for (let i = 0; i < AF_DEAD; i++) {
        afDepth[AF_FACES + i] = depthOf(deadMid, i * 3);
        afOrder.push(AF_FACES + i);
      }
      afDepth[AF_FACES + AF_DEAD] = q[2];
      afOrder.push(AF_FACES + AF_DEAD);
      afOrder.sort((a, b) => afDepth[b] - afDepth[a]);

      const margins = footPx * h > 110;
      const toothed = footPx * h > 160;
      const marginW = Math.max(footPx * h * 0.0028, 0.6);
      for (const it of afOrder) {
        if (it < AF_FACES) {
          const i = it >> 2;
          const f = it & 3;
          const [la, lb] = AF_FACE_LINES[f];
          const base = i * AF_PTS * 12;
          ctx!.beginPath();
          for (let j = 0; j < AF_PTS; j++) {
            const o = base + j * 12 + la * 3;
            if (j === 0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
            else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          for (let j = AF_PTS - 1; j >= 0; j--) {
            const o = base + j * 12 + lb * 3;
            ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          ctx!.closePath();
          ctx!.fillStyle = tones[faceTone[it]];
          ctx!.fill();
          afDone[it] = 1;
          // The margin this face shares with its partner above or below,
          // drawn once, with whichever of the two comes last.
          const partner = it ^ 2;
          if (!margins || (afVis[partner] && !afDone[partner])) continue;
          const line = f === 0 || f === 2 ? 1 : 2;
          ctx!.beginPath();
          for (let j = 0; j < AF_PTS; j++) {
            const o = base + j * 12 + line * 3;
            if (j === 0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
            else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          ctx!.strokeStyle = pal.margin;
          ctx!.lineWidth = marginW;
          ctx!.stroke();
          if (toothed) {
            ctx!.beginPath();
            for (let k = 0; k < AF_TEETH; k++) {
              const o = ((i * 2 + line - 1) * AF_TEETH + k) * 9;
              const mx = sxOf(teeth, o);
              const my = syOf(teeth, o);
              const ox = J[0] * teeth[o + 3] + J[1] * teeth[o + 4] + J[2] * teeth[o + 5];
              const oy = J[3] * teeth[o + 3] + J[4] * teeth[o + 4] + J[5] * teeth[o + 5];
              const ax = J[0] * teeth[o + 6] + J[1] * teeth[o + 7] + J[2] * teeth[o + 8];
              const ay = J[3] * teeth[o + 6] + J[4] * teeth[o + 7] + J[5] * teeth[o + 8];
              ctx!.moveTo(mx - ax, my - ay);
              ctx!.lineTo(mx + ax, my + ay);
              ctx!.lineTo(mx + ox + ax * 0.6, my + oy + ay * 0.6);
              ctx!.closePath();
            }
            ctx!.fillStyle = pal.teeth;
            ctx!.fill();
          }
        } else if (it < AF_FACES + AF_DEAD) {
          const i = it - AF_FACES;
          const base = i * AF_DEAD_PTS * 6;
          const up =
            deadN[i * 3] * (eye[0] - deadMid[i * 3]) +
              deadN[i * 3 + 1] * (eye[1] - deadMid[i * 3 + 1]) +
              deadN[i * 3 + 2] * (eye[2] - deadMid[i * 3 + 2]) >
            0;
          ctx!.beginPath();
          for (let j = 0; j < AF_DEAD_PTS; j++) {
            const o = base + j * 6;
            const wx = J[0] * dead[o + 3] + J[1] * dead[o + 4] + J[2] * dead[o + 5];
            const wy = J[3] * dead[o + 3] + J[4] * dead[o + 4] + J[5] * dead[o + 5];
            if (j === 0) ctx!.moveTo(sxOf(dead, o) + wx, syOf(dead, o) + wy);
            else ctx!.lineTo(sxOf(dead, o) + wx, syOf(dead, o) + wy);
          }
          for (let j = AF_DEAD_PTS - 1; j >= 0; j--) {
            const o = base + j * 6;
            const wx = J[0] * dead[o + 3] + J[1] * dead[o + 4] + J[2] * dead[o + 5];
            const wy = J[3] * dead[o + 3] + J[4] * dead[o + 4] + J[5] * dead[o + 5];
            ctx!.lineTo(sxOf(dead, o) - wx, syOf(dead, o) - wy);
          }
          ctx!.closePath();
          ctx!.fillStyle = tones[deadTone[i * 2 + (up ? 0 : 1)]];
          ctx!.fill();
        } else {
          // The heart, where the leaf bases crowd: dark, so the gaps between
          // them read as depth rather than sand.
          const r = 0.13 * h;
          ctx!.beginPath();
          ctx!.ellipse(q[0], q[1], Math.hypot(J[0], J[2]) * r, Math.hypot(J[4] * 0.8, J[5]) * r, 0, 0, Math.PI * 2);
          ctx!.fillStyle = pal.core;
          ctx!.fill();
        }
      }
      ctx!.lineWidth = lw;
    }

    const tropicalAgaveGrown = new Map<string, TropicalAgavePlant>();
    // Scratch, reused plant to plant.
    const taOrder: number[] = [];
    const taDepth = new Float32Array(TA_LEAVES);
    /** Tropical agave, after the app's model.
     *
     *  A variegated agave in an open vase: forty-eight soft strap leaves
     *  out of the ground, the oldest splayed flat across it, most rising
     *  steeply and arching back at their tips, the youngest upright in the
     *  middle. Cream margins down every leaf with a green stripe between,
     *  paler green beneath.
     *
     *  Each leaf is a twisted ribbon, cream with a green stripe down it, toned
     *  by whichever face shows — drawn far to near, and
     *  close up its small dark tip spine. Grown once and cached; drawn
     *  through the local map at the heart, which a plant this size doesn't
     *  bend.
     */
    function drawTropicalAgaveBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = tropicalAgaveGrown.get(key);
      if (!grown) {
        if (tropicalAgaveGrown.size > 400) tropicalAgaveGrown.clear(); // growth and edits mint new keys
        grown = growTropicalAgave(x, z, h, rot);
        tropicalAgaveGrown.set(key, grown);
      }
      const { leaf, mid, leafN, leafTone, heart } = grown;
      const pal = sel ? TROPICAL_AGAVE_GOLD : TROPICAL_AGAVE_COLOURS;
      const tones = TA_TONES[sel ? 1 : 0];

      // The local map at the heart: screen x, y and depth per foot.
      const q = P(heart[0], heart[1], heart[2]);
      const qx = P(heart[0] + 1, heart[1], heart[2]);
      const qy = P(heart[0], heart[1] + 1, heart[2]);
      const qz = P(heart[0], heart[1], heart[2] + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const footPx = Math.hypot(J[1], J[4]);
      const sxOf = (o: number) => q[0] + J[0] * (leaf[o] - heart[0]) + J[1] * (leaf[o + 1] - heart[1]) + J[2] * (leaf[o + 2] - heart[2]);
      const syOf = (o: number) => q[1] + J[3] * (leaf[o] - heart[0]) + J[4] * (leaf[o + 1] - heart[1]) + J[5] * (leaf[o + 2] - heart[2]);

      taOrder.length = 0;
      for (let i = 0; i < TA_LEAVES; i++) {
        taDepth[i] = q[2] + J[6] * (mid[i * 3] - heart[0]) + J[7] * (mid[i * 3 + 1] - heart[1]) + J[8] * (mid[i * 3 + 2] - heart[2]);
        taOrder.push(i);
      }
      taOrder.sort((a, b) => taDepth[b] - taDepth[a]);

      // A ribbon along the leaf, its half-width scaled by `wide`.
      const ribbon = (o0: number, wide: number) => {
        ctx!.beginPath();
        for (let j = 0; j < TA_PTS; j++) {
          const o = o0 + j * 6;
          const wx = (J[0] * leaf[o + 3] + J[1] * leaf[o + 4] + J[2] * leaf[o + 5]) * wide;
          const wy = (J[3] * leaf[o + 3] + J[4] * leaf[o + 4] + J[5] * leaf[o + 5]) * wide;
          if (j === 0) ctx!.moveTo(sxOf(o) + wx, syOf(o) + wy);
          else ctx!.lineTo(sxOf(o) + wx, syOf(o) + wy);
        }
        for (let j = TA_PTS - 1; j >= 0; j--) {
          const o = o0 + j * 6;
          const wx = (J[0] * leaf[o + 3] + J[1] * leaf[o + 4] + J[2] * leaf[o + 5]) * wide;
          const wy = (J[3] * leaf[o + 3] + J[4] * leaf[o + 4] + J[5] * leaf[o + 5]) * wide;
          ctx!.lineTo(sxOf(o) - wx, syOf(o) - wy);
        }
        ctx!.closePath();
      };
      const spines = footPx * h > 250;
      for (const i of taOrder) {
        const o0 = i * TA_PTS * 6;
        const up =
          leafN[i * 3] * (eye[0] - mid[i * 3]) + leafN[i * 3 + 1] * (eye[1] - mid[i * 3 + 1]) + leafN[i * 3 + 2] * (eye[2] - mid[i * 3 + 2]) > 0;
        // The variegation shows on both faces: without it beneath, the
        // upright leaves' backs merge into one flat blob.
        const side = i * 4 + (up ? 0 : 2);
        ribbon(o0, 1);
        ctx!.fillStyle = tones[leafTone[side]];
        ctx!.fill();
        ribbon(o0, TA_STRIPE);
        ctx!.fillStyle = tones[leafTone[side + 1]];
        ctx!.fill();
        if (spines) {
          // On past the tip, along the leaf's last stretch.
          const a = o0 + (TA_PTS - 2) * 6;
          const b = o0 + (TA_PTS - 1) * 6;
          const ex = sxOf(b);
          const ey = syOf(b);
          const ux = ex - sxOf(a);
          const uy = ey - syOf(a);
          ctx!.beginPath();
          ctx!.moveTo(ex - ux * 0.15, ey - uy * 0.15);
          ctx!.lineTo(ex + ux * 0.1, ey + uy * 0.1);
          ctx!.strokeStyle = pal.spine;
          ctx!.lineWidth = Math.max(footPx * h * 0.004, 0.8);
          ctx!.lineCap = "round";
          ctx!.stroke();
          ctx!.lineCap = "butt";
        }
      }
      ctx!.lineWidth = lw;
    }

    const americanaGrown = new Map<string, AmericanaPlant>();
    // Scratch, reused plant to plant.
    const amOrder: number[] = [];
    const amDepth = new Float32Array(AM_FACES + AM_DEAD + 1);
    const amVis = new Uint8Array(AM_FACES);
    const amDone = new Uint8Array(AM_FACES);
    /** Agave americana, after the app's model.
     *
     *  A big upright rosette: twenty-four broad, thick, glaucous blue-grey leaves,
     *  folded into a V and tapering to a long dark spine, rising steeply and
     *  bending back a little at their ends; some of the old outer ones
     *  buckled partway out, gone dusty tan; dead ones brown on the ground;
     *  big hooked teeth down every margin.
     *
     *  Each leaf is a solid of four faces — the two halves of the folded
     *  upper face, light and dark, over a keeled underside — every face
     *  toward the eye in one far-to-near sort with the dead leaves and the
     *  dark heart. Then its margin, its teeth and its spine, as soon as
     *  they'd show. Grown once and cached; drawn through the local map at
     *  the heart.
     */
    function drawAmericanaBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = americanaGrown.get(key);
      if (!grown) {
        if (americanaGrown.size > 400) americanaGrown.clear(); // growth and edits mint new keys
        grown = growAmericana(x, z, h, rot);
        americanaGrown.set(key, grown);
      }
      const { leaf, faceN, faceMid, faceTone, teeth, spine, dead, deadMid, deadTone, core } = grown;
      const pal = sel ? AMERICANA_GOLD : AMERICANA_COLOURS;
      const tones = AM_TONES[sel ? 1 : 0];

      // The local map at the heart: screen x, y and depth per foot.
      const q = P(core[0], core[1], core[2]);
      const qx = P(core[0] + 1, core[1], core[2]);
      const qy = P(core[0], core[1] + 1, core[2]);
      const qz = P(core[0], core[1], core[2] + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const footPx = Math.hypot(J[1], J[4]);
      const sxOf = (o: Float32Array, i: number) =>
        q[0] + J[0] * (o[i] - core[0]) + J[1] * (o[i + 1] - core[1]) + J[2] * (o[i + 2] - core[2]);
      const syOf = (o: Float32Array, i: number) =>
        q[1] + J[3] * (o[i] - core[0]) + J[4] * (o[i + 1] - core[1]) + J[5] * (o[i + 2] - core[2]);
      const depthOf = (o: Float32Array, i: number) =>
        q[2] + J[6] * (o[i] - core[0]) + J[7] * (o[i + 1] - core[1]) + J[8] * (o[i + 2] - core[2]);

      // Faces toward the eye, the dead leaves and the heart, far to near.
      amOrder.length = 0;
      for (let f = 0; f < AM_FACES; f++) {
        const o = f * 3;
        const vis =
          faceN[o] * (eye[0] - faceMid[o]) + faceN[o + 1] * (eye[1] - faceMid[o + 1]) + faceN[o + 2] * (eye[2] - faceMid[o + 2]) > 0;
        amVis[f] = vis ? 1 : 0;
        amDone[f] = 0;
        if (!vis) continue;
        amDepth[f] = depthOf(faceMid, o);
        amOrder.push(f);
      }
      for (let i = 0; i < AM_DEAD; i++) {
        amDepth[AM_FACES + i] = depthOf(deadMid, i * 3);
        amOrder.push(AM_FACES + i);
      }
      amDepth[AM_FACES + AM_DEAD] = q[2];
      amOrder.push(AM_FACES + AM_DEAD);
      amOrder.sort((a, b) => amDepth[b] - amDepth[a]);

      const margins = footPx * h > 70;
      const toothed = footPx * h > 140;
      const marginW = Math.max(footPx * h * 0.0024, 0.6);
      for (const it of amOrder) {
        if (it < AM_FACES) {
          const i = it >> 2;
          const f = it & 3;
          const [la, lb] = AM_FACE_LINES[f];
          const base = i * AM_PTS * 12;
          ctx!.beginPath();
          for (let j = 0; j < AM_PTS; j++) {
            const o = base + j * 12 + la * 3;
            if (j === 0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
            else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          for (let j = AM_PTS - 1; j >= 0; j--) {
            const o = base + j * 12 + lb * 3;
            ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          ctx!.closePath();
          ctx!.fillStyle = tones[faceTone[it]];
          ctx!.fill();
          amDone[it] = 1;
          // The margin this face shares with its partner above or below,
          // its teeth, and — once per leaf, with the last of its faces to
          // show — the spine.
          const partner = it ^ 2;
          if (!margins || (amVis[partner] && !amDone[partner])) continue;
          const line = f === 0 || f === 2 ? 1 : 2;
          ctx!.beginPath();
          for (let j = 0; j < AM_PTS; j++) {
            const o = base + j * 12 + line * 3;
            if (j === 0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
            else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          ctx!.strokeStyle = pal.margin;
          ctx!.lineWidth = marginW;
          ctx!.stroke();
          if (toothed) {
            ctx!.beginPath();
            for (let k = 0; k < AM_TEETH; k++) {
              const o = ((i * 2 + line - 1) * AM_TEETH + k) * 9;
              const mx = sxOf(teeth, o);
              const my = syOf(teeth, o);
              const ox = J[0] * teeth[o + 3] + J[1] * teeth[o + 4] + J[2] * teeth[o + 5];
              const oy = J[3] * teeth[o + 3] + J[4] * teeth[o + 4] + J[5] * teeth[o + 5];
              const ax = J[0] * teeth[o + 6] + J[1] * teeth[o + 7] + J[2] * teeth[o + 8];
              const ay = J[3] * teeth[o + 6] + J[4] * teeth[o + 7] + J[5] * teeth[o + 8];
              ctx!.moveTo(mx - ax, my - ay);
              ctx!.lineTo(mx + ax, my + ay);
              ctx!.lineTo(mx + ox + ax * 0.8, my + oy + ay * 0.8);
              ctx!.closePath();
            }
            ctx!.fillStyle = pal.teeth;
            ctx!.fill();
          }
          let last = true;
          for (let g = 0; g < 4; g++) if (amVis[i * 4 + g] && !amDone[i * 4 + g]) last = false;
          if (last) {
            ctx!.beginPath();
            ctx!.moveTo(sxOf(spine, i * 6), syOf(spine, i * 6));
            ctx!.lineTo(sxOf(spine, i * 6 + 3), syOf(spine, i * 6 + 3));
            ctx!.strokeStyle = pal.spine;
            ctx!.lineWidth = Math.max(footPx * h * 0.006, 0.8);
            ctx!.lineCap = "round";
            ctx!.stroke();
            ctx!.lineCap = "butt";
          }
        } else if (it < AM_FACES + AM_DEAD) {
          const i = it - AM_FACES;
          const base = i * AM_DEAD_PTS * 6;
          ctx!.beginPath();
          for (let j = 0; j < AM_DEAD_PTS; j++) {
            const o = base + j * 6;
            const wx = J[0] * dead[o + 3] + J[1] * dead[o + 4] + J[2] * dead[o + 5];
            const wy = J[3] * dead[o + 3] + J[4] * dead[o + 4] + J[5] * dead[o + 5];
            if (j === 0) ctx!.moveTo(sxOf(dead, o) + wx, syOf(dead, o) + wy);
            else ctx!.lineTo(sxOf(dead, o) + wx, syOf(dead, o) + wy);
          }
          for (let j = AM_DEAD_PTS - 1; j >= 0; j--) {
            const o = base + j * 6;
            const wx = J[0] * dead[o + 3] + J[1] * dead[o + 4] + J[2] * dead[o + 5];
            const wy = J[3] * dead[o + 3] + J[4] * dead[o + 4] + J[5] * dead[o + 5];
            ctx!.lineTo(sxOf(dead, o) - wx, syOf(dead, o) - wy);
          }
          ctx!.closePath();
          ctx!.fillStyle = tones[deadTone[i * 2 + (eye[1] > deadMid[i * 3 + 1] ? 0 : 1)]];
          ctx!.fill();
        } else {
          // The heart, where the leaf bases crowd: dark.
          const r = 0.09 * h;
          ctx!.beginPath();
          ctx!.ellipse(q[0], q[1], Math.hypot(J[0], J[2]) * r, Math.hypot(J[4] * 0.8, J[5]) * r, 0, 0, Math.PI * 2);
          ctx!.fillStyle = pal.core;
          ctx!.fill();
        }
      }
      ctx!.lineWidth = lw;
    }

    const truncataGrown = new Map<string, TruncataPlant>();
    // Scratch, reused plant to plant.
    const tcDomeX = new Float32Array(TC_DOME.length / 3);
    const tcDomeY = new Float32Array(TC_DOME.length / 3);
    const tcDomeIdx: number[] = Array.from({ length: TC_DOME.length / 3 }, (_, i) => i);
    const tcHull: number[] = [];
    const tcOrder: number[] = [];
    const tcDepth = new Float32Array(TC_FACES);
    const tcVis = new Uint8Array(TC_FACES);
    const tcDone = new Uint8Array(TC_FACES);
    /** Agave truncata, the artichoke agave, after the app's model.
     *
     *  A tight, symmetrical dome of thirty-four short, broad, thick leaves of
     *  nearly one length, pale glaucous blue-grey above and creamy sage
     *  behind, cupped like spoons and overlapping like the bracts of an
     *  artichoke; each cut short to a stout red-brown spine, with fine teeth
     *  down its margins.
     *
     *  The dark inside goes down first. Each leaf is a solid of four faces —
     *  the two halves of the cupped upper face over a keeled back — cut in
     *  two along its length, so the end that stands up shows its back and
     *  the run beneath it doesn't; every face toward the eye in one
     *  far-to-near sort. Then its margin, its teeth and its spine, as soon
     *  as they'd show. Grown once and cached; drawn through the local map at
     *  the heart.
     */
    function drawTruncataBody(x: number, z: number, h: number, rot: number, sel: boolean, lw: number) {
      const key = `${x}|${z}|${h}|${rot}`;
      let grown = truncataGrown.get(key);
      if (!grown) {
        if (truncataGrown.size > 400) truncataGrown.clear(); // growth and edits mint new keys
        grown = growTruncata(x, z, h, rot);
        truncataGrown.set(key, grown);
      }
      const { leaf, faceN, faceMid, faceTone, teeth, spine, core } = grown;
      const pal = sel ? TRUNCATA_GOLD : TRUNCATA_COLOURS;
      const tones = TC_TONES[sel ? 1 : 0];

      // The local map at the heart: screen x, y and depth per foot.
      const q = P(core[0], core[1], core[2]);
      const qx = P(core[0] + 1, core[1], core[2]);
      const qy = P(core[0], core[1] + 1, core[2]);
      const qz = P(core[0], core[1], core[2] + 1);
      const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
      const footPx = Math.hypot(J[1], J[4]);
      const sxOf = (o: Float32Array, i: number) =>
        q[0] + J[0] * (o[i] - core[0]) + J[1] * (o[i + 1] - core[1]) + J[2] * (o[i + 2] - core[2]);
      const syOf = (o: Float32Array, i: number) =>
        q[1] + J[3] * (o[i] - core[0]) + J[4] * (o[i + 1] - core[1]) + J[5] * (o[i + 2] - core[2]);
      const depthOf = (o: Float32Array, i: number) =>
        q[2] + J[6] * (o[i] - core[0]) + J[7] * (o[i + 1] - core[1]) + J[8] * (o[i + 2] - core[2]);

      // The shadowed inside, packed with leaf bases, first — the outline of
      // the dome as seen, so whatever shows between the leaves is dark, as
      // it is on the plant, and never the ground.
      {
        const n = tcDomeX.length;
        for (let k = 0; k < n; k++) {
          const dx = TC_DOME[k * 3] * h;
          const dy = TC_DOME[k * 3 + 1] * h - core[1];
          const dz = TC_DOME[k * 3 + 2] * h;
          tcDomeX[k] = q[0] + J[0] * dx + J[1] * dy + J[2] * dz;
          tcDomeY[k] = q[1] + J[3] * dx + J[4] * dy + J[5] * dz;
        }
        tcDomeIdx.sort((a, b) => tcDomeX[a] - tcDomeX[b] || tcDomeY[a] - tcDomeY[b]);
        // Andrew's monotone chain: lower run, then upper.
        const cross = (o: number, a: number, b: number) =>
          (tcDomeX[a] - tcDomeX[o]) * (tcDomeY[b] - tcDomeY[o]) - (tcDomeY[a] - tcDomeY[o]) * (tcDomeX[b] - tcDomeX[o]);
        tcHull.length = 0;
        for (const k of tcDomeIdx) {
          while (tcHull.length >= 2 && cross(tcHull[tcHull.length - 2], tcHull[tcHull.length - 1], k) <= 0) tcHull.pop();
          tcHull.push(k);
        }
        const lower = tcHull.length + 1;
        for (let m = n - 2; m >= 0; m--) {
          const k = tcDomeIdx[m];
          while (tcHull.length >= lower && cross(tcHull[tcHull.length - 2], tcHull[tcHull.length - 1], k) <= 0) tcHull.pop();
          tcHull.push(k);
        }
        ctx!.beginPath();
        ctx!.moveTo(tcDomeX[tcHull[0]], tcDomeY[tcHull[0]]);
        for (let m = 1; m < tcHull.length - 1; m++) ctx!.lineTo(tcDomeX[tcHull[m]], tcDomeY[tcHull[m]]);
        ctx!.closePath();
        ctx!.fillStyle = pal.core;
        ctx!.fill();
      }

      // Faces toward the eye, far to near.
      tcOrder.length = 0;
      for (let f = 0; f < TC_FACES; f++) {
        const o = f * 3;
        const vis =
          faceN[o] * (eye[0] - faceMid[o]) + faceN[o + 1] * (eye[1] - faceMid[o + 1]) + faceN[o + 2] * (eye[2] - faceMid[o + 2]) > 0;
        tcVis[f] = vis ? 1 : 0;
        tcDone[f] = 0;
        if (!vis) continue;
        tcDepth[f] = depthOf(faceMid, o);
        tcOrder.push(f);
      }
      tcOrder.sort((a, b) => tcDepth[b] - tcDepth[a]);

      const margins = footPx * h > 60;
      const toothed = footPx * h > 130;
      const marginW = Math.max(footPx * h * 0.004, 0.6);
      for (const it of tcOrder) {
        const i = it >> 3;
        const g = (it >> 2) & 1;
        const f = it & 3;
        const [la, lb] = TC_FACE_LINES[f];
        const base = i * TC_PTS * 12;
        const j0 = g === 0 ? 0 : TC_SPLIT;
        const j1 = g === 0 ? TC_SPLIT : TC_PTS - 1;
        ctx!.beginPath();
        for (let j = j0; j <= j1; j++) {
          const o = base + j * 12 + la * 3;
          if (j === j0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
          else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
        }
        for (let j = j1; j >= j0; j--) {
          const o = base + j * 12 + lb * 3;
          ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
        }
        ctx!.closePath();
        ctx!.fillStyle = tones[faceTone[it]];
        ctx!.fill();
        tcDone[it] = 1;
        // The margin this face shares with its partner above or below,
        // its teeth, and — once per leaf, with the last of its faces to
        // show — the spine.
        const partner = it ^ 2;
        if (margins && !(tcVis[partner] && !tcDone[partner])) {
          const line = f === 0 || f === 2 ? 1 : 2;
          ctx!.beginPath();
          for (let j = j0; j <= j1; j++) {
            const o = base + j * 12 + line * 3;
            if (j === j0) ctx!.moveTo(sxOf(leaf, o), syOf(leaf, o));
            else ctx!.lineTo(sxOf(leaf, o), syOf(leaf, o));
          }
          ctx!.strokeStyle = pal.margin;
          ctx!.lineWidth = marginW;
          ctx!.stroke();
          if (toothed) {
            ctx!.beginPath();
            for (let k = 0; k < TC_TEETH; k++) {
              if (TC_MODEL.toothHalf[(i * 2 + line - 1) * TC_TEETH + k] !== g) continue;
              const o = ((i * 2 + line - 1) * TC_TEETH + k) * 9;
              const mx = sxOf(teeth, o);
              const my = syOf(teeth, o);
              const ox = J[0] * teeth[o + 3] + J[1] * teeth[o + 4] + J[2] * teeth[o + 5];
              const oy = J[3] * teeth[o + 3] + J[4] * teeth[o + 4] + J[5] * teeth[o + 5];
              const ax = J[0] * teeth[o + 6] + J[1] * teeth[o + 7] + J[2] * teeth[o + 8];
              const ay = J[3] * teeth[o + 6] + J[4] * teeth[o + 7] + J[5] * teeth[o + 8];
              ctx!.moveTo(mx - ax, my - ay);
              ctx!.lineTo(mx + ax, my + ay);
              ctx!.lineTo(mx + ox + ax * 0.8, my + oy + ay * 0.8);
              ctx!.closePath();
            }
            ctx!.fillStyle = pal.teeth;
            ctx!.fill();
          }
        }
        let last = true;
        for (let k = i * 8; k < i * 8 + 8; k++) if (tcVis[k] && !tcDone[k]) last = false;
        if (last) {
          // A thorn: broad where it leaves the leaf, to a point.
          const ax = sxOf(spine, i * 6);
          const ay = syOf(spine, i * 6);
          const bx = sxOf(spine, i * 6 + 3);
          const by = syOf(spine, i * 6 + 3);
          const l = Math.hypot(bx - ax, by - ay) || 1;
          const half = Math.max(footPx * h * 0.011, 0.6) / l;
          ctx!.beginPath();
          ctx!.moveTo(ax - (by - ay) * half - (bx - ax) * 0.25, ay + (bx - ax) * half - (by - ay) * 0.25);
          ctx!.lineTo(bx, by);
          ctx!.lineTo(ax + (by - ay) * half - (bx - ax) * 0.25, ay - (bx - ax) * half - (by - ay) * 0.25);
          ctx!.closePath();
          ctx!.fillStyle = pal.spine;
          ctx!.fill();
        }
      }
      ctx!.lineWidth = lw;
    }

    const ocotilloGrown = new Map<string, OcotilloPlant>();
    // Scratch for one cane's projected axis and depth order.
    const ocSx = new Float32Array(9);
    const ocSy = new Float32Array(9);
    const ocDepth = new Float32Array(OC_CANES.length);
    const ocOrder = new Int32Array(OC_CANES.length);

    /** Ocotillo, after the app's model: in leaf and in flower.
     *
     *  Thirty-four canes out of one woody crown, from the model, splayed as
     *  it is to the species' spread: pale grey whips tapering to the tip,
     *  sleeved their whole length in small bright leaves standing out from
     *  the bark, eight of them ending in a spike of red tubes. A few short
     *  young canes among the tall ones.
     *
     *  Each cane is a dark sleeve, the leaves behind it, the tapered bark,
     *  then the leaves in front and its flowers, canes far to near. Its axis
     *  is projected exactly; its leaves through a local map at the cane.
     *  Far off, where a leaf is under a pixel or two, the sleeve and the bark
     *  carry it. Grown once and cached.
     */
    function drawOcotilloBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = ocotilloGrown.get(key);
      if (!grown) {
        if (ocotilloGrown.size > 400) ocotilloGrown.clear(); // growth and edits mint new keys
        grown = growOcotillo(x, z, h, rw, rot, seed);
        ocotilloGrown.set(key, grown);
      }
      const pal = sel ? OCOTILLO_GOLD : OCOTILLO_COLOURS;
      const { canes, leafLen, tube } = grown;

      // The crown: the one woody knot the canes come out of, a ring on the
      // ground a little wider than the canes' feet.
      ctx!.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const q = P(x + Math.cos(a) * rw * 0.07, 0, z + Math.sin(a) * rw * 0.07);
        if (i) ctx!.lineTo(q[0], q[1]);
        else ctx!.moveTo(q[0], q[1]);
      }
      ctx!.fillStyle = pal.crown;
      ctx!.fill();

      for (let k = 0; k < canes.length; k++) {
        const a = canes[k].ax;
        ocDepth[k] = P(a[12], a[13], a[14])[2];
        ocOrder[k] = k;
      }
      ocOrder.sort((p, q) => ocDepth[q] - ocDepth[p]);

      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      for (const k of ocOrder) {
        const cane = canes[k];
        const { ax, r, leaves, flowers } = cane;
        for (let i = 0; i < 9; i++) {
          const q = P(ax[i * 3], ax[i * 3 + 1], ax[i * 3 + 2]);
          ocSx[i] = q[0];
          ocSy[i] = q[1];
        }
        // The local map at the cane's middle, for what hangs off the axis.
        const mx = ax[12];
        const my = ax[13];
        const mz = ax[14];
        const q = P(mx, my, mz);
        const qx = P(mx + 1, my, mz);
        const qy = P(mx, my + 1, mz);
        const qz = P(mx, my, mz + 1);
        const J = [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2]];
        const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]), Math.hypot(J[1], J[4]));
        const leafPx = leafLen * footPx;

        const axisPath = () => {
          ctx!.beginPath();
          ctx!.moveTo(ocSx[0], ocSy[0]);
          for (let i = 1; i < 9; i++) ctx!.lineTo(ocSx[i], ocSy[i]);
        };
        // Far off, where a leaf is a pixel or two, a band of green carries
        // them; nearer, a narrower shadow among them.
        const show = leafPx >= 1.5;
        if (leafPx < 4) {
          axisPath();
          ctx!.lineCap = "butt";
          ctx!.lineWidth = Math.max(1, (r[4] * 2 + leafLen * 1.2) * footPx * (show ? 0.6 : 1));
          ctx!.strokeStyle = show ? pal.sleeve : pal.leaf[1];
          ctx!.stroke();
        }
        const leafPaths = (front: boolean, tone: number) => {
          ctx!.beginPath();
          for (let o = 0; o < leaves.length; o += 8) {
            if (leaves[o + 7] !== tone && tone >= 0) continue;
            const far = J[6] * leaves[o + 4] + J[7] * leaves[o + 5] + J[8] * leaves[o + 6] > 0;
            if (far === front) continue;
            const al = leaves[o];
            const i = Math.min(7, al | 0);
            const f = al - i;
            const bx = ocSx[i] + (ocSx[i + 1] - ocSx[i]) * f;
            const by = ocSy[i] + (ocSy[i + 1] - ocSy[i]) * f;
            ctx!.moveTo(bx + J[0] * leaves[o + 1] + J[1] * leaves[o + 2] + J[2] * leaves[o + 3], by + J[3] * leaves[o + 1] + J[4] * leaves[o + 2] + J[5] * leaves[o + 3]);
            ctx!.lineTo(bx + J[0] * leaves[o + 4] + J[1] * leaves[o + 5] + J[2] * leaves[o + 6], by + J[3] * leaves[o + 4] + J[4] * leaves[o + 5] + J[5] * leaves[o + 6]);
          }
        };
        // A leaf is a flat paddle: a square-ended dash half as wide as long.
        ctx!.lineCap = "butt";
        const leafW = Math.max(0.8, leafPx * 0.55);
        if (show) {
          leafPaths(false, -1);
          ctx!.lineWidth = leafW;
          ctx!.strokeStyle = pal.leafBack;
          ctx!.stroke();
        }

        // The bark, tapering: a ribbon a half-girth either side of the axis.
        ctx!.beginPath();
        for (let side = 0; side < 2; side++) {
          for (let s = 0; s < 9; s++) {
            const i = side ? 8 - s : s;
            const i0 = Math.max(0, i - 1);
            const i1 = Math.min(8, i + 1);
            const dx = ocSx[i1] - ocSx[i0];
            const dy = ocSy[i1] - ocSy[i0];
            const dl = Math.hypot(dx, dy) || 1;
            const w = Math.max(0.45, r[i] * footPx) * (side ? -1 : 1);
            const px = ocSx[i] - (dy / dl) * w;
            const py = ocSy[i] + (dx / dl) * w;
            if (s === 0 && side === 0) ctx!.moveTo(px, py);
            else ctx!.lineTo(px, py);
          }
        }
        ctx!.closePath();
        ctx!.fillStyle = pal.bark;
        ctx!.fill();
        // Close up, its lit side.
        if (r[2] * footPx > 2.5) {
          ctx!.beginPath();
          for (let i = 0; i < 9; i++) {
            const i0 = Math.max(0, i - 1);
            const i1 = Math.min(8, i + 1);
            const dx = ocSx[i1] - ocSx[i0];
            const dy = ocSy[i1] - ocSy[i0];
            const dl = Math.hypot(dx, dy) || 1;
            const w = r[i] * footPx * 0.45 * (dy / dl > 0 ? 1 : -1);
            if (i) ctx!.lineTo(ocSx[i] + (dy / dl) * w, ocSy[i] - (dx / dl) * w);
            else ctx!.moveTo(ocSx[i] + (dy / dl) * w, ocSy[i] - (dx / dl) * w);
          }
          ctx!.lineWidth = r[4] * footPx * 0.5;
          ctx!.strokeStyle = pal.barkLit;
          ctx!.stroke();
        }

        if (show) {
          ctx!.lineWidth = leafW;
          for (let t = 0; t < 5; t++) {
            leafPaths(true, t);
            ctx!.strokeStyle = pal.leaf[t];
            ctx!.stroke();
          }
        }

        // The flower spike: its stalk on past the tip, then the tubes; far
        // off a fleck of red, never under a pixel and a bit.
        if (cane.spike) {
          const tx = ocSx[8];
          const ty = ocSy[8];
          const tubePx = tube * footPx;
          if (tubePx < 2) {
            // A flame on the end of the cane.
            const sx = J[0] * (ax[24] - ax[21]) + J[1] * (ax[25] - ax[22]) + J[2] * (ax[26] - ax[23]);
            const sy = J[3] * (ax[24] - ax[21]) + J[4] * (ax[25] - ax[22]) + J[5] * (ax[26] - ax[23]);
            const sl = Math.hypot(sx, sy) || 1;
            const reach = Math.max(2.5, cane.spike * footPx);
            ctx!.beginPath();
            ctx!.moveTo(tx, ty);
            ctx!.lineTo(tx + (sx / sl) * reach, ty + (sy / sl) * reach);
            ctx!.lineCap = "round";
            ctx!.lineWidth = Math.max(1.4, cane.spike * footPx * 0.3);
            ctx!.strokeStyle = pal.flowerLit;
            ctx!.stroke();
          } else {
            ctx!.lineCap = "round";
            ctx!.lineWidth = Math.max(0.8, tubePx * 0.45);
            for (let lit = 0; lit < 2; lit++) {
              ctx!.beginPath();
              for (let o = 0; o < flowers.length; o += 7) {
                if (flowers[o + 6] !== lit) continue;
                ctx!.moveTo(tx + J[0] * flowers[o] + J[1] * flowers[o + 1] + J[2] * flowers[o + 2], ty + J[3] * flowers[o] + J[4] * flowers[o + 1] + J[5] * flowers[o + 2]);
                ctx!.lineTo(tx + J[0] * flowers[o + 3] + J[1] * flowers[o + 4] + J[2] * flowers[o + 5], ty + J[3] * flowers[o + 3] + J[4] * flowers[o + 4] + J[5] * flowers[o + 5]);
              }
              ctx!.strokeStyle = lit ? pal.flowerLit : pal.flower;
              ctx!.stroke();
            }
          }
        }
      }
      ctx!.lineCap = "butt";
      ctx!.lineJoin = "miter";
    }

    const yuccaGrown = new Map<string, YuccaPlant>();
    // Scratch for one plant's blades this frame: where each lands on
    // screen, and the passes they go in, each blade sorted into its pass.
    const ybx = new Float32Array(1500);
    const yby = new Float32Array(1500);
    const ytx = new Float32Array(1500);
    const yty = new Float32Array(1500);
    const yuccaKey = new Int8Array(1500);
    const yuccaOrder = new Int16Array(1500);
    const yuccaStart = new Int32Array(26);
    const yuccaAt = new Int32Array(26);

    // The local map at a point: screen and depth per foot along x, y, z.
    function localMap(x: number, y: number, z: number): number[] {
      const q = P(x, y, z);
      const qx = P(x + 1, y, z);
      const qy = P(x, y + 1, z);
      const qz = P(x, y, z + 1);
      return [qx[0] - q[0], qy[0] - q[0], qz[0] - q[0], qx[1] - q[1], qy[1] - q[1], qz[1] - q[1], qx[2] - q[2], qy[2] - q[2], qz[2] - q[2], q[0], q[1]];
    }

    /** Beaked Yucca, after the app's mature model: the clean-trunked globe.
     *
     *  A ball of stiff, straight, dark-green blades radiating from the head
     *  of a short trunk — the lowest angled down, the top ones near upright
     *  — over a skirt of last years' leaves hanging in straw, and below it
     *  a little of the trunk itself, latticed with old leaf bases.
     *
     *  The blades on the far side of the ball first, darker; the trunk and
     *  the skirt; a dark heart; then the near blades, lit toward the sun.
     *  Far off a blade is a stroke; close up a long pointed blade. All
     *  through a local map at the ball and one at the skirt. Grown once and
     *  cached.
     */
    function drawBeakedYuccaBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = yuccaGrown.get(key);
      if (!grown) {
        if (yuccaGrown.size > 400) yuccaGrown.clear(); // growth and edits mint new keys
        grown = growBeakedYucca(h, rw, rot, seed);
        yuccaGrown.set(key, grown);
      }
      const pal = sel ? BEAKED_YUCCA_GOLD : BEAKED_YUCCA_COLOURS;
      const { blades, straw, skirt } = grown;
      const G = localMap(x, grown.gy, z);
      const S = localMap(x, grown.sy, z);
      const gPx = Math.max(Math.hypot(G[0], G[3]), Math.hypot(G[2], G[5]), Math.hypot(G[1], G[4]));
      const sPx = Math.max(Math.hypot(S[0], S[3]), Math.hypot(S[2], S[5]), Math.hypot(S[1], S[4]));
      const wPx = grown.bladeW * gPx;
      // Where the sun falls on screen, for the lit sides.
      const lsx = S[0] * -0.44 + S[2] * -0.43;
      const lsy = S[3] * -0.44 + S[5] * -0.43;
      const lsl = Math.hypot(lsx, lsy) || 1;

      // Each blade once this frame: where it lands, and its pass — the far
      // side of the ball, or how far toward the camera its tip comes in
      // quarters of a blade — by tone.
      const kite = wPx >= 2.4;
      const bladePx = grown.bladeLen * gPx;
      const n = blades.length / 7;
      const dz = grown.bladeLen * Math.hypot(G[6], G[7], G[8]);
      yuccaStart.fill(0);
      for (let o = 0, k = 0; k < n; o += 7, k++) {
        ybx[k] = G[9] + G[0] * blades[o] + G[1] * blades[o + 1] + G[2] * blades[o + 2];
        yby[k] = G[10] + G[3] * blades[o] + G[4] * blades[o + 1] + G[5] * blades[o + 2];
        ytx[k] = G[9] + G[0] * blades[o + 3] + G[1] * blades[o + 4] + G[2] * blades[o + 5];
        yty[k] = G[10] + G[3] * blades[o + 3] + G[4] * blades[o + 4] + G[5] * blades[o + 5];
        const d = -(G[6] * blades[o + 3] + G[7] * blades[o + 4] + G[8] * blades[o + 5]) / dz;
        const band = d < 0 ? 0 : 1 + Math.min(3, Math.floor(d * 4.4));
        yuccaKey[k] = band * 5 + blades[o + 6];
        yuccaStart[yuccaKey[k] + 1]++;
      }
      for (let b = 0; b < 25; b++) yuccaStart[b + 1] += yuccaStart[b];
      yuccaAt.set(yuccaStart);
      for (let k = 0; k < n; k++) yuccaOrder[yuccaAt[yuccaKey[k]]++] = k;

      // A long pointed blade, widest a third of the way out, narrower the
      // more end-on it is to us. Close up it is two halves either side of
      // its keel: side 1 the half to the sun, -1 the other, 0 both.
      const blade = (k: number, side: number) => {
        const bx = ybx[k];
        const by = yby[k];
        const tx = ytx[k];
        const ty = yty[k];
        if (!kite) {
          ctx!.moveTo(bx, by);
          ctx!.lineTo(tx, ty);
          return;
        }
        const ux = tx - bx;
        const uy = ty - by;
        const ul = Math.hypot(ux, uy) || 1;
        const half = wPx * 0.36 * Math.sqrt(Math.min(1, ul / bladePx));
        let nx = (-uy / ul) * half;
        let ny = (ux / ul) * half;
        if (nx * lsx + ny * lsy < 0) {
          nx = -nx;
          ny = -ny;
        }
        const mx = bx + ux * 0.35;
        const my = by + uy * 0.35;
        if (side === 0) {
          ctx!.moveTo(bx + nx * 0.4, by + ny * 0.4);
          ctx!.lineTo(mx + nx, my + ny);
          ctx!.lineTo(tx, ty);
          ctx!.lineTo(mx - nx, my - ny);
          ctx!.lineTo(bx - nx * 0.4, by - ny * 0.4);
        } else {
          ctx!.moveTo(bx, by);
          ctx!.lineTo(bx + nx * 0.4 * side, by + ny * 0.4 * side);
          ctx!.lineTo(mx + nx * side, my + ny * side);
          ctx!.lineTo(tx, ty);
        }
      };
      // One colour's pass: the blades of one or two buckets.
      const pass = (colour: string, b1: number, side1: number, b2: number, side2: number) => {
        if (kite) ctx!.fillStyle = colour;
        else ctx!.strokeStyle = colour;
        ctx!.beginPath();
        let m = 0;
        for (let r = 0; r < 2; r++) {
          const b = r ? b2 : b1;
          if (b < 0) continue;
          const side = r ? side2 : side1;
          for (let i = yuccaStart[b]; i < yuccaStart[b + 1]; i++) {
            blade(yuccaOrder[i], side);
            // Many overlapping shapes in one fill get slow: fill in batches.
            if (kite && ++m === 150) {
              ctx!.fill();
              ctx!.beginPath();
              m = 0;
            }
          }
        }
        if (kite) ctx!.fill();
        else ctx!.stroke();
      };
      ctx!.lineCap = "butt";
      ctx!.lineWidth = Math.max(0.6, wPx * 0.5);

      // The far side of the ball, a tone darker: over the top of it, it is
      // as much in the sun as the near side.
      for (let t = 0; t < 5; t++) pass(t === 0 ? pal.back[0] : t === 1 ? pal.back[1] : pal.blade[t - 2], t, 0, -1, 0);

      // The trunk: what shows of it under the skirt.
      const t0 = P(x, 0, z);
      const t1 = P(x, grown.trunkTop, z);
      const tdx = t1[0] - t0[0];
      const tdy = t1[1] - t0[1];
      const tdl = Math.hypot(tdx, tdy) || 1;
      const tr = Math.max(0.8, grown.trunkR * sPx);
      const tnx = (-tdy / tdl) * tr;
      const tny = (tdx / tdl) * tr;
      const trunkPath = () => {
        ctx!.beginPath();
        ctx!.moveTo(t0[0] + tnx, t0[1] + tny);
        ctx!.lineTo(t1[0] + tnx, t1[1] + tny);
        ctx!.lineTo(t1[0] - tnx, t1[1] - tny);
        ctx!.lineTo(t0[0] - tnx, t0[1] - tny);
        ctx!.closePath();
      };
      trunkPath();
      ctx!.fillStyle = pal.trunk;
      ctx!.fill();
      const litSide = (tnx * lsx + tny * lsy) / lsl > 0 ? 1 : -1;
      if (tr > 2) {
        ctx!.beginPath();
        ctx!.moveTo(t0[0] + tnx * 0.55 * litSide, t0[1] + tny * 0.55 * litSide);
        ctx!.lineTo(t1[0] + tnx * 0.55 * litSide, t1[1] + tny * 0.55 * litSide);
        ctx!.lineWidth = tr * 0.6;
        ctx!.strokeStyle = pal.trunkLit;
        ctx!.stroke();
      }
      // Close up, the lattice of old leaf bases.
      if (tr > 5) {
        ctx!.save();
        trunkPath();
        ctx!.clip();
        const step = tr * 0.32;
        const reach = tdl + tr * 2;
        ctx!.beginPath();
        for (let s = -tr * 2; s < reach; s += step) {
          const ax = t0[0] + (tdx / tdl) * s;
          const ay = t0[1] + (tdy / tdl) * s;
          ctx!.moveTo(ax - tnx * 1.2, ay - tny * 1.2);
          ctx!.lineTo(ax + tnx * 1.2 + (tdx / tdl) * tr * 0.7, ay + tny * 1.2 + (tdy / tdl) * tr * 0.7);
          ctx!.moveTo(ax + tnx * 1.2, ay + tny * 1.2);
          ctx!.lineTo(ax - tnx * 1.2 + (tdx / tdl) * tr * 0.7, ay - tny * 1.2 + (tdy / tdl) * tr * 0.7);
        }
        ctx!.lineWidth = Math.max(0.7, tr * 0.05);
        ctx!.strokeStyle = pal.trunkLine;
        ctx!.stroke();
        ctx!.restore();
      }

      // The skirt: its outline in straw, the side to the sun paler.
      const skirtHull = (scale: number, shift: number) => {
        const pts: [number, number][] = [];
        for (let i = 0; i < skirt.length; i += 2) {
          const y = skirt[i] - grown.sy;
          const r = skirt[i + 1] * scale;
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const ox = Math.cos(a) * r + -0.44 * shift * skirt[i + 1];
            const oz = Math.sin(a) * r + -0.43 * shift * skirt[i + 1];
            pts.push([S[9] + S[0] * ox + S[1] * y + S[2] * oz, S[10] + S[3] * ox + S[4] * y + S[5] * oz]);
          }
        }
        const hull = convexHull(pts);
        ctx!.beginPath();
        hull.forEach(([px, py], i) => (i ? ctx!.lineTo(px, py) : ctx!.moveTo(px, py)));
        ctx!.closePath();
      };
      skirtHull(1, 0);
      ctx!.fillStyle = pal.skirt;
      ctx!.fill();
      skirtHull(0.78, 0.3);
      ctx!.fillStyle = pal.skirtLit;
      ctx!.fill();
      // Close up, the hanging leaves themselves.
      if (grown.strawLen * sPx >= 3) {
        ctx!.lineWidth = Math.max(0.6, 0.018 * (rw / BY_R) * sPx);
        for (let t = 0; t < 3; t++) {
          ctx!.beginPath();
          for (let o = 0; o < straw.length; o += 8) {
            if (straw[o + 6] !== t) continue;
            if (S[6] * straw[o] + S[8] * straw[o + 2] > 0) continue;
            const ax = S[9] + S[0] * straw[o] + S[1] * straw[o + 1] + S[2] * straw[o + 2];
            const ay = S[10] + S[3] * straw[o] + S[4] * straw[o + 1] + S[5] * straw[o + 2];
            const bx = S[9] + S[0] * straw[o + 3] + S[1] * straw[o + 4] + S[2] * straw[o + 5];
            const by = S[10] + S[3] * straw[o + 3] + S[4] * straw[o + 4] + S[5] * straw[o + 5];
            const c = straw[o + 7];
            ctx!.moveTo(ax, ay);
            ctx!.quadraticCurveTo((ax + bx) / 2 - (by - ay) * c, (ay + by) / 2 + (bx - ax) * c, bx, by);
          }
          ctx!.strokeStyle = pal.straw[t];
          ctx!.stroke();
        }
        ctx!.lineWidth = Math.max(0.6, wPx * 0.5);
      }

      // The ball's dark heart, so gaps between near blades read as depth.
      ctx!.beginPath();
      ctx!.arc(G[9], G[10], Math.max(1, grown.coreR * gPx), 0, Math.PI * 2);
      ctx!.fillStyle = pal.core;
      ctx!.fill();

      // The near blades, toward the sun lighter, a band at a time far to
      // near so the tones lie among each other; each blade's shaded half a
      // tone darker than its sunny one. Close up each one's shaded edge is
      // drawn in, or where they crowd — the fan up from the crown — they
      // melt into one sheet.
      for (let band = 1; band <= 4; band++) {
        const b0 = band * 5;
        for (let t = 0; t < 5; t++) {
          // a stroke far off: a tone down, as its shaded half and edge are
          if (!kite) pass(t ? pal.blade[t - 1] : pal.back[1], b0 + t, 0, -1, 0);
          else pass(pal.blade[t], b0 + t, t === 0 ? 0 : 1, t < 4 ? b0 + t + 1 : -1, -1);
        }
        if (wPx < 3) continue;
        ctx!.beginPath();
        for (let i = yuccaStart[b0]; i < yuccaStart[b0 + 5]; i++) {
          const k = yuccaOrder[i];
          const ux = ytx[k] - ybx[k];
          const uy = yty[k] - yby[k];
          const ul = Math.hypot(ux, uy) || 1;
          const half = wPx * 0.36 * Math.sqrt(Math.min(1, ul / bladePx));
          let nx = (-uy / ul) * half;
          let ny = (ux / ul) * half;
          if (nx * lsx + ny * lsy > 0) {
            nx = -nx;
            ny = -ny;
          }
          ctx!.moveTo(ybx[k] + ux * 0.35 + nx, yby[k] + uy * 0.35 + ny);
          ctx!.lineTo(ytx[k], yty[k]);
        }
        ctx!.lineWidth = Math.max(0.6, wPx * 0.1);
        ctx!.strokeStyle = pal.edge;
        ctx!.stroke();
      }
    }

    const barrelGrown = new Map<string, BarrelPlant>();
    // Scratch: one plant's projected ridges and grooves, its faces' depths.
    const gbRx = new Float32Array(GB_RIBS * GB_ST);
    const gbRy = new Float32Array(GB_RIBS * GB_ST);
    const gbGx = new Float32Array(GB_RIBS * GB_ST);
    const gbGy = new Float32Array(GB_RIBS * GB_ST);
    const gbDepth = new Float32Array(GB_RIBS * 2 * 3);
    const gbOrder = new Int16Array(GB_RIBS * 2 * 3);
    const mixRgb = (a: number[], b: number[], t: number) =>
      `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

    /** Golden Barrel, after the app's scan: a squat drum twice as wide as
     *  it is tall, doming to a crown of cream wool.
     *
     *  Twenty-seven ribs, each two flanks lit by their own lean, the near
     *  ones only, far to near; dark grooves between. Far off its spines are
     *  what you see, so the flanks are gold and the ridges paler; nearer the
     *  dark green body shows through and the spines are drawn — a tuft at
     *  every areole up every ridge, lying out over the grooves. All through
     *  a local map at the plant. Grown once and cached.
     */
    function drawGoldenBarrelBody(
      x: number,
      z: number,
      h: number,
      rw: number,
      rot: number,
      seed: string,
      sel: boolean,
    ) {
      const key = `${seed}|${x}|${z}|${h}|${rw}|${rot}`;
      let grown = barrelGrown.get(key);
      if (!grown) {
        if (barrelGrown.size > 400) barrelGrown.clear(); // growth and edits mint new keys
        grown = growGoldenBarrel(h, rw, rot, seed);
        barrelGrown.set(key, grown);
      }
      const pal = sel ? GOLDEN_BARREL_GOLD : GOLDEN_BARREL_COLOURS;
      const { ridge, groove, faces, areoles } = grown;
      const J = localMap(x, 0, z);
      const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]), Math.hypot(J[1], J[4]));
      const stepPx = grown.step * footPx;
      // How much of the green body shows between the spines: none far off,
      // all of it once the spines are drawn.
      const near = Math.max(0, Math.min(1, (stepPx - 2) / 4));
      const tones = [0, 1, 2, 3, 4].map((t) => mixRgb(pal.far[t], pal.body[t], near));
      // toward the camera
      const el = Math.hypot(J[6], J[7], J[8]) || 1;
      const ex = -J[6] / el;
      const ey = -J[7] / el;
      const ez = -J[8] / el;

      for (let o = 0, n = 0; o < ridge.length; o += 3, n++) {
        gbRx[n] = J[9] + J[0] * ridge[o] + J[1] * ridge[o + 1] + J[2] * ridge[o + 2];
        gbRy[n] = J[10] + J[3] * ridge[o] + J[4] * ridge[o + 1] + J[5] * ridge[o + 2];
        gbGx[n] = J[9] + J[0] * groove[o] + J[1] * groove[o + 1] + J[2] * groove[o + 2];
        gbGy[n] = J[10] + J[3] * groove[o] + J[4] * groove[o + 1] + J[5] * groove[o + 2];
      }
      // The near faces, far to near.
      let nf = 0;
      for (let f = 0, o = 0; o < faces.length; f++, o += 8) {
        if (faces[o + 4] * ex + faces[o + 5] * ey + faces[o + 6] * ez <= 0) continue;
        const k = faces[o];
        const im = (faces[o + 2] + faces[o + 3]) >> 1;
        const r = (k * GB_ST + im) * 3;
        gbDepth[f] = J[6] * ridge[r] + J[7] * ridge[r + 1] + J[8] * ridge[r + 2];
        gbOrder[nf++] = f;
      }
      const order = gbOrder.subarray(0, nf);
      order.sort((a, b) => gbDepth[b] - gbDepth[a]);
      ctx!.lineJoin = "round";
      for (const f of order) {
        const o = f * 8;
        const k = faces[o];
        const g = faces[o + 1] ? (k + GB_RIBS - 1) % GB_RIBS : k;
        const i0 = faces[o + 2];
        const i1 = faces[o + 3];
        ctx!.beginPath();
        for (let i = i0; i <= i1; i++) {
          const n = k * GB_ST + i;
          if (i === i0) ctx!.moveTo(gbRx[n], gbRy[n]);
          else ctx!.lineTo(gbRx[n], gbRy[n]);
        }
        // the top piece closes on the crown
        for (let i = i1; i >= i0; i--) ctx!.lineTo(gbGx[g * GB_ST + i], gbGy[g * GB_ST + i]);
        ctx!.closePath();
        ctx!.fillStyle = tones[Math.min(4, Math.floor(faces[o + 7] * 5))];
        ctx!.fill();
        // seal the hairline between neighbouring faces
        ctx!.strokeStyle = ctx!.fillStyle;
        ctx!.lineWidth = 0.6;
        ctx!.stroke();
      }

      // Grooves dark, ridges pale (the rows of spines), on the near side.
      const facing = (k: number, i: number) => {
        const o = (k * GB_ST + i) * 3;
        const rl = Math.hypot(ridge[o], ridge[o + 2]) || 1;
        return (ridge[o] / rl) * ex + (ridge[o + 2] / rl) * ez + 0.4 * ey > -0.05;
      };
      const line = (pts: "ridge" | "groove") => {
        ctx!.beginPath();
        for (let k = 0; k < GB_RIBS; k++) {
          let on = false;
          for (let i = 0; i < GB_ST; i++) {
            const n = k * GB_ST + i;
            if (!facing(k, i)) {
              on = false;
              continue;
            }
            const px = pts === "ridge" ? gbRx[n] : gbGx[n];
            const py = pts === "ridge" ? gbRy[n] : gbGy[n];
            if (on) ctx!.lineTo(px, py);
            else ctx!.moveTo(px, py);
            on = true;
          }
        }
      };
      ctx!.lineCap = "round";
      line("groove");
      ctx!.lineWidth = Math.max(0.6, rw * 0.025 * footPx);
      ctx!.strokeStyle = pal.groove;
      ctx!.stroke();
      if (near < 1) {
        line("ridge");
        ctx!.lineWidth = Math.max(0.6, rw * 0.03 * footPx);
        ctx!.strokeStyle = pal.ridge;
        ctx!.globalAlpha = (1 - near) * 0.55 * fade;
        ctx!.stroke();
        ctx!.globalAlpha = fade;
      }

      // The crown: a ragged cushion of cream wool, paler where it is newest,
      // under the top tufts' spines.
      const cap = (y: number, r: number) => {
        ctx!.beginPath();
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          const rr = r * rw * (1 + 0.09 * Math.sin(a * 5 + rot * 3) + (i % 2 ? 0.1 : -0.06));
          const px = Math.cos(a) * rr;
          const pz = Math.sin(a) * rr;
          const sx = J[9] + J[0] * px + J[1] * y * h + J[2] * pz;
          const sy = J[10] + J[3] * px + J[4] * y * h + J[5] * pz;
          if (i) ctx!.lineTo(sx, sy);
          else ctx!.moveTo(sx, sy);
        }
        ctx!.closePath();
      };
      cap(0.93, 0.34);
      ctx!.fillStyle = pal.crown;
      ctx!.fill();
      cap(0.985, 0.12);
      ctx!.fillStyle = pal.crownHeart;
      ctx!.fill();
      // Close up, the spines: a tuft at every areole on the near side.
      if (stepPx >= 2) {
        const A = 6 + 21;
        for (let lit = 0; lit < 2; lit++) {
          ctx!.beginPath();
          for (let o = 0; o < areoles.length; o += A) {
            const nx = areoles[o + 3];
            const ny = areoles[o + 4];
            const nz = areoles[o + 5];
            if (nx * ex + ny * ey + nz * ez <= 0.05) continue;
            if ((nx * -0.44 + ny * 0.79 + nz * -0.43 > 0.15 ? 1 : 0) !== lit) continue;
            const ax = J[9] + J[0] * areoles[o] + J[1] * areoles[o + 1] + J[2] * areoles[o + 2];
            const ay = J[10] + J[3] * areoles[o] + J[4] * areoles[o + 1] + J[5] * areoles[o + 2];
            for (let s = 0; s < 7; s++) {
              const q = o + 6 + s * 3;
              ctx!.moveTo(ax, ay);
              ctx!.lineTo(J[9] + J[0] * areoles[q] + J[1] * areoles[q + 1] + J[2] * areoles[q + 2], J[10] + J[3] * areoles[q] + J[4] * areoles[q + 1] + J[5] * areoles[q + 2]);
            }
          }
          ctx!.lineWidth = Math.max(0.5, grown.spine * footPx * 0.065);
          ctx!.strokeStyle = lit ? pal.spineLit : pal.spine;
          ctx!.stroke();
        }
        // the woolly areoles themselves
        const wr = Math.max(0.6, grown.step * footPx * 0.16);
        ctx!.beginPath();
        for (let o = 0; o < areoles.length; o += A) {
          if (areoles[o + 3] * ex + areoles[o + 4] * ey + areoles[o + 5] * ez <= 0.05) continue;
          const ax = J[9] + J[0] * areoles[o] + J[1] * areoles[o + 1] + J[2] * areoles[o + 2];
          const ay = J[10] + J[3] * areoles[o] + J[4] * areoles[o + 1] + J[5] * areoles[o + 2];
          ctx!.moveTo(ax + wr, ay);
          ctx!.arc(ax, ay, wr, 0, Math.PI * 2);
        }
        ctx!.fillStyle = pal.wool;
        ctx!.fill();
      }

      ctx!.lineCap = "butt";
      ctx!.lineJoin = "miter";
    }

    const blueGlowGrown = new Map<string, BlueGlowPlant>();
    // Scratch, reused plant to plant.
    const bgOrder: number[] = [];
    const bgDepth = new Float32Array(BG_FACES);
    const bgVis = new Uint8Array(BG_FACES);
    const bgDone = new Uint8Array(BG_FACES);
    /** Blue Glow agave, after the app's scan.
     *
     *  A vase of sixty-odd broad, stiff, smooth-edged lances: the old outer
     *  ones splayed low, arching over, sage-green, a few dead and brown on
     *  the ground; the rest standing blue-grey round a tight cone of young
     *  leaves. The thin red margin it is named for, and a short dark spine
     *  at each tip.
     *
     *  Each leaf a solid of four faces — the two halves of its channel,
     *  light and dark, over a keeled back — each cut in two along the leaf,
     *  the inner half in shade; every piece toward the eye in one far-to-
     *  near sort, over a dark heart so the gaps low down read as shadow. Its margin and spine once it is big enough to show them.
     *  Grown once and cached; drawn through the local map at the foot.
     */
    function drawBlueGlowBody(x: number, z: number, h: number, rw: number, rot: number, sel: boolean) {
      const key = `${x}|${z}|${h}|${rw}|${rot}`;
      let grown = blueGlowGrown.get(key);
      if (!grown) {
        if (blueGlowGrown.size > 400) blueGlowGrown.clear(); // growth and edits mint new keys
        grown = growBlueGlow(h, rw, rot);
        blueGlowGrown.set(key, grown);
      }
      const { leaf, spine, faceN, faceMid, faceTone } = grown;
      const pal = sel ? BLUE_GLOW_GOLD : BLUE_GLOW_COLOURS;
      const tones = BG_TONES[sel ? 1 : 0];
      const J = localMap(x, 0, z);
      const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]), Math.hypot(J[1], J[4]));
      const sx = (a: Float32Array, o: number) => J[9] + J[0] * a[o] + J[1] * a[o + 1] + J[2] * a[o + 2];
      const sy = (a: Float32Array, o: number) => J[10] + J[3] * a[o] + J[4] * a[o + 1] + J[5] * a[o + 2];

      // The dark heart: a cone from the stem out under the leaves' bases.
      const ring: [number, number][] = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        for (const [y, r] of [
          [0.02, 0.2],
          [0.28, 0.28],
        ]) {
          const px = Math.cos(a) * r * rw;
          const pz = Math.sin(a) * r * rw;
          ring.push([J[9] + J[0] * px + J[1] * y * h + J[2] * pz, J[10] + J[3] * px + J[4] * y * h + J[5] * pz]);
        }
      }
      const hull = convexHull(ring);
      ctx!.beginPath();
      ctx!.moveTo(hull[0][0], hull[0][1]);
      for (let k = 1; k < hull.length; k++) ctx!.lineTo(hull[k][0], hull[k][1]);
      ctx!.closePath();
      ctx!.fillStyle = pal.core;
      ctx!.fill();

      // Faces toward the eye, far to near.
      bgOrder.length = 0;
      const ex = eye[0] - x;
      const ey = eye[1];
      const ez = eye[2] - z;
      for (let f = 0; f < BG_FACES; f++) {
        const o = f * 3;
        const vis = faceN[o] * (ex - faceMid[o]) + faceN[o + 1] * (ey - faceMid[o + 1]) + faceN[o + 2] * (ez - faceMid[o + 2]) > 0;
        bgVis[f] = vis ? 1 : 0;
        bgDone[f] = 0;
        if (!vis) continue;
        bgDepth[f] = J[6] * faceMid[o] + J[7] * faceMid[o + 1] + J[8] * faceMid[o + 2];
        bgOrder.push(f);
      }
      bgOrder.sort((a, b) => bgDepth[b] - bgDepth[a]);

      const margins = footPx * h > 120;
      const marginW = Math.max(footPx * h * 0.003, 0.6);
      const spines = footPx * h > 30;
      ctx!.lineJoin = "round";
      for (const it of bgOrder) {
        const i = it >> 3;
        const f = (it >> 1) & 3;
        const j0 = it & 1 ? BG_SPLIT : 0;
        const j1 = it & 1 ? BG_PTS - 1 : BG_SPLIT;
        const [la, lb] = BG_FACE_LINES[f];
        const base = i * BG_PTS * 12;
        ctx!.beginPath();
        for (let j = j0; j <= j1; j++) {
          const o = base + j * 12 + la * 3;
          if (j === j0) ctx!.moveTo(sx(leaf, o), sy(leaf, o));
          else ctx!.lineTo(sx(leaf, o), sy(leaf, o));
        }
        for (let j = j1; j >= j0; j--) {
          const o = base + j * 12 + lb * 3;
          ctx!.lineTo(sx(leaf, o), sy(leaf, o));
        }
        ctx!.closePath();
        ctx!.fillStyle = tones[faceTone[it]];
        ctx!.fill();
        bgDone[it] = 1;
        // The margin this face shares with its partner above or below, drawn
        // with the later of the two; the spine with the leaf's last face.
        const partner = it ^ 4;
        if (margins && BG_MODEL.kind[i] !== 3 && !(bgVis[partner] && !bgDone[partner])) {
          const line = f === 0 || f === 2 ? 1 : 2;
          ctx!.beginPath();
          for (let j = j0; j <= j1; j++) {
            const o = base + j * 12 + line * 3;
            if (j === j0) ctx!.moveTo(sx(leaf, o), sy(leaf, o));
            else ctx!.lineTo(sx(leaf, o), sy(leaf, o));
          }
          ctx!.strokeStyle = pal.margin;
          ctx!.lineWidth = marginW;
          ctx!.stroke();
        }
        if (!spines) continue;
        let last = true;
        for (let g = i * 8; g < i * 8 + 8; g++) if (bgVis[g] && !bgDone[g]) last = false;
        if (last) {
          ctx!.beginPath();
          ctx!.moveTo(sx(spine, i * 6), sy(spine, i * 6));
          ctx!.lineTo(sx(spine, i * 6 + 3), sy(spine, i * 6 + 3));
          ctx!.strokeStyle = pal.spine;
          ctx!.lineWidth = Math.max(footPx * h * 0.006, 0.7);
          ctx!.lineCap = "round";
          ctx!.stroke();
          ctx!.lineCap = "butt";
        }
      }
      ctx!.lineJoin = "miter";
    }

    const blackTipGrown = new Map<string, BlackTipPlant>();
    // Scratch, reused plant to plant.
    const btOrder: number[] = [];
    const btDepth = new Float32Array(BT_ALL);
    const btVis = new Uint8Array(BT_ALL);
    const btDone = new Uint8Array(BT_ALL);
    /** Black Tip agave, after the app's scan.
     *
     *  A low dome of a hundred and fifty pale blue-grey lances, as many
     *  leaves at every height from the ground to the closed bud on top, each
     *  ending in a fine dark spine.
     *
     *  Each leaf a folded, keeled lance — the two halves of the fold, light
     *  and dark, and the two of its back — every face toward the eye in one
     *  far-to-near sort, over a dark dome a little inside the tips so the
     *  gaps read as depth. Its pale margins and dark spine once it is big
     *  enough to show them. Grown once and cached; drawn through the local
     *  map at the foot.
     */
    function drawBlackTipBody(x: number, z: number, h: number, rw: number, rot: number, sel: boolean) {
      const key = `${x}|${z}|${h}|${rw}|${rot}`;
      let grown = blackTipGrown.get(key);
      if (!grown) {
        if (blackTipGrown.size > 400) blackTipGrown.clear(); // growth and edits mint new keys
        grown = growBlackTip(h, rw, rot);
        blackTipGrown.set(key, grown);
      }
      const { leaf, spine, faceN, faceMid, faceTone } = grown;
      const pal = sel ? BLACK_TIP_GOLD : BLACK_TIP_COLOURS;
      const tones = BT_TONES[sel ? 1 : 0];
      const J = localMap(x, 0, z);
      const footPx = Math.max(Math.hypot(J[0], J[3]), Math.hypot(J[2], J[5]), Math.hypot(J[1], J[4]));
      const sx = (a: Float32Array, o: number) => J[9] + J[0] * a[o] + J[1] * a[o + 1] + J[2] * a[o + 2];
      const sy = (a: Float32Array, o: number) => J[10] + J[3] * a[o] + J[4] * a[o + 1] + J[5] * a[o + 2];

      // The dark dome inside.
      const dome: [number, number][] = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        for (let l = 0; l < 5; l++) {
          const p = (l / 4) * (Math.PI / 2);
          const px = Math.cos(a) * Math.cos(p) * 0.45 * rw;
          const pz = Math.sin(a) * Math.cos(p) * 0.45 * rw;
          const py = (0.08 + Math.sin(p) * 0.52) * h;
          dome.push([J[9] + J[0] * px + J[1] * py + J[2] * pz, J[10] + J[3] * px + J[4] * py + J[5] * pz]);
        }
      }
      const hull = convexHull(dome);
      ctx!.beginPath();
      ctx!.moveTo(hull[0][0], hull[0][1]);
      for (let k = 1; k < hull.length; k++) ctx!.lineTo(hull[k][0], hull[k][1]);
      ctx!.closePath();
      ctx!.fillStyle = pal.core;
      ctx!.fill();

      // Faces toward the eye, far to near.
      btOrder.length = 0;
      const ex = eye[0] - x;
      const ey = eye[1];
      const ez = eye[2] - z;
      for (let f = 0; f < BT_ALL; f++) {
        const o = f * 3;
        const vis = faceN[o] * (ex - faceMid[o]) + faceN[o + 1] * (ey - faceMid[o + 1]) + faceN[o + 2] * (ez - faceMid[o + 2]) > 0;
        btVis[f] = vis ? 1 : 0;
        btDone[f] = 0;
        if (!vis) continue;
        btDepth[f] = J[6] * faceMid[o] + J[7] * faceMid[o + 1] + J[8] * faceMid[o + 2];
        btOrder.push(f);
      }
      btOrder.sort((a, b) => btDepth[b] - btDepth[a]);

      const margins = footPx * h > 120;
      const marginW = Math.max(footPx * h * 0.003, 0.6);
      const spines = footPx * h > 60;
      ctx!.lineJoin = "round";
      for (const it of btOrder) {
        const i = it >> 2;
        const f = it & 3;
        const [la, lb] = BT_FACE_LINES[f];
        const base = i * BT_PTS * 12;
        ctx!.beginPath();
        for (let j = 0; j < BT_PTS; j++) {
          const o = base + j * 12 + la * 3;
          if (j === 0) ctx!.moveTo(sx(leaf, o), sy(leaf, o));
          else ctx!.lineTo(sx(leaf, o), sy(leaf, o));
        }
        for (let j = BT_PTS - 1; j >= 0; j--) {
          const o = base + j * 12 + lb * 3;
          ctx!.lineTo(sx(leaf, o), sy(leaf, o));
        }
        ctx!.closePath();
        ctx!.fillStyle = tones[faceTone[it]];
        ctx!.fill();
        btDone[it] = 1;
        // The pale margin this face shares with its partner above or below,
        // drawn with the later of the two; the spine with the leaf's last.
        const partner = it ^ 2;
        if (margins && !(btVis[partner] && !btDone[partner])) {
          const line = f === 0 || f === 2 ? 1 : 2;
          ctx!.beginPath();
          for (let j = 0; j < BT_PTS; j++) {
            const o = base + j * 12 + line * 3;
            if (j === 0) ctx!.moveTo(sx(leaf, o), sy(leaf, o));
            else ctx!.lineTo(sx(leaf, o), sy(leaf, o));
          }
          ctx!.strokeStyle = pal.margin;
          ctx!.lineWidth = marginW;
          ctx!.stroke();
        }
        if (!spines) continue;
        let last = true;
        for (let g = i * 4; g < i * 4 + 4; g++) if (btVis[g] && !btDone[g]) last = false;
        if (last) {
          ctx!.beginPath();
          ctx!.moveTo(sx(spine, i * 6), sy(spine, i * 6));
          ctx!.lineTo(sx(spine, i * 6 + 3), sy(spine, i * 6 + 3));
          ctx!.strokeStyle = pal.spine;
          ctx!.lineWidth = Math.max(footPx * h * 0.004, 0.6);
          ctx!.lineCap = "round";
          ctx!.stroke();
          ctx!.lineCap = "butt";
        }
      }
      ctx!.lineJoin = "miter";
    }

    const azRockGrown = new Map<string, AzRock>();
    // Scratch, reused rock to rock: projected vertices, which faces show,
    // and their depths.
    const azrScreen = new Float32Array(AZR_NV * 3);
    const azrSeen = new Uint8Array(AZR_NF);
    const azrDepth = new Float32Array(AZR_NF);
    const azrOrder: number[] = [];

    function drawAzBoulderBody(x: number, z: number, rw: number, rot: number, sel: boolean, lw: number) {
      // The plan mark's radius is half the rock's length.
      const len = rw * 2;
      const key = `${x}|${z}|${len}|${rot}`;
      let rock = azRockGrown.get(key);
      if (!rock) {
        if (azRockGrown.size > 400) azRockGrown.clear(); // edits mint new keys
        rock = growAzRock(x, z, len, rot);
        azRockGrown.set(key, rock);
      }
      const { v, n, c, band, fl } = rock;
      const pal = sel ? AZ_ROCK_GOLD : AZ_ROCK_COLOURS;
      const tones = AZR_TONES[sel ? 1 : 0];

      for (let i = 0; i < AZR_NV; i++) {
        const q = P(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
        azrScreen[i * 3] = q[0];
        azrScreen[i * 3 + 1] = q[1];
        azrScreen[i * 3 + 2] = q[2];
      }
      azrOrder.length = 0;
      for (let f = 0; f < AZR_NF; f++) {
        const seen =
          n[f * 3] * (eye[0] - c[f * 3]) + n[f * 3 + 1] * (eye[1] - c[f * 3 + 1]) + n[f * 3 + 2] * (eye[2] - c[f * 3 + 2]);
        azrSeen[f] = seen > 0 ? 1 : 0;
        if (seen <= 0) continue;
        azrDepth[f] =
          azrScreen[AZR_F[f * 3] * 3 + 2] + azrScreen[AZR_F[f * 3 + 1] * 3 + 2] + azrScreen[AZR_F[f * 3 + 2] * 3 + 2];
        azrOrder.push(f);
      }
      if (!azrOrder.length) return;
      azrOrder.sort((a, b) => azrDepth[b] - azrDepth[a]);
      const tri = (f: number) => {
        const a = AZR_F[f * 3] * 3;
        const b = AZR_F[f * 3 + 1] * 3;
        const d = AZR_F[f * 3 + 2] * 3;
        ctx!.moveTo(azrScreen[a], azrScreen[a + 1]);
        ctx!.lineTo(azrScreen[b], azrScreen[b + 1]);
        ctx!.lineTo(azrScreen[d], azrScreen[d + 1]);
        ctx!.closePath();
      };

      // The whole rock first: its outline, then stone under the faces so no
      // sand shows in the seams between them. The outline is stroked at
      // twice the weight it shows at, and the faces cover its inner half, so
      // only the rock's edge keeps it. Edges between a face that shows and
      // one that doesn't outlined every little fold inside it as well.
      ctx!.beginPath();
      for (const f of azrOrder) tri(f);
      ctx!.lineJoin = "round";
      ctx!.strokeStyle = pal.edge;
      ctx!.lineWidth = lw * 1.6;
      ctx!.stroke();
      ctx!.fillStyle = tones[3];
      ctx!.fill();
      // The faces, far to near, one fill to each run of a tone.
      let cur = -1;
      ctx!.beginPath();
      for (const f of azrOrder) {
        if (band[f] !== cur) {
          if (cur >= 0) {
            ctx!.fillStyle = tones[cur];
            ctx!.fill();
            ctx!.beginPath();
          }
          cur = band[f];
        }
        tri(f);
      }
      ctx!.fillStyle = tones[cur];
      ctx!.fill();

      const sizePx = ftPx(x, z, len);
      if (sizePx > 14) {
        ctx!.beginPath();
        for (let e = 0; e < AZR_CREASES.length; e += 4) {
          if (!azrSeen[AZR_CREASES[e + 2]] || !azrSeen[AZR_CREASES[e + 3]]) continue;
          const a = AZR_CREASES[e] * 3;
          const b = AZR_CREASES[e + 1] * 3;
          ctx!.moveTo(azrScreen[a], azrScreen[a + 1]);
          ctx!.lineTo(azrScreen[b], azrScreen[b + 1]);
        }
        ctx!.strokeStyle = pal.crease;
        ctx!.lineWidth = lw * 0.6;
        ctx!.stroke();
      }
      // Close up, the granite's grain: dark flecks and light ones, never
      // more than a couple of pixels however near the camera comes.
      if (sizePx > 60) {
        const s0 = Math.min(Math.max(ftPx(x, z, 0.016), 0.7), 2.2);
        for (const light of [0, 1]) {
          ctx!.beginPath();
          for (let i = 0; i < AZR_FLECKS; i++) {
            if (azrFleckLight[i] !== light || !azrSeen[azrFleckFace[i]]) continue;
            const q = P(fl[i * 3], fl[i * 3 + 1], fl[i * 3 + 2]);
            const s = s0 * azrFleckSize[i];
            ctx!.rect(q[0] - s / 2, q[1] - s / 2, s, s);
          }
          ctx!.fillStyle = light ? pal.light : pal.dark;
          ctx!.fill();
        }
      }
      ctx!.lineWidth = lw;
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
     *
     *  The AZ Boulder has since been given the scan itself (drawAzBoulderBody);
     *  this draws the boulders that haven't.
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
      const rock: BoulderPlant = growBoulder(x, z, wFt, hFt, rot, sym, seed);
      const vs = rock.pts.map((p) => {
        const q = P(p[0], p[1], p[2]);
        return { sx: q[0], sy: q[1], d: q[2] };
      });
      const faces = rock.faces.map((f) => {
        const fv = f.vs.map((i) => vs[i]);
        return { vs: fv, d: fv.reduce((s, v) => s + v.d, 0) / fv.length, lit: f.lit };
      });
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
      const hull = convexHull(vs.map((v): [number, number] => [v.sx, v.sy]));
      if (hull.length < 3) return;
      ctx!.beginPath();
      ctx!.moveTo(hull[0][0], hull[0][1]);
      for (let i = 1; i < hull.length; i++) ctx!.lineTo(hull[i][0], hull[i][1]);
      ctx!.closePath();
      ctx!.strokeStyle = sel ? GOLD : verde(0.7);
      ctx!.lineWidth = lw * 1.2;
      ctx!.stroke();
    }

    /* ── plant snapshots ──
     * A plant drawn leaf by leaf is nearly all of a frame's cost. On a
     * machine that can't keep up (`motion`), a moving view draws each plant
     * from a picture of it taken a moment ago — moved and scaled to where the
     * plant now stands, and as sharp as ever — and takes a few again each
     * frame, those the view has turned or zoomed furthest from. A still view
     * is drawn leaf by leaf, as ever. */
    type Snap = {
      /** what the plant looked like, short of the camera */
      key: string;
      pic: ImageBitmap | HTMLCanvasElement;
      /** the plant's middle; the way the eye looked at it, and the pixels a
       *  foot there, when it was taken */
      at: [number, number, number];
      dir: number[];
      pxFt: number;
      /** the picture's corner from the middle's point on screen, CSS px */
      ox: number;
      oy: number;
      /** what taking it cost, ms */
      ms: number;
    };
    const snaps = new Map<string, Snap>();
    const letGo = (sn: Snap) => {
      if (typeof ImageBitmap !== "undefined" && sn.pic instanceof ImageBitmap) sn.pic.close();
    };
    // Where a snapshot is drawn before it's kept as a bitmap — the fastest
    // thing to lay down — or, without OffscreenCanvas, kept as is.
    const easel = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1);
    let snapping = false;
    /** The snapshots to take again this frame (see `due`). */
    let retake = new Set<string>();

    /** Draws a plant's body from its snapshot, taking it first if it's
     *  missing, out of date or due. False when the plant should be drawn as
     *  ever: too big a picture, or reaching behind the eye. */
    function fromSnap(id: string, key: string, x: number, z: number, h: number, r: number, body: () => void) {
      // Round the plant, with room for a bloom stalk over its height.
      const top = h * 1.3 + 0.5;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const y of [0, top]) {
        for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
          const q = P(x + dx, y, z + dz);
          if (q[2] <= 1) return false;
          x0 = Math.min(x0, q[0]);
          y0 = Math.min(y0, q[1]);
          x1 = Math.max(x1, q[0]);
          y1 = Math.max(y1, q[1]);
        }
      }
      // On whole pixels, so a picture that hasn't changed size is laid down
      // pixel for pixel.
      [x0, y0] = [Math.floor((x0 - 4) * dpr) / dpr, Math.floor((y0 - 4) * dpr) / dpr];
      [x1, y1] = [x1 + 4, y1 + 4];
      if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) return true; // off screen
      if ((x1 - x0) * (y1 - y0) > W * H * 0.5) return false;
      const at: [number, number, number] = [x, h / 2, z];
      const m = P(...at);
      let sn = snaps.get(id);
      if (!sn || sn.key !== key || retake.has(id)) {
        const t0 = performance.now();
        const old = sn?.pic;
        const pic = easel ?? (old instanceof HTMLCanvasElement ? old : document.createElement("canvas"));
        const [pw, ph] = [Math.ceil((x1 - x0) * dpr), Math.ceil((y1 - y0) * dpr)];
        if (pic.width !== pw || pic.height !== ph) {
          pic.width = pw;
          pic.height = ph;
        }
        // The plant's drawing takes either kind of 2D context alike.
        const pc = pic.getContext("2d") as CanvasRenderingContext2D;
        pc.setTransform(1, 0, 0, 1, 0, 0);
        pc.clearRect(0, 0, pw, ph);
        // The plant drawn where it stands on screen, into its picture.
        pc.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
        pc.save();
        const [into, leaves] = [ctx, thin];
        ctx = pc;
        thin = 1;
        try {
          body();
        } finally {
          ctx = into;
          thin = leaves;
          pc.restore();
        }
        if (sn) letGo(sn);
        const kept = easel ? easel.transferToImageBitmap() : (pic as HTMLCanvasElement);
        sn = { key, pic: kept, at, dir: norm(sub(at, eye)), pxFt: focal / m[2], ox: x0 - m[0], oy: y0 - m[1], ms: performance.now() - t0 };
        snaps.set(id, sn);
      }
      const k = focal / m[2] / sn.pxFt;
      if (Math.abs(k - 1) < 0.04) {
        // Near enough its own size: copied, not resampled — far cheaper.
        const px = (v: number) => Math.round(v * dpr) / dpr;
        ctx.drawImage(sn.pic, px(m[0] + sn.ox), px(m[1] + sn.oy), sn.pic.width / dpr, sn.pic.height / dpr);
      } else {
        ctx.drawImage(sn.pic, m[0] + sn.ox * k, m[1] + sn.oy * k, (sn.pic.width / dpr) * k, (sn.pic.height / dpr) * k);
      }
      return true;
    }

    /** The snapshots to take again this frame: those the view has turned
     *  (by more than 1.5°) or zoomed (by more than 12%) furthest from, as
     *  many as SNAP_BUDGET_MS allows. Ones of plants no longer there go. */
    function due(placed: Instance[]) {
      const here = new Set(placed.map((p) => p.id));
      const off: [number, string, number][] = [];
      for (const [id, sn] of snaps) {
        if (!here.has(id)) {
          letGo(sn);
          snaps.delete(id);
          continue;
        }
        const turn = (Math.acos(Math.min(1, dot(norm(sub(sn.at, eye)), sn.dir))) * 180) / Math.PI;
        const zoom = Math.abs(Math.log(focal / P(...sn.at)[2] / sn.pxFt));
        const by = turn / 1.5 + zoom / Math.log(1.12);
        if (by > 1) off.push([by, id, sn.ms]);
      }
      off.sort((a, b) => b[0] - a[0]);
      const out = new Set<string>();
      let spent = 0;
      for (const [, id, ms] of off) {
        if (spent > SNAP_BUDGET_MS) break;
        out.add(id);
        spent += ms;
      }
      return out;
    }

    /** Whether a plant is drawn picked, or hovered. */
    function picksOf(inst: Instance) {
      const st = stateRef.current;
      // Editing addresses ONE plant; browsing still highlights the species,
      // which is how a designer finds where they put the hopseeds.
      const sel = st.editing
        ? st.selectedId === inst.id || picked.has(inst.id)
        : st.selected === inst.model;
      // Nothing else says a plant is clickable, or WHICH one a click would
      // land on — the hit radius is generous and the symbols crowd. The
      // site plan's designer picks on the click alone, as the headset does.
      const hover = st.editing && !sel && !designerRef.current && hoverRef.current === inst.id;
      return { sel, hover };
    }

    function drawInstance(inst: Instance, g: number, t: number, snap = false) {
      const { meta } = inst;
      const { sel, hover } = picksOf(inst);
      const grows = !["boulder", "poolPrefab", "light"].includes(meta.kind);
      const gr = grows ? g : 1;
      const stroke = sel || hover ? GOLD : verde(0.85);
      const fill = sel ? gold(0.14) : hover ? gold(0.07) : verde(0.08);
      const lw = sel ? 2 : hover ? 1.8 : 1.4;
      // A boulder is the rock its size places; a plant, its mature size.
      const sf = sizeFactor(inst.model, meta.kind, inst.scale);
      const h = meta.renderHeightFt * gr * sf;
      const rw = (meta.matureWidthFt / 2) * gr * sf;
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

      ctx!.globalAlpha = bodyA * fade;
      const body = () => {
        if (inst.model === "WhiteDawnLantana") {
          drawWhiteDawnBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "PurpleLantana") {
          drawPurpleLantanaBody(x, z, h, rw, symRot, inst.id, sel || hover);
        } else if (inst.model === "YellowLantana") {
          drawYellowLantanaBody(x, z, h, rw, symRot, inst.id, sel || hover);
        } else if (inst.model === "GreenHopseed") {
          drawHopseedBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "TexasSage") {
          drawTexasSageBody(x, z, h, rw, inst.id, sel || hover, lw);
        } else if (inst.model === "YellowBells") {
          drawYellowBellsBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "RedBirdOfParadise") {
          drawRedBirdBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "Jojoba") {
          drawJojobaBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "LittleJohnBottlebrush") {
          drawBottlebrushBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "PaloVerde") {
          drawPaloVerdeBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "HoneyMesquite") {
          drawMesquiteBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (EBONY_MODELS.has(inst.model)) {
          drawEbonyBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (MULGA_MODELS.has(inst.model)) {
          drawMulgaBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "Vitex") {
          drawChasteBody(x, z, h, rw, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "MexicanFencePost") {
          drawFencePostBody(x, z, h, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "OrganPipe") {
          drawOrganPipeBody(x, z, h, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "ArgentineToothpick") {
          drawToothpickBody(x, z, h, symRot, inst.id, sel || hover, lw);
        } else if (inst.model === "TotemPole") {
          drawTotemBody(x, z, h, symRot, sel || hover);
        } else if (inst.model === "MadagascarPalm") {
          drawMadagascarBody(x, z, h, symRot, sel || hover, lw);
        } else if (inst.model === "Firestick") {
          drawFirestickBody(x, z, h, symRot, sel || hover, lw);
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
          const { top, fronds } = palmFronds(x, z, h, gr);
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
          for (const [tip3, c3] of fronds) {
            const tip = P(...tip3);
            const c = P(...c3);
            ctx!.beginPath();
            ctx!.moveTo(tp[0], tp[1]);
            ctx!.quadraticCurveTo(c[0], c[1], tip[0], tip[1]);
            ctx!.stroke();
          }
        } else if (meta.kind === "saguaro" || meta.kind === "columnar") {
          const base = P(x, 0, z);
          const top = P(x, h, z);
          const bodyR = saguaroR(rw);
          ctx!.strokeStyle = stroke;
          ctx!.lineCap = "round";
          ctx!.lineWidth = Math.max(ftPx(x, z, bodyR) * 2, 3);
          ctx!.beginPath();
          ctx!.moveTo(base[0], base[1]);
          ctx!.lineTo(top[0], top[1]);
          ctx!.stroke();
          if (meta.kind === "saguaro") {
            // Round elbows, whatever the plant drawn before left set.
            ctx!.lineJoin = "round";
            ctx!.lineWidth = Math.max(ftPx(x, z, bodyR) * 1.2, 2);
            for (const arm of saguaroArms(x, z, h, gr)) {
              ctx!.beginPath();
              arm.forEach((p, i) => {
                const q = P(...p);
                if (i) ctx!.lineTo(q[0], q[1]);
                else ctx!.moveTo(q[0], q[1]);
              });
              ctx!.stroke();
            }
          }
          ctx!.lineCap = "butt";
        } else if (inst.model === "GoldenBarrel") {
          drawGoldenBarrelBody(x, z, h, rw, symRot, inst.id, sel || hover);
        } else if (meta.kind === "barrel") {
          drawBarrelBody(x, z, h, rw, symRot, stroke, fill, lw);
        } else if (inst.model === "AZBoulder1") {
          drawAzBoulderBody(x, z, rw, symRot, sel || hover, lw);
        } else if (meta.kind === "boulder") {
          drawBoulderBody(x, z, rw * 2, h, symRot, planSym, inst.id, sel, lw);
        } else if (inst.model === "Ocotillo") {
          drawOcotilloBody(x, z, h, rw, symRot, inst.id, sel || hover);
        } else if (inst.model.startsWith("YuccaRostrata")) {
          drawBeakedYuccaBody(x, z, h, rw, symRot, inst.id, sel || hover);
        } else if (inst.model === "BlackTipAgave") {
          drawBlackTipBody(x, z, h, rw, symRot, sel || hover);
        } else if (inst.model === "BlueGlowAgave") {
          drawBlueGlowBody(x, z, h, rw, symRot, sel || hover);
        } else if (inst.model === "AgaveTruncata") {
          drawTruncataBody(x, z, h, symRot, sel || hover, lw);
        } else if (inst.model === "AgaveAmericana") {
          drawAmericanaBody(x, z, h, symRot, sel || hover, lw);
        } else if (inst.model === "TropicalAgave") {
          drawTropicalAgaveBody(x, z, h, symRot, sel || hover, lw);
        } else if (inst.model === "AloeFerox") {
          drawFeroxBody(x, z, h, symRot, sel || hover, lw);
        } else if (inst.model === "Aloe Vera") {
          drawAloeBody(x, z, h, rw, symRot, inst.id, sel || hover ? gold : verde, stroke, lw, !(sel || hover));
        } else if (meta.kind === "rosette") {
          const bp = P(x, 0, z);
          ctx!.strokeStyle = stroke;
          ctx!.lineWidth = Math.max(lw - 0.2, 1.2);
          for (const [tip3, c3] of rosetteLeaves(x, z, h, rw)) {
            const tip = P(...tip3);
            const c = P(...c3);
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
          // Round corners, whatever the plant drawn before left set.
          ctx!.lineJoin = "round";
          ctx!.stroke();
          pathPoly(shrink(corners, 0.75));
          ctx!.strokeStyle = WATER_LINE;
          ctx!.lineWidth = 1;
          ctx!.stroke();
        }
      };
      // Nothing to see at no opacity (a plant in the flat plan view), nor
      // here when WebGL drew it.
      if (bodyA * fade > 0 && !glDrawn.has(inst.id)) {
        const key = `${inst.model}|${x}|${z}|${h}|${rw}|${symRot}|${sel}|${hover}`;
        const reach = meta.kind === "palm" ? Math.max(rw, 4.5 * gr) : meta.kind === "saguaro" ? Math.max(rw, 2.2 * gr) : rw;
        const drawn = snap && snapping && bodyA * fade === 1 && fromSnap(inst.id, key, x, z, h, reach * 1.25 + 0.3, body);
        if (!drawn) body();
      }

      ctx!.globalAlpha = fade;

      /* ground symbol + label + hit target */
      const symR = Math.max(rw, meta.kind === "poolPrefab" ? 5 * inst.scale : 1);
      const c0 = P(x, 0.02, z);
      // The plan symbol: the mark the blueprint prints, drawn flat on the
      // ground — so plan mode here and the printed sheet are one drawing.
      ctx!.globalAlpha = markA * fade;
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
      ctx!.globalAlpha = fade;
      // The designer names the picked plant in the buttons beside it.
      const labelA = designerRef.current ? t : Math.max(t, sel ? 1 : 0);
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
      // And by its body: in 3D a tree is reached for by its crown, well
      // above the mark on the ground.
      if (bodyA > 0.3 && h > 1.5) {
        const b = P(x, h * 0.55, z);
        hits.push({ model: inst.model, id: inst.id, sx: b[0], sy: b[1], r: Math.max(ftPx(x, z, rw) * 0.8, 16) });
      }
    }

    /** The sand, and the ground with its grid clipped to the boundary (or
     *  the content's bounds). */
    function drawGround(groundPts: [number, number][]) {
      ctx!.fillStyle = SAND;
      ctx!.fillRect(0, 0, W, H);
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
    }

    function render() {
      updateCam();
      picked = new Set(stateRef.current.picks ? stateRef.current.picks.split(",") : []);
      const t = cur.planT;
      const g = cur.growth;
      ctx!.clearRect(0, 0, W, H);
      hits.length = 0;

      const groundPts: [number, number][] =
        scene.boundary.length >= 3
          ? scene.boundary
          : [
              [cx - R, cz - R],
              [cx + R, cz - R],
              [cx + R, cz + R],
              [cx - R, cz + R],
            ];
      const drag = dragRef.current;
      const lifted = drag?.moved ? drag : null;
      const placed = scene.instances.map((at) => {
        const from = drag?.from.get(at.id);
        return from ? { ...at, x: from[0] + drag!.dx, z: from[1] + drag!.dz } : at;
      });

      // WebGL: the yard and the plants it knows under this canvas, which
      // then draws only what's over them — labels, marks, and the plants it
      // doesn't know yet. A plant being carried is still drawn here, raised.
      const gl = glLayer();
      const glPlants: GLPlant[] = [];
      if (gl) {
        for (const inst of placed) {
          if (!GL_MODELS.has(inst.model) || lifted?.from.has(inst.id)) continue;
          const { sel, hover } = picksOf(inst);
          const { h, rw } = matureOf(inst, g);
          glPlants.push({
            id: inst.id,
            model: inst.model,
            x: inst.x,
            z: inst.z,
            h,
            rw,
            rot: (inst.yawDeg * Math.PI) / 180,
            // A plain boulder turns gold when it's picked, not hovered.
            gold: sel || (hover && (inst.meta.kind !== "boulder" || inst.model === "AZBoulder1")),
            picked: sel,
            lw: sel ? 2 : hover ? 1.8 : 1.4,
            g,
            scale: inst.scale,
            planBody: inst.meta.kind === "poolPrefab",
          });
        }
      }
      const glDrew = !!gl && gl.draw({ eye, rt, up, fw, focal, W, H }, glYard, glPlants, 1 - t);
      glDrawn = new Set(glDrew ? glPlants.map((s) => s.id) : []);
      if (!glDrew) drawGround(groundPts);

      /* hardscape areas */
      for (const hs of scene.hardscape) {
        if (!glDrew) {
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
        }
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
        if (glDrew) {
          // WebGL drew it.
        } else if (f.kind === "Pool") {
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
      if (scene.boundary.length >= 3 && !glDrew) {
        pathPoly(scene.boundary);
        ctx!.strokeStyle = verde(0.85);
        ctx!.lineWidth = 1.6;
        ctx!.setLineDash([7, 4]);
        ctx!.stroke();
        ctx!.setLineDash([]);
      }

      /* removal markers */
      for (const rm of glDrew ? [] : scene.removals) {
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
      if (snapping) retake = due(placed);
      // What's being carried: a soft shadow on the ground under each, and
      // the ring it grows to — drawn first, so everything stands on them.
      if (lifted) {
        for (const inst of placed) if (lifted.from.has(inst.id)) groundMarks(inst, g, true);
      }
      const items: { d: number; draw: () => void }[] = placed.map((inst) => ({
        d: P(inst.x, 0, inst.z)[2],
        draw: () => {
          if (!lifted?.from.has(inst.id)) return drawInstance(inst, g, t, true);
          // Held up off the ground: the same drawing, raised on screen by
          // what a little height measures there.
          const lift = Math.min(3, Math.max(1.2, matureOf(inst, g).h * 0.2));
          const a = P(inst.x, 0, inst.z);
          const b = P(inst.x, lift, inst.z);
          ctx!.save();
          ctx!.translate(b[0] - a[0], b[1] - a[1]);
          drawInstance(inst, g, t);
          ctx!.restore();
        },
      }));
      // The plant about to be planted, faint, where a click would put it,
      // over the ring it will grow to.
      const planting = designerRef.current?.placing;
      const ghostAt = ghostRef.current;
      if (planting && ghostAt) {
        const ghost: Instance = {
          id: "",
          model: planting.model,
          meta: speciesMeta(planting.model),
          x: ghostAt[0],
          z: ghostAt[1],
          yawDeg: 0,
          scale: planting.scale,
          containerType: null,
        };
        groundMarks(ghost, g, false);
        items.push({
          d: P(ghost.x, 0, ghost.z)[2],
          draw: () => {
            const n = hits.length;
            fade = 0.5;
            drawInstance(ghost, g, t);
            fade = 1;
            ctx!.globalAlpha = 1;
            hits.length = n;
          },
        });
      }
      for (const f of scene.features) {
        if (!["House", "Garage", "Shed"].includes(f.kind)) continue;
        const [fx, fz] = centroid(f.pts);
        const hFt = f.kind === "Shed" ? 8 : 9;
        items.push({
          d: P(fx, hFt / 2, fz)[2],
          draw: () => drawExtruded(f.pts, hFt, f.label, t, !glDrew),
        });
      }
      items.sort((a, b) => b.d - a.d);
      for (const it of items) it.draw();
      anchor(placed);
    }

    /** How tall and how wide a plant is drawn, in feet. */
    function matureOf(inst: Instance, g: number) {
      const grows = !["boulder", "poolPrefab", "light"].includes(inst.meta.kind);
      const sf = sizeFactor(inst.model, inst.meta.kind, inst.scale);
      return { h: inst.meta.renderHeightFt * (grows ? g : 1) * sf, rw: (inst.meta.matureWidthFt / 2) * (grows ? g : 1) * sf };
    }

    /** Under a plant being placed or carried: the ring it grows to, and,
     *  carried, the shadow of it held up off the ground. */
    function groundMarks(inst: Instance, g: number, shadow: boolean) {
      const { rw } = matureOf(inst, g);
      const r = Math.max(rw, 0.5);
      ctx!.save();
      if (shadow) {
        // Three soft rings of shade, darker to the middle: a blur that
        // costs nothing and looks the same in every browser.
        for (const [k, a] of [[0.95, 0.08], [0.72, 0.1], [0.48, 0.13]] as const) {
          circle3D(inst.x, 0.01, inst.z, r * k, 28);
          ctx!.fillStyle = `rgba(28, 42, 33, ${a})`;
          ctx!.fill();
        }
      }
      circle3D(inst.x, 0.02, inst.z, r, 36);
      ctx!.setLineDash([5, 4]);
      ctx!.strokeStyle = verde(0.55);
      ctx!.lineWidth = 1.2;
      ctx!.stroke();
      ctx!.restore();
    }

    // The picked plants' place on screen, told to the designer when it
    // changes, so the buttons beside them can follow.
    let anchored = "";
    function anchor(placed: Instance[]) {
      const d = designerRef.current;
      if (!d?.onAnchor) return;
      const st = stateRef.current;
      const ids = new Set(st.picks ? st.picks.split(",") : st.selectedId ? [st.selectedId] : []);
      let at: { x0: number; y0: number; x1: number; y1: number } | null = null;
      if (ids.size && !dragRef.current?.moved && !d.placing) {
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const inst of placed) {
          if (!ids.has(inst.id)) continue;
          const { h, rw } = matureOf(inst, cur.growth);
          const r = ftPx(inst.x, inst.z, Math.max(rw, 0.5));
          const foot = P(inst.x, 0, inst.z);
          const top = P(inst.x, h, inst.z);
          [x0, y0] = [Math.min(x0, foot[0] - r), Math.min(y0, top[1], foot[1] - r * 0.5)];
          [x1, y1] = [Math.max(x1, foot[0] + r), Math.max(y1, foot[1] + r * 0.5)];
        }
        if (x0 < x1) at = { x0, y0, x1, y1 };
      }
      const key = at ? [at.x0, at.y0, at.x1, at.y1].map((v) => Math.round(v)).join() : "";
      if (key === anchored) return;
      anchored = key;
      d.onAnchor(at);
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
      let br = 1e9;
      for (const h of hits) {
        const d = Math.hypot(h.sx - mx, h.sy - my);
        if (d >= h.r) continue;
        // The smallest plant under the pointer wins — a shrub under a
        // tree's canopy is the one being reached for — then the nearest.
        if (h.r < br - 0.5 || (h.r < br + 0.5 && d < bd)) {
          bd = d;
          br = h.r;
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
      // A hand on the view takes over from the move into it.
      cam.tween = undefined;
      cv!.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      dragDist = 0;
      cv!.style.cursor = "grabbing";
      // In the designer, pressing on a plant takes hold of the plant, not
      // the view. Shift and the other buttons still pan.
      const d = designerRef.current;
      if (!d || d.placing || !stateRef.current.editing || e.button !== 0 || e.shiftKey || pointers.size > 1) return;
      const hit = nearest(e);
      const inst = hit ? scene.instances.find((i) => i.id === hit.id) : null;
      const g = inst ? groundAt(...canvasXY(e)) : null;
      if (!inst || !g) return;
      // Pressing one of several picked takes hold of them all.
      const st = stateRef.current;
      const group = st.picks ? st.picks.split(",") : [];
      const ids = group.includes(inst.id) ? group : [inst.id];
      if (!group.includes(inst.id)) onSelectRef.current?.(inst.id);
      const from = new Map<string, [number, number]>();
      for (const id of ids) {
        const at = scene.instances.find((i) => i.id === id);
        if (at) from.set(id, [at.x, at.z]);
      }
      dragRef.current = { from, held: inst.id, dx: 0, dz: 0, ox: inst.x - g[0], oz: inst.z - g[1], moved: false, done: false };
      cv!.style.cursor = "move";
    };
    const onLeave = () => {
      hoverRef.current = null;
      ghostRef.current = null;
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) {
        const over = nearest(e);
        const d = designerRef.current;
        if (d?.placing) {
          ghostRef.current = groundAt(...canvasXY(e));
          hoverRef.current = null;
          cv!.style.cursor = "crosshair";
          return;
        }
        cv!.style.cursor = over ? (d ? "move" : "pointer") : "grab";
        hoverRef.current = over?.id ?? null;
        return;
      }
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      const drag = dragRef.current;
      if (drag && !drag.done && pointers.size === 1) {
        dragDist += Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]);
        const g = groundAt(...canvasXY(e));
        const held = drag.from.get(drag.held);
        if (g && held && dragDist >= 4) {
          drag.dx = g[0] + drag.ox - held[0];
          drag.dz = g[1] + drag.oz - held[1];
          drag.moved = true;
        }
        return;
      }
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
      const drag = dragRef.current;
      if (drag && !drag.done) {
        drag.done = true;
        if (!drag.moved) {
          dragRef.current = null;
          // A click on one of a group picks it alone.
          if (drag.from.size > 1) onSelectRef.current?.(drag.held);
          return;
        }
        designerRef.current?.onMove(
          [...drag.from].map(([id, [x, z]]) => {
            const [lx, lz] = sceneToLocal(scene, x + drag.dx, z + drag.dz);
            return { id, x: lx, z: lz };
          }),
        );
        // The moved design rebuilds the scene, which lets go of it; if
        // nothing came back, put the plant back where it was.
        requestAnimationFrame(() => {
          if (dragRef.current === drag) dragRef.current = null;
        });
        return;
      }
      const planting = designerRef.current;
      if (dragDist < 6 && planting?.placing) {
        const g = groundAt(...canvasXY(e));
        if (g) planting.onPlace(...sceneToLocal(scene, g[0], g[1]));
        return;
      }
      if (dragDist < 6) {
        const hit = nearest(e);
        if (stateRef.current.editing) {
          onSelectRef.current?.(hit?.id ?? null, e.shiftKey);
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
      if (dragRef.current && !dragRef.current.done) dragRef.current = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.tween = undefined;
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
    if (!embed || interactive) {
      cv.addEventListener("pointerdown", onDown);
      cv.addEventListener("pointermove", onMove);
      cv.addEventListener("pointerleave", onLeave);
      cv.addEventListener("pointerup", onUp);
      cv.addEventListener("pointercancel", onCancel);
      cv.addEventListener("wheel", onWheel, { passive: false });
      cv.addEventListener("dblclick", onDblClick);
      cv.addEventListener("contextmenu", onContextMenu);
    }

    // Back to 2D: up to straight down, facing `north`, over the ground in
    // the middle now, which keeps its size.
    flattenRef.current = (north) => {
      if (H === 0) return null;
      const hold = ((H / 2) * cur.zoom) / (Math.tan((cur.fov * Math.PI) / 360) * cur.dist);
      const now: Tweened = { az: cur.az, el: cur.el, dist: cur.dist, fov: cur.fov, planT: cur.planT, panX: cur.panX, panZ: cur.panZ };
      const turn = (((facing(north) - cur.az) % 360) + 540) % 360 - 180;
      cam.tween = {
        from: now,
        to: { ...now, az: cur.az + turn, el: VPLAN.el, dist: VPLAN.dist, fov: VPLAN.fov, planT: 1 },
        start: performance.now(),
        dur: 650,
        hold,
      };
      const at = sceneToLocal(scene, cx + cur.panX, cz + cur.panZ);
      return { at, pxPerM: hold * METERS_TO_FEET };
    };

    /* ── loop ── */
    let raf = 0;
    // What the last drawing showed. A still view isn't drawn again: a big
    // yard costs a whole frame to draw, sixty times a second, for nothing.
    let drawn = "";
    // When the last drawing was made, whether the frame before this one drew
    // too (the view is moving), and whether it was drawn light.
    let lastDraw = -Infinity;
    let wasDrawing = false;
    let light = false;
    /** Draws the view at a `motion` level: 0 in full; 1 its plants from
     *  snapshots; 2 also with fewer leaves on any drawn as ever. */
    const draw = (level: number) => {
      snapping = level >= 1;
      thin = level >= 2 ? 2 : 1;
      render();
      snapping = false;
      thin = 1;
    };
    const frame = () => {
      if (embed && !interactive && !reducedMotion) {
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
      const tw = cam.tween;
      if (tw && H > 0) {
        const u = reducedMotion ? 1 : Math.min(1, Math.max(0, (performance.now() - tw.start) / tw.dur));
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(2 - 2 * u, 3) / 2;
        for (const k of TWEENED) cur[k] = tgt[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
        // The ground in the middle keeps its size as the angle changes.
        cur.zoom = tgt.zoom = (tw.hold * cur.dist * Math.tan((cur.fov * Math.PI) / 360)) / (H / 2);
        if (u >= 1) cam.tween = undefined;
      }
      for (const k of ["az", "el", "dist", "fov", "zoom", "planT", "growth", "panX", "panZ"] as const) {
        cur[k] += (tgt[k] - cur[k]) * K;
        if (Math.abs(tgt[k] - cur[k]) < 0.0005) cur[k] = tgt[k];
      }
      const st = stateRef.current;
      const dr = dragRef.current;
      const gh = ghostRef.current;
      const showing = [
        cur.az, cur.el, cur.dist, cur.fov, cur.zoom, cur.planT, cur.growth, cur.panX, cur.panZ,
        W, H, st.mode, st.selected, st.editing, st.selectedId, st.picks, hoverRef.current,
        dr?.dx, dr?.dz, dr?.moved, gh?.[0], gh?.[1], designerRef.current?.placing?.model,
        rendererRef.current,
      ].join();
      const now = performance.now();
      if (W > 0 && H > 0 && showing !== drawn) {
        if (wasDrawing) keepPace(now - lastDraw);
        light = wasDrawing && motion.level > 0;
        draw(light ? motion.level : 0);
        drawn = showing;
        lastDraw = now;
        wasDrawing = true;
      } else {
        wasDrawing = false;
        if (light && now - lastDraw > SETTLE_MS) {
          // It stopped: the same view again, in full.
          draw(0);
          light = false;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      snaps.forEach(letGo);
      flattenRef.current = null;
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
  }, [scene, selectSpecies, embed, interactive]);

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
      <canvas ref={glRef} aria-hidden className="absolute inset-0 h-full w-full" />
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full touch-none ${
          embed && !interactive ? "" : "cursor-grab"
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
