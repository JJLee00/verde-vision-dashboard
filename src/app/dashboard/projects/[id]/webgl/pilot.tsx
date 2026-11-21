"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LivingBlueprint } from "@/lib/viewer/LivingBlueprint";
import { FIXTURE_PROJECT } from "@/lib/viewer/fixture";
import { speciesMeta } from "@/lib/viewer/catalog";
import { GL_MODELS } from "@/lib/viewer/gl/layer";
import type { LocalPoint, PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";

const FT = 0.3048;

type Renderer = "canvas" | "webgl";
type Result = { fps: number; p50: number; worst: number };

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pt = (n: number, x: number, z: number): LocalPoint => ({ id: id(n), positionX: x * FT, positionY: 0, positionZ: z * FT });
const plant = (n: number, model: string, x: number, z: number, size: string): PlacedPlantJSON => ({
  id: id(1000 + n),
  plantModelName: model,
  positionX: x * FT,
  positionY: 0,
  positionZ: z * FT,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  rotationW: 1,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  containerType: size,
});

/** The shrubs WebGL draws, to fill the yard with. */
const SHRUBS = [
  "TexasSage",
  "GreenHopseed",
  "WhiteDawnLantana",
  "PurpleLantana",
  "YellowLantana",
  "YellowBells",
  "RedBirdOfParadise",
  "Jojoba",
  "LittleJohnBottlebrush",
];

/** A yard of `count` Texas Sages, nine feet apart, a little out of line. */
function sageYard(count: number): ProjectFileJSON {
  const cols = Math.ceil(Math.sqrt(count * 1.5));
  const rows = Math.ceil(count / cols);
  const halfX = (cols - 1) * 4.5 + 10;
  const halfZ = (rows - 1) * 4.5 + 10;
  const placements: PlacedPlantJSON[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const jx = Math.sin(i * 12.9898) * 1.4;
    const jz = Math.cos(i * 78.233) * 1.4;
    placements.push(plant(i, "TexasSage", c * 9 - (cols - 1) * 4.5 + jx, r * 9 - (rows - 1) * 4.5 + jz, i % 3 ? "5g" : "15g"));
  }
  return {
    projectName: "WebGL pilot",
    placements,
    boundaryPoints: [pt(1, -halfX, -halfZ), pt(2, halfX, -halfZ), pt(3, halfX, halfZ), pt(4, -halfX, halfZ)],
    boundaryIsClosed: true,
  };
}

/** The sample yard — house, patio, pool, walkway, paving of every kind —
 *  planted with `count` of the plants WebGL draws: the fixture's own trees
 *  and shrubs, then every kind of shrub. */
function shrubYard(count: number): ProjectFileJSON {
  const yard = FIXTURE_PROJECT;
  const hardscapeAreas = [
    ...(yard.hardscapeAreas ?? []),
    { id: id(60), style: "turf", vertices: [pt(61, 14, 4), pt(62, 28, 4), pt(63, 28, 12), pt(64, 14, 12)] },
    { id: id(65), style: "flagstone", vertices: [pt(66, -12, -6), pt(67, -4, -6), pt(68, -4, 1), pt(69, -12, 1)] },
  ];
  const polys = [...(yard.featurePolygons ?? []).map((f) => f.vertices), ...hardscapeAreas.map((h) => h.vertices)].map((vs) =>
    vs.map((v): [number, number] => [v.positionX / FT, v.positionZ / FT]),
  );
  const inside = (p: [number, number], poly: [number, number][]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const boundary = (yard.boundaryPoints ?? []).map((v): [number, number] => [v.positionX / FT, v.positionZ / FT]);
  // The fixture's own shrubs where it put them, then more on open ground.
  const placements = yard.placements.filter((p) => GL_MODELS.has(p.plantModelName)).slice(0, count);
  const taken = placements.map((p): [number, number] => [p.positionX / FT, p.positionZ / FT]);
  const spots: [number, number][] = [];
  for (let x = -28; x <= 29; x += 4.6) for (let z = -22; z <= 22; z += 4.6) spots.push([x + Math.sin(x * 7.1 + z) * 1.1, z + Math.cos(z * 5.3 - x) * 1.1]);
  spots.sort((a, b) => Math.sin(a[0] * 12.9 + a[1] * 78.2) - Math.sin(b[0] * 12.9 + b[1] * 78.2));
  for (const s of spots) {
    if (placements.length >= count) break;
    const ring = [s, [s[0] + 2, s[1]], [s[0] - 2, s[1]], [s[0], s[1] + 2], [s[0], s[1] - 2]] as [number, number][];
    if (!ring.every((q) => inside(q, boundary))) continue;
    if (polys.some((poly) => ring.some((q) => inside(q, poly)))) continue;
    if (taken.some((t) => Math.hypot(t[0] - s[0], t[1] - s[1]) < 4)) continue;
    if (Math.hypot(s[0] - 17, s[1] - 18) < 3.5) continue; // the removal marker
    taken.push(s);
    const n = placements.length;
    placements.push(plant(n, SHRUBS[n % SHRUBS.length], s[0], s[1], n % 3 ? "5g" : "15g"));
  }
  return { ...yard, projectName: "WebGL pilot", placements, hardscapeAreas };
}

/** One plant of a kind, alone on a square of ground a little wider than it. */
function onePlant(model: string): ProjectFileJSON {
  const r = Math.max(8, speciesMeta(model).matureWidthFt / 2 + 3);
  return {
    projectName: "WebGL pilot",
    placements: [plant(0, model, 0, 0, "15g")],
    boundaryPoints: [pt(1, -r, -r), pt(2, r, -r), pt(3, r, r), pt(4, -r, r)],
    boundaryIsClosed: true,
  };
}

/** What the browser draws WebGL with, asked of a canvas of our own. */
function probeGpu(): { name: string; software: boolean } {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) return { name: "WebGL 2 not available", software: true };
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return { name, software: /swiftshader|llvmpipe|basic render|software/i.test(name) };
}

export function WebGLPilot({
  count,
  scene,
  model,
  selected,
}: {
  count: number;
  scene: "yard" | "sage" | "one";
  model: string;
  selected: boolean;
}) {
  const project = useMemo(
    () => (scene === "sage" ? sageYard(count) : scene === "one" ? onePlant(model) : shrubYard(count)),
    [count, scene, model],
  );
  const [renderer, setRenderer] = useState<Renderer>("webgl");
  const [gpu, setGpu] = useState<{ name: string; software: boolean } | null>(null);
  const [live, setLive] = useState({ fps: 0, worst: 0 });
  const [results, setResults] = useState<Partial<Record<Renderer, Result>>>({});
  const [testing, setTesting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setGpu(probeGpu()));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Frames a second, and the longest frame, over the last second.
  useEffect(() => {
    let raf = 0;
    const stamps: number[] = [];
    let shown = 0;
    const tick = (now: number) => {
      stamps.push(now);
      while (stamps.length && now - stamps[0] > 1000) stamps.shift();
      if (now - shown > 250) {
        shown = now;
        let worst = 0;
        for (let i = 1; i < stamps.length; i++) worst = Math.max(worst, stamps[i] - stamps[i - 1]);
        setLive({ fps: stamps.length, worst: Math.round(worst) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** Drags the view round for four seconds, one step a frame, and times
   *  the frames. */
  const spin = () => {
    const cv = wrapRef.current?.querySelector<HTMLCanvasElement>("canvas[role=img]");
    if (!cv || testing) return;
    setTesting(true);
    const r = cv.getBoundingClientRect();
    let x = r.left + r.width * 0.3;
    const y = r.top + r.height * 0.5;
    const ev = (type: string) =>
      cv.dispatchEvent(
        new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true }),
      );
    ev("pointerdown");
    const gaps: number[] = [];
    const start = performance.now();
    let last = start;
    const which = renderer;
    const step = (now: number) => {
      gaps.push(now - last);
      last = now;
      x += 6;
      ev("pointermove");
      if (now - start < 4000) {
        requestAnimationFrame(step);
        return;
      }
      ev("pointerup");
      const sorted = [...gaps].sort((a, b) => a - b);
      setResults((rs) => ({
        ...rs,
        [which]: {
          fps: Math.round((gaps.length * 1000) / (now - start)),
          p50: Math.round(sorted[Math.floor(sorted.length / 2)]),
          worst: Math.round(sorted[sorted.length - 1]),
        },
      }));
      setTesting(false);
    };
    requestAnimationFrame(step);
  };

  const tab = (r: Renderer, label: string) => (
    <button
      type="button"
      onClick={() => setRenderer(r)}
      aria-pressed={renderer === r}
      className={`px-3 py-1.5 text-[13px] ${renderer === r ? "bg-ink text-paper font-semibold" : "text-ink hover:bg-ink/[0.06]"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-paper">
      <div ref={wrapRef} className="absolute inset-0">
        <LivingBlueprint
          project={project}
          projectName="WebGL pilot"
          showPrices={false}
          embed
          interactive
          renderer={renderer}
          editing={selected}
          selectedId={selected ? project.placements[0]?.id : null}
        />
      </div>
      <div className="absolute left-3 top-3 w-[290px] rounded-xl border border-rule bg-card/95 p-3 text-[12.5px] text-ink shadow-lg">
        <div className="flex items-center justify-between">
          <div className="font-semibold">
            WebGL pilot · {scene === "one" ? model : `${project.placements.length} ${scene === "sage" ? "sages" : "shrubs"}`}
          </div>
        </div>
        <div className="mt-2 inline-flex overflow-hidden rounded-lg border border-rule">
          {tab("canvas", "Canvas (now)")}
          {tab("webgl", "WebGL")}
        </div>
        <div className="mt-2 text-muted">
          Graphics: <span className={gpu?.software ? "font-semibold text-red-700" : "text-ink"}>{gpu ? gpu.name : "…"}</span>
          {gpu?.software && <div className="text-red-700">This is software, not the graphics card.</div>}
        </div>
        <div className="mt-1 text-muted">
          Now: <span className="tabular-nums text-ink">{live.fps} fps</span>, longest frame{" "}
          <span className="tabular-nums text-ink">{live.worst} ms</span>
        </div>
        <button
          type="button"
          onClick={spin}
          disabled={testing}
          className="mt-2 w-full rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {testing ? "Spinning…" : `Spin test (${renderer === "webgl" ? "WebGL" : "Canvas"})`}
        </button>
        {(results.canvas || results.webgl) && (
          <table className="mt-2 w-full tabular-nums">
            <thead className="text-muted">
              <tr>
                <th className="text-left font-normal"></th>
                <th className="text-right font-normal">fps</th>
                <th className="text-right font-normal">typical</th>
                <th className="text-right font-normal">longest</th>
              </tr>
            </thead>
            <tbody>
              {(["canvas", "webgl"] as const).map((r) =>
                results[r] ? (
                  <tr key={r}>
                    <td>{r === "canvas" ? "Canvas" : "WebGL"}</td>
                    <td className="text-right">{results[r]!.fps}</td>
                    <td className="text-right">{results[r]!.p50} ms</td>
                    <td className="text-right">{results[r]!.worst} ms</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
