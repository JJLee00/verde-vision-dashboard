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
import { METERS_TO_FEET } from "./types";
import { speciesMeta, type SpeciesMeta } from "./catalog";

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

const verde = (a: number) => `rgba(46,93,67,${a})`;
const gold = (a: number) => `rgba(168,123,47,${a})`;
const ink = (a: number) => `rgba(28,42,33,${a})`;

const YOUNG_FACTOR = 0.45;

/* ── Scene prep ─────────────────────────────────────────────────── */

type Instance = {
  model: string;
  meta: SpeciesMeta;
  x: number; // feet, plan
  z: number;
  yawDeg: number;
  scale: number;
  containerType: string | null;
};

type Poly = { pts: [number, number][]; label: string; kind: string };

type Scene = {
  instances: Instance[];
  boundary: [number, number][];
  features: Poly[];
  hardscape: (Poly & { sqFt: number; style: string })[];
  removals: { x: number; z: number; r: number }[];
  center: [number, number];
  radius: number; // content radius in feet
};

function quatYawDeg(x: number, y: number, z: number, w: number) {
  return (Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z)) * 180) / Math.PI;
}

function buildScene(project: ProjectFileJSON): Scene {
  const heading = project.northHeadingDegrees;
  const phi =
    heading == null ? 0 : ((-90 - heading) * Math.PI) / 180; // rotate so north is up
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const toPlan = (mx: number, mz: number): [number, number] => {
    const x = mx * METERS_TO_FEET;
    const z = mz * METERS_TO_FEET;
    return [x * cos - z * sin, x * sin + z * cos];
  };

  const instances: Instance[] = (project.placements ?? []).map((p) => {
    const [x, z] = toPlan(p.positionX, p.positionZ);
    return {
      model: p.plantModelName,
      meta: speciesMeta(p.plantModelName),
      x,
      z,
      yawDeg:
        quatYawDeg(p.rotationX, p.rotationY, p.rotationZ, p.rotationW) +
        (phi * 180) / Math.PI,
      scale: p.scaleX || 1,
      containerType: p.containerType ?? null,
    };
  });

  const boundary = (project.boundaryPoints ?? []).map((b) =>
    toPlan(b.positionX, b.positionZ)
  );

  const features: Poly[] = (project.featurePolygons ?? [])
    .filter((f) => f.vertices.length >= 3)
    .map((f) => ({
      pts: f.vertices.map((v) => toPlan(v.positionX, v.positionZ)),
      label: f.featureType === "Other" ? f.customLabel || "Other" : f.featureType,
      kind: f.featureType,
    }));

  const hardscape = (project.hardscapeAreas ?? [])
    .filter((h) => h.vertices.length >= 3)
    .map((h) => {
      const pts = h.vertices.map((v) => toPlan(v.positionX, v.positionZ));
      let sum = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        sum += a[0] * b[1] - b[0] * a[1];
      }
      const label = h.style
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase());
      return { pts, label, kind: h.style, style: h.style, sqFt: Math.abs(sum) / 2 };
    });

  const removals = (project.removalMarkers ?? []).map((r) => {
    const [x, z] = toPlan(r.positionX, r.positionZ);
    return { x, z, r: Math.max(r.radiusMeters * METERS_TO_FEET, 0.8) };
  });

  // Bounds over everything drawable.
  const xs: number[] = [];
  const zs: number[] = [];
  for (const [x, z] of boundary) {
    xs.push(x);
    zs.push(z);
  }
  for (const f of [...features, ...hardscape])
    for (const [x, z] of f.pts) {
      xs.push(x);
      zs.push(z);
    }
  for (const i of instances) {
    xs.push(i.x);
    zs.push(i.z);
  }
  for (const r of removals) {
    xs.push(r.x);
    zs.push(r.z);
  }
  if (xs.length === 0) {
    xs.push(-20, 20);
    zs.push(-20, 20);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const center: [number, number] = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  const radius = Math.max(
    Math.hypot(maxX - minX, maxZ - minZ) / 2 + 4,
    20
  );

  return { instances, boundary, features, hardscape, removals, center, radius };
}

/* ── Rail data ──────────────────────────────────────────────────── */

type RailRow = {
  model: string;
  meta: SpeciesMeta;
  qty: number;
  unitPrice: number | null; // null = varies or unknown
  unitLabel: string;
  lineTotal: number | null;
};

function buildRail(
  scene: Scene,
  priceOverrides: Record<string, number>
): { rows: RailRow[]; subtotal: number | null } {
  const groups = new Map<string, Instance[]>();
  for (const inst of scene.instances) {
    const list = groups.get(inst.model) ?? [];
    list.push(inst);
    groups.set(inst.model, list);
  }

  const rows: RailRow[] = [];
  for (const [model, list] of groups) {
    const meta = list[0].meta;
    const override = priceOverrides[meta.name.toLowerCase()];
    const unitFor = (inst: Instance): number | null => {
      if (override != null) return override;
      if (inst.containerType && meta.prices[inst.containerType] != null)
        return meta.prices[inst.containerType];
      return null;
    };
    const units = list.map(unitFor);
    const lineTotal = units.every((u) => u != null)
      ? (units as number[]).reduce((s, u) => s + u, 0)
      : null;
    const uniqueUnits = [...new Set(units.filter((u) => u != null))];
    const uniqueSizes = [...new Set(list.map((l) => l.containerType).filter(Boolean))];
    rows.push({
      model,
      meta,
      qty: list.length,
      unitPrice: uniqueUnits.length === 1 ? (uniqueUnits[0] as number) : null,
      unitLabel:
        uniqueSizes.length === 1
          ? (uniqueSizes[0] as string)
          : uniqueSizes.length > 1
            ? "mixed sizes"
            : "",
      lineTotal,
    });
  }
  rows.sort((a, b) => (b.lineTotal ?? 0) - (a.lineTotal ?? 0) || b.qty - a.qty);

  const subtotal = rows.every((r) => r.lineTotal != null)
    ? rows.reduce((s, r) => s + (r.lineTotal as number), 0)
    : rows.some((r) => r.lineTotal != null)
      ? rows.reduce((s, r) => s + (r.lineTotal ?? 0), 0)
      : null;

  return { rows, subtotal };
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
  priceOverrides?: Record<string, number>;
  showPrices: boolean;
  backHref?: string | null;
  shareTokens?: { client: string; crew: string } | null;
};

export function LivingBlueprint({
  project,
  projectName,
  estimateAmount,
  priceOverrides = {},
  showPrices,
  backHref,
  shareTokens,
}: LivingBlueprintProps) {
  const scene = useMemo(() => buildScene(project), [project]);
  const rail = useMemo(
    () => buildRail(scene, priceOverrides),
    [scene, priceOverrides]
  );

  const [mode, setMode] = useState<"3d" | "plan">("3d");
  const [growth, setGrowth] = useState<"young" | "mature">("mature");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState<"client" | "crew" | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // Mirror interactive state into refs so the rAF loop never restarts.
  const stateRef = useRef({ mode, growth, selected });
  useEffect(() => {
    stateRef.current = { mode, growth, selected };
  }, [mode, growth, selected]);

  const selectSpecies = useCallback((model: string | null) => {
    setSelected((prev) => (prev === model ? null : model));
  }, []);

  useEffect(() => {
    if (!selected) return;
    rowRefs.current.get(selected)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const copyShareLink = useCallback(
    async (kind: "client" | "crew") => {
      if (!shareTokens) return;
      const token = kind === "client" ? shareTokens.client : shareTokens.crew;
      await navigator.clipboard.writeText(`${location.origin}/share/${token}`);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    },
    [shareTokens]
  );

  /* ── Canvas renderer ──────────────────────────────────────────── */
  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const K = reducedMotion ? 1 : 0.14;

    const R = scene.radius;
    const [cx, cz] = scene.center;
    const V3D = { az: -30, el: 30, dist: R * 2.6, fov: 40 };
    const VPLAN = { az: 0, el: 88.5, dist: R * 10.2, fov: 10 };
    const cur = { ...V3D, zoom: 1, planT: 0, growth: 1 };
    const tgt = { ...V3D, zoom: 1, planT: 0, growth: 1 };
    let saved3d = { ...V3D };
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
      const target = [cx, 0, cz];
      eye = [
        cx + cur.dist * Math.cos(er) * Math.sin(ar),
        cur.dist * Math.sin(er),
        cz + cur.dist * Math.cos(er) * Math.cos(ar),
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
    const ftPx = (x: number, z: number, r: number) => {
      const a = P(x, 0, z);
      const b = P(x + r, 0, z);
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
    const hits: { model: string; sx: number; sy: number; r: number }[] = [];

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

    function drawInstance(inst: Instance, g: number, t: number) {
      const { meta } = inst;
      const sel = stateRef.current.selected === inst.model;
      const grows = !["boulder", "poolPrefab", "light"].includes(meta.kind);
      const gr = grows ? g : 1;
      const stroke = sel ? GOLD : verde(0.85);
      const fill = sel ? gold(0.14) : verde(0.08);
      const lw = sel ? 2 : 1.4;
      const h = meta.renderHeightFt * gr;
      const rw = (meta.matureWidthFt / 2) * gr;
      const { x, z } = inst;

      if (meta.kind === "tree" || meta.kind === "shrub") {
        const isShrub = meta.kind === "shrub";
        if (!isShrub) {
          const base = P(x, 0, z);
          const top = P(x, h * 0.62, z);
          ctx!.strokeStyle = verde(0.7);
          ctx!.lineWidth = Math.max(ftPx(x, z, 0.3), 1.2);
          ctx!.beginPath();
          ctx!.moveTo(base[0], base[1]);
          ctx!.lineTo(top[0], top[1]);
          ctx!.stroke();
        }
        ctx!.lineWidth = lw;
        ctx!.strokeStyle = stroke;
        ctx!.fillStyle = fill;
        circle3D(x, h * (isShrub ? 0.45 : 0.66), z, rw);
        ctx!.fill();
        ctx!.stroke();
        circle3D(x, h * (isShrub ? 0.8 : 0.92), z, rw * 0.55, 18);
        ctx!.fill();
        ctx!.stroke();
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
        const base = P(x, 0, z);
        const top = P(x, h, z);
        const rx = Math.max(ftPx(x, z, rw), 2);
        const ry = Math.max(base[1] - top[1], 2);
        ctx!.beginPath();
        ctx!.ellipse(base[0], base[1] - ry / 2, rx, ry / 1.6, 0, 0, Math.PI * 2);
        ctx!.fillStyle = fill;
        ctx!.fill();
        ctx!.strokeStyle = stroke;
        ctx!.lineWidth = lw;
        ctx!.stroke();
      } else if (meta.kind === "boulder") {
        const w = Math.min(Math.max(1.2 * inst.scale, 0.8), 6);
        const bh = (w * meta.renderHeightFt) / meta.matureWidthFt;
        const base = P(x, 0, z);
        const top = P(x, bh, z);
        const rx = Math.max(ftPx(x, z, w / 2), 2);
        const ry = Math.max(base[1] - top[1], 2);
        ctx!.beginPath();
        ctx!.ellipse(base[0], base[1] - ry / 2, rx, ry / 1.4, 0, 0, Math.PI * 2);
        ctx!.fillStyle = sel ? gold(0.14) : ink(0.08);
        ctx!.fill();
        ctx!.strokeStyle = sel ? GOLD : verde(0.5);
        ctx!.lineWidth = lw;
        ctx!.stroke();
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

      /* ground symbol + label + hit target */
      const symR = Math.max(rw, meta.kind === "poolPrefab" ? 5 * inst.scale : 1);
      const c0 = P(x, 0.02, z);
      if (meta.kind !== "poolPrefab") {
        ctx!.strokeStyle = sel ? GOLD : verde(meta.kind === "boulder" ? 0.4 : 0.5);
        ctx!.lineWidth = sel ? 1.6 : 1;
        circle3D(x, 0.02, z, symR);
        ctx!.stroke();
        ctx!.fillStyle = sel ? GOLD : verde(0.55);
        ctx!.beginPath();
        ctx!.arc(c0[0], c0[1], 1.6, 0, 7);
        ctx!.fill();
      }
      const labelA = Math.max(t, sel ? 1 : 0);
      if (labelA > 0.45) {
        ctx!.font = "600 10px ui-monospace, Menlo, monospace";
        ctx!.fillStyle = sel ? GOLD : ink(0.6 * labelA);
        ctx!.fillText(meta.code, c0[0] + ftPx(x, z, symR) * 0.72 + 4, c0[1] - 4);
      }
      hits.push({
        model: inst.model,
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
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    function canvasXY(e: PointerEvent): [number, number] {
      const r = cv!.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    function nearest(e: PointerEvent) {
      const [mx, my] = canvasXY(e);
      let best: string | null = null;
      let bd = 1e9;
      for (const h of hits) {
        const d = Math.hypot(h.sx - mx, h.sy - my);
        if (d < h.r && d < bd) {
          bd = d;
          best = h.model;
        }
      }
      return best;
    }

    const onDown = (e: PointerEvent) => {
      cv!.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      dragDist = 0;
      cv!.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) {
        cv!.style.cursor = nearest(e) ? "pointer" : "grab";
        return;
      }
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
        if (lastPinch) tgt.zoom = clamp((tgt.zoom * d) / lastPinch, 0.5, 2.6);
        lastPinch = d;
        return;
      }
      const dx = e.clientX - prev[0];
      const dy = e.clientY - prev[1];
      dragDist += Math.abs(dx) + Math.abs(dy);
      if (stateRef.current.mode === "3d") {
        tgt.az = cur.az - dx * 0.4;
        tgt.el = clamp(cur.el + dy * 0.3, 8, 80);
        cur.az = tgt.az;
        cur.el = tgt.el;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastPinch = 0;
      cv!.style.cursor = "grab";
      if (dragDist < 6) {
        const model = nearest(e);
        if (model) selectSpecies(model);
        else setSelected(null);
      }
    };
    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastPinch = 0;
      cv!.style.cursor = "grab";
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      tgt.zoom = clamp(tgt.zoom * Math.exp(-e.deltaY * 0.0012), 0.5, 2.6);
    };
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onCancel);
    cv.addEventListener("wheel", onWheel, { passive: false });

    /* ── loop ── */
    let raf = 0;
    const frame = () => {
      const m = stateRef.current.mode;
      if (m !== lastMode) {
        if (lastMode === "3d")
          saved3d = { az: cur.az, el: cur.el, dist: cur.dist, fov: cur.fov };
        Object.assign(tgt, m === "plan" ? VPLAN : saved3d);
        tgt.planT = m === "plan" ? 1 : 0;
        lastMode = m;
      }
      tgt.growth = stateRef.current.growth === "young" ? YOUNG_FACTOR : 1;
      for (const k of ["az", "el", "dist", "fov", "zoom", "planT", "growth"] as const) {
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
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onCancel);
      cv.removeEventListener("wheel", onWheel);
    };
    // scene is the only real dependency; selectSpecies is stable.
  }, [scene, selectSpecies]);

  /* ── UI ───────────────────────────────────────────────────────── */

  const seg = (active: boolean) =>
    `px-3.5 py-1.5 text-[13px] transition ${
      active
        ? "bg-ink/[0.07] font-semibold text-ink"
        : "text-muted hover:text-ink"
    }`;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#ebe0cb] text-ink">
      {/* top bar */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-4 py-2.5 sm:px-5">
        {backHref && (
          <Link
            href={backHref}
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
          <div className="flex overflow-hidden rounded-lg border border-rule bg-card">
            <button
              type="button"
              className={seg(growth === "young")}
              aria-pressed={growth === "young"}
              onClick={() => setGrowth("young")}
            >
              At planting
            </button>
            <button
              type="button"
              className={seg(growth === "mature")}
              aria-pressed={growth === "mature"}
              onClick={() => setGrowth("mature")}
            >
              Mature
            </button>
          </div>
          {shareTokens && (
            <div className="hidden items-center gap-1.5 md:flex">
              <button
                type="button"
                onClick={() => copyShareLink("client")}
                className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-paper transition hover:bg-accent-bright"
              >
                {copied === "client" ? "Copied ✓" : "Copy client link"}
              </button>
              <button
                type="button"
                onClick={() => copyShareLink("crew")}
                title="Same viewer without pricing — for install crews"
                className="rounded-lg border border-rule-strong px-3 py-1.5 text-[13px] font-semibold text-ink transition hover:bg-card"
              >
                {copied === "crew" ? "Copied ✓" : "Crew link"}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* canvas */}
        <div ref={wrapRef} className="relative min-h-0 flex-1">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full cursor-grab touch-none"
            role="img"
            aria-label={`Interactive plan of ${projectName}. Drag to orbit, tap a plant to highlight that species.`}
          />
          <p className="pointer-events-none absolute right-3.5 top-3 text-right font-mono text-[11px] leading-relaxed text-faint">
            drag to orbit · scroll to zoom
            <br />
            tap a plant to find its kind
          </p>
          <p className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            {projectName} · drawn to scale from headset data · Verde Vision
          </p>
        </div>

        {/* rail */}
        <aside className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-rule bg-card/60 md:max-h-none md:w-[320px] md:border-l md:border-t-0">
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
        </aside>
      </div>
    </div>
  );
}
