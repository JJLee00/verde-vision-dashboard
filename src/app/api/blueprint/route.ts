import { NextResponse, type NextRequest } from "next/server";
import { maricopaProvider, normalizeStreetAddress } from "@/lib/blueprint/maricopa";
import { ringCentroid, ringToXZMeters } from "@/lib/blueprint/normalize";
import type { BlueprintCandidate, ParcelProvider } from "@/lib/blueprint/types";

/**
 * Auto Blueprint fetch for the Verde Vision Pro app.
 *
 * GET /api/blueprint?address=26007%20N%20Rio%20Ln
 * Header: `x-api-key: <VISION_PRO_API_KEY>` (same key as /api/vision-pro)
 *
 * Response: { provider, candidates: BlueprintCandidate[] } — one candidate
 * per matching parcel (several parcels can share a street address; the app
 * shows a thumbnail per candidate so the designer confirms the right lot).
 * Geometry is meters in the app's XZ ground frame, origin at the parcel
 * centroid. Owner/sale PII never enters this response by construction —
 * providers only request physical fields.
 */

// Today everything ships from Maricopa's free endpoint. When we expand,
// this becomes a lookup (geocode → county → provider) — the app never
// knows which provider answered.
const provider: ParcelProvider = maricopaProvider;

// Parcel data changes on assessor timescales — cache generously. Module
// scope = per server instance, best effort; that's fine for our volume.
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
    return NextResponse.json(hit.body);
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

  return NextResponse.json(body);
}
