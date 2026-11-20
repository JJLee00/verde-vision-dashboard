// A made-up yard for the dev fixture — synthetic on purpose, so no real
// property's plan lives in the repo. On the photo it lands on some real
// neighbourhood; it isn't meant to match the roofs there.

import type { LocalPoint, ProjectFileJSON } from "@/lib/viewer/types";
import { designFromPlan, geoToLocal } from "./design";
import { boundaryOutline, finishPlan, outlineOf, type PlanPlant, type SitePlan, type XZ } from "./plan";

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

export const FIXTURE_PLAN: SitePlan = finishPlan({
  provider: "trace",
  lookupAddress: "27210 N Rio Verde Dr, Rio Verde, AZ",
  origin: { lat: 33.72, lng: -111.67 },
  frame: { cx: 0, cz: 0, halfWidth: 30, halfHeight: 30 },
  underlay: { kind: "satellite", opacity: 0.65 },
  boundary: [
    [-16, -22],
    [16, -22],
    [16, 22],
    [-16, 22],
  ],
  features: [
    {
      id: id(1),
      type: "House",
      shape: "area",
      points: [
        [-10, -14],
        [8, -14],
        [8, -2],
        [0, -2],
        [0, 6],
        [-10, 6],
      ],
    },
    { id: id(2), type: "Driveway", shape: "area", points: [[2, -22], [8, -22], [8, -14], [2, -14]] },
    { id: id(3), type: "Walkway", shape: "area", points: [[-4, -22], [-2.6, -22], [-2.6, -14], [-4, -14]] },
    // A patio with a bowed front edge, and a pool with a rounded end:
    // each a smooth corner between two sharp ones.
    {
      id: id(4),
      type: "Patio",
      shape: "area",
      points: [[-10, 6], [0, 6], [0, 10], [-5, 11.2], [-10, 10]],
      smooth: [false, false, false, true, false],
    },
    {
      id: id(5),
      type: "Pool",
      shape: "area",
      points: [[-8, 12.5], [2, 12.5], [4.5, 15], [2, 17.5], [-8, 17.5]],
      smooth: [false, false, true, false, false],
    },
    { id: id(6), type: "Fire Pit", shape: "circle", points: [[9, 14]], radius: 1.1 },
    { id: id(7), type: "AC Unit", shape: "area", points: [[8.4, -6], [9.6, -6], [9.6, -4.8], [8.4, -4.8]] },
    { id: id(8), type: "Shed", shape: "area", points: [[10.5, 18], [15.4, 18], [15.4, 21.4], [10.5, 21.4]] },
    { id: id(9), type: "Fence", shape: "line", points: [[-16, -2], [-16, 22], [16, 22], [16, -2]] },
  ],
});

/* ── A design on it ──────────────────────────────────────────────── */

const pid = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

const plant = (n: number, key: string, size: string, x: number, z: number, rotation = (n * 1.7) % 6 - 3): PlanPlant => ({
  id: pid(n),
  key,
  size,
  x,
  z,
  rotation,
});

/** The sample plan with a front-yard and backyard design drawn on it. */
export const FIXTURE_DESIGNED: SitePlan = {
  ...FIXTURE_PLAN,
  plants: [
    plant(1, "blue palo verde", '24" Box', -11, -18),
    plant(2, "texas ebony", '24" Box', 12.5, -17.5),
    plant(3, "red yucca", "5g", -6, -16),
    plant(4, "red yucca", "5g", -7.3, -17.3),
    plant(5, "red yucca", "5g", -5.7, -18.7),
    plant(6, "golden barrel cactus", "5g", -13.4, -14.8),
    plant(7, "golden barrel cactus", "5g", -14.4, -15.9),
    plant(8, "golden barrel cactus", "5g", -13.2, -16.6),
    plant(9, "desert spoon", "15g", 11.5, -9),
    plant(10, "path light", "Small", -4.6, -20.5),
    plant(11, "path light", "Small", -4.6, -17.2),
    plant(12, "mulga", '36" Box', 13.4, 9.6),
    plant(13, "texas sage", "5g", -14.2, 0.5),
    plant(14, "texas sage", "5g", -14.2, 3.5),
    plant(15, "texas sage", "5g", -14.2, 6.5),
  ],
  surfaces: [
    {
      id: pid(50),
      style: "Artificial Turf",
      shape: "area",
      points: [
        [2, 0],
        [11, 0],
        [11, 8],
        [2, 8],
      ],
    },
    { id: pid(51), style: "Travertine", shape: "circle", points: [[9, 14]], radius: 2.6 },
  ],
};

/**
 * The same yard after a corner walk: the plan's shapes and design as the
 * headset would hold them, in a yard frame turned and moved from the plan's.
 * For trying the Design tab's publish flow; nothing in it was walked.
 */
export function fixtureWalked(): { plan: SitePlan; project: ProjectFileJSON } {
  const fit = { rotation: 0.35, tx: 3, tz: -2 };
  const local = (p: XZ, i: number, id: string): LocalPoint => {
    const [x, z] = geoToLocal(fit, p);
    // The shape's number, then the corner's: a UUID like the headset's.
    return { id: `${id.slice(0, 24)}${id.slice(-2)}AA${String(i).padStart(8, "0")}`, positionX: x, positionY: 0, positionZ: z };
  };
  const plan = FIXTURE_DESIGNED;
  const base: ProjectFileJSON = {
    projectName: "Sample yard",
    placements: [],
    featurePolygons: plan.features.map((f) => ({
      id: f.id.toUpperCase(),
      featureType: f.type,
      vertices: outlineOf(f).map((p, i) => local(p, i, f.id)),
      ...(f.shape === "line" ? { isClosed: false } : {}),
    })),
    boundaryPoints: boundaryOutline(plan).map((p, i) => local(p, i, id(90))),
    boundaryIsClosed: true,
    outlinePlacement: {
      rotation: fit.rotation,
      translationX: fit.tx,
      translationZ: fit.tz,
      padHeight: 0,
      houseFeatureID: id(1).toUpperCase(),
      placedAt: "2026-11-12T17:30:00Z",
    },
  };
  const designed = designFromPlan(base, fit, plan.plants ?? [], plan.surfaces ?? [], []);
  // Measured by the headset since: nothing waits on a height.
  const project: ProjectFileJSON = {
    ...designed,
    placements: designed.placements.map((p) => ({ ...p, positionY: 0, heightPending: undefined })),
    hardscapeAreas: (designed.hardscapeAreas ?? []).map((a) => ({
      ...a,
      vertices: a.vertices.map((v) => ({ ...v, positionY: 0, heightPending: undefined })),
    })),
  };
  return { plan, project };
}
