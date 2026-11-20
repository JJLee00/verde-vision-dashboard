// The design drawn on the site plan: plants, and new surfaces such as a
// paver patio or a lawn. Pure; no React.
//
// Before the walk the design lives in the plan (`plants`, `surfaces`), in
// the plan's frame, and the corner walk carries it into the yard with the
// shapes. After the walk it lives where every design lives — the project's
// placements and hardscapeAreas, in yard coordinates — and the Design tab
// edits it there through the walk's fit, publishing a revision the headset
// pulls like any other office edit.

import { quatYaw } from "@/lib/blueprint/sheet";
import { plantForKey, plantForModel, currentSize, type CatalogPlant, type CatalogSize } from "@/lib/design-edit";
import { gridPrice } from "@/lib/price-book";
import { STYLES, SURFACE_PRICE_SIZE, surfacePriceKey, surfaceStyle } from "@/lib/surfaces";
import type { HardscapeAreaJSON, LocalPoint, PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";
import { localToGeo, type WalkFit } from "./placed";
import { outlineOf, polygonArea, SQ_FT_PER_SQ_M, type PlanPlant, type PlanSurface, type XZ } from "./plan";

/** Styles the headset no longer lays (HardscapeStyle.retired). A saved area
 *  in one still draws and prices; it just isn't offered. */
const RETIRED_SURFACES = new Set(["Concrete", "Decomposed Granite"]);
export const OFFERED_SURFACES = STYLES.filter((s) => !RETIRED_SURFACES.has(s.style));

export const newId = () => crypto.randomUUID().toUpperCase();

/* ── Plants ──────────────────────────────────────────────────────── */

/** A turn about up as the quaternion PlacedPlant stores. */
export function yawQuat(yaw: number) {
  return { rotationX: 0, rotationY: Math.sin(yaw / 2), rotationZ: 0, rotationW: Math.cos(yaw / 2) };
}

/** The catalog plant and size a plan plant is, or null for one the
 *  catalog no longer knows. */
export function catalogOf(p: Pick<PlanPlant, "key" | "size">): { plant: CatalogPlant; size: CatalogSize } | null {
  const plant = plantForKey(p.key);
  const size = plant?.sizes.find((s) => s.size === p.size);
  return plant && size ? { plant, size } : null;
}

/** A plan plant as a placement in the plan's own frame, on the ground. */
export function placementOf(p: PlanPlant, y = 0): PlacedPlantJSON | null {
  const c = catalogOf(p);
  if (!c) return null;
  const s = c.size.heightMultiplier;
  return {
    id: p.id,
    plantModelName: c.size.modelName,
    positionX: p.x,
    positionY: y,
    positionZ: p.z,
    ...yawQuat(p.rotation),
    scaleX: s,
    scaleY: s,
    scaleZ: s,
    containerType: c.size.size,
  };
}

/** What one plant costs on the org's grid; blank is $0. */
export function plantPrice(p: Pick<PlanPlant, "key" | "size">, prices: Record<string, number>): number {
  return gridPrice(prices, p.key, p.size);
}

/* ── Surfaces ────────────────────────────────────────────────────── */

export function surfaceSqFtOf(s: Pick<PlanSurface, "shape" | "points" | "radius" | "smooth">): number {
  return polygonArea(outlineOf(s)) * SQ_FT_PER_SQ_M;
}

/** A surface's material price per square foot on the org's grid. */
export function surfaceRate(style: string, prices: Record<string, number>): number {
  const s = surfaceStyle(style);
  return s ? gridPrice(prices, surfacePriceKey(s), SURFACE_PRICE_SIZE) : 0;
}

export function surfacePrice(s: PlanSurface, prices: Record<string, number>): number {
  return surfaceSqFtOf(s) * surfaceRate(s.style, prices);
}

/** A plan surface as a HardscapeArea in the plan's frame. The corner ids
 *  are only for drawing — nothing here reaches the headset. */
export function areaOf(s: PlanSurface): HardscapeAreaJSON {
  return {
    id: s.id,
    style: s.style,
    vertices: outlineOf(s).map(([x, z], i) => ({ id: `${s.id}-${i}`, positionX: x, positionY: 0, positionZ: z })),
  };
}

/** What a design comes to in materials: plants and surfaces at grid price. */
export function designTotal(plants: PlanPlant[], surfaces: PlanSurface[], prices: Record<string, number>): number {
  const sum = plants.reduce((t, p) => t + plantPrice(p, prices), 0) + surfaces.reduce((t, s) => t + surfacePrice(s, prices), 0);
  return Math.round(sum * 100) / 100;
}

/* ── After the walk ──────────────────────────────────────────────── */

/** The plan's frame to the yard's: the walk's fit (BlueprintAligner.Fit). */
export function geoToLocal(fit: WalkFit, [gx, gz]: XZ): XZ {
  const c = Math.cos(fit.rotation);
  const s = Math.sin(fit.rotation);
  return [c * gx - s * gz + fit.tx, s * gx + c * gz + fit.tz];
}

/**
 * A placed design, shown on the plan: every plant the catalog knows as a
 * plan plant, back in the plan's frame. A turn in the yard is a turn on the
 * plan less the fit's own turn. Plants the catalog doesn't know (a
 * placeholder, a firm's own) come back in `others`: drawn, kept, not edited.
 */
export function designOnPlan(project: ProjectFileJSON, fit: WalkFit) {
  const plants: PlanPlant[] = [];
  const others: PlacedPlantJSON[] = [];
  for (const p of project.placements ?? []) {
    const plant = plantForModel(p.plantModelName);
    const size = plant ? currentSize(plant, p) : null;
    if (!plant || !size) {
      others.push(p);
      continue;
    }
    const [x, z] = localToGeo(fit, [p.positionX, p.positionZ]);
    plants.push({ id: p.id, key: plant.key, size: size.size, x, z, rotation: wrap(quatYaw(p) + fit.rotation) });
  }
  const surfaces: PlanSurface[] = (project.hardscapeAreas ?? [])
    .filter((a) => (a.vertices ?? []).length >= 3)
    .map((a) => ({
      id: a.id,
      style: a.style,
      shape: "area",
      points: a.vertices.map((v) => localToGeo(fit, [v.positionX, v.positionZ])),
    }));
  return { plants, surfaces, others };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

/**
 * The ground's height at a spot in the yard, as best the design knows it:
 * the measured heights around it, nearest weighted most. A desk can't see
 * the ground, so this is only where to start — whatever it sets is marked
 * `heightPending`, and the headset measures the real ground once its scan
 * reaches the spot.
 */
export function groundAt(project: ProjectFileJSON, [x, z]: XZ): number {
  const known: [number, number, number][] = [];
  const take = (p: { positionX: number; positionY: number; positionZ: number; heightPending?: boolean | null }) => {
    if (!p.heightPending && Number.isFinite(p.positionY)) known.push([p.positionX, p.positionY, p.positionZ]);
  };
  (project.placements ?? []).forEach(take);
  (project.boundaryPoints ?? []).forEach(take);
  for (const f of project.featurePolygons ?? []) f.vertices.forEach(take);
  for (const a of project.hardscapeAreas ?? []) a.vertices.forEach(take);
  if (known.length === 0) return project.outlinePlacement?.padHeight ?? 0;
  const nearest = known
    .map(([kx, ky, kz]) => ({ y: ky, d: Math.hypot(kx - x, kz - z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  if (nearest[0].d < 0.05) return nearest[0].y;
  let w = 0;
  let sum = 0;
  for (const n of nearest) {
    const k = 1 / (n.d * n.d);
    w += k;
    sum += n.y * k;
  }
  return sum / w;
}

/** Quaternion product a·b: turn by b, then by a. */
function mul(
  a: { rotationX: number; rotationY: number; rotationZ: number; rotationW: number },
  b: { rotationX: number; rotationY: number; rotationZ: number; rotationW: number }
) {
  const [ax, ay, az, aw] = [a.rotationX, a.rotationY, a.rotationZ, a.rotationW];
  const [bx, by, bz, bw] = [b.rotationX, b.rotationY, b.rotationZ, b.rotationW];
  return {
    rotationX: aw * bx + ax * bw + ay * bz - az * by,
    rotationY: aw * by - ax * bz + ay * bw + az * bx,
    rotationZ: aw * bz + ax * by - ay * bx + az * bw,
    rotationW: aw * bw - ax * bx - ay * by - az * bz,
  };
}

/**
 * The placed design with the plan's edits laid back on it.
 *
 * Only what changed moves: a plant that wasn't dragged keeps the height the
 * headset measured, a plant only turned keeps any lean it had on a slope
 * (the turn is applied on top of its rotation), and a surface whose outline
 * didn't change keeps its corners and their heights. Whatever was moved or
 * added gets a height from `groundAt` and is marked for the headset to
 * measure.
 */
export function designFromPlan(
  base: ProjectFileJSON,
  fit: WalkFit,
  plants: PlanPlant[],
  surfaces: PlanSurface[],
  others: PlacedPlantJSON[]
): ProjectFileJSON {
  const before = new Map((base.placements ?? []).map((p) => [p.id, p]));
  const edited = new Map<string, PlacedPlantJSON>();
  const added: PlacedPlantJSON[] = [];
  for (const p of plants) {
    const c = catalogOf(p);
    if (!c) continue;
    const was = before.get(p.id);
    const local = geoToLocal(fit, [p.x, p.z]);
    if (!was) {
      const s = c.size.heightMultiplier;
      added.push({
        id: p.id,
        plantModelName: c.size.modelName,
        positionX: local[0],
        positionY: groundAt(base, local),
        positionZ: local[1],
        ...yawQuat(p.rotation - fit.rotation),
        scaleX: s,
        scaleY: s,
        scaleZ: s,
        containerType: c.size.size,
        heightPending: true,
      });
      continue;
    }
    let next: PlacedPlantJSON = { ...was };
    const [wx, wz] = localToGeo(fit, [was.positionX, was.positionZ]);
    if (!near(wx, p.x) || !near(wz, p.z)) {
      next = { ...next, positionX: local[0], positionY: groundAt(base, local), positionZ: local[1], heightPending: true };
    }
    const turn = wrap(p.rotation - (quatYaw(was) + fit.rotation));
    if (!near(turn, 0)) next = { ...next, ...mul(yawQuat(turn), next) };
    const wasPlant = plantForModel(was.plantModelName);
    const wasSize = wasPlant ? currentSize(wasPlant, was) : null;
    if (wasPlant?.key !== p.key || wasSize?.size !== p.size) {
      const s = c.size.heightMultiplier;
      next = { ...next, plantModelName: c.size.modelName, containerType: c.size.size, scaleX: s, scaleY: s, scaleZ: s };
    }
    edited.set(p.id, next);
  }
  // In the order they were, new ones last, so an unchanged design reads
  // back exactly as it was stored.
  const kept = new Set(others.map((o) => o.id));
  const placements = [
    ...(base.placements ?? []).flatMap((p) => (kept.has(p.id) ? [p] : edited.has(p.id) ? [edited.get(p.id)!] : [])),
    ...added,
  ];

  const areasBefore = new Map((base.hardscapeAreas ?? []).map((a) => [a.id, a]));
  const order = new Map((base.hardscapeAreas ?? []).map((a, i) => [a.id, i]));
  const ordered = [...surfaces].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  const hardscapeAreas: HardscapeAreaJSON[] = ordered.map((s) => {
    const was = areasBefore.get(s.id);
    const outline = outlineOf(s);
    const same =
      was &&
      was.vertices.length === outline.length &&
      was.vertices.every((v, i) => {
        const [gx, gz] = localToGeo(fit, [v.positionX, v.positionZ]);
        return near(gx, outline[i][0]) && near(gz, outline[i][1]);
      });
    if (was && same) return { ...was, style: s.style };
    const vertices: LocalPoint[] = outline.map((g, i) => {
      const local = geoToLocal(fit, g);
      return {
        // The headset decodes these as UUIDs.
        id: was?.vertices[i]?.id ?? newId(),
        positionX: local[0],
        positionY: groundAt(base, local),
        positionZ: local[1],
        heightPending: true,
      };
    });
    return { ...(was ?? {}), id: s.id, style: s.style, vertices };
  });

  return { ...base, placements, hardscapeAreas };
}

/** Whether two designs differ in what the Design tab edits. */
export function designChanged(a: ProjectFileJSON, b: ProjectFileJSON): boolean {
  return (
    JSON.stringify(a.placements ?? []) !== JSON.stringify(b.placements ?? []) ||
    JSON.stringify(a.hardscapeAreas ?? []) !== JSON.stringify(b.hardscapeAreas ?? [])
  );
}
