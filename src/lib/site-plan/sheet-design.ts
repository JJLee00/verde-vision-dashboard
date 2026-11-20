// The site plan on the blueprint PDF, before the corner walk.

import type { LocalPoint, PlacedPlantJSON, ProjectFileJSON } from "@/lib/viewer/types";
import { areaOf, placementOf } from "./design";
import { boundaryOutline, outlineOf, type SitePlan, type XZ } from "./plan";

/**
 * The design the blueprint sheet draws — and the 3D view, and the estimate.
 * A project traced at the desk has nothing drawn on the headset yet, so
 * until it does, its sheet draws the site plan itself, north up in the
 * plan's metres, with the plants and surfaces designed on it. Once the
 * headset has drawn anything — a plant, a shape, the lot — its design is
 * the sheet as always: the two frames only meet through the corner walk.
 */
export function sheetDesign(
  design: ProjectFileJSON | null,
  plan: Pick<SitePlan, "features" | "boundary" | "boundarySmooth" | "plants" | "surfaces"> | null,
  name: string
): ProjectFileJSON | null {
  if (!plan || design?.outlinePlacement || headsetDrew(design)) return design;
  const point = (id: string, [x, z]: XZ): LocalPoint => ({ id, positionX: x, positionY: 0, positionZ: z });
  return {
    ...(design ?? { projectName: name, placements: [] }),
    featurePolygons: plan.features.map((f) => ({
      id: f.id,
      featureType: f.type,
      customLabel: f.label ?? null,
      vertices: outlineOf(f).map((p, i) => point(`${f.id}-${i}`, p)),
      ...(f.shape === "line" ? { isClosed: false } : {}),
    })),
    boundaryPoints: boundaryOutline(plan).map((p, i) => point(`boundary-${i}`, p)),
    boundaryIsClosed: plan.boundary.length >= 3,
    placements: (plan.plants ?? []).map((p) => placementOf(p)).filter((p): p is PlacedPlantJSON => p != null),
    hardscapeAreas: (plan.surfaces ?? []).map(areaOf),
  };
}

/** Whether the headset has drawn anything of its own — a plant, a shape,
 *  the lot, a surface. */
export function headsetDrew(design: ProjectFileJSON | null): boolean {
  return (
    (design?.placements?.length ?? 0) +
      (design?.featurePolygons?.length ?? 0) +
      (design?.boundaryPoints?.length ?? 0) +
      (design?.hardscapeAreas?.length ?? 0) >
    0
  );
}
