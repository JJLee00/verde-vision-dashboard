// TypeScript mirror of the Vision Pro app's ProjectFile (Swift, Codable).
// Only the fields the living-blueprint viewer reads are typed here; the
// stored jsonb keeps everything the app sent.
//
// Coordinate convention (matches the app): positions are LOCAL alignment
// coordinates in METERS, Y up. The viewer maps local X/Z onto the plan and
// converts to feet for display.

export type PlacedPlantJSON = {
  id: string;
  plantModelName: string;
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  rotationW: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  // ContainerSize.SizeType raw value, e.g. "15g" or "36\" Box".
  containerType?: string | null;
  beamTiltDegrees?: number | null;
};

export type LocalPoint = {
  id: string;
  positionX: number;
  positionY: number;
  positionZ: number;
};

export type FeaturePolygonJSON = {
  id: string;
  // FeatureType raw value: "House" | "Pool" | "Driveway" | "Patio" |
  // "Fence" | "Shed" | "Garage" | "Walkway" | "Deck" | "AC Unit" |
  // "Retaining Wall" | "Fire Pit" | "Other"
  featureType: string;
  customLabel?: string | null;
  vertices: LocalPoint[];
};

export type HardscapeAreaJSON = {
  id: string;
  // HardscapeStyle raw value, e.g. "paver", "travertine", "concrete",
  // "decomposedGranite", "turf", "flagstone", "pool"
  style: string;
  vertices: LocalPoint[];
  gradeHeight?: number | null;
};

export type RemovalMarkerJSON = {
  id: string;
  positionX: number;
  positionY: number;
  positionZ: number;
  radiusMeters: number;
  heightMeters: number;
};

export type ProjectFileJSON = {
  projectName: string;
  createdDate?: string;
  placements: PlacedPlantJSON[];
  boundaryPoints?: LocalPoint[] | null;
  boundaryIsClosed?: boolean | null;
  featurePolygons?: FeaturePolygonJSON[] | null;
  hardscapeAreas?: HardscapeAreaJSON[] | null;
  removalMarkers?: RemovalMarkerJSON[] | null;
  // Degrees clockwise from the local +X axis to true north. Never captured
  // by the app today (reserved for the iPhone companion) — when present the
  // plan rotates so north is up.
  northHeadingDegrees?: number | null;
  clientEmail?: string | null;
  // Cumulative seconds spent in each mode across all sessions, keyed
  // "design" | "blueprint" | "night" | "clientView" (presenting).
  modeSeconds?: Record<string, number> | null;
};

export const METERS_TO_FEET = 3.28084;
