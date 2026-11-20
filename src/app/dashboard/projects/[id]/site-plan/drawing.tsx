// How a site plan looks: every shape in the blueprint's own patterns
// (src/lib/blueprint/feature-style.ts, shared with the PDF), over a paper
// wash so the patterns read on the photo too. Pure SVG and no hooks, so the
// project page's thumbnail and the builder's sheet draw the same way.
//
// Everything here is in SCREEN pixels: the caller maps plan metres to the
// screen first. The patterns stay the size they are on the printed sheet,
// at any zoom, the way a hatch does on paper.

import { cssColor, featureStyle, type FeatureFill } from "@/lib/blueprint/feature-style";
import { edgeCurves, withCurves, type FeatureType, type PlanFeature, type PlanSurface } from "@/lib/site-plan/plan";
import { surfaceStyle } from "@/lib/surfaces";

export type Pt = [number, number];

/** Sheet points to screen pixels for patterns and line weights. */
const K = 1.5;

/** The drawing sheet: the 3D view's sand, so the plan and the 3D view are
 *  one ground and the switch between them doesn't flash. */
export const SHEET_PAPER = "#ebe0cb";
export const INK = "#1c2a21";

const FILL_IDS: Record<FeatureFill["kind"] | "light", string> = {
  lines: "vv-hatch-lines",
  light: "vv-hatch-light",
  waves: "vv-hatch-waves",
  dots: "vv-hatch-dots",
};

function fillId(type: FeatureType): string {
  const fill = featureStyle(type).fill;
  if (fill.kind === "lines") return fill.color[0] > 0.45 ? FILL_IDS.light : FILL_IDS.lines;
  return FILL_IDS[fill.kind];
}

/** The four patterns every shape fills with. Render once per <svg>. */
export function PlanPatterns() {
  const house = featureStyle("House").fill;
  const other = featureStyle("Other").fill;
  const pool = featureStyle("Pool").fill;
  const paving = featureStyle("Patio").fill;
  const lines = (id: string, f: FeatureFill) => {
    if (f.kind !== "lines") return null;
    const s = f.spacing * K;
    return (
      <pattern id={id} width={s} height={s} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1={0} y1={0} x2={0} y2={s} stroke={cssColor(f.color)} strokeWidth={f.width * K} />
      </pattern>
    );
  };
  const wl = pool.kind === "waves" ? pool.wavelength * K : 12;
  const amp = pool.kind === "waves" ? pool.amplitude * K : 1.2;
  const ws = pool.kind === "waves" ? pool.spacing * K : 6;
  const ds = paving.kind === "dots" ? paving.spacing * K : 9;
  return (
    <defs>
      {lines(FILL_IDS.lines, house)}
      {lines(FILL_IDS.light, other)}
      {pool.kind === "waves" && (
        <pattern id={FILL_IDS.waves} width={wl} height={ws} patternUnits="userSpaceOnUse">
          <path
            d={`M0 ${ws / 2} Q ${wl / 4} ${ws / 2 - amp} ${wl / 2} ${ws / 2} T ${wl} ${ws / 2}`}
            fill="none"
            stroke={cssColor(pool.color)}
            strokeWidth={pool.width * K}
          />
        </pattern>
      )}
      {paving.kind === "dots" && (
        <pattern id={FILL_IDS.dots} width={ds} height={ds} patternUnits="userSpaceOnUse">
          <circle cx={ds / 2} cy={ds / 2} r={paving.radius * K} fill={cssColor(paving.color)} />
        </pattern>
      )}
    </defs>
  );
}

const f1 = (v: number) => v.toFixed(1);

/** A run as an SVG path, through its smooth corners as true curves
 *  (plan.ts edgeCurves). */
export function pathOf(pts: Pt[], closed: boolean, smooth?: boolean[]): string {
  if (pts.length === 0) return "";
  const curves = edgeCurves(pts, smooth, closed);
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  curves.forEach((c, i) => {
    const [x, y] = pts[(i + 1) % pts.length];
    d += c ? `C${f1(c[0][0])} ${f1(c[0][1])} ${f1(c[1][0])} ${f1(c[1][1])} ${f1(x)} ${f1(y)}` : `L${f1(x)} ${f1(y)}`;
  });
  return d + (closed ? "Z" : "");
}

/** Screen points along a run's curves, close enough for ticks and labels. */
const along = (pts: Pt[], closed: boolean, smooth?: boolean[]) => withCurves(pts, smooth, closed, 6);

/** Pavement first, buildings over it, runs on top — the sheet's stacking. */
const LAYER: Record<FeatureType, number> = {
  Driveway: 0,
  Walkway: 0,
  Patio: 1,
  Deck: 1,
  Pool: 2,
  "Fire Pit": 3,
  Other: 3,
  House: 4,
  Garage: 4,
  Shed: 4,
  "AC Unit": 5,
  Fence: 6,
  "Retaining Wall": 6,
};

/** Shapes in the order they're drawn, bottom first. */
export function byLayer<T extends Pick<PlanFeature, "type">>(features: T[]): T[] {
  return features
    .map((f, i) => ({ f, i }))
    .sort((a, b) => LAYER[a.f.type] - LAYER[b.f.type] || a.i - b.i)
    .map(({ f }) => f);
}

export const displayName = (f: Pick<PlanFeature, "type" | "label">) =>
  f.type === "Other" ? f.label?.trim() || "Other" : f.type;

/**
 * One shape. `halo` lays a paper-coloured line under the ink so it holds on
 * the photo — pass the photo's opacity, 0 on bare paper. `wash` is the
 * paper tint inside areas, again so the pattern reads over the photo.
 */
export function FeatureArt({
  feature,
  pts,
  radius = 0,
  smooth,
  halo,
  wash,
  label = true,
  dim = false,
  locked = false,
}: {
  feature: Pick<PlanFeature, "type" | "label" | "shape">;
  /** Screen points: the corners, the run, or [centre] for a circle. */
  pts: Pt[];
  /** Screen pixels, for a circle. */
  radius?: number;
  /** Which corners are smooth. */
  smooth?: boolean[];
  halo: number;
  wash: number;
  label?: boolean;
  /** Drawn faintly: a placed shape's old copy, or one being dragged. */
  dim?: boolean;
  /** Locked in the builder: a padlock on its label. */
  locked?: boolean;
}) {
  const style = featureStyle(feature.type);
  const stroke = cssColor(style.stroke);
  const opacity = dim ? 0.45 : 1;

  if (feature.shape === "line") {
    const d = pathOf(pts, false, smooth);
    const run = along(pts, false, smooth);
    const fence = feature.type === "Fence";
    return (
      <g opacity={opacity}>
        {halo > 0 && (
          <path d={d} fill="none" stroke={SHEET_PAPER} strokeOpacity={0.85 * halo} strokeWidth={fence ? 6 : 8} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {fence ? (
          <>
            <path d={d} fill="none" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
            <FenceTicks pts={run} />
          </>
        ) : (
          <>
            <path d={d} fill="none" stroke={INK} strokeWidth={5} strokeLinejoin="miter" />
            <path d={d} fill="none" stroke="#9a968c" strokeWidth={2.6} strokeLinejoin="miter" />
          </>
        )}
        {label && <RunLabel pts={run} text={displayName(feature)} locked={locked} />}
      </g>
    );
  }

  const fill = `url(#${fillId(feature.type)})`;
  const d = pathOf(pts, true, smooth);
  const el = (props: { fill: string; fillOpacity?: number; stroke?: string; strokeOpacity?: number; strokeWidth?: number }) =>
    feature.shape === "circle" ? (
      <circle cx={pts[0][0]} cy={pts[0][1]} r={radius} {...props} />
    ) : (
      <path d={d} strokeLinejoin="miter" {...props} />
    );
  return (
    <g opacity={opacity}>
      {wash > 0 && el({ fill: SHEET_PAPER, fillOpacity: wash })}
      {el({ fill })}
      {halo > 0 && el({ fill: "none", stroke: SHEET_PAPER, strokeOpacity: 0.85 * halo, strokeWidth: 4.5 })}
      {el({ fill: "none", stroke, strokeWidth: 1.2 * K })}
      {label && (
        <AreaLabel
          pts={radius > 0 ? pts : along(pts, true, smooth)}
          radius={radius}
          text={displayName(feature)}
          color={cssColor(style.label)}
          locked={locked}
        />
      )}
    </g>
  );
}

/** Short cross-ticks along a fence, every 14 px. */
function FenceTicks({ pts }: { pts: Pt[] }) {
  const ticks: string[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1) continue;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    for (let t = 7; t < len - 3; t += 14) {
      const cx = x0 + ux * t;
      const cy = y0 + uy * t;
      ticks.push(`M${(cx - uy * 3.5).toFixed(1)} ${(cy + ux * 3.5).toFixed(1)}L${(cx + uy * 3.5).toFixed(1)} ${(cy - ux * 3.5).toFixed(1)}`);
    }
  }
  return <path d={ticks.join("")} stroke={INK} strokeWidth={1.2} />;
}

/** The yard boundary: the sheet's heaviest line, a survey dash. */
export function BoundaryArt({
  pts,
  closed = true,
  smooth,
  halo,
}: {
  pts: Pt[];
  closed?: boolean;
  smooth?: boolean[];
  halo: number;
}) {
  const d = pathOf(pts, closed, smooth);
  return (
    <g>
      {halo > 0 && <path d={d} fill="none" stroke={SHEET_PAPER} strokeOpacity={0.85 * halo} strokeWidth={5.5} />}
      <path d={d} fill="none" stroke={INK} strokeWidth={1.8} strokeDasharray="10 4 2 4" />
    </g>
  );
}

/** A label chip the way the PDF sets one: small caps on a white chip. */
function Chip({
  x,
  y,
  text,
  color,
  size = 9,
  locked = false,
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  size?: number;
  locked?: boolean;
}) {
  const lock = locked ? size : 0;
  const w = text.length * size * 0.66 + 8 + lock;
  const k = size / 9;
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} pointerEvents="none">
      <rect x={-w / 2} y={-size * 0.8} width={w} height={size * 1.6} rx={2} fill="#fff" fillOpacity={0.92} />
      {locked && (
        <g transform={`translate(${(-w / 2 + 4).toFixed(1)} ${(-4.6 * k).toFixed(1)}) scale(${k.toFixed(2)})`}>
          <rect x={0} y={3.8} width={6.4} height={4.8} rx={0.9} fill={color} />
          <path d="M1.5 3.8V2.4a1.7 1.7 0 0 1 3.4 0v1.4" fill="none" stroke={color} strokeWidth={1.1} />
        </g>
      )}
      <text
        x={lock / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size}
        fontWeight={600}
        letterSpacing="0.06em"
        fill={color}
        style={{ fontFamily: "var(--font-sans, system-ui)" }}
      >
        {text.toUpperCase()}
      </text>
    </g>
  );
}

function AreaLabel({
  pts,
  radius,
  text,
  color,
  locked,
}: {
  pts: Pt[];
  radius: number;
  text: string;
  color: string;
  locked: boolean;
}) {
  let cx: number;
  let cy: number;
  let w: number;
  let h: number;
  if (radius > 0) {
    [cx, cy] = pts[0];
    w = h = radius * 2;
  } else {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    w = Math.max(...xs) - Math.min(...xs);
    h = Math.max(...ys) - Math.min(...ys);
    [cx, cy] = screenCentroid(pts);
  }
  // Only where there's room for it.
  if (w < text.length * 6 + 12 || h < 18) return null;
  return <Chip x={cx} y={cy} text={text} color={color} locked={locked} />;
}

function RunLabel({ pts, text, locked }: { pts: Pt[]; text: string; locked: boolean }) {
  // On the longest run, if it's long enough to carry it.
  let best = -1;
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (l > len) [len, best] = [l, i];
  }
  if (best < 0 || len < text.length * 6 + 30) return null;
  const [x0, y0] = pts[best];
  const [x1, y1] = pts[best + 1];
  return <Chip x={(x0 + x1) / 2} y={(y0 + y1) / 2} text={text} color={INK} size={8} locked={locked} />;
}

export function screenCentroid(pts: Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = pts.length || 1;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** A swatch of a type's pattern, for the palette and the list. */
export function TypeSwatch({ type, size = 18 }: { type: FeatureType; size?: number }) {
  const style = featureStyle(type);
  const line = type === "Fence" || type === "Retaining Wall";
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className="shrink-0">
      {line ? (
        type === "Fence" ? (
          <>
            <path d="M2 9H16" stroke={INK} strokeWidth={1.3} />
            <path d="M5 6V12M9 6V12M13 6V12" stroke={INK} strokeWidth={1.1} />
          </>
        ) : (
          <>
            <path d="M2 9H16" stroke={INK} strokeWidth={5} />
            <path d="M2 9H16" stroke="#9a968c" strokeWidth={2.6} />
          </>
        )
      ) : (
        <>
          <rect x={2} y={2} width={14} height={14} rx={type === "Fire Pit" ? 7 : 0} fill={SHEET_PAPER} />
          <rect x={2} y={2} width={14} height={14} rx={type === "Fire Pit" ? 7 : 0} fill={`url(#${fillId(type)})`} />
          <rect
            x={2}
            y={2}
            width={14}
            height={14}
            rx={type === "Fire Pit" ? 7 : 0}
            fill="none"
            stroke={cssColor(style.stroke)}
            strokeWidth={1.4}
          />
        </>
      )}
    </svg>
  );
}

/* ── Surfaces ────────────────────────────────────────────────────── */

// The new surfaces a design lays — pavers, turf — in the blueprint's own
// hatches (blueprint-pdf.ts surfaceHatch, FeaturePatterns.swift), each
// pattern's repeat drawn into one SVG tile at the printed size.

const rgb = (r: number, g: number, b: number) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
const grey = (v: number) => rgb(v, v, v);

/** Each style's outline, label and pattern colours, as the PDF prints them. */
const SURFACE_INK: Record<string, { stroke: string; label: string; line: string }> = {
  paver: { stroke: rgb(0.36, 0.37, 0.36), label: grey(0.28), line: rgb(0.46, 0.47, 0.46) },
  sierra: { stroke: rgb(0.34, 0.28, 0.22), label: grey(0.28), line: rgb(0.44, 0.37, 0.29) },
  travertine: { stroke: rgb(0.46, 0.45, 0.42), label: grey(0.3), line: rgb(0.56, 0.55, 0.51) },
  flagstone: { stroke: grey(0.35), label: grey(0.25), line: grey(0.45) },
  decomposedGranite: { stroke: rgb(0.6, 0.48, 0.34), label: rgb(0.48, 0.38, 0.26), line: rgb(0.66, 0.54, 0.39) },
  turf: { stroke: rgb(0.24, 0.45, 0.22), label: rgb(0.18, 0.36, 0.17), line: rgb(0.32, 0.55, 0.28) },
  concrete: { stroke: grey(0.45), label: grey(0.3), line: grey(0.55) },
};

/** A style's case name ("paver"), concrete for anything unknown. */
export const surfaceCase = (style: string) => surfaceStyle(style)?.case ?? "concrete";
const surfaceInk = (style: string) => SURFACE_INK[surfaceCase(style)] ?? SURFACE_INK.concrete;
const surfacePatternId = (kase: string) => `vv-surface-${kase}`;

/** One tile of each surface's pattern. Render once per <svg>. */
export function SurfacePatterns() {
  const tile = (kase: string, w: number, h: number, body: string, fill = false, opacity = 0.8, width = 0.35) => {
    const ink = SURFACE_INK[kase];
    return (
      <pattern key={kase} id={surfacePatternId(kase)} width={w * K} height={h * K} patternUnits="userSpaceOnUse">
        <g transform={`scale(${K})`}>
          {fill ? (
            <path d={body} fill={ink.line} fillOpacity={opacity} />
          ) : (
            <path d={body} fill="none" stroke={ink.line} strokeOpacity={opacity} strokeWidth={width} />
          )}
        </g>
      </pattern>
    );
  };
  const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`;
  const dot = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

  // Herringbone: u x 2u stones on a 4u repeat, drawn past the tile's edges
  // so the stones it cuts are completed by its neighbours.
  let paver = "";
  const u = 4;
  for (let b = -3; b < 5; b++) {
    for (let a = -3; a < 5; a++) {
      if ((((a - b) % 4) + 4) % 4 !== 1) continue;
      paver += rect(a * u, b * u, u, u * 2) + rect(a * u + u, b * u, u * 2, u);
    }
  }
  // Three-piece modular, quarter-turned by the PDF's rule: a 4 x 4 module repeat.
  let sierra = "";
  const m = 17;
  const big = (m * 9) / 15;
  const small = (m * 6) / 15;
  for (let b = 0; b < 4; b++) {
    for (let a = 0; a < 4; a++) {
      const turn = (((a * 3 + b * 7) % 4) + 4) % 4;
      let pieces = [
        [0, 0, big, big],
        [big, 0, small, big],
        [0, big, big, small],
        [big, big, small, small],
      ];
      for (let t = 0; t < turn; t++) pieces = pieces.map(([x, y, w, h]) => [m - y - h, x, h, w]);
      for (const [x, y, w, h] of pieces) sierra += rect(a * m + x, b * m + y, w, h);
    }
  }
  // Running bond.
  const travertine = "M0 0H8M0 4H8M0 0V4M4 4V8M8 0V4";
  // Short scattered strokes, seeded the PDF's way, on a 7 x 7 repeat.
  let flag = "";
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      const seed = (row * 31 + col * 17) % 7;
      const angle = (seed * Math.PI) / 7;
      const len = 3 + (seed % 3);
      const dx = (Math.cos(angle) * len) / 2;
      const dy = (Math.sin(angle) * len) / 2;
      const x = 3 + col * 7;
      const y = 3 + row * 7;
      flag += `M${(x - dx).toFixed(2)} ${(y - dy).toFixed(2)}L${(x + dx).toFixed(2)} ${(y + dy).toFixed(2)}`;
    }
  }
  const turf = "M2 3l-0.6 -2.4M6 3l0 -2.4M4 7l0.6 -2.4M8 7l-0.6 -2.4M10 3l0.6 -2.4";
  const dg = dot(2, 2, 0.4) + dot(6, 2.4, 0.4) + dot(4, 6, 0.4) + dot(0.4, 6.4, 0.4) + dot(8, 6, 0.4);
  const concrete = dot(4, 4, 0.5) + dot(8.5, 13, 0.5) + dot(-0.5, 13, 0.5);
  return (
    <defs>
      {tile("paver", 4 * u, 4 * u, paver)}
      {tile("sierra", 4 * m, 4 * m, sierra)}
      {tile("travertine", 8, 8, travertine)}
      {tile("flagstone", 49, 49, flag)}
      {tile("turf", 12, 8, turf, false, 0.85, 0.4)}
      {tile("decomposedGranite", 8, 8, dg, true, 0.9)}
      {tile("concrete", 9, 18, concrete, true, 0.9)}
    </defs>
  );
}

/** One surface, the way the blueprint prints it: its material's pattern,
 *  its outline, and a label with its area. */
export function SurfaceArt({
  surface,
  pts,
  radius = 0,
  smooth,
  halo,
  wash,
  sqft,
  label = true,
  dim = false,
  locked = false,
}: {
  surface: Pick<PlanSurface, "style" | "shape">;
  pts: Pt[];
  radius?: number;
  smooth?: boolean[];
  halo: number;
  wash: number;
  /** The area, for the label. */
  sqft?: number;
  label?: boolean;
  dim?: boolean;
  locked?: boolean;
}) {
  const ink = surfaceInk(surface.style);
  const d = pathOf(pts, true, smooth);
  const el = (props: { fill: string; fillOpacity?: number; stroke?: string; strokeOpacity?: number; strokeWidth?: number }) =>
    surface.shape === "circle" ? <circle cx={pts[0][0]} cy={pts[0][1]} r={radius} {...props} /> : <path d={d} strokeLinejoin="miter" {...props} />;
  const name = surfaceStyle(surface.style)?.style ?? surface.style;
  return (
    <g opacity={dim ? 0.45 : 1}>
      {el({ fill: SHEET_PAPER, fillOpacity: Math.max(wash, 0.55) })}
      {el({ fill: `url(#${surfacePatternId(surfaceCase(surface.style))})` })}
      {halo > 0 && el({ fill: "none", stroke: SHEET_PAPER, strokeOpacity: 0.85 * halo, strokeWidth: 4.5 })}
      {el({ fill: "none", stroke: ink.stroke, strokeWidth: K })}
      {label && (
        <AreaLabel
          pts={radius > 0 ? pts : along(pts, true, smooth)}
          radius={radius}
          text={sqft != null ? `${name} · ${Math.round(sqft).toLocaleString("en-US")} sq ft` : name}
          color={ink.label}
          locked={locked}
        />
      )}
    </g>
  );
}

/** A swatch of a surface's pattern, for the catalog and the list. */
export function SurfaceSwatch({ style, size = 18 }: { style: string; size?: number }) {
  const ink = surfaceInk(style);
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className="shrink-0">
      <rect x={2} y={2} width={14} height={14} fill={SHEET_PAPER} />
      <rect x={2} y={2} width={14} height={14} fill={`url(#${surfacePatternId(surfaceCase(style))})`} />
      <rect x={2} y={2} width={14} height={14} fill="none" stroke={ink.stroke} strokeWidth={1.4} />
    </svg>
  );
}
