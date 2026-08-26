import { NextResponse, type NextRequest } from "next/server";
import { maricopaProvider, normalizeStreetAddress } from "@/lib/blueprint/maricopa";
import { enrichParcel } from "@/lib/blueprint/enrich";
import { ringCentroid, ringToXZMeters } from "@/lib/blueprint/normalize";
import type { BlueprintCandidate, ParcelProvider } from "@/lib/blueprint/types";

/**
 * Auto Blueprint fetch for the Verde Vision Pro app.
 *
 * Two steps, because the second one is expensive:
 *
 *   1. GET /api/blueprint?address=26007%20N%20Rio%20Ln
 *      Parcel candidates only — fast, cached. Several parcels can share a
 *      street address, so the caller picks the right lot from this list.
 *
 *   2. GET /api/blueprint?address=...&apn=21650162A[&imagery=1]
 *      The confirmed parcel, ENRICHED: house footprint extracted from the
 *      Solar building mask, imagery capture date, and warnings. Add
 *      `imagery=1` to embed the ortho tile as base64 JPEG (~500 KB) so the
 *      headset can render the align map with no connectivity at the
 *      property — the whole reason this fetch happens at the desk.
 *
 * Header: `x-api-key: <VISION_PRO_API_KEY>` (same key as /api/vision-pro)
 *
 * Geometry is meters in the app's XZ ground frame, origin at the parcel
 * centroid. Owner/sale PII never enters this response by construction —
 * providers only request physical fields.
 */

// Enrichment downloads and decodes two GeoTIFFs; measured at ~8 s with
// imagery on a real parcel, which overruns the common 10 s serverless
// default uncomfortably.
export const maxDuration = 60;

// Today everything ships from Maricopa's free endpoint. When we expand,
// this becomes a lookup (geocode → county → provider) — the app never
// knows which provider answered.
const provider: ParcelProvider = maricopaProvider;

// Parcel data changes on assessor timescales — cache generously. Module
// scope = per server instance, best effort; that's fine for our volume.
// Only the parcel-candidate list is cached: enriched responses carry a
// ~500 KB ortho each, and holding 500 of those would be half a gigabyte.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { expires: number; body: ResponseBody }>();

interface ResponseBody {
  provider: string;
  candidates: BlueprintCandidate[];
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey || apiKey !== process.env.VISION_PRO_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json(
      { error: "Missing ?address= query parameter" },
      { status: 400 }
    );
  }

  const cacheKey = normalizeStreetAddress(address);
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    // Through respond(), not straight out: a cached candidate list must
    // still be enrichable, or ?apn= would silently return an un-enriched
    // parcel for any address someone had already looked up.
    return respond(hit.body, request);
  }

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
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: `No parcel found for "${address}"` },
      { status: 404 }
    );
  }

  const body: ResponseBody = { provider: provider.name, candidates };
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, body });

  return respond(body, request);
}

/**
 * Serves the candidate list, or — when the caller has named an APN —
 * enriches just that parcel with its house footprint and imagery.
 *
 * Enrichment is per-APN rather than automatic so the "which lot is it?"
 * picker stays a fast, cacheable call: enriching every candidate of an
 * ambiguous address would mean several imagery fetches to show a list the
 * designer is about to narrow to one anyway.
 */
async function respond(body: ResponseBody, request: NextRequest) {
  const apn = request.nextUrl.searchParams.get("apn")?.trim();
  if (!apn) return NextResponse.json(body);

  const candidate = body.candidates.find((c) => c.apn === apn);
  if (!candidate) {
    return NextResponse.json(
      { error: `No candidate with APN "${apn}" for this address` },
      { status: 404 }
    );
  }

  const includeImagery = request.nextUrl.searchParams.get("imagery") === "1";
  const records = await provider.findByAddress(candidate.address);
  const record = records.find((r) => r.apn === apn);
  if (!record) {
    return NextResponse.json({ error: `Parcel ${apn} vanished mid-request` }, { status: 502 });
  }

  const enriched = await enrichParcel(record, candidate.centroid, { includeImagery });
  return NextResponse.json({
    provider: body.provider,
    candidates: [
      {
        ...candidate,
        houseXZ: enriched.houseXZ,
        houseAreaSqFt: enriched.houseAreaSqFt,
        imagery: enriched.imagery,
        warnings: enriched.warnings,
      },
    ],
  });
}
