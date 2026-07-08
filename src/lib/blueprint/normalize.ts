// WGS84 → app-frame meters.
//
// Equirectangular projection around the parcel centroid. At parcel scale
// (< 300 m) the error vs. a true geodesic is negligible, and it keeps every
// provider on plain WGS84 — no per-county state-plane handling. Scale
// accuracy matters more than usual here: the app compares map distances
// against ARKit's cm-accurate measurements (alignment tripwires), so the
// meters-per-degree factors use the standard geodetic series rather than a
// spherical earth (which would be off by ~0.3% in latitude).

import type { LatLng } from "./types";

function metersPerDegree(lat: number): { lat: number; lng: number } {
  const phi = (lat * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lng: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
  };
}

/**
 * Projects a ring to meters around `origin`: x = east, z = south — the
 * app's right-handed Y-up XZ ground frame (see BlueprintCandidate.parcelXZ).
 */
export function ringToXZMeters(ring: LatLng[], origin: LatLng): [number, number][] {
  const m = metersPerDegree(origin.lat);
  return ring.map((p) => [
    (p.lng - origin.lng) * m.lng, // x = east
    -((p.lat - origin.lat) * m.lat), // z = south
  ]);
}

/**
 * Area centroid (shoelace) of a ring, computed in projected meters for
 * numerical sanity, returned in WGS84. Falls back to the vertex average
 * for degenerate (near-zero-area) rings.
 */
export function ringCentroid(ring: LatLng[]): LatLng {
  const origin = ring[0];
  const m = metersPerDegree(origin.lat);
  const pts = ring.map((p) => ({
    x: (p.lng - origin.lng) * m.lng,
    y: (p.lat - origin.lat) * m.lat,
  }));

  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }

  if (Math.abs(area) < 1e-6) {
    const avgX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const avgY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { lat: origin.lat + avgY / m.lat, lng: origin.lng + avgX / m.lng };
  }

  area /= 2;
  cx /= 6 * area;
  cy /= 6 * area;
  return { lat: origin.lat + cy / m.lat, lng: origin.lng + cx / m.lng };
}
