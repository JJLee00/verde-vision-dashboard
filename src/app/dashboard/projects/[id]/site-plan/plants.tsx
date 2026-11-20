"use client";

// The plants on the sheet, drawn the way the blueprint prints them: the
// viewer's own plan symbols (src/lib/viewer/symbols.ts) at mature spread,
// trees first and lighter over a pale canopy tint, and one code per group of
// same-kind plants ("6 LAY") joined by thin lines. A canvas rather than SVG,
// because the symbols are canvas drawings — the PDF runs the same calls
// through its own canvas shim.

import { useEffect, useRef } from "react";
import { markRadiusFt, plantGroups, TREE_KINDS, type PlantMark } from "@/lib/blueprint/sheet";
import { speciesMeta } from "@/lib/viewer/catalog";
import { drawPlanSymbol, edgeRadius, symbolFor } from "@/lib/viewer/symbols";
import { METERS_TO_FEET } from "@/lib/viewer/types";
import type { XZ } from "@/lib/site-plan/plan";
import { INK, SHEET_PAPER } from "./drawing";
import { toScreen, type Size, type View } from "./geometry";

/** A plant as the sheet draws it, in plan metres. */
export type SheetPlant = { id: string; model: string; scale: number; x: number; z: number; rotation: number };

/** How far a plant's drawing reaches, in metres. */
export const plantRadiusM = (p: Pick<SheetPlant, "model" | "scale">) => markRadiusFt(p.model, p.scale) / METERS_TO_FEET;

/** The plant under a point, if any. */
export function plantAt(plants: SheetPlant[], [x, z]: XZ, ppm: number): string | null {
  let best: string | null = null;
  let bestR = Infinity;
  let bestD = Infinity;
  for (const p of plants) {
    // Anywhere on its drawing picks a plant, and a small one is never
    // smaller to the hand than PICK_PX across the middle.
    const r = Math.max(plantRadiusM(p), PICK_PX / ppm);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > r) continue;
    // The smallest plant under the cursor wins: a shrub under a tree's
    // canopy is the one being reached for, and the tree has the rest of
    // its canopy to be picked by. Among equals, the nearest.
    if (r < bestR - 1e-9 || (r < bestR + 1e-9 && d < bestD)) [best, bestR, bestD] = [p.id, r, d];
  }
  return best;
}

/** How far from a small plant's middle a click still picks it, in pixels. */
const PICK_PX = 12;

const css = (a: number) => `rgba(28,42,33,${a})`;

export function PlantLayer({
  plants,
  view,
  size,
  faded = false,
  ghost = null,
  halo,
  labels = true,
}: {
  plants: SheetPlant[];
  view: View;
  size: Size;
  /** The Site tab: the design shown, not worked on. */
  faded?: boolean;
  /** The plant about to be placed, under the cursor. */
  ghost?: SheetPlant | null;
  /** The photo's opacity: a paper wash under each plant holds it on the photo. */
  halo: number;
  labels?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.globalAlpha = faded ? 0.4 : 1;

    // The symbols are drawn in feet, as the PDF draws them.
    const project = (wx: number, _y: number, wz: number): [number, number, number] => {
      const [sx, sy] = toScreen(view, size, [wx / METERS_TO_FEET, wz / METERS_TO_FEET]);
      return [sx, sy, 1];
    };
    const ptPerFt = view.ppm / METERS_TO_FEET;
    const all = ghost ? [...plants, ghost] : plants;
    const marks: (PlantMark & { plant: SheetPlant })[] = all.map((p) => {
      const meta = speciesMeta(p.model);
      const radiusFt = markRadiusFt(p.model, p.scale);
      const [x, y] = toScreen(view, size, [p.x, p.z]);
      return {
        plant: p,
        id: p.id,
        model: p.model,
        code: meta.code,
        kind: meta.kind,
        x,
        y,
        radiusFt,
        R: radiusFt * ptPerFt,
        // A +yaw carries the model's +X to (cos, -sin) on the ground.
        rot: -p.rotation,
        scale: p.scale,
        symbol: symbolFor(p.model, meta.kind),
      };
    });
    const onScreen = (m: { x: number; y: number; R: number }) =>
      m.x + m.R > 0 && m.x - m.R < size.w && m.y + m.R > 0 && m.y - m.R < size.h;

    // Canopies and washes first, under every drawing.
    for (const m of marks) {
      if (!m.symbol || m.symbol.edge === "none" || !onScreen(m)) continue;
      const tree = TREE_KINDS.has(m.kind);
      if (!tree && halo <= 0) continue;
      ctx.save();
      if (m.plant === ghost) ctx.globalAlpha *= 0.5;
      ctx.beginPath();
      for (let k = 0; k <= 64; k++) {
        const a = (k / 64) * Math.PI * 2;
        const r = m.R * (m.symbol.edge === "poly" ? 1 : edgeRadius(m.symbol, a - m.rot));
        const X = m.x + Math.cos(a) * r;
        const Y = m.y + Math.sin(a) * r;
        if (k) ctx.lineTo(X, Y);
        else ctx.moveTo(X, Y);
      }
      ctx.closePath();
      ctx.fillStyle = tree ? "rgba(150,165,130,0.3)" : SHEET_PAPER;
      ctx.globalAlpha *= tree ? 1 : 0.55 * halo;
      ctx.fill();
      ctx.restore();
    }

    // Trees first and lighter, so what grows under them reads on top.
    const order = [...marks.filter((m) => TREE_KINDS.has(m.kind)), ...marks.filter((m) => !TREE_KINDS.has(m.kind))];
    for (const m of order) {
      if (!m.symbol || !onScreen(m)) continue;
      const tree = TREE_KINDS.has(m.kind);
      ctx.save();
      if (m.plant === ghost) ctx.globalAlpha *= 0.55;
      drawPlanSymbol(ctx, project, m.plant.x * METERS_TO_FEET, m.plant.z * METERS_TO_FEET, m.radiusFt, m.symbol, {
        rot: m.rot,
        stroke: css(tree ? 0.6 : m.kind === "boulder" ? 0.72 : 1),
        detail: css(tree ? 0.35 : 0.65),
        lw: tree ? 0.85 : 1.1,
        markR: m.R,
        seed: m.model,
      });
      ctx.restore();
    }

    if (!labels) return;
    // One code per group, beside the plant nearest its middle, the way the
    // blueprint's first choice puts it.
    const placed = marks.filter((m) => m.plant !== ghost);
    const groups = plantGroups(placed, ptPerFt);
    ctx.save();
    ctx.strokeStyle = css(0.5);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (const g of groups) {
      for (let i = 1; i < g.length; i++) {
        // Nearest earlier plant of the group: a short spanning tree.
        const b = placed[g[i]];
        let a = placed[g[0]];
        for (let j = 0; j < i; j++) {
          const c = placed[g[j]];
          if (Math.hypot(c.x - b.x, c.y - b.y) < Math.hypot(a.x - b.x, a.y - b.y)) a = c;
        }
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
    ctx.font = "600 10px var(--font-sans, system-ui)";
    ctx.textBaseline = "middle";
    for (const g of groups) {
      const cx = g.reduce((s, i) => s + placed[i].x, 0) / g.length;
      const cy = g.reduce((s, i) => s + placed[i].y, 0) / g.length;
      let a = placed[g[0]];
      for (const i of g) if (Math.hypot(placed[i].x - cx, placed[i].y - cy) < Math.hypot(a.x - cx, a.y - cy)) a = placed[i];
      if (!onScreen(a)) continue;
      const text = g.length > 1 ? `${g.length} ${a.code}` : a.code;
      const x = a.x + a.R * 0.72 + 4;
      const y = a.y - 4;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#ffffff";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = INK;
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }, [plants, view, size, faded, ghost, halo, labels]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0"
      style={{ width: size.w, height: size.h }}
      aria-hidden
    />
  );
}
