// Shared types for the Auto Blueprint pipeline (address → draft blueprint).
//
// A ParcelProvider is the ONLY county/vendor-specific piece of the system.
// Every provider emits the same WGS84 payload; the /api/blueprint route
// converts it once to app-frame meters (see normalize.ts). Adding a county
// (Pima, Pinal, Regrid…) means adding a provider that speaks that GIS
// server's dialect — nothing downstream changes.

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Physical attributes only. County responses also carry owner names,
 * mailing addresses, and sale prices — providers must never request or
 * forward those fields.
 */
export interface ParcelAttributes {
  lotSizeSqFt?: number;
  livableAreaSqFt?: number;
  pool?: boolean;
  patios?: number;
  coveredParkingSpots?: number;
  constructionYear?: number;
}

/** One parcel candidate as returned by a provider, in WGS84. */
export interface ParcelRecord {
  apn: string;
  address: string;
  /** Outer boundary ring, unclosed (first vertex not repeated at the end). */
  ring: LatLng[];
  attributes: ParcelAttributes;
}

export interface ParcelProvider {
  /** Short id for logs and the response payload, e.g. "maricopa". */
  name: string;
  /** All parcels matching a street address — several can share one. */
  findByAddress(address: string): Promise<ParcelRecord[]>;
}

/** One candidate as served to the Vision Pro app: meters, app ground frame. */
export interface BlueprintCandidate {
  apn: string;
  address: string;
  /** Parcel centroid in WGS84 — the anchor for Solar API calls + thumbnails. */
  centroid: LatLng;
  /**
   * Parcel outline in "geo frame" meters, origin at the parcel centroid:
   * x = east, z = south. This matches the app's right-handed Y-up XZ
   * ground plane, so the geo → local bake is rotation + translation only.
   * (A flipped axis would mirror the blueprint — no rigid fit can undo
   * that, so handedness is locked down here, at the source.)
   */
  parcelXZ: [number, number][];
  attributes: ParcelAttributes;
}
