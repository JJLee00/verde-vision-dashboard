"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from "react";
import { BASEMAPS, LOT_LINES, MAX_NATIVE_ZOOM } from "@/lib/blueprint/esri";
import { ringToXZMeters, xzMetersToRing } from "@/lib/blueprint/normalize";
import type { MapOffset } from "@/lib/blueprint/trace";
import type { LatLng } from "@/lib/blueprint/types";
import {
  bezierAt,
  centroid,
  crosses,
  FEET_PER_METER,
  mainHouse,
  MAX_REACH_M,
  outlineOf,
  pathLength,
  polygonArea,
  edgeCurves,
  edgeRuns,
  withCurves,
  type FeatureType,
  type PlanFeature,
  type PlanFrame,
  type PlanImage,
  type PlanPlant,
  type PlanSurface,
  type UnderlayKind,
  type XZ,
} from "@/lib/site-plan/plan";
import { catalogOf, newId, surfaceSqFtOf } from "@/lib/site-plan/design";
import { plantForKey } from "@/lib/design-edit";
import {
  BoundaryArt,
  byLayer,
  FeatureArt,
  INK,
  pathOf,
  PlanPatterns,
  SHEET_PAPER,
  SurfaceArt,
  SurfacePatterns,
  type Pt,
} from "./drawing";
import { plantAt, PlantLayer, plantRadiusM, type SheetPlant } from "./plants";
import {
  addCorner,
  dist,
  dropCorner,
  feetInches,
  fitView,
  gridAt,
  clampZoom,
  nearestOnRun,
  nearestOnSegment,
  parseLength,
  pointInPolygon,
  referenceAngles,
  rotateAbout,
  smoothCorners,
  unionBox,
  zoomRange,
  snap,
  sqFt,
  toPlan,
  toScreen,
  type Size,
  type SnapContext,
  type Snapped,
  type View,
} from "./geometry";
import { CopyIcon, CurveIcon, LockIcon, RedoIcon, TrashIcon, UndoIcon } from "./icons";

/**
 * The drafting sheet: the locked photo of the yard under a sheet of paper,
 * and everything traced on it drawn the way the blueprint draws it.
 *
 * Its own surface rather than a web map: a drafting sheet snaps in metres,
 * squares corners to the house, and hit-tests shapes to the pixel, and none
 * of that fits a map that scrolls like Google Maps. The photo is Esri's
 * tiles, fetched live and laid in the plan's own frame — never saved, since
 * Esri's licence allows tracing but not offline copies.
 *
 * The sheet owns what's in flight (a half-drawn shape, a drag); the plan
 * itself lives with the builder, which keeps the undo history and saves.
 */

export const BOUNDARY_ID = "boundary";

/** What one undo step covers: the shapes and the design, not the view or
 *  the photo. */
export type Doc = {
  boundary: XZ[];
  boundarySmooth?: boolean[];
  boundaryLocked?: boolean;
  features: PlanFeature[];
  mainHouseId?: string;
  plants: PlanPlant[];
  surfaces: PlanSurface[];
};
/** `place` plants whatever the catalog has picked, a click at a time. */
export type Tool = "select" | "area" | "rect" | "line" | "circle" | "measure" | "place";
/** A new surface of a material, drawn with the shape tools. */
export type SurfaceTarget = `surface:${string}`;
/** What the drawing tools make: a feature type, the yard boundary, or a
 *  surface. */
export type DrawTarget = FeatureType | "Boundary" | SurfaceTarget;
export const surfaceTarget = (style: string): SurfaceTarget => `surface:${style}`;
export const styleOf = (t: DrawTarget): string | null => (t.startsWith("surface:") ? t.slice(8) : null);
/** Which tab the sheet is working for: the yard as it is, or the design. */
export type Layer = "site" | "design";
/** A plant to place: the catalog plant and the size picked for it. */
export type Placing = { key: string; size: string };
/** What clicks do to an uploaded plan: drag it into line, measure a length
 *  on it to set its scale, or follow its north arrow — or, on a plan
 *  started from the upload, drag the photo under it instead. */
export type ImageTool = "align" | "scale" | "north" | "photo";

export interface SheetHandle {
  /** The part of the plan on screen now, inset a little: what Lock view keeps. */
  visibleBox(): PlanFrame | null;
  fit(box: PlanFrame): void;
  /** Moves the view by (dx, dz) metres, for when the origin under it moved
   *  by the opposite: nothing on screen moves. */
  shift(dx: number, dz: number): void;
  /** What's on screen: the middle, and pixels a metre. Null before it has a size. */
  view(): View | null;
  /** Puts the sheet over that spot, at that scale. */
  show(v: View): void;
}

/** The desk the sheet of paper lies on, round the photo frame. */
const DESK = "#e4dccb";
/** The desk round the photo, washed with the tab's colour: blue on the
 *  Blueprint tab, green on the Design tab. */
const DESK_TINTED = `color-mix(in srgb, var(--accent) 12%, ${DESK})`;

/** Room left around the locked frame, in screen pixels. */
export const LOCK_INSET = 28;
/** A pointer that moves less than this between down and up clicked. */
const CLICK_SLOP = 4;
const MIN_EDGE_M = 0.1;

type Shape = {
  pts: XZ[];
  closed: boolean;
  radius?: number;
  smooth?: boolean[];
  locked: boolean;
  feature?: PlanFeature;
  surface?: PlanSurface;
};

export function shapeOf(doc: Doc, id: string): Shape | null {
  if (id === BOUNDARY_ID) {
    return doc.boundary.length >= 3
      ? { pts: doc.boundary, closed: true, smooth: doc.boundarySmooth, locked: !!doc.boundaryLocked }
      : null;
  }
  const f = doc.features.find((x) => x.id === id);
  if (f) return { pts: f.points, closed: f.shape !== "line", radius: f.radius, smooth: f.smooth, locked: !!f.locked, feature: f };
  const s = doc.surfaces.find((x) => x.id === id);
  if (s) return { pts: s.points, closed: true, radius: s.radius, smooth: s.smooth, locked: !!s.locked, surface: s };
  return null;
}

/** A placed plant by id. */
export const plantOf = (doc: Doc, id: string | null) => (id ? (doc.plants.find((p) => p.id === id) ?? null) : null);

/** A plan plant as the sheet draws it. */
export function sheetPlant(p: PlanPlant): SheetPlant | null {
  const c = catalogOf(p);
  return c ? { id: p.id, model: c.size.modelName, scale: c.size.heightMultiplier, x: p.x, z: p.z, rotation: p.rotation } : null;
}

type Editable = { points: XZ[]; smooth?: boolean[]; locked?: boolean; radius?: number };

/** Changes one shape, a feature or a surface, by id. */
function editShape(doc: Doc, id: string, change: <T extends Editable>(x: T) => T): Doc {
  if (doc.features.some((f) => f.id === id)) {
    return { ...doc, features: doc.features.map((f) => (f.id === id ? change(f) : f)) };
  }
  return { ...doc, surfaces: doc.surfaces.map((s) => (s.id === id ? change(s) : s)) };
}

/** A shape's outline with its curves filled in. */
const outline = (s: Pick<Shape, "pts" | "smooth" | "closed">) => withCurves(s.pts, s.smooth, s.closed);

/** Moves a shape's corners; its curves ride along. */
function withPoints(doc: Doc, id: string, pts: XZ[]): Doc {
  if (id === BOUNDARY_ID) return { ...doc, boundary: pts };
  return editShape(doc, id, (f) => ({ ...f, points: pts }));
}

/** Sets a shape's corners and which are smooth together, for when the
 *  corners themselves change. */
export function withEdges(doc: Doc, id: string, pts: XZ[], smooth: boolean[] | undefined): Doc {
  const sm = smooth?.some(Boolean) ? smooth : undefined;
  if (id === BOUNDARY_ID) return { ...doc, boundary: pts, boundarySmooth: sm };
  return editShape(doc, id, (f) => ({ ...f, points: pts, smooth: sm }));
}

/** Smooths a shape's gentle corners — or, when it has any smooth corners,
 *  makes them all sharp again. */
export function toggleSmooth(doc: Doc, id: string): Doc {
  const s = shapeOf(doc, id);
  if (!s || s.radius != null) return doc;
  return withEdges(doc, id, s.pts, s.smooth?.some(Boolean) ? undefined : smoothCorners(s.pts, s.closed));
}

export function setLocked(doc: Doc, id: string, locked: boolean): Doc {
  if (id === BOUNDARY_ID) return { ...doc, boundaryLocked: locked || undefined };
  return editShape(doc, id, (f) => ({ ...f, locked: locked || undefined }));
}

export function removeShape(doc: Doc, id: string): Doc {
  if (id === BOUNDARY_ID) return { ...doc, boundary: [], boundarySmooth: undefined, boundaryLocked: undefined };
  return {
    ...doc,
    features: doc.features.filter((f) => f.id !== id),
    mainHouseId: doc.mainHouseId === id ? undefined : doc.mainHouseId,
    plants: doc.plants.filter((p) => p.id !== id),
    surfaces: doc.surfaces.filter((s) => s.id !== id),
  };
}

/** A copy of a shape a metre down and right — or of a plant, beside it —
 *  as a new, unlocked one. */
export function duplicate(doc: Doc, id: string): { doc: Doc; id: string } | null {
  const shift = (pts: XZ[]) => pts.map(([x, z]) => [x + 1, z + 1] as XZ);
  const f = doc.features.find((x) => x.id === id);
  if (f) {
    const copy: PlanFeature = { ...f, id: crypto.randomUUID(), points: shift(f.points), locked: undefined };
    return { doc: { ...doc, features: [...doc.features, copy] }, id: copy.id };
  }
  const s = doc.surfaces.find((x) => x.id === id);
  if (s) {
    const copy: PlanSurface = { ...s, id: newId(), points: shift(s.points), locked: undefined };
    return { doc: { ...doc, surfaces: [...doc.surfaces, copy] }, id: copy.id };
  }
  const p = doc.plants.find((x) => x.id === id);
  if (p) {
    const drawn = sheetPlant(p);
    const step = drawn ? Math.max(0.6, plantRadiusM(drawn) * 2) : 1;
    const copy: PlanPlant = { ...p, id: newId(), x: p.x + step };
    return { doc: { ...doc, plants: [...doc.plants, copy] }, id: copy.id };
  }
  return null;
}

/** What a shape is called in a sentence. */
export function nameOf(doc: Doc, id: string): string {
  if (id === BOUNDARY_ID) return "yard boundary";
  const f = doc.features.find((x) => x.id === id);
  if (f) return f.type === "Other" ? f.label?.trim() || "shape" : f.type.toLowerCase();
  const s = doc.surfaces.find((x) => x.id === id);
  if (s) return s.style.toLowerCase();
  const p = doc.plants.find((x) => x.id === id);
  if (p) return plantForKey(p.key)?.name ?? "plant";
  return "shape";
}

/* ── The photo ───────────────────────────────────────────────────── */

type Tile = { key: string; src: string; x: number; y: number; w: number; h: number };

/** Metres per pixel of a 256 px tile at zoom 0, at the equator. */
const M_PER_PX_Z0 = 156543.03392;
const MAX_TILES = 160;

const lngToX = (lng: number, n: number) => ((lng + 180) / 360) * n;
const latToY = (lat: number, n: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
};
const xToLng = (x: number, n: number) => (x / n) * 360 - 180;
const yToLat = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

/**
 * The tiles covering the screen, each placed by its own corners in plan
 * metres — the plan's projection, not the map's — so the photo sits exactly
 * where a traced corner says it is. `shift` moves the layer (the Map view's
 * offset to agree with the satellite).
 */
function tilesFor(
  template: string,
  origin: LatLng,
  view: View,
  size: Size,
  zoom: { min: number; max: number },
  shift: XZ
): Tile[] {
  if (size.w === 0 || size.h === 0) return [];
  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const want = Math.ceil(
    Math.log2(M_PER_PX_Z0 * Math.cos((origin.lat * Math.PI) / 180) * view.ppm * dpr) - 0.3
  );
  const z = Math.min(zoom.max, Math.max(zoom.min, want));
  const n = 2 ** z;
  const corner = (sx: number, sy: number) => {
    const [x, zz] = toPlan(view, size, [sx, sy]);
    return xzMetersToRing([[x - shift[0], zz - shift[1]]], origin)[0];
  };
  const nw = corner(0, 0);
  const se = corner(size.w, size.h);
  const x0 = Math.floor(lngToX(nw.lng, n));
  const x1 = Math.floor(lngToX(se.lng, n));
  const y0 = Math.floor(latToY(nw.lat, n));
  const y1 = Math.floor(latToY(se.lat, n));
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return [];
  const tiles: Tile[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const [[ax, az], [bx, bz]] = ringToXZMeters(
        [
          { lat: yToLat(ty, n), lng: xToLng(tx, n) },
          { lat: yToLat(ty + 1, n), lng: xToLng(tx + 1, n) },
        ],
        origin
      );
      const [sx0, sy0] = toScreen(view, size, [ax + shift[0], az + shift[1]]);
      const [sx1, sy1] = toScreen(view, size, [bx + shift[0], bz + shift[1]]);
      tiles.push({
        key: `${z}/${tx}/${ty}`,
        src: template.replace("{z}", String(z)).replace("{y}", String(ty)).replace("{x}", String(tx)),
        x: sx0,
        y: sy0,
        // Half a pixel over, so neighbours never show a hairline seam.
        w: sx1 - sx0 + 0.5,
        h: sy1 - sy0 + 0.5,
      });
    }
  }
  return tiles;
}

/** Regrid draws its lines mid-grey; recoloured so they read on each base. */
const LOT_LINE_FILTER: Record<UnderlayKind, string> = {
  satellite: "brightness(1.45) opacity(0.85) drop-shadow(0 0 1px rgba(0,0,0,0.9))",
  map: "brightness(0.5) opacity(0.5)",
  none: "brightness(0.5) opacity(0.5)",
};

/* ── The sheet ───────────────────────────────────────────────────── */

type Gesture =
  | { kind: "pan"; start: Pt; view: View; moved: boolean; onClick: (() => void) | null }
  | { kind: "vertex"; id: string; index: number; base: Doc; start: Pt; moved: boolean }
  | { kind: "move"; id: string; base: Doc; start: Pt; from: XZ; moved: boolean }
  | { kind: "rotate"; id: string; base: Doc; centre: XZ; a0: number }
  | { kind: "radius"; id: string; base: Doc }
  | { kind: "frame"; sides: FrameSides; base: PlanFrame; start: Pt; moved: boolean }
  | { kind: "plantMove"; id: string; base: Doc; start: Pt; from: XZ; moved: boolean }
  | { kind: "plantTurn"; id: string; base: Doc; centre: XZ; a0: number; r0: number }
  // `id`: the plant pressed on — a click without a drag picks it alone.
  | { kind: "groupMove"; id: string; ids: string[]; base: Doc; start: Pt; moved: boolean }
  | { kind: "box"; start: Pt; now: Pt }
  | { kind: "image"; how: "move" | "turn" | "size"; base: PlanImage; from: XZ }
  // An end of the scale line, nudged.
  | { kind: "imgPt"; index: number }
  // The plan spun round its middle (on screen, `centre`) to set its north.
  | { kind: "turnPlan"; centre: Pt; a0: number; r0: number }
  // The compass moved, to sit beside the plan's own north arrow.
  | { kind: "compass"; start: Pt; from: Pt }
  | { kind: "photo"; start: Pt; ppm: number };

/** Which of the frame's edges a handle moves: −1 the west or north
 *  edge, 1 the east or south, 0 neither. */
type FrameSides = { x: -1 | 0 | 1; z: -1 | 0 | 1 };

/** The smallest photo frame, in metres across. */
const MIN_FRAME_M = 10;


type Draft = { tool: Tool; target: DrawTarget; points: XZ[] };

export function Sheet({
  handle,
  doc,
  apply,
  undo,
  redo,
  canUndo,
  canRedo,
  selected,
  onSelect,
  tool: toolProp,
  onTool,
  target,
  onDrawn,
  editable,
  origin,
  frame,
  initialBox,
  underlay,
  lotLines,
  mapOffset,
  framing,
  onFrame,
  grid,
  gridSnap,
  layer,
  placing,
  others = [],
  chrome = "full",
  group = [],
  onToggle,
  onBox,
  actions = null,
  image = null,
  imageTool = null,
  onImage,
  onImageTool,
  onImageDone,
  guided = false,
  onPhotoMoved,
  frameFollowsImage = false,
}: {
  handle: RefObject<SheetHandle | null>;
  doc: Doc;
  apply: (change: (d: Doc) => Doc) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  tool: Tool;
  onTool: (t: Tool) => void;
  target: DrawTarget;
  /** A shape was finished: the builder selects it. */
  onDrawn: (id: string) => void;
  /** False while framing the view, and on a plan that's been placed. */
  editable: boolean;
  origin: LatLng | null;
  /** The locked frame; the photo is cut to it. Null while framing. */
  frame: PlanFrame | null;
  /** Where the sheet opens. */
  initialBox: PlanFrame | null;
  underlay: { kind: UnderlayKind; opacity: number };
  lotLines: boolean;
  mapOffset: MapOffset | null;
  /** Show the rectangle Lock view will keep. */
  framing: boolean;
  /** The frame was dragged to a new size. */
  onFrame: (frame: PlanFrame) => void;
  grid: boolean;
  gridSnap: boolean;
  /** What clicks pick and change: the yard's shapes, or the design. */
  layer: Layer;
  /** What the place tool plants. */
  placing: Placing | null;
  /** Plants already in the yard the catalog can't name: drawn, never
   *  picked. */
  others?: SheetPlant[];
  /** "design": the inventory bar sits along the bottom and carries undo,
   *  so the sheet leaves both to it. */
  chrome?: "full" | "design";
  /** Plants picked together on the Design tab, two or more; else empty. */
  group?: string[];
  /** Shift-click on a plant: into the group, or out of it. */
  onToggle?: (id: string) => void;
  /** Shift-drag a box round plants: these join the picked ones. */
  onBox?: (ids: string[]) => void;
  /** The buttons by the picked plant or group; the sheet places them. */
  actions?: React.ReactNode;
  /** An uploaded plot plan under the sheet, and a link to its picture. */
  image?: { plan: PlanImage; url: string } | null;
  /** What clicks do to the uploaded plan while it's lined up; null for
   *  the usual tools. */
  imageTool?: ImageTool | null;
  onImage?: (next: PlanImage) => void;
  onImageTool?: (t: ImageTool | null) => void;
  /** A scale or a north was set on the uploaded plan (or, guided, the
   *  north skipped): the builder walks on to the next step. */
  onImageDone?: (t: "scale" | "north") => void;
  /** The plan was just uploaded: its steps say so, and the north can be
   *  skipped. */
  guided?: boolean;
  /** The photo was dragged this far, in metres, to sit under the plan. */
  onPhotoMoved?: (shift: XZ) => void;
  /** The frame is the uploaded plan's sheet of paper (a plan started from
   *  it): while the plan is turned, the paper turns with it. */
  frameFollowsImage?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [live, setLive] = useState<Doc | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hover, setHover] = useState<{ screen: Pt; snapped: Snapped } | null>(null);
  const [typed, setTyped] = useState("");
  const [measured, setMeasured] = useState<[XZ, XZ] | null>(null);
  const [vertexSel, setVertexSel] = useState<{ id: string; index: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [liveFrame, setLiveFrame] = useState<PlanFrame | null>(null);
  const [frameCursor, setFrameCursor] = useState<string | null>(null);
  // What a click would pick, under the pointer: the cursor says so.
  const [over, setOver] = useState<string | null>(null);
  const [box, setBox] = useState<[Pt, Pt] | null>(null);
  // The uploaded plan while it's dragged, and the clicks a scale or north
  // is being taken from (with the tool they were made for).
  const [liveImage, setLiveImage] = useState<PlanImage | null>(null);
  const [imgClicks, setImgClicks] = useState<{ tool: ImageTool; pts: XZ[] }>({ tool: "scale", pts: [] });
  const [imgHover, setImgHover] = useState<XZ | null>(null);
  const [lengthText, setLengthText] = useState("");
  // The photo while it's dragged under the plan, as a shift in metres.
  const [photoShift, setPhotoShift] = useState<XZ | null>(null);
  // The turn being tried in the north step, till it's kept; any other
  // step, or the north step begun again, starts from the plan as it is.
  const [turnTry, setTurnTry] = useState<number | null>(null);
  const [turnFor, setTurnFor] = useState(imageTool);
  // Where the compass sits on the sheet, if it's been moved.
  const [compassAt, setCompassAt] = useState<Pt | null>(null);
  if (turnFor !== imageTool) {
    setTurnFor(imageTool);
    setTurnTry(null);
  }
  // The inventory bar's height, kept clear along the bottom.
  const inset = chrome === "design" ? 108 : 0;

  const tool: Tool = editable ? toolProp : toolProp === "measure" ? "measure" : "select";
  const shown = live ?? doc;
  const shownPlants = useMemo(
    () => shown.plants.map(sheetPlant).filter((p): p is SheetPlant => p != null),
    [shown.plants]
  );
  // A half-drawn shape belongs to the tool and target it was started with.
  const active = draft && draft.tool === tool && draft.target === target ? draft : null;
  const imgPts = imageTool && imgClicks.tool === imageTool ? imgClicks.pts : [];
  const turning = imageTool === "north" && image ? turnTry : null;
  const shownImage = useMemo(
    () => liveImage ?? (image && turning != null ? { ...image.plan, rotation: turning } : (image?.plan ?? null)),
    [liveImage, image, turning]
  );
  const drawing = tool !== "select";
  const shownFrame = useMemo(
    () => liveFrame ?? (frameFollowsImage && shownImage ? imageFrame(shownImage) : frame),
    [liveFrame, frameFollowsImage, shownImage, frame]
  );

  // How far it zooms: round the frame and the uploaded plan, whatever size
  // the plan's scale made them.
  const zoom = useMemo(
    () => zoomRange(unionBox([shownFrame, shownImage && imageFrame(shownImage)].filter((b) => b != null)), size, shownImage?.scale),
    [shownFrame, shownImage, size]
  );
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // The view starts once the sheet has a size to fit into.
  const initialRef = useRef(initialBox);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const s = { w: entry.contentRect.width, h: entry.contentRect.height };
      setSize(s);
      setView((v) => v ?? fitView(initialRef.current ?? { cx: 0, cz: 0, halfWidth: 30, halfHeight: 30 }, s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useImperativeHandle(
    handle,
    () => ({
      visibleBox() {
        if (!view || size.w === 0) return null;
        const [x0, z0] = toPlan(view, size, [LOCK_INSET, LOCK_INSET]);
        const [x1, z1] = toPlan(view, size, [size.w - LOCK_INSET, size.h - LOCK_INSET]);
        return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, halfWidth: (x1 - x0) / 2, halfHeight: (z1 - z0) / 2 };
      },
      fit(box) {
        if (size.w > 0) setView(fitView(box, size));
        else initialRef.current = box;
      },
      shift(dx, dz) {
        setView((v) => (v ? { ...v, cx: v.cx + dx, cz: v.cz + dz } : v));
      },
      view() {
        return view;
      },
      show(v) {
        setView({ ...v, ppm: Math.min(zoom.max, Math.max(zoom.min, v.ppm)) });
      },
    }),
    [view, size, zoom]
  );

  // Wheel zooms at the cursor. Native and non-passive, so the page behind
  // never scrolls instead.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at: Pt = [e.clientX - r.left, e.clientY - r.top];
      // A trackpad pinch arrives as a wheel with ctrlKey, in small steps.
      const k = e.ctrlKey ? 0.01 : 0.0015;
      setView((v) => {
        if (!v) return v;
        const s = { w: r.width, h: r.height };
        const ppm = clampZoom(v.ppm * Math.exp(-e.deltaY * k), zoomRef.current, v.ppm);
        const [px, pz] = toPlan(v, s, at);
        return { ppm, cx: px - (at[0] - s.w / 2) / ppm, cz: pz - (at[1] - s.h / 2) / ppm };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function say(text: string) {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }

  function resetDraft() {
    setDraft(null);
    setTyped("");
  }

  /* ── Snapping ── */

  function snapContext(base: Doc, v: View, exclude?: { id: string; index: number }, extra: XZ[] = []): SnapContext {
    const corners: XZ[] = [...extra];
    const edges: [XZ, XZ][] = [];
    // Square to the house, the lot, and the shape's own first edges — their
    // straight edges, that is.
    const square: [XZ, XZ][] = extra.slice(1).map((p, i) => [extra[i], p]);
    const add = (id: string, pts: XZ[], smooth: boolean[] | undefined, closed: boolean, reference: boolean) => {
      const n = pts.length;
      pts.forEach((p, i) => {
        if (exclude?.id === id && exclude.index === i) return;
        corners.push(p);
      });
      // A curve snaps along itself.
      edgeRuns(pts, smooth, closed).forEach((run, i) => {
        const j = (i + 1) % n;
        if (exclude?.id === id && (exclude.index === i || exclude.index === j)) return;
        for (let k = 0; k + 1 < run.length; k++) edges.push([run[k], run[k + 1]]);
        if (reference && run.length === 2) square.push([pts[i], pts[j]]);
      });
    };
    const house = mainHouse(base);
    if (base.boundary.length >= 3) add(BOUNDARY_ID, base.boundary, base.boundarySmooth, true, true);
    for (const f of base.features) {
      if (f.shape === "circle") corners.push(f.points[0]);
      else add(f.id, f.points, f.smooth, f.shape === "area", f === house);
    }
    for (const s of base.surfaces) {
      if (s.shape === "circle") corners.push(s.points[0]);
      else add(s.id, s.points, s.smooth, true, false);
    }
    const g = grid && gridSnap ? gridAt(v.ppm).minor : null;
    return { corners, edges, angles: referenceAngles(square), ppm: v.ppm, grid: g };
  }

  function snapAt(screen: Pt, free: boolean): Snapped | null {
    if (!view) return null;
    const p = toPlan(view, size, screen);
    if (free) return { p, kind: null };
    // A plant goes where it's put: onto the grid when that's on, never
    // onto a corner of the house.
    if (tool === "place") return grid && gridSnap ? onGrid(p, view) : { p, kind: null };
    const pts = active?.points ?? [];
    // The rectangle's depth and the circle's edge aren't corners: only
    // snap them onto other shapes' corners.
    const from = (tool === "rect" && pts.length === 2) || tool === "circle" ? null : (pts[pts.length - 1] ?? null);
    return snap(p, from, snapContext(shown, view, undefined, pts));
  }

  /** Where the next point goes: the cursor, or a typed length along it. */
  function nextPoint(): XZ | null {
    const at = hover?.snapped.p ?? null;
    const pts = active?.points ?? [];
    const len = typed ? parseLength(typed) : null;
    if (!at || len == null || pts.length === 0) return at;
    if (tool === "rect" && pts.length === 2) {
      const [a, b] = pts;
      const u = unit([b[0] - a[0], b[1] - a[1]]);
      const nrm: XZ = [-u[1], u[0]];
      const side = Math.sign((at[0] - b[0]) * nrm[0] + (at[1] - b[1]) * nrm[1]) || 1;
      return [b[0] + nrm[0] * len * side, b[1] + nrm[1] * len * side];
    }
    const last = pts[pts.length - 1];
    const u = unit([at[0] - last[0], at[1] - last[1]]);
    // A circle's typed size is how wide it is, the way fire pits are sold.
    const reach = tool === "circle" ? len / 2 : len;
    return [last[0] + u[0] * reach, last[1] + u[1] * reach];
  }

  function onGrid(p: XZ, v: View): Snapped {
    const g = gridAt(v.ppm).minor;
    return { p: [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g], kind: "grid" };
  }

  /* ── Drawing ── */

  function finishShape(shape: PlanFeature["shape"], points: XZ[], radius?: number) {
    const style = styleOf(target);
    if (style) {
      const s: PlanSurface = { id: newId(), style, shape: shape === "circle" ? "circle" : "area", points };
      if (radius != null) s.radius = radius;
      apply((d) => ({ ...d, surfaces: [...d.surfaces, s] }));
      onDrawn(s.id);
    } else if (target === "Boundary") {
      apply((d) => ({ ...d, boundary: points, boundarySmooth: undefined }));
      onDrawn(BOUNDARY_ID);
    } else {
      const f: PlanFeature = { id: crypto.randomUUID(), type: target as FeatureType, shape, points };
      if (radius != null) f.radius = radius;
      apply((d) => ({ ...d, features: [...d.features, f] }));
      onDrawn(f.id);
    }
    resetDraft();
  }

  function finishRun(points: XZ[], closed: boolean) {
    const pts = closed && points.length > 3 && dist(points[0], points[points.length - 1]) < MIN_EDGE_M ? points.slice(0, -1) : points;
    if (closed && (pts.length < 3 || polygonArea(pts) < 0.1)) return say("A shape needs three corners or more.");
    if (!closed && pts.length < 2) return say("A run needs two points or more.");
    if (crosses(pts, closed)) return say("Those edges cross. Click the corners in order around the shape.");
    finishShape(closed ? "area" : "line", pts);
  }

  function addPoint(p: XZ) {
    if (!view) return;
    const pts = active?.points ?? [];
    const px = (a: XZ, b: XZ) => dist(a, b) * view.ppm;
    const last = pts[pts.length - 1];
    const start = (first: XZ) => {
      setDraft({ tool, target, points: [first] });
      setTyped("");
    };
    const push = (next: XZ) => {
      setDraft({ tool, target, points: [...pts, next] });
      setTyped("");
    };
    if (pts.length === 0 && target === "Boundary" && tool !== "measure" && doc.boundaryLocked) {
      return say("The yard boundary is locked. Unlock it to draw it again.");
    }
    switch (tool) {
      case "place": {
        if (!placing || !catalogOf(placing)) return;
        // Turned a little at random, so a bed of one plant reads as
        // individuals rather than a stamp.
        const plant: PlanPlant = { id: newId(), key: placing.key, size: placing.size, x: p[0], z: p[1], rotation: Math.random() * Math.PI * 2 - Math.PI };
        apply((d) => ({ ...d, plants: [...d.plants, plant] }));
        return;
      }
      case "area":
        if (pts.length === 0) return start(p);
        if (pts.length >= 3 && px(p, pts[0]) < 10) return finishRun(pts, true);
        // The second click of a double click.
        if (px(p, last) < CLICK_SLOP) return pts.length >= 3 ? finishRun(pts, true) : undefined;
        return push(p);
      case "line":
        if (pts.length === 0) return start(p);
        if (px(p, last) < 6) return pts.length >= 2 ? finishRun(pts, false) : undefined;
        return push(p);
      case "rect": {
        if (pts.length === 0) return start(p);
        if (pts.length === 1) return dist(p, pts[0]) < MIN_EDGE_M ? undefined : push(p);
        const corners = rectCorners(pts[0], pts[1], p);
        if (polygonArea(corners) < 0.1) return;
        return finishShape("area", corners);
      }
      case "circle": {
        if (pts.length === 0) return start(p);
        const r = dist(pts[0], p);
        if (r < 0.15) return;
        return finishShape("circle", [pts[0]], r);
      }
      case "measure":
        if (pts.length === 0) {
          setMeasured(null);
          return start(p);
        }
        setMeasured([pts[0], p]);
        return resetDraft();
    }
  }

  /* ── Hit testing ── */

  function hitShape(p: XZ, v: View): string | null {
    const tol = 6 / v.ppm;
    let best: string | null = null;
    let score = Infinity;
    const consider = (id: string, s: number) => {
      // Ties go to the later shape: it's drawn on top.
      if (s <= score) [best, score] = [id, s];
    };
    if (layer === "design") {
      // Plants lie on top of the surfaces they're planted beside.
      const plant = plantAt(shownPlants, p, v.ppm);
      if (plant) return plant;
      for (const s of shown.surfaces) {
        if (s.shape === "circle") {
          const d = dist(p, s.points[0]);
          const r = s.radius ?? 0;
          if (Math.abs(d - r) < tol) consider(s.id, 0);
          else if (d < r) consider(s.id, Math.PI * r * r);
          continue;
        }
        const ring = outlineOf(s);
        if (ring.some((q, i) => nearestOnSegment(p, q, ring[(i + 1) % ring.length]).d < tol)) consider(s.id, 0);
        else if (pointInPolygon(p, ring)) consider(s.id, polygonArea(ring));
      }
      return best;
    }
    const nearRun = (pts: XZ[], closed: boolean) => {
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) if (nearestOnSegment(p, pts[i], pts[(i + 1) % pts.length]).d < tol) return true;
      return false;
    };
    // The lot only by its line: its inside is the whole yard.
    if (shown.boundary.length >= 3 && nearRun(withCurves(shown.boundary, shown.boundarySmooth, true), true)) consider(BOUNDARY_ID, 1);
    for (const f of shown.features) {
      if (f.shape === "circle") {
        const d = dist(p, f.points[0]);
        const r = f.radius ?? 0;
        if (Math.abs(d - r) < tol) consider(f.id, 0);
        else if (d < r) consider(f.id, Math.PI * r * r);
        continue;
      }
      const ring = outlineOf(f);
      if (f.shape === "line") {
        if (nearRun(ring, false)) consider(f.id, 0);
      } else if (nearRun(ring, true)) consider(f.id, 0);
      else if (pointInPolygon(p, ring)) consider(f.id, polygonArea(ring));
    }
    return best;
  }

  /** The selected shape's handles, in screen pixels. A locked shape has
   *  none: it can be looked at, not changed. */
  function handlesOf(id: string | null, v: View) {
    if (!id || !editable || tool !== "select") return null;
    const plant = shownPlants.find((x) => x.id === id);
    if (plant) {
      const [cx, cy] = toScreen(v, size, [plant.x, plant.z]);
      const top: Pt = [cx, cy - Math.max(plantRadiusM(plant) * v.ppm, 8)];
      return { vertices: [], smooth: [], mids: [], rotate: { stem: top, at: [top[0], top[1] - 22] as Pt }, radius: null };
    }
    const s = shapeOf(shown, id);
    if (!s || s.locked) return null;
    const scr = s.pts.map((p) => toScreen(v, size, p));
    if (s.radius != null) {
      const [cx, cy] = scr[0];
      return { vertices: [], smooth: [], mids: [], rotate: null, radius: [cx + s.radius * v.ppm, cy] as Pt };
    }
    // A dot in the middle of each edge long enough to hold one — on the
    // curve, where it's curved: drag it to add a corner there.
    const mids: { at: Pt; plan: XZ; index: number; curved: boolean }[] = [];
    edgeCurves(s.pts, s.smooth, s.closed).forEach((c, i) => {
      const a = s.pts[i];
      const b = s.pts[(i + 1) % s.pts.length];
      if (dist(a, b) * v.ppm <= 34) return;
      const plan: XZ = c ? bezierAt(a, c[0], c[1], b, 0.5) : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      mids.push({ at: toScreen(v, size, plan), plan, index: i, curved: c != null });
    });
    const smooth = s.pts.map((_, i) => !!s.smooth?.[i] && (s.closed || (i > 0 && i < s.pts.length - 1)));
    const ring = outline(s).map((p) => toScreen(v, size, p));
    const ys = ring.map((p) => p[1]);
    const xs = ring.map((p) => p[0]);
    const top: Pt = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys)];
    const rotate = id === BOUNDARY_ID ? null : { stem: top, at: [top[0], top[1] - 26] as Pt };
    return { vertices: scr, smooth, mids, rotate, radius: null };
  }

  /** The frame's handles: its corners and the middles of its sides. */
  function frameHandles(v: View): { at: Pt; sides: FrameSides }[] {
    const f = liveFrame ?? frame;
    // The uploaded plan's own paper is sized by the plan, not by hand.
    if (!f || !editable || tool !== "select" || layer !== "site" || imageTool || frameFollowsImage) return [];
    const out: { at: Pt; sides: FrameSides }[] = [];
    for (const z of [-1, 0, 1] as const) {
      for (const x of [-1, 0, 1] as const) {
        if (x === 0 && z === 0) continue;
        out.push({ at: toScreen(v, size, [f.cx + x * f.halfWidth, f.cz + z * f.halfHeight]), sides: { x, z } });
      }
    }
    return out;
  }

  /** The frame handle under the pointer, or the side of the frame. */
  function frameHit(at: Pt, v: View, sidesToo: boolean): FrameSides | null {
    const handles = frameHandles(v);
    const h = handles.find((x) => Math.hypot(x.at[0] - at[0], x.at[1] - at[1]) < 9);
    if (h) return h.sides;
    if (!sidesToo || handles.length === 0) return null;
    const [x0, y0] = handles[0].at;
    const [x1, y1] = handles[handles.length - 1].at;
    const inX = at[0] > x0 && at[0] < x1;
    const inY = at[1] > y0 && at[1] < y1;
    if (inY && Math.abs(at[0] - x0) < 5) return { x: -1, z: 0 };
    if (inY && Math.abs(at[0] - x1) < 5) return { x: 1, z: 0 };
    if (inX && Math.abs(at[1] - y0) < 5) return { x: 0, z: -1 };
    if (inX && Math.abs(at[1] - y1) < 5) return { x: 0, z: 1 };
    return null;
  }

  /* ── The uploaded plan ── */

  /** The handles of the plan being lined up: its corners, which size it,
   *  and the round one over its top edge, which turns it. */
  function imageHandles(m: PlanImage, v: View) {
    const corners = imageCorners(m).map((p) => toScreen(v, size, p));
    const mid = toScreen(v, size, imageToPlan(m, [m.w / 2, 0]));
    const centre = toScreen(v, size, [m.x, m.z]);
    const len = Math.hypot(mid[0] - centre[0], mid[1] - centre[1]) || 1;
    const turn: Pt = [mid[0] + ((mid[0] - centre[0]) / len) * 28, mid[1] + ((mid[1] - centre[1]) / len) * 28];
    return { corners, mid, turn };
  }

  /** Which end of the scale line is under the pointer, or −1. */
  function imgEndAt(at: Pt): number {
    if (!view) return -1;
    return imgPts.findIndex((q) => {
      const [x, y] = toScreen(view, size, q);
      return Math.hypot(x - at[0], y - at[1]) < 10;
    });
  }

  /** A click while taking the scale from the plan. With both ends of the
   *  line down, a click elsewhere starts it again there. */
  function addImagePoint(p: XZ) {
    if (!image || imageTool !== "scale") return;
    const pts: XZ[] = imgPts.length >= 2 ? [p] : [...imgPts, p];
    if (pts.length === 2 && dist(pts[0], pts[1]) * (view?.ppm ?? 1) < CLICK_SLOP) return;
    setImgClicks({ tool: imageTool, pts });
  }

  /** Where the compass is, on screen: on the right under the zoom buttons
   *  until it's moved, and always wholly on the sheet. */
  function compassCentre(at: Pt | null = compassAt): Pt {
    const [x, y] = at ?? [size.w - 96, 270];
    const m = COMPASS_R + 8;
    return [Math.min(size.w - m, Math.max(m, x)), Math.min(size.h - m, Math.max(m, y))];
  }

  /** North is up as the plan's turned now: kept, and on to the next step. */
  function keepNorth() {
    if (!image) return;
    onImage?.({ ...image.plan, rotation: turning ?? image.plan.rotation, north: true });
    onImageTool?.(null);
    onImageDone?.("north");
  }

  /** The length typed for the line measured on the plan: scale it to that. */
  function setScaleTo(text: string) {
    if (!image) return;
    if (imgPts.length !== 2) return say("Click both ends of the length on the plan first.");
    const len = parseLength(text);
    if (len == null) return say(`“${text}” isn't a length. Try 85, 85.5 or 85'6.`);
    const next = rescaled(image.plan, imgPts[0], imgPts[1], len);
    const check = scaleCheck(image.plan, next.scale);
    if (check?.refuse) return say(check.text);
    finishScale(next);
  }

  /** Sized by the scale it was printed at, about its middle. */
  function setPrintedScale(ftPerInch: number) {
    if (!image?.plan.ppi) return;
    const scale = ftPerInch / FEET_PER_METER / image.plan.ppi;
    const check = scaleCheck(image.plan, scale);
    if (check?.refuse) return say(check.text);
    finishScale({ ...image.plan, scale, scaled: true });
  }

  function finishScale(next: PlanImage) {
    onImage?.(next);
    setImgClicks({ tool: "scale", pts: [] });
    setLengthText("");
    onImageTool?.(null);
    onImageDone?.("scale");
  }

  /* ── Pointer ── */

  function local(e: { clientX: number; clientY: number }): Pt {
    const r = boxRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!view || (e.button !== 0 && e.button !== 1)) return;
    boxRef.current?.setPointerCapture(e.pointerId);
    const at = local(e);
    const pan = (onClick: (() => void) | null) => {
      gesture.current = { kind: "pan", start: at, view, moved: false, onClick };
    };
    if (e.button === 1 || spaceHeld) return pan(null);

    // Lining up an uploaded plan: clicks are for it alone.
    if (imageTool && image && shownImage) {
      const p = toPlan(view, size, at);
      if (imageTool === "photo") {
        gesture.current = { kind: "photo", start: at, ppm: view.ppm };
        return;
      }
      if (imageTool === "north") {
        // The compass is moved; grabbed anywhere else, the plan spins round
        // its middle.
        const k = compassCentre();
        if (Math.hypot(at[0] - k[0], at[1] - k[1]) < COMPASS_R) {
          gesture.current = { kind: "compass", start: at, from: k };
          return;
        }
        const c = toScreen(view, size, [shownImage.x, shownImage.z]);
        gesture.current = { kind: "turnPlan", centre: c, a0: Math.atan2(at[1] - c[1], at[0] - c[0]), r0: shownImage.rotation };
        return;
      }
      if (imageTool !== "align") {
        // An end already down is nudged by dragging it.
        const end = imgEndAt(at);
        if (end >= 0) {
          gesture.current = { kind: "imgPt", index: end };
          return;
        }
        return pan(() => addImagePoint(p));
      }
      const ih = imageHandles(shownImage, view);
      const near = (q: Pt, r: number) => Math.hypot(q[0] - at[0], q[1] - at[1]) < r;
      const how = near(ih.turn, 11) ? "turn" : ih.corners.some((c) => near(c, 10)) ? "size" : inImage(shownImage, p) ? "move" : null;
      if (!how) return pan(null);
      gesture.current = { kind: "image", how, base: shownImage, from: p };
      return;
    }

    if (drawing) {
      // A click places a point; a drag pans the sheet instead.
      const snapped = snapAt(at, e.altKey);
      return pan(() => {
        if (snapped) addPoint(snapped.p);
      });
    }

    const h = handlesOf(selected, view);
    const selPlant = plantOf(shown, selected);
    if (h && selected && selPlant) {
      if (h.rotate && Math.hypot(h.rotate.at[0] - at[0], h.rotate.at[1] - at[1]) < 10) {
        const c: XZ = [selPlant.x, selPlant.z];
        const p = toPlan(view, size, at);
        gesture.current = { kind: "plantTurn", id: selected, base: shown, centre: c, a0: Math.atan2(p[1] - c[1], p[0] - c[0]), r0: selPlant.rotation };
        return;
      }
    } else if (h && selected) {
      const near = (p: Pt, r: number) => Math.hypot(p[0] - at[0], p[1] - at[1]) < r;
      if (h.rotate && near(h.rotate.at, 10)) {
        const s = shapeOf(shown, selected)!;
        const c = centroid(s.pts);
        const p = toPlan(view, size, at);
        gesture.current = { kind: "rotate", id: selected, base: shown, centre: c, a0: Math.atan2(p[1] - c[1], p[0] - c[0]) };
        return;
      }
      if (h.radius && near(h.radius, 9)) {
        gesture.current = { kind: "radius", id: selected, base: shown };
        return;
      }
      const vi = h.vertices.findIndex((p) => near(p, 8));
      if (vi >= 0) {
        setVertexSel({ id: selected, index: vi });
        gesture.current = { kind: "vertex", id: selected, index: vi, base: shown, start: at, moved: false };
        return;
      }
      const mid = h.mids.find((m) => near(m.at, 8));
      if (mid) {
        // A new corner on the edge, dragged from where it was made.
        const s = shapeOf(shown, selected)!;
        const cut = addCorner(s.pts, s.smooth, mid.index, mid.plan, mid.curved);
        const base = withEdges(shown, selected, cut.pts, cut.smooth);
        setLive(base);
        setVertexSel({ id: selected, index: mid.index + 1 });
        gesture.current = { kind: "vertex", id: selected, index: mid.index + 1, base, start: at, moved: true };
        return;
      }
    }

    const startFrame = (sides: FrameSides) => {
      gesture.current = { kind: "frame", sides, base: (liveFrame ?? frame)!, start: at, moved: false };
    };
    const corner = frameHit(at, view, false);
    if (corner) return startFrame(corner);

    const p = toPlan(view, size, at);
    const hit = hitShape(p, view);
    if (hit) {
      const pressed = plantOf(shown, hit);
      // Shift-click picks plants together; pressing one already picked
      // with others takes hold of them all.
      if (pressed && e.shiftKey && onToggle) {
        onToggle(hit);
        setVertexSel(null);
        return pan(null);
      }
      if (pressed && group.includes(hit)) {
        if (editable) gesture.current = { kind: "groupMove", id: hit, ids: group, base: shown, start: at, moved: false };
        else pan(() => onSelect(hit));
        return;
      }
      if (hit !== selected) {
        onSelect(hit);
        setVertexSel(null);
      }
      const plant = plantOf(shown, hit);
      if (plant) {
        if (editable) gesture.current = { kind: "plantMove", id: hit, base: shown, start: at, from: [plant.x, plant.z], moved: false };
        else pan(null);
        return;
      }
      // A locked shape stays put: dragging it pans instead.
      if (editable && !shapeOf(shown, hit)?.locked) {
        gesture.current = { kind: "move", id: hit, base: shown, start: at, from: p, moved: false };
      } else pan(null);
      return;
    }
    const side = frameHit(at, view, true);
    if (side) return startFrame(side);
    // Shift-drag on the Design tab draws a box round the plants to pick.
    if (layer === "design" && e.shiftKey && onBox) {
      gesture.current = { kind: "box", start: at, now: at };
      return;
    }
    pan(() => {
      onSelect(null);
      setVertexSel(null);
    });
  }

  /** Double click: a corner turns smooth or sharp; an edge gets a new corner. */
  function onDoubleClick(e: React.MouseEvent) {
    if (!view || !selected || e.button !== 0) return;
    const h = handlesOf(selected, view);
    const s = shapeOf(doc, selected);
    if (!h || !s || s.radius != null) return;
    const at = local(e);
    const near = (q: Pt, r: number) => Math.hypot(q[0] - at[0], q[1] - at[1]) < r;
    const vi = h.vertices.findIndex((q) => near(q, 8));
    if (vi >= 0) {
      // An open run's ends have nothing to curve between.
      if (!s.closed && (vi === 0 || vi === s.pts.length - 1)) return;
      const smooth = s.pts.map((_, i) => (i === vi ? !h.smooth[i] : !!s.smooth?.[i]));
      const next = withEdges(doc, selected, s.pts, smooth);
      if (crosses(withCurves(s.pts, smooth, s.closed), s.closed)) return say("Smoothing that corner would make the edges cross.");
      apply(() => next);
      return;
    }
    const p = toPlan(view, size, at);
    const runs = edgeRuns(s.pts, s.smooth, s.closed);
    for (let i = 0; i < runs.length; i++) {
      const hit = nearestOnRun(p, runs[i]);
      if (hit.d * view.ppm >= 7) continue;
      const cut = addCorner(s.pts, s.smooth, i, hit.q, runs[i].length > 2);
      apply((d) => withEdges(d, selected, cut.pts, cut.smooth));
      setVertexSel({ id: selected, index: i + 1 });
      return;
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!view) return;
    const at = local(e);
    const g = gesture.current;
    if (!g) {
      if (imageTool) {
        setImgHover(toPlan(view, size, at));
        const m = shownImage;
        const ih = m && imageTool === "align" ? imageHandles(m, view) : null;
        const near = (q: Pt, r: number) => Math.hypot(q[0] - at[0], q[1] - at[1]) < r;
        setFrameCursor(
          imageTool === "photo"
            ? "move"
            : imageTool === "north"
            ? Math.hypot(at[0] - compassCentre()[0], at[1] - compassCentre()[1]) < COMPASS_R
              ? "move"
              : TURN_CURSOR
            : imageTool !== "align"
            ? imgEndAt(at) >= 0
              ? "grab"
              : "crosshair"
            : ih && near(ih.turn, 11)
              ? "grab"
              : ih && ih.corners.some((c) => near(c, 10))
                ? "nwse-resize"
                : m && inImage(m, toPlan(view, size, at))
                  ? "move"
                  : null
        );
        return;
      }
      if (drawing) {
        const snapped = snapAt(at, e.altKey);
        if (snapped) setHover({ screen: at, snapped });
      } else if (hover) setHover(null);
      const hit = !drawing && layer === "design" ? hitShape(toPlan(view, size, at), view) : null;
      if (hit !== over) setOver(hit);
      const sides = drawing ? null : frameHit(at, view, true);
      setFrameCursor(sides ? frameCursorFor(sides) : null);
      return;
    }
    const far = (start: Pt) => Math.hypot(at[0] - start[0], at[1] - start[1]) > CLICK_SLOP;
    switch (g.kind) {
      case "pan": {
        if (!g.moved && !far(g.start)) return;
        g.moved = true;
        setPanning(true);
        setView({ ...g.view, cx: g.view.cx - (at[0] - g.start[0]) / g.view.ppm, cz: g.view.cz - (at[1] - g.start[1]) / g.view.ppm });
        return;
      }
      case "vertex": {
        if (!g.moved && !far(g.start)) return;
        g.moved = true;
        const s = shapeOf(g.base, g.id)!;
        const n = s.pts.length;
        const prev = s.closed || g.index > 0 ? s.pts[(g.index - 1 + n) % n] : null;
        const p = e.altKey
          ? toPlan(view, size, at)
          : snap(toPlan(view, size, at), prev, snapContext(g.base, view, { id: g.id, index: g.index })).p;
        const pts = s.pts.map((q, i) => (i === g.index ? p : q));
        setLive(withPoints(g.base, g.id, pts));
        return;
      }
      case "frame": {
        if (!g.moved && !far(g.start)) return;
        g.moved = true;
        const [px, pz] = toPlan(view, size, at);
        const f = g.base;
        let [x0, x1, z0, z1] = [f.cx - f.halfWidth, f.cx + f.halfWidth, f.cz - f.halfHeight, f.cz + f.halfHeight];
        const reach = MAX_REACH_M;
        if (g.sides.x < 0) x0 = Math.max(-reach, Math.min(px, x1 - MIN_FRAME_M));
        if (g.sides.x > 0) x1 = Math.min(reach, Math.max(px, x0 + MIN_FRAME_M));
        if (g.sides.z < 0) z0 = Math.max(-reach, Math.min(pz, z1 - MIN_FRAME_M));
        if (g.sides.z > 0) z1 = Math.min(reach, Math.max(pz, z0 + MIN_FRAME_M));
        setLiveFrame({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, halfWidth: (x1 - x0) / 2, halfHeight: (z1 - z0) / 2 });
        return;
      }
      case "move": {
        if (!g.moved && !far(g.start)) return;
        g.moved = true;
        const p = toPlan(view, size, at);
        const dx = p[0] - g.from[0];
        const dz = p[1] - g.from[1];
        const s = shapeOf(g.base, g.id)!;
        setLive(withPoints(g.base, g.id, s.pts.map(([x, z]) => [x + dx, z + dz] as XZ)));
        return;
      }
      case "rotate": {
        const p = toPlan(view, size, at);
        let turn = Math.atan2(p[1] - g.centre[1], p[0] - g.centre[0]) - g.a0;
        if (e.shiftKey) turn = Math.round(turn / (Math.PI / 12)) * (Math.PI / 12);
        const s = shapeOf(g.base, g.id)!;
        setLive(withPoints(g.base, g.id, rotateAbout(s.pts, g.centre, turn)));
        return;
      }
      case "radius": {
        const s = shapeOf(g.base, g.id)!;
        const r = Math.max(0.15, dist(s.pts[0], toPlan(view, size, at)));
        setLive(editShape(g.base, g.id, (f) => ({ ...f, radius: r })));
        return;
      }
      case "plantMove": {
        if (!g.moved && !far(g.start)) return;
        g.moved = true;
        const p = toPlan(view, size, at);
        const s = shapeOfStart(g);
        let to: XZ = [g.from[0] + p[0] - s[0], g.from[1] + p[1] - s[1]];
        if (grid && gridSnap && !e.altKey) to = onGrid(to, view).p;
        setLive({ ...g.base, plants: g.base.plants.map((x) => (x.id === g.id ? { ...x, x: to[0], z: to[1] } : x)) });
        return;
      }
      case "groupMove": {
        if (!g.moved && !far(g.start)) return;
        g.moved = true;
        const [x0, z0] = toPlan(view, size, g.start);
        const [x1, z1] = toPlan(view, size, at);
        const moved = new Set(g.ids);
        setLive({
          ...g.base,
          plants: g.base.plants.map((x) => (moved.has(x.id) ? { ...x, x: x.x + x1 - x0, z: x.z + z1 - z0 } : x)),
        });
        return;
      }
      case "box": {
        g.now = at;
        setBox([g.start, at]);
        return;
      }
      case "imgPt": {
        const p = toPlan(view, size, at);
        setImgHover(p);
        setImgClicks((c) => ({ ...c, pts: c.pts.map((q, i) => (i === g.index ? p : q)) }));
        return;
      }
      case "photo": {
        setPhotoShift([(at[0] - g.start[0]) / g.ppm, (at[1] - g.start[1]) / g.ppm]);
        return;
      }
      case "turnPlan": {
        const a = Math.atan2(at[1] - g.centre[1], at[0] - g.centre[0]);
        setTurnTry(snapTurn(g.r0 + a - g.a0, e.shiftKey));
        return;
      }
      case "compass": {
        setCompassAt(compassCentre([g.from[0] + at[0] - g.start[0], g.from[1] + at[1] - g.start[1]]));
        return;
      }
      case "image": {
        const p = toPlan(view, size, at);
        const m = g.base;
        const c: XZ = [m.x, m.z];
        if (g.how === "move") setLiveImage({ ...m, x: m.x + p[0] - g.from[0], z: m.z + p[1] - g.from[1] });
        else if (g.how === "turn") {
          let turn = Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(g.from[1] - c[1], g.from[0] - c[0]);
          if (e.shiftKey) turn = Math.round(turn / (Math.PI / 12)) * (Math.PI / 12);
          setLiveImage({ ...m, rotation: Math.atan2(Math.sin(m.rotation + turn), Math.cos(m.rotation + turn)) });
        } else {
          // Sized by hand, it's a guess again until a length is set on it.
          const k = dist(p, c) / Math.max(1e-6, dist(g.from, c));
          setLiveImage({ ...m, scale: Math.min(10, Math.max(1e-5, m.scale * k)), scaled: undefined });
        }
        return;
      }
      case "plantTurn": {
        const p = toPlan(view, size, at);
        let turn = Math.atan2(p[1] - g.centre[1], p[0] - g.centre[0]) - g.a0;
        if (e.shiftKey) turn = Math.round(turn / (Math.PI / 12)) * (Math.PI / 12);
        // Clockwise on screen is a negative yaw: see PlantLayer's `rot`.
        const r = g.r0 - turn;
        setLive({ ...g.base, plants: g.base.plants.map((x) => (x.id === g.id ? { ...x, rotation: Math.atan2(Math.sin(r), Math.cos(r)) } : x)) });
        return;
      }
    }
  }

  /** Where a plant drag started, in plan metres. */
  function shapeOfStart(g: { start: Pt }): XZ {
    return toPlan(view!, size, g.start);
  }

  function onPointerUp() {
    const g = gesture.current;
    gesture.current = null;
    setPanning(false);
    if (!g) return;
    if (g.kind === "pan") {
      if (!g.moved) g.onClick?.();
      return;
    }
    if (g.kind === "frame") {
      const f = liveFrame;
      setLiveFrame(null);
      if (f && g.moved) onFrame(f);
      return;
    }
    if (g.kind === "image") {
      const m = liveImage;
      setLiveImage(null);
      if (m) onImage?.(m);
      return;
    }
    if (g.kind === "imgPt" || g.kind === "turnPlan" || g.kind === "compass") return;
    if (g.kind === "photo") {
      const shift = photoShift;
      setPhotoShift(null);
      if (shift && (shift[0] !== 0 || shift[1] !== 0)) onPhotoMoved?.(shift);
      return;
    }
    if (g.kind === "box") {
      setBox(null);
      if (!view || Math.hypot(g.now[0] - g.start[0], g.now[1] - g.start[1]) < CLICK_SLOP) return;
      const [x0, z0] = toPlan(view, size, [Math.min(g.start[0], g.now[0]), Math.min(g.start[1], g.now[1])]);
      const [x1, z1] = toPlan(view, size, [Math.max(g.start[0], g.now[0]), Math.max(g.start[1], g.now[1])]);
      const inside = shownPlants.filter((q) => q.x >= x0 && q.x <= x1 && q.z >= z0 && q.z <= z1).map((q) => q.id);
      if (inside.length) onBox?.(inside);
      return;
    }
    if (g.kind === "groupMove" && !g.moved) {
      setLive(null);
      onSelect(g.id);
      return;
    }
    const next = live;
    setLive(null);
    if (!next || ("moved" in g && !g.moved)) return;
    const s = shapeOf(next, g.id);
    if (s && s.radius == null && crosses(outline(s), s.closed)) {
      say("That would make the edges cross, so the corner went back.");
      return;
    }
    apply(() => next);
  }

  /* ── Changes from the keys and the toolbars ── */

  /** Undo — or, while drawing, take back the last point. */
  function undoStep() {
    if (active) {
      if (active.points.length <= 1) resetDraft();
      else setDraft({ ...active, points: active.points.slice(0, -1) });
    } else undo();
  }

  function removeSelected() {
    if (!editable || !selected) return;
    if (plantOf(doc, selected)) {
      apply((d) => removeShape(d, selected));
      onSelect(null);
      return;
    }
    const s = shapeOf(doc, selected);
    if (!s) return;
    if (s.locked) return say(`The ${nameOf(doc, selected)} is locked. Unlock it to delete it.`);
    apply((d) => removeShape(d, selected));
    onSelect(null);
    setVertexSel(null);
  }

  function smoothSelected() {
    if (!editable || !selected) return;
    const s = shapeOf(doc, selected);
    if (!s) return;
    if (s.locked) return say(`The ${nameOf(doc, selected)} is locked. Unlock it to change it.`);
    const next = toggleSmooth(doc, selected);
    const t = shapeOf(next, selected)!;
    if (crosses(outline(t), t.closed)) return say("Smoothing this one would make its edges cross.");
    apply(() => next);
  }

  function duplicateSelected() {
    if (!editable || !selected) return;
    const copy = duplicate(doc, selected);
    if (copy) {
      apply(() => copy.doc);
      onSelect(copy.id);
    }
  }

  /* ── Keys ── */

  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.key === " ") {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undoStep();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && editable && selected) {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod || e.altKey) return;
      if (imageTool === "north" && image && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const by = ((e.shiftKey ? 5 : 0.5) * Math.PI) / 180;
        setTurnTry(snapTurn((turning ?? image.plan.rotation) + (e.key === "ArrowLeft" ? -by : by), false));
        return;
      }

      if (active && /^[0-9.'"]$/.test(e.key) && tool !== "measure") {
        e.preventDefault();
        setTyped((t) => (t + e.key).slice(0, 12));
        return;
      }
      switch (e.key) {
        case "Enter": {
          if (imageTool === "north") return keepNorth();
          if (!active) return;
          e.preventDefault();
          if (typed) {
            const p = nextPoint();
            if (p) addPoint(p);
            else say(`“${typed}” isn't a length. Try 42, 42.5 or 42'6.`);
            setTyped("");
          } else if (tool === "area") finishRun(active.points, true);
          else if (tool === "line") finishRun(active.points, false);
          return;
        }
        case "Backspace":
        case "Delete": {
          e.preventDefault();
          if (typed) return setTyped((t) => t.slice(0, -1));
          if (active) {
            if (active.points.length <= 1) resetDraft();
            else setDraft({ ...active, points: active.points.slice(0, -1) });
            return;
          }
          if (!editable || !selected) return;
          if (plantOf(doc, selected)) return removeSelected();
          const s = shapeOf(doc, selected);
          if (!s) return;
          if (vertexSel?.id === selected && !s.locked && s.radius == null && s.pts.length > (s.closed ? 3 : 2)) {
            const cut = dropCorner(s.pts, s.smooth, vertexSel.index);
            if (crosses(withCurves(cut.pts, cut.smooth, s.closed), s.closed)) {
              return say("Taking that corner out would make the edges cross.");
            }
            apply((d) => withEdges(d, selected, cut.pts, cut.smooth));
            setVertexSel(null);
            return;
          }
          removeSelected();
          return;
        }
        case "Escape":
          if (imageTool) {
            if (imgPts.length) setImgClicks({ tool: imageTool, pts: [] });
            else onImageTool?.(null);
          } else if (tool === "place") onTool("select");
          else if (typed) setTyped("");
          else if (active) resetDraft();
          else if (measured) setMeasured(null);
          else if (vertexSel) setVertexSel(null);
          else if (selected || group.length) onSelect(null);
          else if (tool !== "select") onTool("select");
          return;
        case "v":
        case "V":
          onTool("select");
          return;
        case "m":
        case "M":
          onTool("measure");
          return;
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  });

  /* ── Drawing it ── */

  const tiles = useMemo(() => {
    if (!view || !origin || underlay.kind === "none") return [];
    const shift: XZ =
      photoShift ?? (underlay.kind === "map" && mapOffset ? [mapOffset.east, -mapOffset.north] : [0, 0]);
    return tilesFor(BASEMAPS[underlay.kind].url, origin, view, size, { min: 3, max: MAX_NATIVE_ZOOM }, shift);
  }, [view, size, origin, underlay.kind, mapOffset, photoShift]);
  const lotTiles = useMemo(() => {
    if (!view || !origin || !lotLines) return [];
    return tilesFor(LOT_LINES.url, origin, view, size, { min: LOT_LINES.minNativeZoom, max: LOT_LINES.maxNativeZoom }, [0, 0]);
  }, [view, size, origin, lotLines]);

  if (!view) return <div ref={boxRef} className="relative h-full w-full" style={{ background: SHEET_PAPER }} />;

  const S = (p: XZ) => toScreen(view, size, p);
  const photo = underlay.kind === "none" ? 0 : underlay.opacity;
  const wash = 0.4 * photo;
  const frameRect = shownFrame
    ? (() => {
        const [x0, y0] = S([shownFrame.cx - shownFrame.halfWidth, shownFrame.cz - shownFrame.halfHeight]);
        const [x1, y1] = S([shownFrame.cx + shownFrame.halfWidth, shownFrame.cz + shownFrame.halfHeight]);
        return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
      })()
    : { left: 0, top: 0, width: size.w, height: size.h };

  const features = byLayer(shown.features);
  const sel = selected ? shapeOf(shown, selected) : null;
  const selPlant = selected ? (shownPlants.find((p) => p.id === selected) ?? null) : null;
  const ghost: SheetPlant | null =
    tool === "place" && hover && placing
      ? (() => {
          const c = catalogOf(placing);
          return c
            ? { id: "ghost", model: c.size.modelName, scale: c.size.heightMultiplier, x: hover.snapped.p[0], z: hover.snapped.p[1], rotation: 0 }
            : null;
        })()
      : null;
  const h = handlesOf(selected, view);
  const fh = frameHandles(view);

  const pts = active?.points ?? [];
  const next = hover && drawing ? nextPoint() : null;
  const preview = pts.length > 0 && next ? previewOf(tool, target, pts, next) : null;

  // The picked plants: one, or a group.
  const picked = group.length ? shownPlants.filter((p) => group.includes(p.id)) : selPlant ? [selPlant] : [];
  // Their buttons, under them — or over them, near the bottom.
  const plantBar = (() => {
    if (!picked.length || !actions || !editable || tool !== "select" || live || imageTool) return null;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const q of picked) {
      const [x, y] = S([q.x, q.z]);
      const r = Math.max(plantRadiusM(q) * view.ppm, 8);
      [x0, y0, x1, y1] = [Math.min(x0, x - r), Math.min(y0, y - r), Math.max(x1, x + r), Math.max(y1, y + r)];
    }
    const floor = size.h - inset;
    let top = y1 + 12;
    // Over them, clear of a lone plant's turning handle.
    if (top + ACTIONS_H > floor - 8) top = y0 - (group.length ? 12 : 40) - ACTIONS_H;
    return {
      x: Math.min(size.w - 56 - 150, Math.max(12 + 150, (x0 + x1) / 2)),
      y: Math.max(56, Math.min(floor - ACTIONS_H - 8, top)),
    };
  })();

  // The selected shape's toolbar, under it — or over it, near the bottom.
  const bar = (() => {
    if (!sel || !editable || tool !== "select" || live) return null;
    const ring = sel.radius != null ? circleBox(sel.pts[0], sel.radius) : outline(sel);
    const scr = ring.map(S);
    const ys = scr.map((p) => p[1]);
    const xs = scr.map((p) => p[0]);
    const w = (sel.feature || sel.surface ? 150 : 116) + (sel.radius == null ? 80 : 0);
    const x = Math.min(size.w - 56 - w / 2, Math.max(12 + w / 2, (Math.min(...xs) + Math.max(...xs)) / 2));
    const floor = size.h - inset;
    let y = Math.max(...ys) + 30;
    if (y + 40 > floor - 64) y = Math.min(...ys) - (h?.rotate ? 44 : 18) - 40;
    return { x, y: Math.max(64, Math.min(floor - 104, y)) };
  })();

  const overNow = !drawing && !panning && !gesture.current ? over : null;
  const cursor = panning
    ? "grabbing"
    : spaceHeld
      ? "grab"
      : imageTool
        ? (frameCursor ?? "default")
        : drawing
          ? "crosshair"
          : (frameCursor ?? (overNow ? (editable ? "move" : "pointer") : "default"));
  // Clicks on the floating controls stay off the sheet underneath.
  const shield = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  };
  const hintText =
    notice ??
    (imageTool
      ? imageHint(imageTool, imgPts.length)
      : hint(
          tool,
          target,
          pts.length,
          editable,
          frame != null,
          group.length ? "group" : sel ? (sel.locked ? "locked" : "open") : selPlant ? "plant" : null,
          layer,
          framing,
          frameFollowsImage
        ));

  const tileImg = (t: Tile, dx: number, dy: number) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={t.key}
      src={t.src}
      alt=""
      draggable={false}
      decoding="async"
      className="pointer-events-none absolute max-w-none"
      style={{ left: t.x - dx, top: t.y - dy, width: t.w, height: t.h }}
    />
  );

  return (
    <div
      ref={boxRef}
      className="relative h-full w-full touch-none select-none overflow-hidden"
      style={{ background: shownFrame ? DESK_TINTED : SHEET_PAPER, cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (gesture.current) return;
        setHover(null);
        setOver(null);
        setImgHover(null);
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* While the frame is dragged, the photo it would take in, faintly. */}
      {liveFrame && photo > 0 && (
        <div className="absolute inset-0" style={{ opacity: 0.3 * photo }}>
          {tiles.map((t) => tileImg(t, 0, 0))}
        </div>
      )}

      {/* While the uploaded plan is lined up, all of it, faintly. */}
      {imageTool === "align" && image && shownImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.url} alt="" draggable={false} className="pointer-events-none" style={imageStyle(shownImage, view, size, 0, 0, 0.3)} />
      )}

      {/* The sheet of paper, and the photo (and any uploaded plan) cut to it. */}
      <div className="absolute overflow-hidden" style={{ ...frameRect, background: SHEET_PAPER }}>
        <div className="absolute inset-0" style={{ opacity: photo }}>
          {tiles.map((t) => tileImg(t, frameRect.left, frameRect.top))}
        </div>
        {image && shownImage && (!shownImage.hidden || imageTool) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt=""
            draggable={false}
            className="pointer-events-none"
            style={imageStyle(
              shownImage,
              view,
              size,
              frameRect.left,
              frameRect.top,
              // See-through while the photo is slid under it.
              imageTool === "photo" ? Math.min(0.5, imageOpacity(shownImage, layer)) : imageOpacity(shownImage, layer)
            )}
          />
        )}
        {lotTiles.length > 0 && (
          <div className="absolute inset-0" style={{ filter: LOT_LINE_FILTER[underlay.kind] }}>
            {lotTiles.map((t) => tileImg(t, frameRect.left, frameRect.top))}
          </div>
        )}
      </div>

      <svg className="absolute inset-0" width={size.w} height={size.h}>
        <PlanPatterns />
        <SurfacePatterns />
        {grid && <Grid view={view} size={size} rect={frameRect} ink={layer === "site" ? BLUEPRINT_GRID : DESIGN_GRID} />}
        {shownFrame && (
          <rect
            x={frameRect.left}
            y={frameRect.top}
            width={frameRect.width}
            height={frameRect.height}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeOpacity={liveFrame ? 0.9 : 0.6}
          />
        )}
        {framing && (
          <rect
            x={LOCK_INSET}
            y={LOCK_INSET}
            width={Math.max(0, size.w - 2 * LOCK_INSET)}
            height={Math.max(0, size.h - 2 * LOCK_INSET)}
            fill="none"
            stroke={INK}
            strokeWidth={1.5}
            strokeDasharray="8 6"
            strokeOpacity={0.7}
          />
        )}

        {/* The yard as it is: in full while it's traced, quieter under the design. */}
        <g opacity={layer === "design" ? 0.6 : 1}>
          {shown.boundary.length >= 3 && (
            <BoundaryArt pts={shown.boundary.map(S)} smooth={shown.boundarySmooth} halo={photo} />
          )}
          {features.map((f) => (
            <FeatureArt
              key={f.id}
              feature={f}
              pts={f.points.map(S)}
              radius={(f.radius ?? 0) * view.ppm}
              smooth={f.smooth}
              halo={photo}
              wash={wash}
              locked={f.locked}
            />
          ))}
        </g>

        {/* The design's new surfaces, over the yard as it is. */}
        {shown.surfaces.map((x) => (
          <SurfaceArt
            key={x.id}
            surface={x}
            pts={x.points.map(S)}
            radius={(x.radius ?? 0) * view.ppm}
            smooth={x.smooth}
            halo={photo}
            wash={wash}
            sqft={surfaceSqFtOf(x)}
            dim={layer === "site"}
            locked={x.locked}
          />
        ))}
      </svg>

      <PlantLayer plants={[...others, ...shownPlants]} view={view} size={size} faded={layer === "site"} ghost={ghost} halo={photo} />

      <svg className="absolute inset-0" width={size.w} height={size.h}>
        {/* The frame's handles: drag them to take in more photo, or less. */}
        {fh.map(({ at: [x, y], sides }) => (
          <rect
            key={`${sides.x}${sides.z}`}
            x={x - 4.5}
            y={y - 4.5}
            width={9}
            height={9}
            fill="#fff"
            stroke={INK}
            strokeOpacity={0.6}
            strokeWidth={1.3}
            pointerEvents="none"
          />
        ))}

        {/* The selection, its sizes, and its handles. */}
        {sel && (
          <g pointerEvents="none">
            <Outline shape={sel} S={S} ppm={view.ppm} dashed={sel.locked} />
            <Dims shape={sel} S={S} ppm={view.ppm} />
          </g>
        )}
        {picked.map((q) => (
          <circle
            key={q.id}
            cx={S([q.x, q.z])[0]}
            cy={S([q.x, q.z])[1]}
            r={Math.max(plantRadiusM(q) * view.ppm, 6) + 4}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            pointerEvents="none"
          />
        ))}
        {box && (
          <rect
            x={Math.min(box[0][0], box[1][0])}
            y={Math.min(box[0][1], box[1][1])}
            width={Math.abs(box[1][0] - box[0][0])}
            height={Math.abs(box[1][1] - box[0][1])}
            fill="rgba(46,93,67,0.06)"
            stroke="var(--accent)"
            strokeWidth={1.2}
            strokeDasharray="5 4"
            pointerEvents="none"
          />
        )}
        {imageTool === "align" && shownImage && (
          <ImageHandles {...imageHandles(shownImage, view)} />
        )}
        {imageTool === "scale" && imgPts.length > 0 && (
          <ImageLine a={imgPts[0]} b={imgPts[1] ?? imgHover ?? imgPts[0]} S={S} placed={imgPts.length} />
        )}
        {imageTool === "north" && <Compass at={compassCentre()} />}
        {h && (
          <g pointerEvents="none">
            {h.rotate && (
              <>
                <line x1={h.rotate.stem[0]} y1={h.rotate.stem[1]} x2={h.rotate.at[0]} y2={h.rotate.at[1]} stroke="var(--accent)" />
                <circle cx={h.rotate.at[0]} cy={h.rotate.at[1]} r={5.5} fill="#fff" stroke="var(--accent)" strokeWidth={1.5} />
              </>
            )}
            {h.mids.map((m) => (
              <circle key={m.index} cx={m.at[0]} cy={m.at[1]} r={3.5} fill="#fff" stroke="var(--accent)" strokeOpacity={0.8} />
            ))}
            {h.vertices.map(([x, y], i) => {
              const on = vertexSel?.id === selected && vertexSel.index === i;
              // Smooth corners are round, sharp ones square.
              return h.smooth[i] ? (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={5}
                  fill={on ? "var(--accent)" : "#fff"}
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                />
              ) : (
                <rect
                  key={i}
                  x={x - 4.5}
                  y={y - 4.5}
                  width={9}
                  height={9}
                  fill={on ? "var(--accent)" : "#fff"}
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                />
              );
            })}
            {h.radius && <circle cx={h.radius[0]} cy={h.radius[1]} r={5} fill="#fff" stroke="var(--accent)" strokeWidth={1.5} />}
          </g>
        )}

        {/* The shape being drawn. */}
        {preview && (
          <g pointerEvents="none">
            {preview.surface && (
              <SurfaceArt
                surface={preview.surface}
                pts={preview.surface.points.map(S)}
                radius={(preview.surface.radius ?? 0) * view.ppm}
                halo={photo}
                wash={wash}
                label={false}
                dim
              />
            )}
            {preview.art && (
              <FeatureArt
                feature={preview.art}
                pts={preview.art.points.map(S)}
                radius={(preview.art.radius ?? 0) * view.ppm}
                halo={photo}
                wash={wash}
                label={false}
                dim
              />
            )}
            {preview.boundary && <BoundaryArt pts={preview.boundary.map(S)} closed={preview.closed} halo={photo} />}
            {preview.band && <Band pts={preview.band.map(S)} />}
            <Dims shape={{ pts: preview.run, closed: preview.closed, radius: preview.radius }} S={S} ppm={view.ppm} />
          </g>
        )}
        {pts.length > 0 &&
          (tool === "area" || tool === "line" || tool === "rect") &&
          pts.map((p, i) => {
            const [x, y] = S(p);
            const first = i === 0 && tool === "area" && pts.length >= 3;
            return (
              <rect
                key={i}
                x={x - (first ? 5.5 : 3.5)}
                y={y - (first ? 5.5 : 3.5)}
                width={first ? 11 : 7}
                height={first ? 11 : 7}
                fill="#fff"
                stroke={INK}
                strokeWidth={1.2}
                pointerEvents="none"
              />
            );
          })}

        {/* The measuring tape. */}
        {tool === "measure" && (measured || (pts.length === 1 && next)) && (
          <Tape a={measured ? measured[0] : pts[0]} b={measured ? measured[1] : next!} S={S} />
        )}

        {/* Where the cursor snapped, and why. */}
        {hover && drawing && <SnapMark snapped={hover.snapped} S={S} />}
      </svg>

      {typed && hover && (
        <div
          className="pointer-events-none absolute rounded-md border border-rule-strong bg-card px-2 py-1 text-xs font-semibold text-ink shadow"
          style={{ left: hover.screen[0] + 14, top: hover.screen[1] + 14 }}
        >
          {typed}
          <span className="ml-1 font-normal text-faint">
            {parseLength(typed) != null ? (tool === "circle" ? "across ↵" : "↵") : "?"}
          </span>
        </div>
      )}

      {/* Undo and redo, big, where the work is. */}
      {editable && chrome === "full" && (
        <div className="absolute left-3 top-3 flex gap-1 rounded-xl border border-rule-strong bg-card p-1 shadow-md" {...shield}>
          <BigButton title="Undo (⌘Z)" disabled={!canUndo && !active} onClick={undoStep}>
            <UndoIcon />
          </BigButton>
          <BigButton title="Redo (⇧⌘Z)" disabled={!canRedo || !!active} onClick={redo}>
            <RedoIcon />
          </BigButton>
        </div>
      )}

      {plantBar && (
        <div className="absolute z-10 -translate-x-1/2" style={{ left: plantBar.x, top: plantBar.y }} {...shield}>
          {actions}
        </div>
      )}

      {/* The step under way on the uploaded plan, docked at the top so the
          drawing round the line stays in sight. */}
      {image && (imageTool === "scale" || imageTool === "north" || imageTool === "photo") && (
        <ImageStep
          tool={imageTool}
          plan={image.plan}
          line={imgPts.length === 2 ? [imgPts[0], imgPts[1]] : null}
          ends={imgPts.length}
          length={lengthText}
          onLength={setLengthText}
          onScale={() => setScaleTo(lengthText)}
          onPrinted={setPrintedScale}
          onClearLine={() => setImgClicks({ tool: imageTool, pts: [] })}
          onClose={() => {
            setImgClicks({ tool: imageTool, pts: [] });
            onImageTool?.(null);
          }}
          onSkip={guided && imageTool === "north" ? () => {
            onImageTool?.(null);
            onImageDone?.("north");
          } : undefined}
          onNorth={keepNorth}
          guided={guided}
          shield={shield}
          onPointerEnter={() => setImgHover(null)}
        />
      )}

      {/* A magnifier by the pointer while an end is clicked down, so it
          lands on the dimension's tick, not beside it. */}
      {image && shownImage && imageTool === "scale" && imgHover && !panning && (
        <Loupe plan={shownImage} url={image.url} at={imgHover} view={view} size={size} />
      )}

      {bar && sel && selected && (
        <div
          className="absolute flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-rule-strong bg-card p-1 shadow-md"
          style={{ left: bar.x, top: bar.y }}
          {...shield}
        >
          <button
            type="button"
            title={sel.locked ? "Unlock it to move or change it" : "Lock it so it can't be moved by accident"}
            onClick={() => apply((d) => setLocked(d, selected, !sel.locked))}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition ${
              sel.locked ? "bg-accent/15 text-accent" : "text-body hover:bg-card-hover hover:text-ink"
            }`}
          >
            <LockIcon open={!sel.locked} />
            {sel.locked ? "Locked" : "Lock"}
          </button>
          {sel.radius == null && (
            <button
              type="button"
              title={
                sel.smooth?.some(Boolean)
                  ? "Make every corner sharp again"
                  : "Curve the outline smoothly through its corners. Double-click a corner to switch it."
              }
              onClick={smoothSelected}
              className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition ${
                sel.smooth?.some(Boolean) ? "bg-accent/15 text-accent" : "text-body hover:bg-card-hover hover:text-ink"
              }`}
            >
              <CurveIcon />
              Smooth
            </button>
          )}
          {(sel.feature || sel.surface) && (
            <BarButton title="Duplicate (⌘D)" onClick={duplicateSelected}>
              <CopyIcon />
            </BarButton>
          )}
          <BarButton title="Delete (⌫)" onClick={removeSelected} danger>
            <TrashIcon />
          </BarButton>
        </div>
      )}

      {/* Only where up is known to be north: the photo's, or a plan turned
          by its arrow. */}
      {(origin != null || image?.plan.north) && imageTool !== "north" && (
        <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-card/90 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-body shadow-sm">
          N ↑
        </div>
      )}
      <div className="absolute right-3 top-10 flex flex-col overflow-hidden rounded-md border border-rule-strong bg-card shadow-sm" {...shield}>
        {[
          { label: "+", title: "Zoom in", f: 1.4 },
          { label: "−", title: "Zoom out", f: 1 / 1.4 },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            title={b.title}
            onClick={() => setView((v) => (v ? { ...v, ppm: clampZoom(v.ppm * b.f, zoom, v.ppm) } : v))}
            className="h-7 w-7 text-sm font-semibold text-body transition hover:bg-card-hover hover:text-ink"
          >
            {b.label}
          </button>
        ))}
        {shownFrame && (
          <button
            type="button"
            title="Back to the whole yard"
            onClick={() => setView(fitView(shownFrame, size))}
            className="h-7 w-7 border-t border-rule text-[11px] font-semibold text-body transition hover:bg-card-hover hover:text-ink"
          >
            ⤢
          </button>
        )}
      </div>

      <div
        className="pointer-events-none absolute bottom-2 left-3 right-3 flex items-end justify-between gap-4"
        style={{ bottom: 8 + inset }}
      >
        <div className="flex flex-col items-start gap-1.5">
          <ScaleBar ppm={view.ppm} grid={grid ? gridAt(view.ppm).minorFt : null} />
          {hintText && (
            <p className={`rounded-md px-2 py-1 text-xs shadow-sm ${notice ? "bg-clay text-white" : "bg-card/90 text-body"}`}>
              {hintText}
            </p>
          )}
        </div>
        {origin && underlay.kind !== "none" && (
          <p
            {...shield}
            className="pointer-events-auto max-w-[45%] truncate rounded bg-card/80 px-1.5 py-0.5 text-[10px] text-faint hover:whitespace-normal"
            dangerouslySetInnerHTML={{
              __html: BASEMAPS[underlay.kind].attribution + (lotLines ? ` · ${LOT_LINES.attribution}` : ""),
            }}
          />
        )}
      </div>
    </div>
  );
}

/** The cursor over each frame handle and side. */
function frameCursorFor({ x, z }: FrameSides): string {
  if (x === 0) return "ns-resize";
  if (z === 0) return "ew-resize";
  return x === z ? "nwse-resize" : "nesw-resize";
}

const circleBox = ([x, z]: XZ, r: number): XZ[] => [
  [x - r, z - r],
  [x + r, z + r],
];

/* ── Pieces ──────────────────────────────────────────────────────── */

const unit = ([x, z]: XZ): XZ => {
  const l = Math.hypot(x, z);
  return l === 0 ? [1, 0] : [x / l, z / l];
};

/** A rectangle on edge a–b, pulled out to where c is. */
function rectCorners(a: XZ, b: XZ, c: XZ): XZ[] {
  const u = unit([b[0] - a[0], b[1] - a[1]]);
  const n: XZ = [-u[1], u[0]];
  const d = (c[0] - b[0]) * n[0] + (c[1] - b[1]) * n[1];
  return [a, b, [b[0] + n[0] * d, b[1] + n[1] * d], [a[0] + n[0] * d, a[1] + n[1] * d]];
}

/**
 * The half-drawn shape as it would be if the next point went at `next`:
 * drawn as the finished thing once it closes, and as a rubber band until
 * then.
 */
function previewOf(tool: Tool, target: DrawTarget, pts: XZ[], next: XZ) {
  if (tool === "measure" || tool === "place") return null;
  const lot = target === "Boundary";
  const style = styleOf(target);
  const none = { art: null, surface: null, boundary: null, band: null, radius: undefined };
  const asFeature = (shape: PlanFeature["shape"], points: XZ[], radius?: number) =>
    lot
      ? {}
      : style
        ? { surface: { id: "draft", style, shape: shape === "circle" ? "circle" : "area", points, radius } as PlanSurface }
        : { art: { id: "draft", type: target as FeatureType, shape, points, radius } as PlanFeature };
  if (tool === "circle") {
    const radius = dist(pts[0], next);
    return { ...none, ...asFeature("circle", [pts[0]], radius), run: [pts[0]], closed: true, radius };
  }
  if (tool === "line") {
    const run = [...pts, next];
    return { ...none, ...asFeature("line", run), run, closed: false };
  }
  const run = tool === "rect" ? (pts.length === 1 ? [pts[0], next] : rectCorners(pts[0], pts[1], next)) : [...pts, next];
  const closed = tool === "rect" ? pts.length === 2 : run.length >= 3;
  if (!closed) return { ...none, ...(lot ? { boundary: run } : { band: run }), run, closed };
  return { ...none, ...(lot ? { boundary: run } : asFeature("area", run)), run, closed };
}

/** A run still being drawn: a dashed ink line on a paper halo. */
function Band({ pts }: { pts: Pt[] }) {
  const d = `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}`;
  return (
    <>
      <path d={d} fill="none" stroke={SHEET_PAPER} strokeOpacity={0.8} strokeWidth={4} />
      <path d={d} fill="none" stroke={INK} strokeWidth={1.5} strokeDasharray="6 4" />
    </>
  );
}

type Drawn = Pick<Shape, "pts" | "closed" | "radius" | "smooth">;

/** The selection's outline; dashed when it's locked. */
function Outline({ shape, S, ppm, dashed }: { shape: Drawn; S: (p: XZ) => Pt; ppm: number; dashed: boolean }) {
  const dash = dashed ? "7 4" : undefined;
  if (shape.radius != null) {
    const [x, y] = S(shape.pts[0]);
    return <circle cx={x} cy={y} r={shape.radius * ppm} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray={dash} />;
  }
  const d = pathOf(shape.pts.map(S), shape.closed, shape.smooth);
  return <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeDasharray={dash} />;
}

/** Every straight edge's length in feet and inches, outside the shape;
 *  the area in square feet in the middle. Curves go unlabelled — a length
 *  on every stretch of one is clutter. */
function Dims({ shape, S, ppm }: { shape: Drawn; S: (p: XZ) => Pt; ppm: number }) {
  const out: React.ReactNode[] = [];
  if (shape.radius != null) {
    const [x, y] = S(shape.pts[0]);
    const r = shape.radius * ppm;
    out.push(
      <DimChip key="d" x={x} y={y + r + 12} text={`${feetInches(shape.radius * 2)} across`} />,
      <DimChip key="a" x={x} y={y} text={sqFt(Math.PI * shape.radius * shape.radius)} quiet />
    );
    return <>{out}</>;
  }
  const pts = shape.pts;
  const n = shape.closed ? pts.length : pts.length - 1;
  // Which way is "outside": the shape's turning direction.
  let signed = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    signed += x0 * z1 - x1 * z0;
  }
  const outward = signed >= 0 ? -1 : 1;
  const curves = edgeCurves(pts, shape.smooth, shape.closed);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = dist(a, b);
    if (len * ppm < 38 || curves[i]) continue;
    const [ax, ay] = S(a);
    const [bx, by] = S(b);
    const ux = (bx - ax) / (len * ppm);
    const uy = (by - ay) / (len * ppm);
    const side = shape.closed ? outward : 1;
    const text = feetInches(len);
    // Far enough out along the edge's normal that the chip clears the edge
    // (and its handles) whatever the angle.
    const reach = 7 + Math.abs(uy) * chipWidth(text) * 0.5 + Math.abs(ux) * 8;
    out.push(
      <DimChip key={i} x={(ax + bx) / 2 - uy * reach * side} y={(ay + by) / 2 + ux * reach * side} text={text} />
    );
  }
  const ring = outline(shape);
  if (shape.closed && pts.length >= 3) {
    const [cx, cy] = S(centroid(ring));
    out.push(<DimChip key="area" x={cx} y={cy + 16} text={sqFt(polygonArea(ring))} quiet />);
  } else if (!shape.closed && (pts.length > 2 || curves.some(Boolean))) {
    const [x, y] = S(pts[pts.length - 1]);
    out.push(<DimChip key="run" x={x} y={y + 16} text={`${feetInches(pathLength(ring, false))} total`} quiet />);
  }
  return <>{out}</>;
}

const chipWidth = (text: string) => text.length * 6.2 + 10;

function DimChip({ x, y, text, quiet = false }: { x: number; y: number; text: string; quiet?: boolean }) {
  const w = chipWidth(text);
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
      <rect x={-w / 2} y={-8} width={w} height={16} rx={3} fill={quiet ? "#fff" : "var(--accent)"} fillOpacity={quiet ? 0.9 : 1} />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10.5}
        fontWeight={600}
        fill={quiet ? "var(--accent)" : "#fff"}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {text}
      </text>
    </g>
  );
}

function Tape({ a, b, S }: { a: XZ; b: XZ; S: (p: XZ) => Pt }) {
  const [ax, ay] = S(a);
  const [bx, by] = S(b);
  return (
    <g pointerEvents="none">
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#fff" strokeWidth={4} strokeOpacity={0.8} />
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--clay)" strokeWidth={1.8} strokeDasharray="6 4" />
      <circle cx={ax} cy={ay} r={3.5} fill="var(--clay)" />
      <circle cx={bx} cy={by} r={3.5} fill="var(--clay)" />
      <DimChip x={(ax + bx) / 2} y={(ay + by) / 2 - 14} text={feetInches(dist(a, b))} />
    </g>
  );
}

function SnapMark({ snapped, S }: { snapped: Snapped; S: (p: XZ) => Pt }) {
  const [x, y] = S(snapped.p);
  return (
    <g pointerEvents="none">
      {snapped.guide && (
        <line
          x1={S(snapped.guide[0])[0]}
          y1={S(snapped.guide[0])[1]}
          x2={x}
          y2={y}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
      {snapped.kind === "corner" && <rect x={x - 6} y={y - 6} width={12} height={12} fill="none" stroke="var(--accent)" strokeWidth={1.6} />}
      {(snapped.kind === "edge" || snapped.kind === "square+edge") && (
        <path d={`M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`} fill="none" stroke="var(--accent)" strokeWidth={1.6} />
      )}
      <circle cx={x} cy={y} r={2.5} fill="var(--accent)" />
    </g>
  );
}

/** A bar 60–140 px long at a round number of feet, and the grid's size. */
function ScaleBar({ ppm, grid }: { ppm: number; grid: number | null }) {
  const pxPerFoot = ppm / FEET_PER_METER;
  const feet = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000].find((f) => f * pxPerFoot >= 60) ?? 2000;
  const w = feet * pxPerFoot;
  return (
    <div className="rounded-md bg-card/90 px-2 py-1 shadow-sm">
      <div className="h-1.5 border-x-2 border-b-2 border-ink" style={{ width: w }} />
      <p className="mt-0.5 text-[10px] font-semibold text-body">
        {feet} ft
        {grid != null && <span className="ml-2 font-normal text-muted">grid {grid} ft</span>}
      </p>
    </div>
  );
}

/**
 * Drafting paper: a line every foot (or 5, 10… as you zoom out) and a
 * heavier one every fifth or tenth, square to north from the plan's origin,
 * on the paper only.
 */
/** The Blueprint tab's grid: drafting blue, so the two tabs read apart at a glance. */
const BLUEPRINT_GRID = "#2d5a80";
/** …and the Design tab's, its green. */
const DESIGN_GRID = "#2e5d43";

function Grid({
  view,
  size,
  rect,
  ink,
}: {
  view: View;
  size: Size;
  rect: { left: number; top: number; width: number; height: number };
  ink: string;
}) {
  const g = gridAt(view.ppm);
  const ratio = Math.round(g.major / g.minor);
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(size.w, rect.left + rect.width);
  const bottom = Math.min(size.h, rect.top + rect.height);
  if (right <= left || bottom <= top) return null;
  const [x0, z0] = toPlan(view, size, [left, top]);
  const [x1, z1] = toPlan(view, size, [right, bottom]);
  let minor = "";
  let major = "";
  const f = (v: number) => v.toFixed(1);
  for (let i = Math.ceil(x0 / g.minor); i * g.minor <= x1; i++) {
    const sx = f(toScreen(view, size, [i * g.minor, 0])[0]);
    const seg = `M${sx} ${f(top)}V${f(bottom)}`;
    if (((i % ratio) + ratio) % ratio === 0) major += seg;
    else minor += seg;
  }
  for (let i = Math.ceil(z0 / g.minor); i * g.minor <= z1; i++) {
    const sy = f(toScreen(view, size, [0, i * g.minor])[1]);
    const seg = `M${f(left)} ${sy}H${f(right)}`;
    if (((i % ratio) + ratio) % ratio === 0) major += seg;
    else minor += seg;
  }
  return (
    <g pointerEvents="none">
      <path d={minor} stroke={ink} strokeOpacity={0.085 * g.strength} strokeWidth={1} />
      <path d={major} stroke={ink} strokeOpacity={0.17} strokeWidth={1} />
    </g>
  );
}

function BigButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-lg text-ink transition hover:bg-card-hover disabled:text-faint disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function BarButton({
  title,
  onClick,
  danger = false,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-body transition hover:bg-card-hover ${
        danger ? "hover:text-clay" : "hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function hint(
  tool: Tool,
  target: DrawTarget,
  points: number,
  editable: boolean,
  locked: boolean,
  selection: "open" | "locked" | "plant" | "group" | null,
  layer: Layer,
  framing: boolean,
  /** The frame is the uploaded plan's paper: no handles to take in more. */
  paperOnly: boolean
): string {
  if (!locked) return framing ? "Frame the yard inside the dashed line, then Lock view." : "";
  const name = target === "Boundary" ? "yard boundary" : (styleOf(target) ?? target).toLowerCase();
  switch (tool) {
    case "place":
      return "Click to plant it — and again for each one. Esc when you're done.";
    case "select":
      if (layer === "design") {
        if (!editable) return "Click a plant or surface to see it. Drag to pan, scroll to zoom.";
        if (selection === "plant") return "Drag it to move it; the round handle turns it, and so does R. Shift-click another to pick it too.";
        if (selection === "group") return "Drag any of them to move them all. Shift-click to add one or take one out.";
        if (selection === "locked") return "Locked: it can't be moved or changed. Unlock it to work on it.";
        if (selection === "open") return "Drag a corner to move it, or a dot mid-edge to add one. Change its material on the right.";
        return "Pick a slot on the bar (or 1–7), then click the plan. In Edit, click a plant to change it — shift-drag to pick several.";
      }
      if (!editable) return "Click a shape to see its sizes. Drag to pan, scroll to zoom.";
      if (selection === "locked") return "Locked: it can't be moved or changed. Unlock it to work on it.";
      if (selection === "open") {
        return "Drag a corner to move it, or a dot mid-edge to add one. Smooth curves the outline; double-click a corner to switch it.";
      }
      return paperOnly
        ? "Click a shape to change it, or pick a tool on the left to trace one."
        : "Click a shape to change it. Drag the photo's corner handles to take in more of the yard.";
    case "measure":
      return points === 0 ? "Click two points to measure between them." : "Click the second point.";
    case "rect":
      return points === 0
        ? `Click a corner of the ${name}.`
        : points === 1
          ? "Click the next corner along one side — or type its length."
          : "Pull out the depth and click — or type it.";
    case "circle":
      return points === 0 ? `Click the centre of the ${name}.` : "Click its edge — or type how wide it is.";
    case "line":
      return points === 0
        ? `Click where the ${name} starts.`
        : "Click the next point, or type a length. Enter or click the last point again to finish.";
    case "area":
      return points === 0
        ? `Click the first corner of the ${name}.`
        : points < 3
          ? "Click the next corner, or type a length and press Enter. Option turns snapping off."
          : "Click the first corner (or press Enter) to finish.";
  }
}

/* ── The uploaded plan ───────────────────────────────────────────── */

/** The buttons by a plant: name chip and a row of round buttons. */
const ACTIONS_H = 104;

/** A pixel of the uploaded plan, in plan metres. */
function imageToPlan(m: PlanImage, [u, v]: Pt): XZ {
  const c = Math.cos(m.rotation);
  const s = Math.sin(m.rotation);
  const du = (u - m.w / 2) * m.scale;
  const dv = (v - m.h / 2) * m.scale;
  return [m.x + c * du - s * dv, m.z + s * du + c * dv];
}

/** A plan point, in pixels of the uploaded plan. */
function planToImage(m: PlanImage, [x, z]: XZ): Pt {
  const c = Math.cos(m.rotation);
  const s = Math.sin(m.rotation);
  const dx = x - m.x;
  const dz = z - m.z;
  return [(c * dx + s * dz) / m.scale + m.w / 2, (-s * dx + c * dz) / m.scale + m.h / 2];
}

const imageCorners = (m: PlanImage): XZ[] =>
  ([[0, 0], [m.w, 0], [m.w, m.h], [0, m.h]] as Pt[]).map((p) => imageToPlan(m, p));

/** The sheet of paper round an uploaded plan, with a little margin (2 m, or
 *  less round a small drawing): the frame of a plan started from the
 *  upload, which has no photo to frame. */
export function imageFrame(m: PlanImage): PlanFrame {
  const corners = imageCorners(m);
  const xs = corners.map((p) => p[0]);
  const zs = corners.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const margin = Math.min(2, 0.04 * Math.max(x1 - x0, z1 - z0));
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, halfWidth: (x1 - x0) / 2 + margin, halfHeight: (z1 - z0) / 2 + margin };
}

function inImage(m: PlanImage, p: XZ): boolean {
  const [u, v] = planToImage(m, p);
  return u >= 0 && v >= 0 && u <= m.w && v <= m.h;
}

/** Scaled about `a`, so the line a–b on it measures `len` metres. */
function rescaled(m: PlanImage, a: XZ, b: XZ, len: number): PlanImage {
  const k = len / dist(a, b);
  return { ...m, scale: Math.min(10, Math.max(1e-5, m.scale * k)), x: a[0] + (m.x - a[0]) * k, z: a[1] + (m.z - a[1]) * k, scaled: true };
}

/** A turn of the plan, in radians, kept within a half turn either way:
 *  to 15° steps with Shift, and onto a square turn (0°, 90°…) within a
 *  degree of one. */
function snapTurn(r: number, coarse: boolean): number {
  let deg = (r * 180) / Math.PI;
  if (coarse) deg = Math.round(deg / 15) * 15;
  const square = Math.round(deg / 90) * 90;
  if (Math.abs(deg - square) < 1) deg = square;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  return (deg * Math.PI) / 180;
}

/** The compass's size on screen, its radius in pixels. */
const COMPASS_R = 56;

/** A cursor of a turning arrow: dragging turns the plan. */
const TURN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    ["#fff", "#1c2a21"]
      .map((c, i) => `<g stroke="${c}" stroke-width="${i ? 2 : 5}"><path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4v4h-4"/></g>`)
      .join("") +
    "</svg>"
)}") 12 12, grab`;

/** A compass, north always straight up the sheet: the plan is turned till
 *  its own north arrow points the way this one does. */
function Compass({ at: [x, y] }: { at: Pt }) {
  const r = COMPASS_R;
  const letters: [string, number, number][] = [
    ["N", 0, -r + 15],
    ["E", r - 14, 0],
    ["S", 0, r - 14],
    ["W", -r + 14, 0],
  ];
  return (
    <g pointerEvents="none" transform={`translate(${x} ${y})`} style={{ filter: "drop-shadow(0 1px 3px rgb(0 0 0 / 0.18))" }}>
      {/* Clear, like a map compass: laid over the plan's arrow, it shows through. */}
      <circle r={r} fill="var(--card)" fillOpacity={0.55} stroke="var(--rule-strong)" strokeWidth={1.5} />
      {Array.from({ length: 24 }, (_, i) => i * 15)
        .filter((d) => d % 90 !== 0)
        .map((d) => {
          const a = (d * Math.PI) / 180;
          const r0 = d % 45 === 0 ? r - 9 : r - 5;
          return (
            <line
              key={d}
              x1={Math.sin(a) * r0}
              y1={-Math.cos(a) * r0}
              x2={Math.sin(a) * (r - 2)}
              y2={-Math.cos(a) * (r - 2)}
              stroke="var(--rule-strong)"
              strokeWidth={1}
            />
          );
        })}
      {letters.map(([t, lx, ly]) => (
        <text
          key={t}
          x={lx}
          y={ly}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={t === "N" ? 15 : 10}
          fontWeight={700}
          fill={t === "N" ? "var(--clay)" : "var(--text-muted)"}
        >
          {t}
        </text>
      ))}
      <path d={`M0 ${-r + 26}L7 0L-7 0Z`} fill="var(--clay)" />
      <path d={`M0 ${r - 26}L7 0L-7 0Z`} fill="var(--rule-strong)" />
      <circle r={3} fill="var(--card)" stroke="var(--ink)" strokeWidth={1.5} />
    </g>
  );
}

/** How strongly the uploaded plan shows: its own strength while tracing,
 *  faint under the design. */
const imageOpacity = (m: PlanImage, layer: Layer) => (layer === "design" ? m.opacity * 0.45 : m.opacity);

/** The <img> for the uploaded plan, laid in the plan's frame. `ox`/`oy`:
 *  where its container sits on the screen. */
function imageStyle(m: PlanImage, v: View, s: Size, ox: number, oy: number, opacity: number): React.CSSProperties {
  const k = m.scale * v.ppm;
  const c = Math.cos(m.rotation);
  const sn = Math.sin(m.rotation);
  const [sx, sy] = toScreen(v, s, [m.x, m.z]);
  const e = sx - (c * m.w - sn * m.h) * (k / 2) - ox;
  const f = sy - (sn * m.w + c * m.h) * (k / 2) - oy;
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: m.w,
    height: m.h,
    maxWidth: "none",
    transformOrigin: "0 0",
    transform: `matrix(${k * c},${k * sn},${-k * sn},${k * c},${e},${f})`,
    opacity,
  };
}

function ImageHandles({ corners, mid, turn }: { corners: Pt[]; mid: Pt; turn: Pt }) {
  return (
    <g pointerEvents="none">
      <polygon
        points={corners.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeDasharray="6 4"
      />
      <line x1={mid[0]} y1={mid[1]} x2={turn[0]} y2={turn[1]} stroke="var(--accent)" />
      <circle cx={turn[0]} cy={turn[1]} r={6} fill="#fff" stroke="var(--accent)" strokeWidth={1.5} />
      {corners.map(([x, y], i) => (
        <rect key={i} x={x - 5} y={y - 5} width={10} height={10} fill="#fff" stroke="var(--accent)" strokeWidth={1.5} />
      ))}
    </g>
  );
}

/** The line being measured on the uploaded plan. */
function ImageLine({ a, b, S, placed }: { a: XZ; b: XZ; S: (p: XZ) => Pt; placed: number }) {
  const [ax, ay] = S(a);
  const [bx, by] = S(b);
  return (
    <g pointerEvents="none">
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#fff" strokeWidth={4} strokeOpacity={0.85} />
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--clay)" strokeWidth={2} strokeDasharray="6 4" />
      {/* The ends clicked down are handles, ringed: drag one to nudge it. */}
      <circle cx={ax} cy={ay} r={6} fill="#fff" stroke="var(--clay)" strokeWidth={2} />
      <circle cx={ax} cy={ay} r={1.5} fill="var(--clay)" />
      {placed === 2 ? (
        <>
          <circle cx={bx} cy={by} r={6} fill="#fff" stroke="var(--clay)" strokeWidth={2} />
          <circle cx={bx} cy={by} r={1.5} fill="var(--clay)" />
        </>
      ) : (
        <circle cx={bx} cy={by} r={4} fill="var(--clay)" />
      )}
    </g>
  );
}

function imageHint(tool: ImageTool, clicks: number): string {
  switch (tool) {
    case "align":
      return "Drag the plan to move it, a corner to size it, the round handle to turn it (Shift: 15° steps). Esc when it lines up.";
    case "scale":
      return clicks < 2
        ? "Scroll to zoom in on the end of the line. The magnifier shows exactly where a click lands."
        : "Drag an end to fine-tune it, or click somewhere else to start the line again.";
    case "north":
      return "Drag the plan to turn it. The compass can be dragged next to the plan's arrow.";
    case "photo":
      return "Drag the photo until it sits under the plan. Esc when it lines up.";
  }
}

/* ── Setting up an uploaded plan ─────────────────────────────────── */

/** Scales plans are printed at, as feet to the inch: the engineer's for
 *  site plans and surveys, then the architect's. */
const PRINTED_SCALES: { label: string; ftPerInch: number }[] = [
  ...[10, 20, 30, 40, 50, 60, 100].map((ft) => ({ label: `1" = ${ft}'`, ftPerInch: ft })),
  { label: `1/4" = 1'`, ftPerInch: 4 },
  { label: `3/16" = 1'`, ftPerInch: 16 / 3 },
  { label: `1/8" = 1'`, ftPerInch: 8 },
  { label: `3/32" = 1'`, ftPerInch: 32 / 3 },
  { label: `1/16" = 1'`, ftPerInch: 16 },
];

/** A length in whole feet, for sizes too big to want inches. */
const wholeFeet = (m: number) => `${Math.round(m * FEET_PER_METER).toLocaleString("en-US")}′`;

/** How big the whole drawing comes out at this many metres a pixel. */
const drawingSize = (m: PlanImage, scale: number) => `${wholeFeet(m.w * scale)} × ${wholeFeet(m.h * scale)}`;

/** Bigger than any one property's drawing (and than the sheet can save);
 *  smaller than any yard's. */
const DRAWING_MAX_M = 1000;
const DRAWING_MIN_M = 3;

/** What's wrong with a scale that makes the drawing this big, if anything:
 *  too big refuses it, too small only says so. */
function scaleCheck(m: PlanImage, scale: number): { refuse: boolean; text: string } | null {
  const across = Math.max(m.w, m.h) * scale;
  if (across > DRAWING_MAX_M) {
    return { refuse: true, text: `That makes the drawing ${drawingSize(m, scale)} — too big for one property. Check the length and the line's ends.` };
  }
  if (across < DRAWING_MIN_M) return { refuse: false, text: `That makes the drawing only ${drawingSize(m, scale)}. Check the length.` };
  return null;
}


/**
 * The card for the step under way on an uploaded plan, docked at the top of
 * the sheet: its scale (from a dimension on it, or the scale it was printed
 * at), its north, or — on a plan started from the upload — the photo slid
 * under it. Each says how big the drawing will come out before it's set,
 * the check a wrong length fails loudly.
 */
function ImageStep({
  tool,
  plan,
  line,
  ends,
  length,
  onLength,
  onScale,
  onPrinted,
  onClearLine,
  onClose,
  onSkip,
  onNorth,
  guided,
  shield,
  onPointerEnter,
}: {
  tool: "scale" | "north" | "photo";
  plan: PlanImage;
  line: [XZ, XZ] | null;
  ends: number;
  length: string;
  onLength: (text: string) => void;
  onScale: () => void;
  onPrinted: (ftPerInch: number) => void;
  onClearLine: () => void;
  onClose: () => void;
  onSkip?: () => void;
  /** The plan's north arrow points the compass's way: keep it. */
  onNorth: () => void;
  guided: boolean;
  shield: { onPointerDown: (e: React.PointerEvent) => void; onDoubleClick: (e: React.MouseEvent) => void };
  /** The pointer came off the sheet onto the card. */
  onPointerEnter: () => void;
}) {
  const [printed, setPrinted] = useState("");
  const typed = parseLength(length);
  const byLine = line && typed ? rescaled(plan, line[0], line[1], typed) : null;
  const ftPerInch = PRINTED_SCALES.find((x) => x.label === printed)?.ftPerInch ?? null;
  const lineCheck = byLine ? scaleCheck(plan, byLine.scale) : null;
  const printedScale = ftPerInch != null && plan.ppi ? ftPerInch / FEET_PER_METER / plan.ppi : null;
  const printedCheck = printedScale != null ? scaleCheck(plan, printedScale) : null;
  const step = (n: number) => (guided ? `Step ${n} of 2 · ` : "");
  const title =
    tool === "scale" ? `${step(1)}Set the scale` : tool === "north" ? `${step(2)}Point it north` : "Line up the photo";

  return (
    <div
      className="absolute left-1/2 top-3 z-20 w-[min(560px,calc(100%-200px))] -translate-x-1/2 rounded-xl border border-rule-strong bg-card p-3 shadow-lg"
      {...shield}
      onPointerEnter={onPointerEnter}
      onKeyDown={(e) => {
        // Esc in a field closes the step, as it does on the sheet.
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{title}</p>
          <p className="mt-0.5 text-sm text-body">
            {tool === "scale"
              ? ends === 0
                ? "Click both ends of a length written on the plan — a lot line is best."
                : ends === 1
                  ? "Now click the other end."
                  : "Type how long that line is. Drag an end to fine-tune it."
              : tool === "north"
                ? "Drag the plan to turn it, until its north arrow points the same way as the compass."
                : "Drag the photo until it sits under the plan."}
          </p>
        </div>
        {onSkip ? (
          <button type="button" onClick={onSkip} className="shrink-0 text-xs font-semibold text-muted hover:text-ink">
            Skip
          </button>
        ) : (
          <button type="button" onClick={onClose} className="shrink-0 text-xs font-semibold text-muted hover:text-ink">
            {tool === "photo" ? "Done" : "Cancel"}
          </button>
        )}
      </div>

      {tool === "scale" && (
        <>
          <form
            className="mt-2.5 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onScale();
            }}
          >
            <label className="flex items-center gap-2 text-xs font-semibold text-body">
              That line is
              <input
                autoFocus
                value={length}
                onChange={(e) => onLength(e.target.value)}
                placeholder="100'"
                inputMode="decimal"
                aria-label="The line's length"
                className="w-24 rounded-md border border-rule-strong bg-card-hover px-2 py-1 text-sm font-normal text-ink placeholder:text-faint"
              />
            </label>
            <button
              type="submit"
              disabled={!byLine || lineCheck?.refuse}
              className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              Set scale
            </button>
            {ends > 0 && (
              <button type="button" onClick={onClearLine} className="text-xs font-semibold text-muted hover:text-ink">
                Clear line
              </button>
            )}
            <span className={`ml-auto text-xs ${lineCheck ? "font-semibold text-clay" : "text-muted"}`}>
              {lineCheck
                ? lineCheck.text
                : byLine
                ? `The drawing comes out ${drawingSize(plan, byLine.scale)}.`
                : length.trim() && typed == null
                  ? `“${length.trim()}” isn't a length — try 100, 100.5 or 100'-6".`
                  : ""}
            </span>
          </form>
          {plan.ppi && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-rule pt-2.5">
              <label className="flex items-center gap-2 text-xs font-semibold text-body">
                Or, printed at
                <select
                  value={printed}
                  onChange={(e) => setPrinted(e.target.value)}
                  aria-label="The plan's printed scale"
                  className="rounded-md border border-rule-strong bg-card-hover px-2 py-1 text-sm font-normal text-ink"
                >
                  <option value="">its scale…</option>
                  {PRINTED_SCALES.map((x) => (
                    <option key={x.label} value={x.label}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={ftPerInch == null || printedCheck?.refuse}
                onClick={() => ftPerInch != null && onPrinted(ftPerInch)}
                className="rounded-md border border-accent px-3 py-1 text-xs font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-40"
              >
                Use it
              </button>
              <span className={`ml-auto text-xs ${printedCheck ? "font-semibold text-clay" : "text-muted"}`}>
                {printedCheck
                  ? printedCheck.text
                  : printedScale != null
                  ? `The drawing comes out ${drawingSize(plan, printedScale)}.`
                  : "Only if the PDF is the real sheet size."}
              </span>
            </div>
          )}
        </>
      )}

      {tool === "north" && (
        <div className="mt-2.5 flex justify-end">
          <button
            type="button"
            onClick={onNorth}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Confirm direction
          </button>
        </div>
      )}
    </div>
  );
}

/** How much closer the magnifier looks than the sheet. */
const LOUPE_ZOOM = 4;
const LOUPE_SIZE = 132;
/** The step's card along the top of the sheet, which the magnifier keeps clear of. */
const LOUPE_CLEAR_TOP = 170;

/** A round close-up of the uploaded plan round `at`, beside the pointer —
 *  up and to the right, or wherever there's room. */
function Loupe({ plan, url, at, view, size }: { plan: PlanImage; url: string; at: XZ; view: View; size: Size }) {
  const [sx, sy] = toScreen(view, size, at);
  const gap = 22;
  const left = sx + gap + LOUPE_SIZE > size.w ? sx - gap - LOUPE_SIZE : sx + gap;
  // Below the pointer where above would run into the step's card.
  const top = sy - gap - LOUPE_SIZE < LOUPE_CLEAR_TOP ? sy + gap : sy - gap - LOUPE_SIZE;
  const close: View = { cx: at[0], cz: at[1], ppm: view.ppm * LOUPE_ZOOM };
  const box: Size = { w: LOUPE_SIZE, h: LOUPE_SIZE };
  const mid = LOUPE_SIZE / 2;
  return (
    <div
      className="pointer-events-none absolute z-20 overflow-hidden rounded-full border-2 border-[var(--clay)] shadow-lg"
      style={{ left, top, width: LOUPE_SIZE, height: LOUPE_SIZE, background: SHEET_PAPER }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" draggable={false} style={imageStyle(plan, close, box, 0, 0, 1)} />
      <svg className="absolute inset-0" width={LOUPE_SIZE} height={LOUPE_SIZE}>
        <line x1={mid} y1={mid - 18} x2={mid} y2={mid - 4} stroke="var(--clay)" strokeWidth={1.5} />
        <line x1={mid} y1={mid + 4} x2={mid} y2={mid + 18} stroke="var(--clay)" strokeWidth={1.5} />
        <line x1={mid - 18} y1={mid} x2={mid - 4} y2={mid} stroke="var(--clay)" strokeWidth={1.5} />
        <line x1={mid + 4} y1={mid} x2={mid + 18} y2={mid} stroke="var(--clay)" strokeWidth={1.5} />
        <circle cx={mid} cy={mid} r={1.5} fill="var(--clay)" />
      </svg>
    </div>
  );
}

