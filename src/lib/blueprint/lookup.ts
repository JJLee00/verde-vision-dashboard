// Address → parcel candidates → one enriched parcel.
//
// LEGACY (Oct 2026): outlines are now traced by hand on the project page
// (trace.ts), which works at any address; this county + Solar pipeline only
// ever covered Maricopa. It stays for the /api/blueprint route, which
// headset builds from before the change still call from their in-app
// lookup. Once those are gone, so can this be.

import { maricopaProvider, normalizeStreetAddress } from "./maricopa";
import { enrichParcel } from "./enrich";
import { ringCentroid, ringToXZMeters } from "./normalize";
import type { BlueprintCandidate, ParcelProvider } from "./types";

// Today everything ships from Maricopa's free endpoint. When we expand,
// this becomes a lookup (geocode → county → provider) — callers never know
// which provider answered.
const provider: ParcelProvider = maricopaProvider;

/** A lookup that failed in a way the caller should report, with its HTTP status. */
export class BlueprintLookupError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export interface CandidateList {
  provider: string;
  candidates: BlueprintCandidate[];
}

// Parcel data changes on assessor timescales — cache generously. Module
// scope = per server instance, best effort; that's fine for our volume.
// Only the parcel-candidate list is cached: enriched responses carry a
// ~500 KB ortho each, and holding 500 of those would be half a gigabyte.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { expires: number; body: CandidateList }>();

/**
 * Every parcel matching a street address. Several can share one, so the
 * caller confirms which lot. Fast, cached, no imagery.
 */
export async function findCandidates(address: string): Promise<CandidateList> {
  const cacheKey = normalizeStreetAddress(address);
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.body;

  let candidates: BlueprintCandidate[];
  try {
    const records = await provider.findByAddress(address);
    candidates = records.map((record) => {
      const centroid = ringCentroid(record.ring);
      return {
        apn: record.apn,
        address: record.address,
        centroid,
        parcelXZ: ringToXZMeters(record.ring, centroid),
        attributes: record.attributes,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parcel lookup failed";
    throw new BlueprintLookupError(message, 502);
  }

  if (candidates.length === 0) {
    throw new BlueprintLookupError(`No parcel found for "${address}"`, 404);
  }

  const body: CandidateList = { provider: provider.name, candidates };
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, body });
  return body;
}

/**
 * One confirmed parcel, ENRICHED: house footprint extracted from the Solar
 * building mask, imagery capture date, warnings — and, with `includeImagery`,
 * the ortho tile as base64 JPEG (~500 KB).
 *
 * Enrichment is per-APN rather than automatic so the "which lot is it?"
 * picker stays a fast, cacheable call: enriching every candidate of an
 * ambiguous address would mean several imagery fetches to show a list the
 * designer is about to narrow to one anyway.
 */
export async function enrichCandidate(
  list: CandidateList,
  apn: string,
  { includeImagery }: { includeImagery: boolean }
): Promise<BlueprintCandidate> {
  const candidate = list.candidates.find((c) => c.apn === apn);
  if (!candidate) {
    throw new BlueprintLookupError(`No candidate with APN "${apn}" for this address`, 404);
  }

  const records = await provider.findByAddress(candidate.address);
  const record = records.find((r) => r.apn === apn);
  if (!record) {
    throw new BlueprintLookupError(`Parcel ${apn} vanished mid-request`, 502);
  }

  const enriched = await enrichParcel(record, candidate.centroid, { includeImagery });
  return {
    ...candidate,
    houseXZ: enriched.houseXZ,
    houseAreaSqFt: enriched.houseAreaSqFt,
    imagery: enriched.imagery,
    warnings: enriched.warnings,
  };
}
