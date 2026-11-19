// The site plan on the blueprint PDF, before the corner walk.

import type { LocalPoint, ProjectFileJSON } from "@/lib/viewer/types";
import { outlineOf, type SitePlan, type XZ } from "./plan";

/**
 * The design the blueprint sheet draws. A project traced at the desk has
 * nothing drawn on the headset yet, so until it does, its sheet draws the
 * site plan itself, north up in the plan's metres. Once the headset has
 * drawn anything — a plant, a shape, the lot — its design is the sheet as
 * always: the two frames only meet through the corner walk.
 */
export function sheetDesign(design: ProjectFileJSON | null, plan: SitePlan | null, name: string): ProjectFileJSON | null {
  if (!plan || design?.outlinePlacement) return design;
  const drawn =
    (design?.placements?.length ?? 0) +
    (design?.featurePolygons?.length ?? 0) +
    (design?.boundaryPoints?.length ?? 0) +
    (design?.hardscapeAreas?.length ?? 0);
  if (drawn > 0) return design;
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
    boundaryPoints: plan.boundary.map((p, i) => point(`boundary-${i}`, p)),
    boundaryIsClosed: plan.boundary.length >= 3,
  };
}
