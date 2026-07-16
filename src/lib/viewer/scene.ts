// Pure data prep for the living-blueprint viewer — no React, no canvas —
// so both the client component (LivingBlueprint) and server pages (the
// project page's plant summary) can share it.

import type { ProjectFileJSON } from "./types";
import { METERS_TO_FEET } from "./types";
import { speciesMeta, type SpeciesMeta } from "./catalog";

export const YOUNG_FACTOR = 0.45;

export type Instance = {
  model: string;
  meta: SpeciesMeta;
  x: number; // feet, plan
  z: number;
  yawDeg: number;
  scale: number;
  containerType: string | null;
};

export type Poly = { pts: [number, number][]; label: string; kind: string };

export type Scene = {
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

export function buildScene(project: ProjectFileJSON): Scene {
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

export type RailRow = {
  model: string;
  meta: SpeciesMeta;
  qty: number;
  unitPrice: number | null; // null = varies or unknown
  unitLabel: string;
  lineTotal: number | null;
};

export function buildRail(
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
