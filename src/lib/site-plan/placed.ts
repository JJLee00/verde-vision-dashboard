// A site plan after the corner walk. From then on the project's own shapes
// (yard coordinates, edited on the headset) are the plan; the dashboard
// shows them back on the photo by running the walk's fit in reverse.

import type { ProjectFileJSON } from "@/lib/viewer/types";
import { FEATURE_TYPES, finishPlan, type PlanFeature, type SitePlan, type XZ } from "./plan";

/** The walk's fit, geo → local (BlueprintAligner.Fit): rotate, then move. */
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
  const geo = (pts: { positionX: number; positionZ: number }[]) =>
    pts.map((p) => localToGeo(fit, [p.positionX, p.positionZ]));
  const features: PlanFeature[] = (project.featurePolygons ?? [])
    .filter((f) => f.vertices.length >= 3)
    .map((f) => {
      const type = FEATURE_TYPES.find((t) => t === f.featureType) ?? "Other";
      const label = type === "Other" ? f.customLabel || (f.featureType !== "Other" ? f.featureType : undefined) : undefined;
      // The headset's shapes are always closed today, fences included.
      return { id: f.id.toLowerCase(), type, ...(label ? { label } : {}), shape: "area", points: geo(f.vertices) };
    });
  const boundary = (project.boundaryPoints ?? []).length >= 3 ? geo(project.boundaryPoints!) : [];
  const house = project.outlinePlacement?.houseFeatureID?.toLowerCase();
  return finishPlan({
    provider: plan.provider,
    lookupAddress: plan.lookupAddress,
    origin: plan.origin,
    frame: plan.frame,
    underlay: plan.underlay,
    ...(plan.mapOffset ? { mapOffset: plan.mapOffset } : {}),
    boundary,
    features,
    ...(house && features.some((f) => f.id === house) ? { mainHouseId: house } : {}),
  });
}
