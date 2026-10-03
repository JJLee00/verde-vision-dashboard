import { NextResponse, type NextRequest } from "next/server";
import {
  BlueprintLookupError,
  enrichCandidate,
  findCandidates,
} from "@/lib/blueprint/lookup";

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

// The lookup itself lives in @/lib/blueprint/lookup, shared with the project
// page's House outline card — the normal path, run at a desk. This route is
// the headset's backup for a project nobody looked up beforehand.

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

  try {
    const list = await findCandidates(address);
    const apn = request.nextUrl.searchParams.get("apn")?.trim();
    if (!apn) return NextResponse.json(list);

    const includeImagery = request.nextUrl.searchParams.get("imagery") === "1";
    const candidate = await enrichCandidate(list, apn, { includeImagery });
    return NextResponse.json({ provider: list.provider, candidates: [candidate] });
  } catch (err) {
    if (err instanceof BlueprintLookupError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
