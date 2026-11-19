// A made-up yard for the dev fixture — synthetic on purpose, so no real
// property's plan lives in the repo. On the photo it lands on some real
// neighbourhood; it isn't meant to match the roofs there.

import { finishPlan, type SitePlan } from "./plan";

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
    { id: id(4), type: "Patio", shape: "area", points: [[-10, 6], [0, 6], [0, 10], [-10, 10]] },
    { id: id(5), type: "Pool", shape: "area", points: [[-8, 12.5], [2, 12.5], [2, 17.5], [-8, 17.5]] },
    { id: id(6), type: "Fire Pit", shape: "circle", points: [[9, 14]], radius: 1.1 },
    { id: id(7), type: "AC Unit", shape: "area", points: [[8.4, -6], [9.6, -6], [9.6, -4.8], [8.4, -4.8]] },
    { id: id(8), type: "Shed", shape: "area", points: [[10.5, 18], [15.4, 18], [15.4, 21.4], [10.5, 21.4]] },
    { id: id(9), type: "Fence", shape: "line", points: [[-16, -2], [-16, 22], [16, 22], [16, -2]] },
  ],
});
