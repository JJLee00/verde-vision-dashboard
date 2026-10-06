"use client";

import "leaflet/dist/leaflet.css";
import "./trace-map.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { LatLng } from "@/lib/blueprint/types";
import { BASEMAPS, LOT_LINES, MAX_NATIVE_ZOOM, type Basemap } from "@/lib/blueprint/esri";
import { xzMetersToRing } from "@/lib/blueprint/normalize";
import { distanceMeters, formatFeetInches, type MapOffset } from "@/lib/blueprint/trace";

// The map the house is traced on — Esri satellite, or Esri's topographic
// map where houses are clean grey footprints — with the corners as handles
// while it is being edited. The designer flips between the two from the
// corner of the map, and the choice is remembered in this browser. Beside
// it, a Lot lines switch lays Regrid's parcel boundaries over either one.
//
// The Map view's house footprints can sit metres from where the satellite
// (and every other aerial we've checked) puts the house — at Ashler Hills,
// ~12 ft. So a project can carry a Map offset: once the designer slides a
// Map-traced house onto the satellite roof, the Map is shifted by the same
// amount and the two views agree for that property (see `mapOffset`).
//
// Leaflet is driven imperatively from effects rather than wrapped in React
// components. It touches `window` the moment it is imported, so it loads
// inside the mount effect, and the outline is a handful of layers that are
// simply rebuilt whenever it changes. The one thing that can't wait for a
// rebuild is a drag in progress — those update the lines in place, and the
// shape is handed back to React when the corner is dropped.

export type ShapeKind = "house" | "boundary";
export interface Shape {
  points: LatLng[];
  /** False while it is still being clicked out, corner by corner. */
  closed: boolean;
}
export type Shapes = Record<ShapeKind, Shape>;

/** Where to look. A new object moves the map; the same one leaves it alone. */
export type MapView =
  | { kind: "center"; lat: number; lng: number; zoom: number }
  | { kind: "fit"; points: LatLng[] };

type L = typeof Leaflet;
type Built = {
  L: L;
  map: Leaflet.Map;
  /** Swapped, not restyled, when the base map changes. */
  tiles: Leaflet.TileLayer;
  basemap: Basemap;
  /** Added to and removed from the map by the Lot lines switch. */
  lots: Leaflet.TileLayer;
  overlay: Leaflet.LayerGroup;
  /** The dashed line from the last corner to the cursor while drawing. */
  band: Leaflet.Polyline;
};

type Ink = { line: string; weight: number; dash?: string; fill: string; fillOpacity: number };
interface Palette {
  ink: Record<ShapeKind, Ink>;
  /** Drawn wider beneath each line so it holds on any ground. */
  halo: string;
  band: string;
  /** The ring around a corner handle. */
  cornerRing: string;
}

const PALETTES: Record<Basemap, Palette> = {
  // Inks for aerial imagery, not the paper UI: the house in the headset's
  // walk gold, the boundary as a cream survey dash, both over a dark halo
  // so they hold on a white roof and on black asphalt alike.
  satellite: {
    ink: {
      house: { line: "#f2c14e", weight: 2.5, fill: "#f2c14e", fillOpacity: 0.18 },
      boundary: { line: "#f8f3e6", weight: 2, dash: "8 6", fill: "#f8f3e6", fillOpacity: 0 },
    },
    halo: "rgba(20,24,20,0.7)",
    band: "#f8f3e6",
    cornerRing: "rgba(20,24,20,0.85)",
  },
  // On the near-white map gold and cream vanish, so the dashboard's own
  // green and ink, over a white halo that lifts them off the grey
  // footprints they are traced against.
  map: {
    ink: {
      house: { line: "#2e5d43", weight: 2.5, fill: "#3c7857", fillOpacity: 0.18 },
      boundary: { line: "#1c2a21", weight: 2, dash: "8 6", fill: "#1c2a21", fillOpacity: 0 },
    },
    halo: "rgba(255,255,255,0.85)",
    band: "#1c2a21",
    cornerRing: "rgba(255,255,255,0.95)",
  },
};

const CONTIGUOUS_US: [number, number] = [39.5, -98.35];
const BASEMAP_KEY = "vv.traceBasemap";
const LOT_LINES_KEY = "vv.traceLotLines";

/** The base map this browser last chose. Satellite until told otherwise. */
function rememberedBasemap(): Basemap {
  try {
    return localStorage.getItem(BASEMAP_KEY) === "map" ? "map" : "satellite";
  } catch {
    return "satellite";
  }
}

/** Whether this browser last had lot lines on. Off until told otherwise. */
function rememberedLotLines(): boolean {
  try {
    return localStorage.getItem(LOT_LINES_KEY) === "1";
  } catch {
    return false;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A private window: the choice simply isn't remembered.
  }
}

function tilesFor(L: L, basemap: Basemap): Leaflet.TileLayer {
  return L.tileLayer(BASEMAPS[basemap].url, {
    maxZoom: 22,
    maxNativeZoom: MAX_NATIVE_ZOOM,
    attribution: BASEMAPS[basemap].attribution,
  });
}

/**
 * A finished outline being edited can be dragged by its inside. It needs a
 * faint fill for that, even the boundary, which is otherwise only a line.
 */
const MOVABLE_FILL = 0.06;

/** Edge labels and midpoint handles drop out below these on-screen sizes. */
const MIN_LABEL_PX = 56;
const MIN_HANDLE_PX = 28;
/** The gap between an edge and its length label. */
const LABEL_GAP_PX = 9;

const toLL = (p: LatLng): [number, number] => [p.lat, p.lng];
const fromLL = (ll: Leaflet.LatLng): LatLng => ({ lat: ll.lat, lng: ll.lng });
const midpoint = (a: LatLng, b: LatLng): LatLng => ({
  lat: (a.lat + b.lat) / 2,
  lng: (a.lng + b.lng) / 2,
});

export function TraceMap({
  shapes,
  editing,
  onChange,
  onAddCorner,
  onMoveWhole,
  onBasemapChange,
  mapOffset,
  view,
  className,
}: {
  shapes: Shapes;
  /** The shape whose corners are handles, or null for a read-only map. */
  editing: ShapeKind | null;
  /** A corner was moved, inserted or removed, or the loop was closed. */
  onChange?: (kind: ShapeKind, shape: Shape) => void;
  /**
   * A click on the map while `editing` is still open. Separate from
   * onChange so the parent can append against its CURRENT state: two clicks
   * inside one frame both land before this component sees either result,
   * and a whole-shape update built from what it last saw would drop one.
   */
  onAddCorner?: (kind: ShapeKind, point: LatLng) => void;
  /**
   * A finished outline was dragged as a whole, from `from` to `to` (any one
   * corner, before and after). Separate from the onChange that also fires,
   * because a whole-outline move on the satellite is what calibrates the Map.
   */
  onMoveWhole?: (kind: ShapeKind, from: LatLng, to: LatLng) => void;
  /** The base map in view, on load and whenever the designer switches. */
  onBasemapChange?: (basemap: Basemap) => void;
  /**
   * How far to shift the Map view's tiles so its house footprints sit where
   * the satellite has them, for this property. Lot lines and the outlines
   * are never shifted: they already agree with the satellite.
   */
  mapOffset?: MapOffset | null;
  view: MapView | null;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const builtRef = useRef<Built | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [lotLines, setLotLines] = useState(false);
  // Labels, handles and the Map offset all follow zoom.
  const [zoom, setZoom] = useState(4);
  // Leaflet's handlers are bound once; they read the current props here.
  const latest = useRef({ shapes, editing, onChange, onAddCorner, onMoveWhole, onBasemapChange });
  useEffect(() => {
    latest.current = { shapes, editing, onChange, onAddCorner, onMoveWhole, onBasemapChange };
  });

  useEffect(() => {
    let cancelled = false;
    let built: Built | null = null;
    let observer: ResizeObserver | null = null;

    (async () => {
      const mod = await import("leaflet");
      const L = ((mod as unknown as { default?: L }).default ?? mod) as L;
      const el = containerRef.current;
      if (cancelled || !el) return;

      const map = L.map(el, {
        // Double-click is a corner on this map, never a zoom.
        doubleClickZoom: false,
        // Off until editing: a read-only map on a long page must not steal
        // the scroll wheel from the page.
        scrollWheelZoom: false,
        maxZoom: 22,
        zoomSnap: 0.5,
      }).setView(CONTIGUOUS_US, 4);

      // Read here, not in useState: the server renders this component too,
      // and has no localStorage to agree with.
      const initial = rememberedBasemap();
      const tiles = tilesFor(L, initial).addTo(map);
      const initialLots = rememberedLotLines();
      const lots = L.tileLayer(LOT_LINES.url, {
        minNativeZoom: LOT_LINES.minNativeZoom,
        maxNativeZoom: LOT_LINES.maxNativeZoom,
        // Below this the service has nothing; not asking keeps it quiet.
        minZoom: LOT_LINES.minNativeZoom,
        maxZoom: 22,
        // Above whichever base map is in, which is always zIndex 1.
        zIndex: 2,
        // Recoloured per base map in trace-map.css.
        className: "trace-lot-lines",
        attribution: LOT_LINES.attribution,
      });
      if (initialLots) lots.addTo(map);

      const overlay = L.layerGroup().addTo(map);
      const band = L.polyline([], {
        color: PALETTES[initial].band,
        weight: 1.5,
        dashArray: "4 4",
        interactive: false,
      });

      map.on("click", (e: Leaflet.LeafletMouseEvent) => {
        const { shapes, editing, onAddCorner } = latest.current;
        if (!editing || !onAddCorner || shapes[editing].closed) return;
        onAddCorner(editing, fromLL(e.latlng));
      });
      map.on("mousemove", (e: Leaflet.LeafletMouseEvent) => {
        const { shapes, editing } = latest.current;
        const shape = editing ? shapes[editing] : null;
        if (!shape || shape.closed || shape.points.length === 0) {
          band.remove();
          return;
        }
        band.setLatLngs([toLL(shape.points[shape.points.length - 1]), e.latlng]);
        if (!map.hasLayer(band)) band.addTo(map);
      });
      map.on("mouseout", () => band.remove());
      map.on("zoomend", () => setZoom(map.getZoom()));

      observer = new ResizeObserver(() => map.invalidateSize());
      observer.observe(el);

      built = { L, map, tiles, basemap: initial, lots, overlay, band };
      builtRef.current = built;
      setBasemap(initial);
      setLotLines(initialLots);
      setZoom(map.getZoom());
      setReady(true);
      latest.current.onBasemapChange?.(initial);
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      built?.map.remove();
      builtRef.current = null;
    };
  }, []);

  useEffect(() => {
    const built = builtRef.current;
    if (!ready || !built || !view) return;
    if (view.kind === "fit") {
      if (view.points.length === 0) return;
      built.map.fitBounds(built.L.latLngBounds(view.points.map(toLL)), {
        padding: [40, 40],
        maxZoom: 20,
      });
    } else {
      built.map.setView([view.lat, view.lng], view.zoom);
    }
  }, [ready, view]);

  const drawing = editing != null && !shapes[editing].closed;
  useEffect(() => {
    const built = builtRef.current;
    if (!ready || !built) return;
    built.map.getContainer().style.cursor = drawing ? "crosshair" : "";
    if (editing) built.map.scrollWheelZoom.enable();
    else built.map.scrollWheelZoom.disable();
    if (!drawing) built.band.remove();
  }, [ready, editing, drawing]);

  useEffect(() => {
    const built = builtRef.current;
    if (!ready || !built || built.basemap === basemap) return;
    built.tiles.remove();
    built.tiles = tilesFor(built.L, basemap).addTo(built.map);
    built.basemap = basemap;
    built.band.setStyle({ color: PALETTES[basemap].band });
  }, [ready, basemap]);

  // After the swap above, so a freshly added Map layer gets its offset too.
  useEffect(() => {
    const built = builtRef.current;
    if (!ready || !built) return;
    const el = built.tiles.getContainer();
    if (!el) return;
    if (basemap !== "map" || !mapOffset) {
      el.style.transform = "";
      return;
    }
    // Metres to screen pixels at this zoom: where the map centre would land
    // if moved by the offset. Leaflet never transforms a layer's own
    // container (only the zoom levels inside it), so this is ours to set.
    const c = built.map.getCenter();
    const [moved] = xzMetersToRing([[mapOffset.east, -mapOffset.north]], { lat: c.lat, lng: c.lng });
    const a = built.map.latLngToLayerPoint(c);
    const b = built.map.latLngToLayerPoint([moved.lat, moved.lng]);
    el.style.transform = `translate(${(b.x - a.x).toFixed(1)}px, ${(b.y - a.y).toFixed(1)}px)`;
  }, [ready, basemap, mapOffset, zoom]);

  useEffect(() => {
    const built = builtRef.current;
    if (!ready || !built) return;
    if (lotLines) built.lots.addTo(built.map);
    else built.lots.remove();
  }, [ready, lotLines]);

  useEffect(() => {
    const built = builtRef.current;
    if (!ready || !built) return;
    draw(
      built,
      shapes,
      editing,
      PALETTES[basemap],
      (kind, shape) => latest.current.onChange?.(kind, shape),
      (kind, from, to) => latest.current.onMoveWhole?.(kind, from, to)
    );
  }, [ready, shapes, editing, basemap, zoom]);

  function choose(next: Basemap) {
    setBasemap(next);
    remember(BASEMAP_KEY, next);
    onBasemapChange?.(next);
  }

  const shifted = mapOffset ? Math.hypot(mapOffset.east, mapOffset.north) : 0;

  function toggleLotLines() {
    const next = !lotLines;
    setLotLines(next);
    remember(LOT_LINES_KEY, next ? "1" : "0");
  }

  return (
    <div className={`trace-map relative ${className ?? ""}`} data-basemap={basemap}>
      <div ref={containerRef} className="absolute inset-0" />
      {ready && editing && basemap === "map" && (
        // Click-through, so it never eats a corner.
        <p className="pointer-events-none absolute bottom-7 left-2.5 z-[1000] max-w-[75%] rounded-md bg-ink/80 px-2.5 py-1.5 text-xs leading-snug text-paper">
          {shifted > 0.3
            ? `Map lined up with the satellite for this property (moved ${formatFeetInches(shifted)}). Tracing here now lands in the right place.`
            : "Map outlines can sit 10 ft or more off the real house. Trace here, then switch to Satellite and drag the outline onto the roof — the Map lines itself up to match."}
        </p>
      )}
      {ready && (
        // Outside Leaflet's container, so a click here is never a corner.
        <div className="absolute right-2.5 top-2.5 z-[1000] flex items-center gap-2">
          <button
            type="button"
            aria-pressed={lotLines}
            onClick={toggleLotLines}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-rule-strong transition ${
              lotLines ? "bg-accent text-paper" : "bg-card text-muted hover:text-ink"
            }`}
          >
            Lot lines
          </button>
          <div className="flex rounded-lg bg-card p-0.5 shadow-sm ring-1 ring-rule-strong">
            {(Object.keys(BASEMAPS) as Basemap[]).map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={basemap === b}
                onClick={() => choose(b)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  basemap === b ? "bg-accent text-paper" : "text-muted hover:text-ink"
                }`}
              >
                {BASEMAPS[b].label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Rebuilds every outline layer from the shapes. Cheap: a house is a dozen corners. */
function draw(
  { L, map, overlay }: Built,
  shapes: Shapes,
  editing: ShapeKind | null,
  palette: Palette,
  emit: (kind: ShapeKind, shape: Shape) => void,
  emitMove: (kind: ShapeKind, from: LatLng, to: LatLng) => void
) {
  overlay.clearLayers();
  const px = (a: LatLng, b: LatLng) =>
    map.latLngToLayerPoint(toLL(a)).distanceTo(map.latLngToLayerPoint(toLL(b)));

  // The shape being edited goes on top.
  const order: ShapeKind[] = editing === "boundary" ? ["house", "boundary"] : ["boundary", "house"];
  for (const kind of order) {
    const shape = shapes[kind];
    const n = shape.points.length;
    if (n === 0) continue;
    const active = editing === kind;
    const dim = editing != null && !active;
    const ink = palette.ink[kind];
    const ring = shape.closed && n >= 3;
    const movable = active && ring;
    const fillOpacity = dim
      ? ink.fillOpacity * 0.45
      : movable
        ? Math.max(ink.fillOpacity, MOVABLE_FILL)
        : ink.fillOpacity;
    // Handles and labels that a whole-outline drag hides until it lands.
    const extras: Leaflet.Layer[] = [];

    let halo: Leaflet.Polyline | Leaflet.Polygon | null = null;
    let line: Leaflet.Polyline | Leaflet.Polygon | null = null;
    if (n >= 2) {
      const lls = shape.points.map(toLL);
      const make = (opts: Leaflet.PolylineOptions) =>
        ring ? L.polygon(lls, opts) : L.polyline(lls, opts);
      halo = make({
        color: palette.halo,
        weight: ink.weight + 3,
        opacity: dim ? 0.35 : 0.7,
        fill: false,
        interactive: false,
      }).addTo(overlay);
      line = make({
        color: ink.line,
        weight: ink.weight,
        opacity: dim ? 0.55 : 1,
        dashArray: ink.dash,
        fill: ring && fillOpacity > 0,
        fillColor: ink.fill,
        fillOpacity,
        interactive: movable,
        bubblingMouseEvents: false,
        className: movable ? "trace-movable" : undefined,
      }).addTo(overlay);
    }
    const reshape = (points: LatLng[]) => {
      const lls = points.map(toLL);
      halo?.setLatLngs(lls);
      line?.setLatLngs(lls);
    };

    // Lengths on the house always (they're what the walk checks against),
    // and on whichever shape is being drawn. Each sits just outside its
    // edge, clear of the midpoint handle on it.
    if ((kind === "house" || active) && !dim) {
      const screen = shape.points.map((p) => map.latLngToLayerPoint(toLL(p)));
      const cx = screen.reduce((sum, p) => sum + p.x, 0) / n;
      const cy = screen.reduce((sum, p) => sum + p.y, 0) / n;
      const edges = ring ? n : n - 1;
      for (let i = 0; i < edges; i++) {
        const a = shape.points[i];
        const b = shape.points[(i + 1) % n];
        const pa = screen[i];
        const pb = screen[(i + 1) % n];
        const len = pa.distanceTo(pb);
        if (len < MIN_LABEL_PX) continue;
        let nx = -(pb.y - pa.y) / len;
        let ny = (pb.x - pa.x) / len;
        if (nx * ((pa.x + pb.x) / 2 - cx) + ny * ((pa.y + pb.y) / 2 - cy) < 0) {
          nx = -nx;
          ny = -ny;
        }
        const label = L.marker(toLL(midpoint(a, b)), {
          icon: labelIcon(L, formatFeetInches(distanceMeters(a, b)), [nx, ny]),
          interactive: false,
          keyboard: false,
        }).addTo(overlay);
        extras.push(label);
      }
    }

    if (!active) continue;

    // Midpoints first, so a corner always sits above them.
    if (ring) {
      for (let i = 0; i < n; i++) {
        const a = shape.points[i];
        const b = shape.points[(i + 1) % n];
        if (px(a, b) < MIN_HANDLE_PX) continue;
        const at = midpoint(a, b);
        const insert = (p: LatLng) => [
          ...shape.points.slice(0, i + 1),
          p,
          ...shape.points.slice(i + 1),
        ];
        const handle = L.marker(toLL(at), {
          draggable: true,
          icon: midpointIcon(L, ink.line),
          keyboard: false,
          zIndexOffset: 500,
        });
        handle.on("drag", () => reshape(insert(fromLL(handle.getLatLng()))));
        handle.on("dragend", () =>
          emit(kind, { points: insert(fromLL(handle.getLatLng())), closed: true })
        );
        handle.on("click", () => emit(kind, { points: insert(at), closed: true }));
        handle.addTo(overlay);
        extras.push(handle);
      }
    }

    const working = [...shape.points];
    const corners: Leaflet.Marker[] = [];
    shape.points.forEach((p, i) => {
      // While drawing, the first corner is the way to close the loop.
      const closer = !shape.closed && i === 0 && n >= 3;
      const corner = L.marker(toLL(p), {
        draggable: true,
        icon: cornerIcon(L, ink.line, palette.cornerRing, closer),
        keyboard: false,
        zIndexOffset: closer ? 2000 : 1000,
      });
      corner.on("drag", () => {
        working[i] = fromLL(corner.getLatLng());
        reshape(working);
      });
      corner.on("dragend", () => {
        working[i] = fromLL(corner.getLatLng());
        emit(kind, { points: [...working], closed: shape.closed });
      });
      corner.on("click", () => {
        if (closer) emit(kind, { points: shape.points, closed: true });
      });
      // Right-click (or two-finger click) removes a corner. Not double-click:
      // that would also land its first click, which closes the loop when it
      // hits the first corner.
      corner.on("contextmenu", (e: Leaflet.LeafletMouseEvent) => {
        L.DomEvent.stop(e);
        if (shape.closed && n <= 3) return;
        emit(kind, { points: shape.points.filter((_, j) => j !== i), closed: shape.closed });
      });
      corner.addTo(overlay);
      corners.push(corner);
    });

    // Dragging inside a finished outline moves all of it. This is how a
    // shape traced on the Map view, whose footprints can sit several metres
    // from the real house, gets slid onto the roof on Satellite; it is just
    // as handy for a satellite trace that landed a little off.
    if (movable && line) {
      line.on("mousedown", (e: Leaflet.LeafletMouseEvent) => {
        if (e.originalEvent.button !== 0) return;
        L.DomEvent.stop(e);
        // Before the event reaches the map, or it would pan instead.
        map.dragging.disable();
        const start = e.latlng;
        let moved: LatLng[] | null = null;
        for (const layer of extras) layer.remove();
        // Document-level: the cursor rides on top of the outline the whole
        // way, and the outline keeps its mouse events from the map.
        const onMove = (ev: MouseEvent) => {
          const at = map.mouseEventToLatLng(ev);
          const dLat = at.lat - start.lat;
          const dLng = at.lng - start.lng;
          moved = shape.points.map((q) => ({ lat: q.lat + dLat, lng: q.lng + dLng }));
          reshape(moved);
          moved.forEach((q, i) => corners[i].setLatLng(toLL(q)));
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          map.dragging.enable();
          // The redraw this triggers brings the labels and handles back,
          // moved or not.
          emit(kind, { points: moved ?? shape.points, closed: true });
          if (moved) emitMove(kind, shape.points[0], moved[0]);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp, { once: true });
      });
    }
  }
}

function cornerIcon(L: L, color: string, ring: string, closer: boolean): Leaflet.DivIcon {
  const size = closer ? 18 : 12;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html:
      `<div style="box-sizing:border-box;width:${size}px;height:${size}px;border-radius:50%;` +
      `background:${closer ? "#f8f3e6" : color};` +
      `border:2px solid ${closer ? color : ring};` +
      `box-shadow:0 0 0 1.5px rgba(20,24,20,0.55);cursor:${closer ? "pointer" : "grab"}"></div>`,
  });
}

function midpointIcon(L: L, color: string): Leaflet.DivIcon {
  const size = 10;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html:
      `<div style="box-sizing:border-box;width:${size}px;height:${size}px;border-radius:50%;` +
      `background:rgba(20,24,20,0.45);border:1.5px solid ${color};opacity:0.9;cursor:grab"></div>`,
  });
}

/**
 * A length label beside its edge. `normal` is the unit vector pointing away
 * from the shape; the label's own size is part of the shift (the % terms),
 * so a wide label beside an upright edge clears it as well as a flat one.
 */
function labelIcon(L: L, text: string, [nx, ny]: [number, number]): Leaflet.DivIcon {
  const shift = (n: number) =>
    `calc(${(-50 + n * 50).toFixed(1)}% + ${(n * LABEL_GAP_PX).toFixed(1)}px)`;
  return L.divIcon({
    className: "",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html:
      `<div style="position:absolute;transform:translate(${shift(nx)},${shift(ny)});white-space:nowrap;` +
      `pointer-events:none;font:600 11px/1.2 var(--font-schibsted),system-ui,sans-serif;` +
      `color:#f8f3e6;background:rgba(20,24,20,0.72);padding:2px 5px;border-radius:4px">${text}</div>`,
  });
}
