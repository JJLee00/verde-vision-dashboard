import { createDoc, FONT, longDate, toBuffer, type Doc } from "./doc";
import { PdfCanvas } from "./canvas-on-pdf";
import {
  CONTINUED,
  CONTINUED_ROWS_PER_COLUMN,
  PX,
  SCHEDULE_TOP,
  SHEET,
  legendCounts,
  plantMarks,
  plantSchedule,
  scheduleFit,
  sheetCount,
  sheetLayout,
  type ScheduleRow,
  type SheetLayout,
} from "@/lib/blueprint/sheet";
import { surfaceSqFt, surfaceStyle } from "@/lib/surfaces";
import { speciesMeta } from "@/lib/viewer/catalog";
import { drawPlanSymbol, symbolFor } from "@/lib/viewer/symbols";
import type { LocalPoint, ProjectFileJSON } from "@/lib/viewer/types";
import { METERS_TO_FEET } from "@/lib/viewer/types";

// The blueprint sheet, drawn by the dashboard from the saved design.
//
// It used to be a file the headset rendered and uploaded when a project was
// closed — so it showed whatever that build drew, and nothing done in the
// office reached it until the headset closed the project again. Rendered
// here, on demand, every project's sheet is the current design, drawn the
// current way.
//
// It is the headset's sheet (BlueprintExporter.swift in the app), block for
// block, because the headset still draws its own copy for the offline
// preview on site. The geometry both sides share — page, scale, every
// plant's place, size and turn, the schedule — is src/lib/blueprint/sheet.ts,
// checked against the app by `npm run check:blueprint`. The plants are the
// 2D viewer's own drawPlanSymbol, run on this page through PdfCanvas.

type RGB = [number, number, number];
const gray = (w: number): RGB => [w * 255, w * 255, w * 255];
const rgb = (r: number, g: number, b: number): RGB => [r * 255, g * 255, b * 255];
const css = ([r, g, b]: RGB, a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;

type Rect = { x: number; y: number; w: number; h: number };

/** The plan symbols' ink: a green-black, the headset's planInkGreen. */
const INK: RGB = rgb(0.15, 0.3, 0.12);
type Hatch = { stroke: RGB; label: RGB; draw: (doc: Doc, r: Rect) => void };

// ── Pattern helpers ──────────────────────────────────────────────────────

function lines(doc: Doc, color: RGB, alpha: number, width: number, build: () => void) {
  doc.save();
  build();
  doc.lineWidth(width).strokeColor(color, alpha).stroke();
  doc.restore();
}

function dots(doc: Doc, color: RGB, alpha: number, build: () => void) {
  doc.save();
  build();
  doc.fillColor(color, alpha).fill();
  doc.restore();
}

/** A quadratic from the current point, as the cubic a PDF can draw. */
function quad(doc: Doc, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) {
  doc.bezierCurveTo(
    x0 + (2 / 3) * (cx - x0),
    y0 + (2 / 3) * (cy - y0),
    x1 + (2 / 3) * (cx - x1),
    y1 + (2 / 3) * (cy - y1),
    x1,
    y1,
  );
}

// ── Feature hatches (FeaturePatterns.swift, featureStyle) ───────────────

const FEATURE_ORDER = [
  "House", "Pool", "Driveway", "Patio", "Fence", "Shed", "Garage", "Walkway",
  "Deck", "AC Unit", "Retaining Wall", "Fire Pit", "Other",
];

function featureHatch(type: string): Hatch {
  if (type === "House" || type === "Shed" || type === "Garage") {
    return {
      stroke: gray(0.15),
      label: gray(0.2),
      draw: (doc, r) =>
        lines(doc, gray(0.3), 1, 0.35, () => {
          for (let y = r.y - r.w; y < r.y + r.h; y += 5) {
            doc.moveTo(r.x, y).lineTo(r.x + r.w, y + r.w);
          }
        }),
    };
  }
  if (type === "Pool") {
    return {
      stroke: rgb(0.24, 0.48, 0.61),
      label: rgb(0.2, 0.4, 0.52),
      draw: (doc, r) =>
        lines(doc, rgb(0.35, 0.58, 0.71), 1, 0.45, () => {
          const wl = 8;
          const amp = 0.8;
          for (let y = r.y + 2; y < r.y + r.h; y += 4) {
            doc.moveTo(r.x, y);
            for (let x = r.x; x < r.x + r.w; x += wl) {
              quad(doc, x, y, x + wl / 4, y - amp, x + wl / 2, y);
              quad(doc, x + wl / 2, y, x + (3 * wl) / 4, y + amp, x + wl, y);
            }
          }
        }),
    };
  }
  if (type === "Patio" || type === "Walkway" || type === "Driveway" || type === "Deck") {
    return {
      stroke: gray(0.4),
      label: gray(0.3),
      draw: (doc, r) =>
        dots(doc, gray(0.5), 1, () => {
          for (let y = r.y + 3; y < r.y + r.h; y += 6) {
            for (let x = r.x + 3; x < r.x + r.w; x += 6) doc.circle(x, y, 0.6);
          }
        }),
    };
  }
  return {
    stroke: gray(0.4),
    label: gray(0.25),
    draw: (doc, r) =>
      lines(doc, gray(0.6), 1, 0.35, () => {
        for (let o = -r.w; o < r.h; o += 5) {
          doc.moveTo(r.x, r.y + o).lineTo(r.x + r.w, r.y + o + r.w);
        }
      }),
  };
}

// ── Surface hatches (FeaturePatterns.swift, hardscapeStyle) ─────────────

/** HardscapeStyle.allCases — the legend's order. */
const SURFACE_ORDER = ["paver", "sierra", "travertine", "flagstone", "concrete", "decomposedGranite", "turf"];

function surfaceHatch(kase: string): Hatch {
  switch (kase) {
    case "paver":
      // 90° herringbone: an L-pair of u x 2u stones on the lattice spanned
      // by (1, 1) and (4, 0), stroked in one pass so shared joints don't
      // darken.
      return {
        stroke: rgb(0.36, 0.37, 0.36),
        label: gray(0.28),
        draw: (doc, r) =>
          lines(doc, rgb(0.46, 0.47, 0.46), 0.8, 0.35, () => {
            const u = 4;
            const cols = Math.ceil(r.w / u) + 2;
            const rows = Math.ceil(r.h / u) + 2;
            for (let b = -2; b < rows; b++) {
              for (let a = -3; a < cols; a++) {
                if ((((a - b) % 4) + 4) % 4 !== 1) continue;
                const x = r.x + a * u;
                const y = r.y + b * u;
                doc.rect(x, y, u, u * 2);
                doc.rect(x + u, y, u * 2, u);
              }
            }
          }),
      };
    case "sierra":
      // 3-piece modular: 9x9, 9x6, 6x9, 6x6 in a 15" square, stamped and
      // quarter-turned by a fixed rule so two prints are identical.
      return {
        stroke: rgb(0.34, 0.28, 0.22),
        label: gray(0.28),
        draw: (doc, r) =>
          lines(doc, rgb(0.44, 0.37, 0.29), 0.8, 0.35, () => {
            const m = 17;
            const big = (m * 9) / 15;
            const small = (m * 6) / 15;
            const cols = Math.ceil(r.w / m) + 1;
            const rows = Math.ceil(r.h / m) + 1;
            for (let b = 0; b < rows; b++) {
              for (let a = 0; a < cols; a++) {
                const turn = (((a * 3 + b * 7) % 4) + 4) % 4;
                let pieces = [
                  [0, 0, big, big],
                  [big, 0, small, big],
                  [0, big, big, small],
                  [big, big, small, small],
                ];
                for (let t = 0; t < turn; t++) {
                  pieces = pieces.map(([x, y, w, h]) => [m - y - h, x, h, w]);
                }
                for (const [x, y, w, h] of pieces) doc.rect(r.x + a * m + x, r.y + b * m + y, w, h);
              }
            }
          }),
      };
    case "travertine":
      // Running bond, half-lapped courses of 2:1 planks.
      return {
        stroke: rgb(0.46, 0.45, 0.42),
        label: gray(0.3),
        draw: (doc, r) =>
          lines(doc, rgb(0.56, 0.55, 0.51), 0.8, 0.35, () => {
            let course = 0;
            for (let y = r.y; y < r.y + r.h; y += 4, course++) {
              doc.moveTo(r.x, y).lineTo(r.x + r.w, y);
              for (let x = r.x + (course % 2 === 0 ? 0 : 4); x < r.x + r.w; x += 8) {
                doc.moveTo(x, y).lineTo(x, Math.min(y + 4, r.y + r.h));
              }
            }
          }),
      };
    case "flagstone":
      return {
        stroke: gray(0.35),
        label: gray(0.25),
        draw: (doc, r) =>
          lines(doc, gray(0.45), 0.8, 0.35, () => {
            let row = 0;
            for (let y = r.y + 3; y < r.y + r.h; y += 7, row++) {
              let col = 0;
              for (let x = r.x + 3; x < r.x + r.w; x += 7, col++) {
                const seed = (row * 31 + col * 17) % 7;
                const angle = (seed * Math.PI) / 7;
                const len = 3 + (seed % 3);
                const dx = (Math.cos(angle) * len) / 2;
                const dy = (Math.sin(angle) * len) / 2;
                doc.moveTo(x - dx, y - dy).lineTo(x + dx, y + dy);
              }
            }
          }),
      };
    case "decomposedGranite":
      return {
        stroke: rgb(0.6, 0.48, 0.34),
        label: rgb(0.48, 0.38, 0.26),
        draw: (doc, r) =>
          dots(doc, rgb(0.66, 0.54, 0.39), 0.9, () => {
            let row = 0;
            for (let y = r.y + 2; y < r.y + r.h; y += 4, row++) {
              for (let x = r.x + (row % 2 === 0 ? 2 : 4); x < r.x + r.w; x += 4) {
                const jitter = ((row * 13 + Math.trunc(x)) % 3) * 0.4;
                doc.circle(x + jitter, y, 0.4);
              }
            }
          }),
      };
    case "turf":
      return {
        stroke: rgb(0.24, 0.45, 0.22),
        label: rgb(0.18, 0.36, 0.17),
        draw: (doc, r) =>
          lines(doc, rgb(0.32, 0.55, 0.28), 0.85, 0.4, () => {
            let row = 0;
            for (let y = r.y + 3; y < r.y + r.h; y += 4, row++) {
              for (let x = r.x + (row % 2 === 0 ? 2 : 4); x < r.x + r.w; x += 4) {
                const lean = (((row * 7 + Math.trunc(x)) % 3) - 1) * 0.6;
                doc.moveTo(x, y).lineTo(x + lean, y - 2.4);
              }
            }
          }),
      };
    default:
      // concrete, and anything the lenient decode lands on it
      return {
        stroke: gray(0.45),
        label: gray(0.3),
        draw: (doc, r) =>
          dots(doc, gray(0.55), 0.9, () => {
            let row = 0;
            for (let y = r.y + 4; y < r.y + r.h; y += 9, row++) {
              for (let x = r.x + (row % 2 === 0 ? 4 : 8.5); x < r.x + r.w; x += 9) doc.circle(x, y, 0.5);
            }
          }),
      };
  }
}

// ── Text ─────────────────────────────────────────────────────────────────

type Font = { name: string; size: number; spacing?: number };
const F = {
  logo: { name: FONT.sansSemi, size: 14, spacing: 2 },
  subLogo: { name: FONT.sans, size: 6, spacing: 1.5 },
  section: { name: FONT.sansSemi, size: 8 },
  tableHeader: { name: FONT.sansSemi, size: 6.5, spacing: 0.3 },
  tableBody: { name: FONT.sans, size: 7 },
  titleLabel: { name: FONT.sans, size: 5.5, spacing: 0.5 },
  titleValue: { name: FONT.sans, size: 7 },
  titleValueBold: { name: FONT.sansSemi, size: 8 },
  titleMain: { name: FONT.sansSemi, size: 10 },
  featureLabel: { name: FONT.sansSemi, size: 9 },
  plantCode: { name: FONT.sansSemi, size: 7 },
  dimension: { name: FONT.sans, size: 6.5 },
  scale: { name: FONT.sans, size: 7 },
  footer: { name: FONT.sans, size: 5, spacing: 0.5 },
  plate: { name: FONT.sansBold, size: 7 },
} satisfies Record<string, Font>;

function measure(doc: Doc, s: string, f: Font) {
  doc.font(f.name).fontSize(f.size);
  return { w: doc.widthOfString(s, { characterSpacing: f.spacing ?? 0 }), h: doc.currentLineHeight() };
}

/** Drawn with its line's top-left at (x, y), like NSAttributedString.draw(at:). */
function text(doc: Doc, s: string, x: number, y: number, f: Font, color: RGB, alpha = 1) {
  doc
    .font(f.name)
    .fontSize(f.size)
    .fillColor(color, alpha)
    .text(s, x, y, { lineBreak: false, characterSpacing: f.spacing ?? 0 });
}

/** A centred label on a white chip, over a hatch. */
function chipLabel(doc: Doc, s: string, cx: number, cy: number, f: Font, color: RGB) {
  const { w, h } = measure(doc, s, f);
  doc.save().rect(cx - w / 2 - 4, cy - h / 2 - 1, w + 8, h + 2).fillColor(gray(1), 0.92).fill().restore();
  text(doc, s, cx - w / 2, cy - h / 2, f, color);
}

function hline(doc: Doc, x1: number, x2: number, y: number, color: RGB, width: number) {
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke().restore();
}

// ── The sheet ────────────────────────────────────────────────────────────

export type BlueprintMeta = {
  /** the project's name on the dashboard */
  name: string;
  date: Date | null;
  client: string | null;
  designer: string | null;
};

const polygon = (doc: Doc, pts: [number, number][]) => {
  pts.forEach(([x, y], i) => (i ? doc.lineTo(x, y) : doc.moveTo(x, y)));
  doc.closePath();
};

const bounds = (pts: [number, number][]): Rect => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/** A traced area: hatch clipped to its outline, the outline, a label. */
function drawArea(doc: Doc, layout: SheetLayout, verts: LocalPoint[], hatch: Hatch, width: number, label: string) {
  const rot = verts.map((v) => layout.rotate(v.positionX, v.positionZ));
  const pts = rot.map(([x, z]) => layout.toPDF(x, z));
  doc.save();
  polygon(doc, pts);
  doc.clip();
  hatch.draw(doc, bounds(pts));
  doc.restore();
  doc.save();
  polygon(doc, pts);
  doc.lineWidth(width).lineJoin("miter").strokeColor(hatch.stroke).stroke();
  doc.restore();
  const cx = rot.reduce((s, p) => s + p[0], 0) / rot.length;
  const cz = rot.reduce((s, p) => s + p[1], 0) / rot.length;
  const [px, py] = layout.toPDF(cx, cz);
  chipLabel(doc, label, px, py, F.featureLabel, hatch.label);
}

function swatch(doc: Doc, x: number, y: number, hatch: Hatch) {
  const r = { x, y, w: 14, h: 10 };
  doc.save().rect(r.x, r.y, r.w, r.h).clip();
  hatch.draw(doc, r);
  doc.restore();
  doc.save().rect(r.x, r.y, r.w, r.h).lineWidth(0.5).strokeColor(hatch.stroke).stroke().restore();
}

/** The blueprint PDF, or null for a yard with nothing drawn on it. */
export async function renderBlueprintPDF(project: ProjectFileJSON, meta: BlueprintMeta): Promise<Buffer | null> {
  const layout = sheetLayout(project);
  if (!layout) return null;
  const { width: W, height: H, margin: M, titleColumnWidth: T } = SHEET;

  const doc = createDoc(`${meta.name} – Blueprint`, { size: [W, H], margin: 0, bufferPages: false });

  // Double border, and the rule between map and title column.
  doc.save().rect(M, M, W - 2 * M, H - 2 * M).lineWidth(1.5).strokeColor(gray(0.6)).stroke().restore();
  doc.save().rect(M + 6, M + 6, W - 2 * (M + 6), H - 2 * (M + 6)).lineWidth(0.5).strokeColor(gray(0.8)).stroke().restore();
  const divX = W - M - T - 8;
  doc.save().moveTo(divX, M + 6).lineTo(divX, H - M - 6).lineWidth(1).strokeColor(gray(0.6)).stroke().restore();

  const { minRX, maxRX, minRZ, maxRZ, toPDF } = layout;

  // 1 m grid.
  doc.save();
  for (let gx = Math.floor(minRX); gx <= maxRX; gx += 1) {
    const [x1, y1] = toPDF(gx, minRZ);
    const [x2, y2] = toPDF(gx, maxRZ);
    doc.moveTo(x1, y1).lineTo(x2, y2);
  }
  for (let gz = Math.floor(minRZ); gz <= maxRZ; gz += 1) {
    const [x1, y1] = toPDF(minRX, gz);
    const [x2, y2] = toPDF(maxRX, gz);
    doc.moveTo(x1, y1).lineTo(x2, y2);
  }
  doc.lineWidth(0.3).strokeColor(gray(0.95)).stroke().restore();

  // Surfaces, under the features.
  const areas = project.hardscapeAreas ?? [];
  for (const area of areas) {
    if ((area.vertices ?? []).length < 3) continue;
    const style = surfaceStyle(area.style);
    const name = style?.style ?? area.style;
    drawArea(
      doc,
      layout,
      area.vertices,
      surfaceHatch(style?.case ?? "concrete"),
      1,
      `${name.toUpperCase()} · ${Math.round(surfaceSqFt(area))} SQ FT`,
    );
  }

  // Features.
  const features = project.featurePolygons ?? [];
  for (const f of features) {
    if ((f.vertices ?? []).length < 3) continue;
    const label = f.featureType === "Other" ? (f.customLabel ?? "Other") : f.featureType;
    drawArea(doc, layout, f.vertices, featureHatch(f.featureType), 1.2, label.toUpperCase());
  }

  // Boundary, and a dimension on every edge longer than three feet.
  const boundary = project.boundaryPoints ?? [];
  if (boundary.length >= 2) {
    const rot = boundary.map((b) => layout.rotate(b.positionX, b.positionZ));
    const pts = rot.map(([x, z]) => toPDF(x, z));
    doc.save();
    polygon(doc, pts);
    doc.lineWidth(1.8).lineJoin("miter").strokeColor("#000000").stroke();
    doc.restore();
    if (boundary.length >= 3) {
      const cx = rot.reduce((s, p) => s + p[0], 0) / rot.length;
      const cz = rot.reduce((s, p) => s + p[1], 0) / rot.length;
      const [ccx, ccy] = toPDF(cx, cz);
      for (let i = 0; i < rot.length; i++) {
        const [ax, az] = rot[i];
        const [bx, bz] = rot[(i + 1) % rot.length];
        const feet = Math.hypot(bx - ax, bz - az) * METERS_TO_FEET;
        if (!(feet > 3)) continue;
        const [p1x, p1y] = pts[i];
        const [p2x, p2y] = pts[(i + 1) % pts.length];
        const len = Math.hypot(p2x - p1x, p2y - p1y);
        if (!(len > 0.1)) continue;
        const nx = -(p2y - p1y) / len;
        const ny = (p2x - p1x) / len;
        const mx = (p1x + p2x) / 2;
        const my = (p1y + p2y) / 2;
        const inward = nx * (ccx - mx) + ny * (ccy - my) > 0;
        const ox = inward ? -nx : nx;
        const oy = inward ? -ny : ny;
        const label = `${feet.toFixed(1)} ft`;
        const { w, h } = measure(doc, label, F.dimension);
        const tx = mx + ox * (8 + h / 2) - w / 2;
        const ty = my + oy * (8 + h / 2) - h / 2;
        doc.save().rect(tx - 2, ty - 1, w + 4, h + 2).fillColor(gray(1), 0.95).fill().restore();
        text(doc, label, tx, ty, F.dimension, gray(0.35));
      }
    }
  }

  // Removal markers: a red disc at the marker's real radius, and an X.
  for (const m of project.removalMarkers ?? []) {
    const [x, y] = toPDF(...layout.rotate(m.positionX, m.positionZ));
    const r = Math.max(2, m.radiusMeters * layout.mapScale);
    doc.save().circle(x, y, r).fillColor(rgb(0.95, 0.2, 0.2), 0.32).fill().restore();
    doc.save().circle(x, y, r).lineWidth(0.7).strokeColor(rgb(0.78, 0.1, 0.1), 0.85).stroke().restore();
    const half = Math.min(r * 0.9, 10) / 2;
    doc
      .save()
      .moveTo(x - half, y - half)
      .lineTo(x + half, y + half)
      .moveTo(x + half, y - half)
      .lineTo(x - half, y + half)
      .lineWidth(0.9)
      .strokeColor(rgb(0.78, 0.1, 0.1), 0.85)
      .stroke()
      .restore();
  }

  // Plants: the viewer's own symbols, at mature spread. Drawn in a frame
  // scaled to a viewer pixel, so the few things the viewer sizes in pixels
  // (dashes, dots, the 1 px line) print at the same 0.75 pt the headset uses.
  const ink = INK;
  const canvas = new PdfCanvas(doc) as unknown as CanvasRenderingContext2D;
  const project3 = (wx: number, _y: number, wz: number): [number, number, number] => {
    const [x, y] = toPDF(wx / METERS_TO_FEET, wz / METERS_TO_FEET);
    return [x / PX, y / PX, 1];
  };
  const poolStroke = featureHatch("Pool").stroke;
  const ptPerFt = layout.mapScale / METERS_TO_FEET;
  const marks = plantMarks(project, layout);
  for (const mark of marks) {
    const placement = (project.placements ?? []).find((p) => p.id === mark.id);
    if (mark.symbol && placement) {
      const [rx, rz] = layout.rotate(placement.positionX, placement.positionZ);
      doc.save().scale(PX);
      drawPlanSymbol(canvas, project3, rx * METERS_TO_FEET, rz * METERS_TO_FEET, mark.radiusFt, mark.symbol, {
        rot: mark.rot,
        stroke: css(ink, mark.kind === "boulder" ? 0.45 / 0.62 : 1),
        detail: css(ink, 0.4 / 0.62),
        lw: 1,
        markR: mark.R / PX,
        seed: mark.model,
      });
      doc.restore();
    } else if (mark.kind === "poolPrefab") {
      const s = mark.scale * ptPerFt;
      const c = Math.cos(mark.rot);
      const sn = Math.sin(mark.rot);
      const corners: [number, number][] = [[-5, -3], [5, -3], [5, 3], [-5, 3]].map(([x, z]) => [
        mark.x + (x * c - z * sn) * s,
        mark.y + (x * sn + z * c) * s,
      ]);
      for (const [f, w] of [[1, PX], [0.75, PX * 0.75]]) {
        doc.save();
        polygon(doc, corners.map(([x, y]) => [mark.x + (x - mark.x) * f, mark.y + (y - mark.y) * f]));
        doc.lineWidth(w).strokeColor(poolStroke).stroke();
        doc.restore();
      }
    }
  }

  // Codes, off each plant's upper right — drawn after every plant so no
  // canopy lands on one, and on a white halo so they read over the busiest
  // linework. They were light 6.5 pt type drawn plant by plant, and in a
  // dense bed the next plant's lines went straight through them.
  for (const mark of marks) {
    const x = mark.x + mark.R * 0.72 + 4 * PX;
    const y = mark.y - 4 * PX;
    const opts = { lineBreak: false, baseline: "alphabetic" } as const;
    doc.font(F.plantCode.name).fontSize(F.plantCode.size);
    doc.save().lineWidth(CODE_HALO).lineJoin("round").strokeColor("#ffffff");
    doc.text(mark.code, x, y, { ...opts, stroke: true, fill: false });
    doc.restore();
    doc.fillColor(gray(0.12)).text(mark.code, x, y, opts);
  }

  // Marker plates: a small square and its letter, wherever one is mounted
  // inside the drawn extent. Never clamped to the edge — a plate pinned to
  // the border would claim a place it isn't.
  const plateFill = rgb(0.14, 0.29, 0.21);
  for (const reg of project.markerRegistrations ?? []) {
    if (reg.localPosition?.length !== 3) continue;
    const [rx, rz] = layout.rotate(reg.localPosition[0], reg.localPosition[2]);
    if (rx < minRX || rx > maxRX || rz < minRZ || rz > maxRZ) continue;
    const [x, y] = toPDF(rx, rz);
    const half = 3.5;
    doc.save().roundedRect(x - half, y - half, half * 2, half * 2, 1.2).fillColor(plateFill, 0.92).fill().restore();
    doc.save().roundedRect(x - half, y - half, half * 2, half * 2, 1.2).lineWidth(0.8).strokeColor(gray(1), 0.9).stroke().restore();
    text(doc, reg.markerID, x + half + 1.5, y - half - 1, F.plate, plateFill, 0.92);
  }

  // 20 ft scale bar under the map.
  const barLen = (20 / METERS_TO_FEET) * layout.mapScale;
  const sbX = layout.offX;
  const sbY = layout.offY + layout.usedH + 22;
  const seg = barLen / 4;
  for (let i = 0; i < 4; i++) {
    const r = { x: sbX + i * seg, y: sbY - 2, w: seg, h: 4 };
    if (i % 2 === 0) {
      doc.save().rect(r.x, r.y, r.w, r.h).fillColor("#000000").fill().restore();
    } else {
      doc.save().rect(r.x, r.y, r.w, r.h).fillColor("#ffffff").fill().restore();
      doc.save().rect(r.x, r.y, r.w, r.h).lineWidth(0.4).strokeColor("#000000").stroke().restore();
    }
  }
  doc.save();
  for (let i = 0; i <= 4; i++) doc.moveTo(sbX + i * seg, sbY - 5).lineTo(sbX + i * seg, sbY + 3);
  doc.lineWidth(0.6).strokeColor("#000000").stroke().restore();
  for (const [i, label] of [[0, "0"], [2, "10"], [4, "20 ft"]] as const) {
    const { w } = measure(doc, label, F.scale);
    text(doc, label, sbX + i * seg - w / 2, sbY + 6, F.scale, gray(0.25));
  }

  // ── Title column ──
  const colX = W - M - T;
  const colCX = colX + T / 2;
  let colY = M + 30;

  const brandGreen = rgb(0.1, 0.54, 0.36);
  for (const word of ["VERDE", "VISION"]) {
    const { w, h } = measure(doc, word, F.logo);
    text(doc, word, colCX - w / 2, colY, F.logo, brandGreen);
    colY += h + (word === "VERDE" ? 1 : 4);
  }
  hline(doc, colCX - 28, colCX + 28, colY, brandGreen, 0.8);
  colY += 4;
  {
    const tag = "LANDSCAPE DESIGN";
    const { w, h } = measure(doc, tag, F.subLogo);
    text(doc, tag, colCX - w / 2, colY, F.subLogo, rgb(0.72, 0.45, 0.2));
    colY += h + 30;
  }

  const section = (title: string) => {
    text(doc, title, colX + 6, colY, F.section, gray(0.2));
    colY += 10;
    hline(doc, colX + 6, colX + T - 6, colY, gray(0.55), 0.5);
  };

  // Plant schedule, from a fixed line so the fit below is the headset's.
  colY = SCHEDULE_TOP;
  section("PLANT SCHEDULE");
  colY += 4;
  const keyColX = colX + 6;
  const codeColX = colX + 17;
  const nameColX = colX + 40;
  const sizeColX = colX + 116;
  const qtyColX = colX + T - 10;
  text(doc, "CODE", codeColX, colY, F.tableHeader, gray(0.5));
  text(doc, "COMMON NAME", nameColX, colY, F.tableHeader, gray(0.5));
  text(doc, "SIZE", sizeColX, colY, F.tableHeader, gray(0.5));
  text(doc, "QTY", qtyColX - measure(doc, "QTY", F.tableHeader).w, colY, F.tableHeader, gray(0.5));
  colY += 8;
  hline(doc, colX + 6, colX + T - 6, colY, gray(0.8), 0.3);
  colY += 3;

  const schedule = plantSchedule(project.placements ?? []);
  const counts = legendCounts(project);
  const fit = scheduleFit(schedule.length, counts.featureTypes, counts.surfaceStyles);
  const body: Font = { name: FONT.sans, size: fit.fontSize };
  scheduleRows(doc, canvas, schedule.slice(0, fit.rowsOnSheet), colY, body, fit.rowHeight, {
    key: keyColX,
    code: codeColX,
    name: nameColX,
    nameWidth: sizeColX - nameColX - 3,
    size: sizeColX,
    qtyRight: qtyColX,
  });
  colY += fit.rowsOnSheet * fit.rowHeight;
  const more = schedule.length - fit.rowsOnSheet;
  if (more > 0) {
    text(doc, `Continued on sheet 2 — ${more} more`, keyColX, colY, { ...body, name: FONT.sansSemi }, gray(0.15));
    colY += fit.rowHeight;
  }

  if (fit.legends) {
    // Existing features: only the kinds this yard has.
    const usedFeatures = new Set(features.map((f) => f.featureType));
    if (usedFeatures.size) {
      colY += 14;
      section("EXISTING FEATURES");
      colY += 5;
      for (const type of FEATURE_ORDER.filter((t) => usedFeatures.has(t))) {
        swatch(doc, colX + 6, colY, featureHatch(type));
        text(doc, type, colX + 26, colY + 1, body, gray(0.15));
        colY += 14;
      }
    }

    // Hardscape, with each style's total.
    const usedSurfaces = new Map<string, { name: string; sqFt: number }>();
    for (const area of areas) {
      const style = surfaceStyle(area.style);
      const kase = style?.case ?? "concrete";
      const prev = usedSurfaces.get(kase);
      usedSurfaces.set(kase, {
        name: style?.style ?? area.style,
        sqFt: (prev?.sqFt ?? 0) + surfaceSqFt(area),
      });
    }
    if (usedSurfaces.size) {
      colY += 14;
      section("HARDSCAPE");
      colY += 5;
      for (const kase of SURFACE_ORDER.filter((k) => usedSurfaces.has(k))) {
        const used = usedSurfaces.get(kase)!;
        swatch(doc, colX + 6, colY, surfaceHatch(kase));
        text(doc, `${used.name} — ${Math.round(used.sqFt)} sq ft`, colX + 26, colY + 1, body, gray(0.15));
        colY += 14;
      }
    }
  }

  // Title block.
  const tbY = H - M - 140;
  const tbH = 130;
  doc.save().rect(colX + 4, tbY, T - 8, 26).fillColor(gray(0.94)).fill().restore();
  doc.save().rect(colX + 4, tbY, T - 8, 26).lineWidth(0.8).strokeColor(gray(0.4)).stroke().restore();
  for (const [word, dy] of [["LANDSCAPE", 4], ["CONCEPT PLAN", 14]] as const) {
    text(doc, word, colCX - measure(doc, word, F.titleMain).w / 2, tbY + dy, F.titleMain, gray(0.1));
  }
  const detailsY = tbY + 26;
  const detailsH = tbH - 26;
  doc.save().rect(colX + 4, detailsY, T - 8, detailsH).lineWidth(0.8).strokeColor(gray(0.4)).stroke().restore();
  const tRowH = detailsH / 5;
  const labelColW = 36;
  doc.save();
  for (let i = 1; i < 5; i++) doc.moveTo(colX + 4, detailsY + i * tRowH).lineTo(colX + T - 4, detailsY + i * tRowH);
  doc.moveTo(colX + 4 + labelColW, detailsY).lineTo(colX + 4 + labelColW, detailsY + detailsH);
  doc.lineWidth(0.3).strokeColor(gray(0.65)).stroke().restore();

  const rows: [string, string, boolean][] = [
    ["SCALE", "NTS", false],
    ["DESIGNER", meta.designer?.trim() || "—", true],
    ["CLIENT", meta.client?.trim() || "—", true],
    ["DATE", meta.date ? longDate.format(meta.date) : "—", false],
    ["PROJECT", meta.name, false],
  ];
  const maxW = T - labelColW - 16;
  rows.forEach(([label, value, bold], i) => {
    const y = detailsY + i * tRowH + 2;
    text(doc, label, colX + 7, y, F.titleLabel, gray(0.5));
    const f = bold ? F.titleValueBold : F.titleValue;
    let shown = value;
    if (measure(doc, value, f).w > maxW) {
      let trimmed = value;
      while (measure(doc, trimmed + "…", F.titleValue).w > maxW && trimmed.length > 3) trimmed = trimmed.slice(0, -1);
      shown = trimmed + "…";
    }
    text(doc, shown, colX + 4 + labelColW + 4, y + (bold ? 3 : 4), f, bold ? gray(0.1) : gray(0.15));
  });

  text(doc, "GENERATED BY VERDE VISION", colCX - 42, H - M - 10, F.footer, gray(0.7));

  // The rest of a schedule too long for the title column: three columns
  // of 11 pt rows a sheet, as many sheets as it takes.
  const rest = schedule.slice(fit.rowsOnSheet);
  const perSheet = CONTINUED.columns * CONTINUED_ROWS_PER_COLUMN;
  const sheets = sheetCount(schedule.length, fit);
  for (let sheet = 0; sheet * perSheet < rest.length; sheet++) {
    doc.addPage({ size: [W, H], margin: 0 });
    doc.save().rect(M, M, W - 2 * M, H - 2 * M).lineWidth(1.5).strokeColor(gray(0.6)).stroke().restore();
    doc.save().rect(M + 6, M + 6, W - 2 * (M + 6), H - 2 * (M + 6)).lineWidth(0.5).strokeColor(gray(0.8)).stroke().restore();
    text(doc, "PLANT SCHEDULE — CONTINUED", M + 16, M + 20, F.titleMain, gray(0.1));
    text(doc, meta.name, M + 16, M + 34, F.titleValue, gray(0.5));

    const colW = (W - 2 * (M + 16)) / CONTINUED.columns;
    const cBody: Font = { name: FONT.sans, size: CONTINUED.fontSize };
    const chunk = rest.slice(sheet * perSheet, (sheet + 1) * perSheet);
    for (let c = 0; c < CONTINUED.columns; c++) {
      const rows = chunk.slice(c * CONTINUED_ROWS_PER_COLUMN, (c + 1) * CONTINUED_ROWS_PER_COLUMN);
      if (!rows.length) break;
      const x0 = M + 16 + c * colW;
      const y0 = CONTINUED.top;
      const qtyRight = x0 + colW - 16;
      text(doc, "CODE", x0 + 14, y0, F.tableHeader, gray(0.5));
      text(doc, "COMMON NAME", x0 + 44, y0, F.tableHeader, gray(0.5));
      text(doc, "SIZE", x0 + 150, y0, F.tableHeader, gray(0.5));
      text(doc, "QTY", qtyRight - measure(doc, "QTY", F.tableHeader).w, y0, F.tableHeader, gray(0.5));
      hline(doc, x0, qtyRight, y0 + 8, gray(0.8), 0.3);
      scheduleRows(doc, canvas, rows, y0 + 11, cBody, CONTINUED.rowHeight, {
        key: x0,
        code: x0 + 14,
        name: x0 + 44,
        nameWidth: 103,
        size: x0 + 150,
        qtyRight,
      });
    }
    const footer = `GENERATED BY VERDE VISION · SHEET ${sheet + 2} OF ${sheets}`;
    text(doc, footer, W - M - 16 - measure(doc, footer, F.footer).w, H - M - 10, F.footer, gray(0.7));
  }

  return toBuffer(doc);
}

/** The white halo behind a plan code, in points across. */
const CODE_HALO = 1.8;
/** The key's line weight: the map's 0.75 pt would clot a 9 pt drawing. */
const KEY_PX = 0.35;

/**
 * A plant's drawing as the schedule's key: the same mark the map prints,
 * unturned, sized to the row. A light's beam is turned to point along the
 * row, and scaled so the whole fan fits.
 */
function keyIcon(doc: Doc, canvas: CanvasRenderingContext2D, model: string, cx: number, cy: number, r: number) {
  const meta = speciesMeta(model);
  const sym = symbolFor(model, meta.kind);
  if (!sym) return;
  const aimed = sym.edge === "uplight" || sym.edge === "flood";
  // How far the mark reaches, in symbol radii: a fixture is drawn at 1.1
  // and its beam at 2.2 of that.
  const reach = aimed ? 2.42 : sym.edge === "pathlight" ? 1.045 : 1;
  const u = r / reach;
  const project = (wx: number, _y: number, wz: number): [number, number, number] => [
    (cx + wx * u) / KEY_PX,
    (cy + wz * u) / KEY_PX,
    1,
  ];
  doc.save().scale(KEY_PX);
  drawPlanSymbol(canvas, project, 0, 0, 1, sym, {
    rot: aimed ? -Math.PI / 2 : 0,
    stroke: css(INK, meta.kind === "boulder" ? 0.45 / 0.62 : 1),
    detail: css(INK, 0.4 / 0.62),
    lw: 1,
    markR: u / KEY_PX,
    seed: model,
  });
  doc.restore();
}

/** The key drawing's radius for a row: as big as the row allows, up to 4.5 pt. */
export const keyRadius = (rowHeight: number) => Math.min(4.5, (rowHeight - 1.5) / 2);

/** Schedule rows from `y` down: each plant's drawing as the key (once,
 *  on its first row), the catalog's name cut to its column with an ellipsis
 *  when it won't fit, the quantity right-aligned. */
function scheduleRows(
  doc: Doc,
  canvas: CanvasRenderingContext2D,
  rows: ScheduleRow[],
  y: number,
  body: Font,
  rowHeight: number,
  col: { key: number; code: number; name: number; nameWidth: number; size: number; qtyRight: number },
) {
  const r = keyRadius(rowHeight);
  let previous = "";
  for (const row of rows) {
    if (row.name !== previous) keyIcon(doc, canvas, row.model, col.key + r, y + body.size * 0.65, r);
    previous = row.name;
    text(doc, row.code, col.code, y, body, gray(0.15));
    let name = row.name;
    while (name.length > 1 && measure(doc, name, body).w > col.nameWidth) {
      name = name.slice(0, name.endsWith("…") ? -2 : -1).trim() + "…";
    }
    text(doc, name, col.name, y, body, gray(0.15));
    text(doc, row.size, col.size, y, body, gray(0.15));
    const qty = String(row.quantity);
    text(doc, qty, col.qtyRight - measure(doc, qty, body).w, y, body, gray(0.15));
    y += rowHeight;
  }
}
