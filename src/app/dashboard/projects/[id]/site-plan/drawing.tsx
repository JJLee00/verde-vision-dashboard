// How a site plan looks: every shape in the blueprint's own patterns
// (src/lib/blueprint/feature-style.ts, shared with the PDF), over a paper
// wash so the patterns read on the photo too. Pure SVG and no hooks, so the
// project page's thumbnail and the builder's sheet draw the same way.
//
// Everything here is in SCREEN pixels: the caller maps plan metres to the
// screen first. The patterns stay the size they are on the printed sheet,
// at any zoom, the way a hatch does on paper.

import { cssColor, featureStyle, type FeatureFill } from "@/lib/blueprint/feature-style";
import type { FeatureType, PlanFeature } from "@/lib/site-plan/plan";

export type Pt = [number, number];

/** Sheet points to screen pixels for patterns and line weights. */
const K = 1.5;

/** The drawing sheet: warm white, like the printed page. */
export const SHEET_PAPER = "#f8f4ea";
const INK = "#1c2a21";

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

const pathOf = (pts: Pt[], closed: boolean) =>
  pts.length === 0
    ? ""
    : `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}${closed ? "Z" : ""}`;

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
  halo,
  wash,
  label = true,
  dim = false,
}: {
  feature: Pick<PlanFeature, "type" | "label" | "shape">;
  /** Screen points: the corners, the run, or [centre] for a circle. */
  pts: Pt[];
  /** Screen pixels, for a circle. */
  radius?: number;
  halo: number;
  wash: number;
  label?: boolean;
  /** Drawn faintly: a placed shape's old copy, or one being dragged. */
  dim?: boolean;
}) {
  const style = featureStyle(feature.type);
  const stroke = cssColor(style.stroke);
  const opacity = dim ? 0.45 : 1;

  if (feature.shape === "line") {
    const d = pathOf(pts, false);
    const fence = feature.type === "Fence";
    return (
      <g opacity={opacity}>
        {halo > 0 && (
          <path d={d} fill="none" stroke={SHEET_PAPER} strokeOpacity={0.85 * halo} strokeWidth={fence ? 6 : 8} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {fence ? (
          <>
            <path d={d} fill="none" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
            <FenceTicks pts={pts} />
          </>
        ) : (
          <>
            <path d={d} fill="none" stroke={INK} strokeWidth={5} strokeLinejoin="miter" />
            <path d={d} fill="none" stroke="#9a968c" strokeWidth={2.6} strokeLinejoin="miter" />
          </>
        )}
        {label && <RunLabel pts={pts} text={displayName(feature)} />}
      </g>
    );
  }

  const fill = `url(#${fillId(feature.type)})`;
  const d = pathOf(pts, true);
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
      {label && <AreaLabel pts={pts} radius={radius} text={displayName(feature)} color={cssColor(style.label)} />}
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
export function BoundaryArt({ pts, closed = true, halo }: { pts: Pt[]; closed?: boolean; halo: number }) {
  const d = pathOf(pts, closed);
  return (
    <g>
      {halo > 0 && <path d={d} fill="none" stroke={SHEET_PAPER} strokeOpacity={0.85 * halo} strokeWidth={5.5} />}
      <path d={d} fill="none" stroke={INK} strokeWidth={1.8} strokeDasharray="10 4 2 4" />
    </g>
  );
}

/** A label chip the way the PDF sets one: small caps on a white chip. */
function Chip({ x, y, text, color, size = 9 }: { x: number; y: number; text: string; color: string; size?: number }) {
  const w = text.length * size * 0.66 + 8;
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} pointerEvents="none">
      <rect x={-w / 2} y={-size * 0.8} width={w} height={size * 1.6} rx={2} fill="#fff" fillOpacity={0.92} />
      <text
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

function AreaLabel({ pts, radius, text, color }: { pts: Pt[]; radius: number; text: string; color: string }) {
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
  return <Chip x={cx} y={cy} text={text} color={color} />;
}

function RunLabel({ pts, text }: { pts: Pt[]; text: string }) {
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
  return <Chip x={(x0 + x1) / 2} y={(y0 + y1) / 2} text={text} color={INK} size={8} />;
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
