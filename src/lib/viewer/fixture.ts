// Dev-only sample ProjectFile for /viewer/fixture (guarded to
// NODE_ENV=development in the page). Mirrors what the Vision Pro app
// uploads: LOCAL coordinates in meters, Y up. Lets the viewer be built
// and reviewed without touching the shared Supabase project.

import type { ProjectFileJSON, LocalPoint } from "./types";

const FT = 0.3048; // ft → m

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;

const pt = (xFt: number, zFt: number): LocalPoint => ({
  id: id(),
  positionX: xFt * FT,
  positionY: 0,
  positionZ: zFt * FT,
});

const place = (
  model: string,
  xFt: number,
  zFt: number,
  container: string,
  scale = 1
) => ({
  id: id(),
  plantModelName: model,
  positionX: xFt * FT,
  positionY: 0,
  positionZ: zFt * FT,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  rotationW: 1,
  scaleX: scale,
  scaleY: scale,
  scaleZ: scale,
  containerType: container,
});

export const FIXTURE_PROJECT: ProjectFileJSON = {
  projectName: "Rio Verde Residence (sample)",
  createdDate: "2026-07-14T17:00:00Z",
  clientEmail: "demo@useverdevision.com",
  boundaryPoints: [
    pt(-31, 10),
    pt(-24, 24),
    pt(20, 24),
    pt(31, 14),
    pt(31, -24),
    pt(-31, -24),
  ],
  boundaryIsClosed: true,
  featurePolygons: [
    {
      id: id(),
      featureType: "House",
      vertices: [pt(-31, -24), pt(-2, -24), pt(-2, -12), pt(-31, -12)],
    },
    {
      id: id(),
      featureType: "Patio",
      vertices: [pt(-2, -24), pt(14, -24), pt(14, -10), pt(-2, -10)],
    },
    {
      id: id(),
      featureType: "Walkway",
      vertices: [pt(9, -10), pt(13, -10), pt(13, 0), pt(9, 0)],
    },
    {
      id: id(),
      featureType: "Pool",
      vertices: [
        pt(13, 1.5),
        pt(27, 1.5),
        pt(28, 0),
        pt(28, -6),
        pt(27, -7.5),
        pt(13, -7.5),
        pt(12, -6),
        pt(12, 0),
      ],
    },
  ],
  hardscapeAreas: [
    {
      id: id(),
      style: "decomposedGranite",
      vertices: [pt(-30, 12), pt(-14, 16), pt(-16, 22), pt(-28, 20)],
    },
  ],
  removalMarkers: [
    {
      id: id(),
      positionX: 17 * FT,
      positionY: 0,
      positionZ: 18 * FT,
      radiusMeters: 0.45,
      heightMeters: 0.6,
    },
  ],
  placements: [
    place("HoneyMesquite", -18, 14, '36" Box', 6),
    place("Orange_Tree", 25, -16, '24" Box', 0.75),
    place("MexFanPalm", 10, 4, '36" Box', 1.5),
    place("MexFanPalm", 27, -12.5, '36" Box', 1.5),
    place("SaguaroSpear", -10, 6, "Medium", 1.5),
    place("MexicanFencePost", -27, 4, "15g", 0.6),
    place("MexicanFencePost", -25.2, 1, "15g", 0.6),
    place("ArgentineToothpick", 4, 18, "15g", 0.15),
    place("GoldenBarrel", 0, -4, "5g"),
    place("GoldenBarrel", 3, -6, "5g"),
    place("GoldenBarrel", 1.5, -8, "15g", 1.3),
    place("GoldenBarrel", 5.2, -3, "5g"),
    place("Aloe Vera", -6, -9, "5g", 0.5),
    place("Aloe Vera", -4, -11, "5g", 0.5),
    place("Aloe Vera", -7.5, -11.5, "15g"),
    place("AgaveAmericana", -16, -4, "15g", 0.7),
    place("AgaveAmericana", 8, 12, "15g", 0.7),
    place("GrayBoulder", -22, 18, "Medium", 2),
    place("GrayBoulder", 24, 7, "Large", 4),
    place("FlatBoulder", -12, -14, "Medium", 0.7),
    place("NightPathlight", 11, -2, "Small"),
    place("NightUplight", -19, 12, "Small"),
  ],
  northHeadingDegrees: null,
};
