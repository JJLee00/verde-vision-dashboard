"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from "react";
import { BASEMAPS, LOT_LINES, MAX_NATIVE_ZOOM } from "@/lib/blueprint/esri";
import { ringToXZMeters, xzMetersToRing } from "@/lib/blueprint/normalize";
import type { MapOffset } from "@/lib/blueprint/trace";
import type { LatLng } from "@/lib/blueprint/types";
import {
  centroid,
  crosses,
  FEET_PER_METER,
  mainHouse,
  pathLength,
  polygonArea,
  type FeatureType,
  type PlanFeature,
  type PlanFrame,
  type UnderlayKind,
  type XZ,
} from "@/lib/site-plan/plan";
import { BoundaryArt, byLayer, FeatureArt, PlanPatterns, SHEET_PAPER, type Pt } from "./drawing";
import {
  dist,
  feetInches,
  fitView,
  MAX_PPM,
  MIN_PPM,
  nearestOnSegment,
  parseLength,
  pointInPolygon,
  referenceAngles,
  rotateAbout,
  snap,
  sqFt,
  toPlan,
  toScreen,
  type Size,
  type SnapContext,
  type Snapped,
  type View,
} from "./geometry";

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

/** What one undo step covers: the shapes, not the view or the photo. */
export type Doc = { boundary: XZ[]; features: PlanFeature[]; mainHouseId?: string };
export type Tool = "select" | "area" | "rect" | "line" | "circle" | "measure";
/** What the drawing tools make: a feature type, or the yard boundary. */
export type DrawTarget = FeatureType | "Boundary";

export interface SheetHandle {
  /** The part of the plan on screen now, inset a little: what Lock view keeps. */
  visibleBox(): PlanFrame | null;
  fit(box: PlanFrame): void;
  /** Moves the view by (dx, dz) metres, for when the origin under it moved
   *  by the opposite: nothing on screen moves. */
  shift(dx: number, dz: number): void;
}

/** Room left around the locked frame, in screen pixels. */
export const LOCK_INSET = 28;
/** A pointer that moves less than this between down and up clicked. */
const CLICK_SLOP = 4;
const MIN_EDGE_M = 0.1;

type Shape = { pts: XZ[]; closed: boolean; radius?: number; feature?: PlanFeature };

function shapeOf(doc: Doc, id: string): Shape | null {
  if (id === BOUNDARY_ID) return doc.boundary.length >= 3 ? { pts: doc.boundary, closed: true } : null;
  const f = doc.features.find((x) => x.id === id);
  if (!f) return null;
  return { pts: f.points, closed: f.shape !== "line", radius: f.radius, feature: f };
}

function withPoints(doc: Doc, id: string, pts: XZ[]): Doc {
  if (id === BOUNDARY_ID) return { ...doc, boundary: pts };
  return { ...doc, features: doc.features.map((f) => (f.id === id ? { ...f, points: pts } : f)) };
}

/** A copy of a shape a metre down and right, as a new shape. */
export function duplicate(doc: Doc, id: string): { doc: Doc; id: string } | null {
  const f = doc.features.find((x) => x.id === id);
  if (!f) return null;
  const copy: PlanFeature = {
    ...f,
    id: crypto.randomUUID(),
    points: f.points.map(([x, z]) => [x + 1, z + 1] as XZ),
  };
  return { doc: { ...doc, features: [...doc.features, copy] }, id: copy.id };
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
  | { kind: "radius"; id: string; base: Doc };

type Draft = { tool: Tool; target: DrawTarget; points: XZ[] };

export function Sheet({
  handle,
  doc,
  apply,
  undo,
  redo,
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
}: {
  handle: RefObject<SheetHandle | null>;
  doc: Doc;
  apply: (change: (d: Doc) => Doc) => void;
  undo: () => void;
  redo: () => void;
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

  const tool: Tool = editable ? toolProp : toolProp === "measure" ? "measure" : "select";
  const shown = live ?? doc;
  // A half-drawn shape belongs to the tool and target it was started with.
  const active = draft && draft.tool === tool && draft.target === target ? draft : null;
  const drawing = tool !== "select";

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
    }),
    [view, size]
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
        const ppm = Math.min(MAX_PPM, Math.max(MIN_PPM, v.ppm * Math.exp(-e.deltaY * k)));
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
    const add = (id: string, pts: XZ[], closed: boolean) => {
      const n = pts.length;
      pts.forEach((p, i) => {
        if (exclude?.id === id && exclude.index === i) return;
        corners.push(p);
      });
      const m = closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % n;
        if (exclude?.id === id && (exclude.index === i || exclude.index === j)) continue;
        edges.push([pts[i], pts[j]]);
      }
    };
    if (base.boundary.length >= 3) add(BOUNDARY_ID, base.boundary, true);
    for (const f of base.features) {
      if (f.shape === "circle") corners.push(f.points[0]);
      else add(f.id, f.points, f.shape === "area");
    }
    // Square to the house, the lot, and the shape's own first edges.
    const runs: XZ[][] = [];
    const closed: boolean[] = [];
    const house = mainHouse(base);
    if (house) {
      runs.push(house.points);
      closed.push(true);
    }
    if (base.boundary.length >= 3) {
      runs.push(base.boundary);
      closed.push(true);
    }
    if (extra.length >= 2) {
      runs.push(extra);
      closed.push(false);
    }
    return { corners, edges, angles: referenceAngles(runs, closed), ppm: v.ppm };
  }

  function snapAt(screen: Pt, free: boolean): Snapped | null {
    if (!view) return null;
    const p = toPlan(view, size, screen);
    if (free) return { p, kind: null };
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

  /* ── Drawing ── */

  function finishShape(shape: PlanFeature["shape"], points: XZ[], radius?: number) {
    if (target === "Boundary") {
      apply((d) => ({ ...d, boundary: points }));
      onDrawn(BOUNDARY_ID);
    } else {
      const f: PlanFeature = { id: crypto.randomUUID(), type: target, shape, points };
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
    switch (tool) {
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
    const nearRun = (pts: XZ[], closed: boolean) => {
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) if (nearestOnSegment(p, pts[i], pts[(i + 1) % pts.length]).d < tol) return true;
      return false;
    };
    // The lot only by its line: its inside is the whole yard.
    if (shown.boundary.length >= 3 && nearRun(shown.boundary, true)) consider(BOUNDARY_ID, 1);
    for (const f of shown.features) {
      if (f.shape === "circle") {
        const d = dist(p, f.points[0]);
        const r = f.radius ?? 0;
        if (Math.abs(d - r) < tol) consider(f.id, 0);
        else if (d < r) consider(f.id, Math.PI * r * r);
      } else if (f.shape === "line") {
        if (nearRun(f.points, false)) consider(f.id, 0);
      } else if (nearRun(f.points, true)) consider(f.id, 0);
      else if (pointInPolygon(p, f.points)) consider(f.id, polygonArea(f.points));
    }
    return best;
  }

  /** The selected shape's handles, in screen pixels. */
  function handlesOf(id: string | null, v: View) {
    if (!id || !editable || tool !== "select") return null;
    const s = shapeOf(shown, id);
    if (!s) return null;
    const scr = s.pts.map((p) => toScreen(v, size, p));
    if (s.radius != null) {
      const [cx, cy] = scr[0];
      return { vertices: [], mids: [], rotate: null, radius: [cx + s.radius * v.ppm, cy] as Pt };
    }
    const n = s.closed ? scr.length : scr.length - 1;
    const mids: { at: Pt; index: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = scr[i];
      const b = scr[(i + 1) % scr.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 34) mids.push({ at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], index: i });
    }
    const ys = scr.map((p) => p[1]);
    const xs = scr.map((p) => p[0]);
    const top: Pt = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...ys)];
    const rotate = id === BOUNDARY_ID ? null : { stem: top, at: [top[0], top[1] - 26] as Pt };
    return { vertices: scr, mids, rotate, radius: null };
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

    if (drawing) {
      // A click places a point; a drag pans the sheet instead.
      const snapped = snapAt(at, e.altKey);
      return pan(() => {
        if (snapped) addPoint(snapped.p);
      });
    }

    const h = handlesOf(selected, view);
    if (h && selected) {
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
      const mid = h.mids.find((m) => near(m.at, 7));
      if (mid) {
        // A new corner on the edge, dragged from where it was made.
        const s = shapeOf(shown, selected)!;
        const pts = [...s.pts];
        pts.splice(mid.index + 1, 0, toPlan(view, size, mid.at));
        const base = withPoints(shown, selected, pts);
        setLive(base);
        setVertexSel({ id: selected, index: mid.index + 1 });
        gesture.current = { kind: "vertex", id: selected, index: mid.index + 1, base, start: at, moved: true };
        return;
      }
    }

    const p = toPlan(view, size, at);
    const hit = hitShape(p, view);
    if (hit) {
      if (hit !== selected) {
        onSelect(hit);
        setVertexSel(null);
      }
      if (editable) gesture.current = { kind: "move", id: hit, base: shown, start: at, from: p, moved: false };
      else pan(null);
      return;
    }
    pan(() => {
      onSelect(null);
      setVertexSel(null);
    });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!view) return;
    const at = local(e);
    const g = gesture.current;
    if (!g) {
      if (drawing) {
        const snapped = snapAt(at, e.altKey);
        if (snapped) setHover({ screen: at, snapped });
      } else if (hover) setHover(null);
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
        setLive({ ...g.base, features: g.base.features.map((f) => (f.id === g.id ? { ...f, radius: r } : f)) });
        return;
      }
    }
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
    const next = live;
    setLive(null);
    if (!next || ("moved" in g && !g.moved)) return;
    const s = shapeOf(next, g.id);
    if (s && s.radius == null && crosses(s.pts, s.closed)) {
      say("That would make the edges cross, so the corner went back.");
      return;
    }
    apply(() => next);
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
        // While drawing, undo takes back the last point instead.
        if (active && !e.shiftKey) {
          if (active.points.length <= 1) resetDraft();
          else setDraft({ ...active, points: active.points.slice(0, -1) });
        } else if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && editable && selected) {
        e.preventDefault();
        const copy = duplicate(doc, selected);
        if (copy) {
          apply(() => copy.doc);
          onSelect(copy.id);
        }
        return;
      }
      if (mod || e.altKey) return;

      if (active && /^[0-9.'"]$/.test(e.key) && tool !== "measure") {
        e.preventDefault();
        setTyped((t) => (t + e.key).slice(0, 12));
        return;
      }
      switch (e.key) {
        case "Enter": {
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
          const s = shapeOf(doc, selected);
          if (!s) return;
          if (vertexSel?.id === selected && s.radius == null && s.pts.length > (s.closed ? 3 : 2)) {
            const pts = s.pts.filter((_, i) => i !== vertexSel.index);
            if (crosses(pts, s.closed)) return say("Taking that corner out would make the edges cross.");
            apply((d) => withPoints(d, selected, pts));
            setVertexSel(null);
            return;
          }
          apply((d) =>
            selected === BOUNDARY_ID
              ? { ...d, boundary: [] }
              : {
                  ...d,
                  features: d.features.filter((f) => f.id !== selected),
                  mainHouseId: d.mainHouseId === selected ? undefined : d.mainHouseId,
                }
          );
          onSelect(null);
          setVertexSel(null);
          return;
        }
        case "Escape":
          if (typed) setTyped("");
          else if (active) resetDraft();
          else if (measured) setMeasured(null);
          else if (vertexSel) setVertexSel(null);
          else if (selected) onSelect(null);
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
    const shift: XZ = underlay.kind === "map" && mapOffset ? [mapOffset.east, -mapOffset.north] : [0, 0];
    return tilesFor(BASEMAPS[underlay.kind].url, origin, view, size, { min: 3, max: MAX_NATIVE_ZOOM }, shift);
  }, [view, size, origin, underlay.kind, mapOffset]);
  const lotTiles = useMemo(() => {
    if (!view || !origin || !lotLines) return [];
    return tilesFor(LOT_LINES.url, origin, view, size, { min: LOT_LINES.minNativeZoom, max: LOT_LINES.maxNativeZoom }, [0, 0]);
  }, [view, size, origin, lotLines]);

  if (!view) return <div ref={boxRef} className="relative h-full w-full" style={{ background: SHEET_PAPER }} />;

  const S = (p: XZ) => toScreen(view, size, p);
  const photo = underlay.kind === "none" ? 0 : underlay.opacity;
  const wash = 0.4 * photo;
  const frameRect = frame
    ? (() => {
        const [x0, y0] = S([frame.cx - frame.halfWidth, frame.cz - frame.halfHeight]);
        const [x1, y1] = S([frame.cx + frame.halfWidth, frame.cz + frame.halfHeight]);
        return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
      })()
    : { left: 0, top: 0, width: size.w, height: size.h };

  const features = byLayer(shown.features);
  const sel = selected ? shapeOf(shown, selected) : null;
  const h = handlesOf(selected, view);

  const pts = active?.points ?? [];
  const next = hover && drawing ? nextPoint() : null;
  const preview = pts.length > 0 && next ? previewOf(tool, target, pts, next) : null;

  const cursor = panning
    ? "grabbing"
    : spaceHeld
      ? "grab"
      : drawing
        ? "crosshair"
        : "default";

  return (
    <div
      ref={boxRef}
      className="relative h-full w-full touch-none select-none overflow-hidden"
      style={{ background: frame ? "#e4dccb" : SHEET_PAPER, cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => !gesture.current && setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* The sheet of paper, and the photo cut to it. */}
      <div className="absolute overflow-hidden" style={{ ...frameRect, background: SHEET_PAPER }}>
        <div className="absolute inset-0" style={{ opacity: photo }}>
          {tiles.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={t.key}
              src={t.src}
              alt=""
              draggable={false}
              decoding="async"
              className="pointer-events-none absolute max-w-none"
              style={{ left: t.x - frameRect.left, top: t.y - frameRect.top, width: t.w, height: t.h }}
            />
          ))}
        </div>
        {lotTiles.length > 0 && (
          <div className="absolute inset-0" style={{ filter: LOT_LINE_FILTER[underlay.kind] }}>
            {lotTiles.map((t) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={t.key}
                src={t.src}
                alt=""
                draggable={false}
                decoding="async"
                className="pointer-events-none absolute max-w-none"
                style={{ left: t.x - frameRect.left, top: t.y - frameRect.top, width: t.w, height: t.h }}
              />
            ))}
          </div>
        )}
      </div>

      <svg className="absolute inset-0" width={size.w} height={size.h}>
        <PlanPatterns />
        {frame && (
          <rect
            x={frameRect.left}
            y={frameRect.top}
            width={frameRect.width}
            height={frameRect.height}
            fill="none"
            stroke="#1c2a21"
            strokeOpacity={0.35}
          />
        )}
        {framing && (
          <rect
            x={LOCK_INSET}
            y={LOCK_INSET}
            width={Math.max(0, size.w - 2 * LOCK_INSET)}
            height={Math.max(0, size.h - 2 * LOCK_INSET)}
            fill="none"
            stroke="#1c2a21"
            strokeWidth={1.5}
            strokeDasharray="8 6"
            strokeOpacity={0.7}
          />
        )}

        {shown.boundary.length >= 3 && <BoundaryArt pts={shown.boundary.map(S)} halo={photo} />}
        {features.map((f) => (
          <FeatureArt
            key={f.id}
            feature={f}
            pts={f.points.map(S)}
            radius={(f.radius ?? 0) * view.ppm}
            halo={photo}
            wash={wash}
          />
        ))}

        {/* The selection, its sizes, and its handles. */}
        {sel && (
          <g pointerEvents="none">
            <Outline shape={sel} S={S} ppm={view.ppm} />
            <Dims shape={sel} S={S} ppm={view.ppm} />
          </g>
        )}
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
              return (
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
                stroke="#1c2a21"
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

      <ScaleBar ppm={view.ppm} />
      <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-card/90 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-body shadow-sm">
        N ↑
      </div>
      <div className="absolute right-3 top-10 flex flex-col overflow-hidden rounded-md border border-rule-strong bg-card shadow-sm">
        {[
          { label: "+", title: "Zoom in", f: 1.4 },
          { label: "−", title: "Zoom out", f: 1 / 1.4 },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            title={b.title}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setView((v) => (v ? { ...v, ppm: Math.min(MAX_PPM, Math.max(MIN_PPM, v.ppm * b.f)) } : v))}
            className="h-7 w-7 text-sm font-semibold text-body transition hover:bg-card-hover hover:text-ink"
          >
            {b.label}
          </button>
        ))}
        {frame && (
          <button
            type="button"
            title="Back to the whole yard"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setView(fitView(frame, size))}
            className="h-7 w-7 border-t border-rule text-[11px] font-semibold text-body transition hover:bg-card-hover hover:text-ink"
          >
            ⤢
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-2 left-3 right-3 flex items-end justify-between gap-4">
        <p className={`rounded-md px-2 py-1 text-xs shadow-sm ${notice ? "bg-clay text-white" : "bg-card/90 text-body"}`}>
          {notice ?? hint(tool, target, pts.length, editable, frame != null)}
        </p>
        {underlay.kind !== "none" && (
          <p
            onPointerDown={(e) => e.stopPropagation()}
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
  if (tool === "measure") return null;
  const lot = target === "Boundary";
  const asFeature = (shape: PlanFeature["shape"], points: XZ[], radius?: number): PlanFeature | null =>
    lot ? null : { id: "draft", type: target as FeatureType, shape, points, radius };
  const none = { art: null, boundary: null, band: null, radius: undefined };
  if (tool === "circle") {
    const radius = dist(pts[0], next);
    return { ...none, art: asFeature("circle", [pts[0]], radius), run: [pts[0]], closed: true, radius };
  }
  if (tool === "line") {
    const run = [...pts, next];
    return { ...none, art: asFeature("line", run), run, closed: false };
  }
  const run = tool === "rect" ? (pts.length === 1 ? [pts[0], next] : rectCorners(pts[0], pts[1], next)) : [...pts, next];
  const closed = tool === "rect" ? pts.length === 2 : run.length >= 3;
  if (!closed) return { ...none, ...(lot ? { boundary: run } : { band: run }), run, closed };
  return { ...none, ...(lot ? { boundary: run } : { art: asFeature("area", run) }), run, closed };
}

/** A run still being drawn: a dashed ink line on a paper halo. */
function Band({ pts }: { pts: Pt[] }) {
  const d = `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}`;
  return (
    <>
      <path d={d} fill="none" stroke={SHEET_PAPER} strokeOpacity={0.8} strokeWidth={4} />
      <path d={d} fill="none" stroke="#1c2a21" strokeWidth={1.5} strokeDasharray="6 4" />
    </>
  );
}

function Outline({ shape, S, ppm }: { shape: Shape; S: (p: XZ) => Pt; ppm: number }) {
  if (shape.radius != null) {
    const [x, y] = S(shape.pts[0]);
    return <circle cx={x} cy={y} r={shape.radius * ppm} fill="none" stroke="var(--accent)" strokeWidth={2} />;
  }
  const d = `M${shape.pts.map((p) => S(p).map((v) => v.toFixed(1)).join(" ")).join("L")}${shape.closed ? "Z" : ""}`;
  return <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />;
}

/** Every edge's length in feet and inches, outside the shape; the area
 *  in square feet in the middle. */
function Dims({ shape, S, ppm }: { shape: Shape; S: (p: XZ) => Pt; ppm: number }) {
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
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = dist(a, b);
    if (len * ppm < 38) continue;
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
  if (shape.closed && pts.length >= 3) {
    const [cx, cy] = S(centroid(pts));
    out.push(<DimChip key="area" x={cx} y={cy + 16} text={sqFt(polygonArea(pts))} quiet />);
  } else if (!shape.closed && pts.length > 2) {
    const [x, y] = S(pts[pts.length - 1]);
    out.push(<DimChip key="run" x={x} y={y + 16} text={`${feetInches(pathLength(pts, false))} total`} quiet />);
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

/** A bar 60–140 px long at a round number of feet. */
function ScaleBar({ ppm }: { ppm: number }) {
  const pxPerFoot = ppm / FEET_PER_METER;
  const feet = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000].find((f) => f * pxPerFoot >= 60) ?? 2000;
  const w = feet * pxPerFoot;
  return (
    <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-card/90 px-2 py-1 shadow-sm">
      <div className="h-1.5 border-x-2 border-b-2 border-ink" style={{ width: w }} />
      <p className="mt-0.5 text-[10px] font-semibold text-body">{feet} ft</p>
    </div>
  );
}

function hint(tool: Tool, target: DrawTarget, points: number, editable: boolean, locked: boolean): string {
  if (!locked) return "Frame the yard inside the dashed line, then Lock view.";
  const name = target === "Boundary" ? "yard boundary" : target.toLowerCase();
  switch (tool) {
    case "select":
      return editable
        ? "Click a shape to change it. Drag to pan, scroll to zoom."
        : "Click a shape to see its sizes. Drag to pan, scroll to zoom.";
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
