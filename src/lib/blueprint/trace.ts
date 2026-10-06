// A house outline — and, if the designer wants one, the yard boundary —
// traced by hand on the aerial at a desk, turned into the payload the
// headset has always walked.
//
// This replaces the county + Solar pipeline (lookup.ts, enrich.ts) as the
// way a project gets its outline. That pipeline only ever covered Maricopa
// County; tracing covers every address with imagery, and a designer's eye on
// the roofline is what the building-mask extraction was approximating
// anyway. The headset cannot tell the two apart: it receives a
// BlueprintCandidate either way, and walks the house corners.
//
// Shared by the browser (lengths and areas while tracing) and the server
// action (validation and the stored shape), so both agree on every number.

import { ringCentroid, ringToXZMeters, xzMetersToRing } from "./normalize";
import type { StoredBlueprint } from "./stored";
import type { LatLng } from "./types";

/** `StoredBlueprint.provider` for an outline traced on the dashboard. */
export const TRACE_PROVIDER = "trace";

export interface TracedOutline {
  house: LatLng[];
  /** Empty when the designer didn't trace one — the boundary is optional. */
  boundary: LatLng[];
}

/** A traced outline the server refused, with a message for the designer. */
export class TraceError extends Error {}

const SQ_FT_PER_SQ_M = 10.7639;
const FEET_PER_METER = 3.28084;
/** Generous for a house, tight enough to catch a corridor of runaway clicks. */
const MAX_CORNERS = 200;
/** A corner this far from the outline's centre is a mis-click, not a yard. */
const MAX_REACH_M = 1000;
/** Corners closer than this are a double-click, not two corners. */
const MIN_EDGE_M = 0.1;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const [[x, z]] = ringToXZMeters([b], a);
  return Math.hypot(x, z);
}

/** Shoelace area of a closed ring, in square feet. */
export function ringAreaSqFt(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const xz = ringToXZMeters(ring, ring[0]);
  let twice = 0;
  for (let i = 0; i < xz.length; i++) {
    const [x1, z1] = xz[i];
    const [x2, z2] = xz[(i + 1) % xz.length];
    twice += x1 * z2 - x2 * z1;
  }
  return (Math.abs(twice) / 2) * SQ_FT_PER_SQ_M;
}

/** A length as a landscaper would say it: 42′ 6″. */
export function formatFeetInches(meters: number): string {
  const totalInches = Math.round(meters * FEET_PER_METER * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return inches === 0 ? `${feet}′` : `${feet}′ ${inches}″`;
}

/**
 * Whether any two non-adjacent edges of a closed ring cross. A bow-tie
 * outline has corners in an order no one can walk, and its area means
 * nothing, so it is refused rather than stored.
 */
export function selfIntersects(ring: LatLng[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  const p = ringToXZMeters(ring, ring[0]);
  const orient = (a: number[], b: number[], c: number[]) =>
    Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Edges sharing a corner always "touch" there; skip those pairs.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const c = p[j];
      const d = p[(j + 1) % n];
      if (
        orient(a, b, c) * orient(a, b, d) < 0 &&
        orient(c, d, a) * orient(c, d, b) < 0
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks one ring from the browser — server-action arguments are whatever
 * the client sent — and drops repeated corners (a double-click lands two
 * on one spot, and a zero-length edge breaks the headset's corner math).
 */
function parseRing(raw: unknown, label: string): LatLng[] {
  if (!Array.isArray(raw)) throw new TraceError(`The ${label} outline is malformed.`);
  if (raw.length > MAX_CORNERS) {
    throw new TraceError(`The ${label} outline has more than ${MAX_CORNERS} corners.`);
  }
  const ring: LatLng[] = [];
  for (const p of raw) {
    const lat = (p as Partial<LatLng> | null)?.lat;
    const lng = (p as Partial<LatLng> | null)?.lng;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new TraceError(`The ${label} outline has a corner that isn't on the map.`);
    }
    const point = { lat, lng };
    if (ring.length === 0 || distanceMeters(ring[ring.length - 1], point) >= MIN_EDGE_M) {
      ring.push(point);
    }
  }
  // The closing edge too: a last corner clicked onto the first.
  while (ring.length > 1 && distanceMeters(ring[ring.length - 1], ring[0]) < MIN_EDGE_M) {
    ring.pop();
  }
  return ring;
}

function toXZ(ring: LatLng[], origin: LatLng): [number, number][] {
  // Millimetres are plenty: the walk itself is good to a few centimetres.
  return ringToXZMeters(ring, origin).map(
    ([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000] as [number, number]
  );
}

/**
 * The traced outline as the project stores it and the headset receives it.
 * Throws TraceError, with a message meant for the designer, when the trace
 * can't be walked.
 */
export function buildTracedBlueprint(address: string, outline: TracedOutline): StoredBlueprint {
  // Display text only, from the browser: kept to a string of sane length.
  const label = typeof address === "string" ? address.trim().slice(0, 300) : "";
  const house = parseRing(outline?.house, "house");
  const boundary = parseRing(outline?.boundary ?? [], "boundary");

  if (house.length < 3) {
    throw new TraceError("Trace the house first — the headset lines up on its corners.");
  }
  if (boundary.length > 0 && boundary.length < 3) {
    throw new TraceError("Finish the yard boundary, or clear it — it needs at least three corners.");
  }

  // Centred on the boundary when there is one, as the county lot was: the
  // origin is arbitrary to the headset (the corner walk solves for it), but
  // keeping the lot's centre keeps old and new payloads alike.
  const centroid = ringCentroid(boundary.length > 0 ? boundary : house);
  const houseXZ = toXZ(house, centroid);
  const parcelXZ = toXZ(boundary, centroid);
  // Before the crossing check: a stray corner usually crosses something
  // too, and "far from the rest" is the message that finds it.
  if ([...houseXZ, ...parcelXZ].some(([x, z]) => Math.hypot(x, z) > MAX_REACH_M)) {
    throw new TraceError("A corner landed far from the rest of the outline. Check for a stray click.");
  }
  if (selfIntersects(house)) {
    throw new TraceError("The house outline crosses itself. Drag the corners so the edges don't cross.");
  }
  if (boundary.length > 0 && selfIntersects(boundary)) {
    throw new TraceError("The yard boundary crosses itself. Drag the corners so the edges don't cross.");
  }

  return {
    version: 1,
    provider: TRACE_PROVIDER,
    lookupAddress: label,
    candidate: {
      // No parcel number: nothing was looked up. The headset only ever
      // displays it, and an empty one reads as absent there.
      apn: "",
      address: label,
      centroid,
      parcelXZ,
      // Required by the headset's decoder; a trace knows no county facts.
      attributes: {},
      houseXZ,
      houseAreaSqFt: Math.round(ringAreaSqFt(house)),
      imagery: null,
      warnings: [],
    },
  };
}

/**
 * A stored outline back as lat/lng rings, to reopen it on the trace map.
 * Works for outlines from the old county pipeline too — those become
 * editable like any trace.
 */
export function tracedOutlineFrom(stored: StoredBlueprint): TracedOutline {
  const c = stored.candidate;
  const house = c.houseXZ ?? [];
  return {
    house: house.length >= 3 ? xzMetersToRing(house, c.centroid) : [],
    boundary: c.parcelXZ.length >= 3 ? xzMetersToRing(c.parcelXZ, c.centroid) : [],
  };
}
