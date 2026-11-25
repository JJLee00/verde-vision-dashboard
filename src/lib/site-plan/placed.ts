// A yard the headset holds, as a site plan. After the corner walk the
// project's own shapes (yard coordinates, edited on the headset) are the
// plan, shown back on the photo by running the walk's fit in reverse. A
// yard traced on the headset was never walked: it has no photo to go on,
// and its own coordinates are the plan's.

import { layoutTurn, markRadiusFt } from "@/lib/blueprint/sheet";
import { METERS_TO_FEET, type ProjectFileJSON } from "@/lib/viewer/types";
import { FEATURE_TYPES, finishPlan, type PlanFeature, type PlanFrame, type SitePlan, type XZ } from "./plan";

/** The fit, plan → local (BlueprintAligner.Fit): rotate, then move. */
export interface WalkFit {
  rotation: number;
  tx: number;
  tz: number;
}

export function walkFit(project: ProjectFileJSON | null): WalkFit | null {
  const p = project?.outlinePlacement;
  if (!p || p.rotation == null || p.translationX == null || p.translationZ == null) return null;
  return { rotation: p.rotation, tx: p.translationX, tz: p.translationZ };
}

/** When the walk was made. The app writes ISO 8601; a bare number is
 *  Foundation's default, seconds since 2001. */
export function placedAt(project: ProjectFileJSON | null): Date | null {
  const at = project?.outlinePlacement?.placedAt;
  if (at == null) return null;
  const date = typeof at === "number" ? new Date((at + 978307200) * 1000) : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Yard metres back to the plan's geo frame: the fit run backwards. */
export function localToGeo(fit: WalkFit, [lx, lz]: XZ): XZ {
  const c = Math.cos(fit.rotation);
  const s = Math.sin(fit.rotation);
  const dx = lx - fit.tx;
  const dz = lz - fit.tz;
  return [c * dx + s * dz, c * dz - s * dx];
}

/**
 * The plan as the headset has it now, back on the photo. Null when the
 * walk kept no fit (placed before the fit was recorded): then the traced
 * plan is all the dashboard can show.
 */
export function placedPlan(plan: SitePlan, project: ProjectFileJSON): SitePlan | null {
  const fit = walkFit(project);
  if (!fit) return null;
  return finishPlan({
    provider: plan.provider,
    lookupAddress: plan.lookupAddress,
    origin: plan.origin,
    frame: plan.frame,
    underlay: plan.underlay,
    ...(plan.planImage ? { planImage: plan.planImage } : {}),
    ...(plan.mapOffset ? { mapOffset: plan.mapOffset } : {}),
    ...shapesOnPlan(project, fit),
  });
}

/**
 * A yard the headset drew, as a plan in its own coordinates: turned north
 * up when the project knows north (as its blueprint is), otherwise as it
 * was traced. There's no place on the map, so no photo — the sheet is the
 * drawing itself, with a margin. Nothing here is saved: the plan is the
 * project, read again each time.
 */
export function yardPlan(project: ProjectFileJSON): { plan: SitePlan; fit: WalkFit } {
  // layoutTurn carries the yard onto the plan; the fit goes the other way.
  const turn = layoutTurn(project.northHeadingDegrees);
  const fit: WalkFit = { rotation: turn === 0 ? 0 : -turn, tx: 0, tz: 0 };
  return {
    fit,
    plan: finishPlan({
      provider: "headset",
      lookupAddress: "",
      frame: yardFrame(project, fit),
      underlay: { kind: "none", opacity: 0 },
      ...shapesOnPlan(project, fit),
    }),
  };
}

/** Room left round a yard with no photo, so there's ground to design on. */
const YARD_MARGIN_M = 3;

/** The sheet for a yard with no photo: everything drawn, and a margin. */
function yardFrame(project: ProjectFileJSON, fit: WalkFit): PlanFrame {
  const box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  const take = (p: { positionX: number; positionZ: number }, r = 0) => {
    const [x, z] = localToGeo(fit, [p.positionX, p.positionZ]);
    box.x0 = Math.min(box.x0, x - r);
    box.x1 = Math.max(box.x1, x + r);
    box.z0 = Math.min(box.z0, z - r);
    box.z1 = Math.max(box.z1, z + r);
  };
  for (const p of project.boundaryPoints ?? []) take(p);
  for (const f of project.featurePolygons ?? []) for (const v of f.vertices) take(v);
  for (const a of project.hardscapeAreas ?? []) for (const v of a.vertices) take(v);
  for (const p of project.placements ?? []) take(p, markRadiusFt(p.plantModelName, p.scaleX || 1) / METERS_TO_FEET);
  if (box.x0 > box.x1) return { cx: 0, cz: 0, halfWidth: 10, halfHeight: 10 };
  const margin = Math.max(YARD_MARGIN_M, 0.15 * Math.max(box.x1 - box.x0, box.z1 - box.z0));
  return {
    cx: (box.x0 + box.x1) / 2,
    cz: (box.z0 + box.z1) / 2,
    halfWidth: (box.x1 - box.x0) / 2 + margin,
    halfHeight: (box.z1 - box.z0) / 2 + margin,
  };
}

/** The project's shapes, laid on the plan through a fit run backwards. */
function shapesOnPlan(project: ProjectFileJSON, fit: WalkFit): Pick<SitePlan, "boundary" | "features" | "mainHouseId"> {
  const geo = (pts: { positionX: number; positionZ: number }[]) =>
    pts.map((p) => localToGeo(fit, [p.positionX, p.positionZ]));
  const features: PlanFeature[] = (project.featurePolygons ?? [])
    .filter((f) => f.vertices.length >= (f.isClosed === false ? 2 : 3))
    .map((f) => {
      const type = FEATURE_TYPES.find((t) => t === f.featureType) ?? "Other";
      const label = type === "Other" ? f.customLabel || (f.featureType !== "Other" ? f.featureType : undefined) : undefined;
      // A fence or wall run the walk placed stays a run; everything the
      // headset draws itself is closed, fences included.
      const shape = f.isClosed === false ? "line" : "area";
      return { id: f.id.toLowerCase(), type, ...(label ? { label } : {}), shape, points: geo(f.vertices) };
    });
  const boundary = (project.boundaryPoints ?? []).length >= 3 ? geo(project.boundaryPoints!) : [];
  const house = project.outlinePlacement?.houseFeatureID?.toLowerCase();
  return {
    boundary,
    features,
    ...(house && features.some((f) => f.id === house) ? { mainHouseId: house } : {}),
  };
}
