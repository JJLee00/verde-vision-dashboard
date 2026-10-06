// The aerial a house is traced on, and the geocoder that centres it on the
// project's address — both Esri.
//
// Not Google: Google Maps Platform's terms (3.2.3(c), "No Creating Content
// From Google Maps Content") give tracing "building outlines" from its
// satellite map as their example of what is forbidden. Esri's World Imagery
// licence says the layer may be used "to support data collection and
// editing, with the results used internally or shared with others" — which
// is exactly the House outline card.
//
// With NEXT_PUBLIC_ARCGIS_API_KEY set (an ArcGIS Location Platform key —
// it is a browser key by design, restrict it by referrer) both go through
// Esri's keyed hosts. Without one they fall back to the public hosts, which
// answered keylessly in Oct 2026: fine for development, but production
// should carry a key, since the account is what the licence attaches to.

import type { LatLng } from "./types";

const apiKey = process.env.NEXT_PUBLIC_ARCGIS_API_KEY?.trim() || null;

// Same MapServer, same tiling — the keyed host only adds the token.
export const IMAGERY_TILE_URL = apiKey
  ? `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(apiKey)}`
  : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/**
 * The deepest zoom with imagery everywhere we've checked. Deeper tiles exist
 * in some cities (Irvine) and are a grey "Map data not yet available" in
 * others (Rio Verde, Oct 2026), so the map upsamples this level instead of
 * asking for them. ~25 cm a pixel at Phoenix's latitude.
 */
export const IMAGERY_MAX_NATIVE_ZOOM = 19;

// Esri requires both the "Powered by Esri" credit and the imagery sources.
export const IMAGERY_ATTRIBUTION =
  'Powered by <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a> · Esri, Vantor, Earthstar Geographics, and the GIS User Community';

const GEOCODE_URL = apiKey
  ? "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates"
  : "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";

export interface GeocodeHit extends LatLng {
  /** Esri's own rendering of what it matched — shown when the match is loose. */
  label: string;
  /** 0–100. An exact rooftop match is 100; a street with no number is ~87. */
  score: number;
}

/**
 * Where an address is, to point the map at it. Nothing about the result is
 * kept — `forStorage=false` is the free, display-only use — because what the
 * project stores is the outline the designer traces, not this point.
 */
export async function geocodeAddress(
  address: string,
  signal?: AbortSignal
): Promise<GeocodeHit | null> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("SingleLine", address);
  url.searchParams.set("maxLocations", "1");
  url.searchParams.set("countryCode", "USA");
  url.searchParams.set("forStorage", "false");
  url.searchParams.set("f", "json");
  if (apiKey) url.searchParams.set("token", apiKey);

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Address search failed (${res.status})`);
  const body = (await res.json()) as {
    candidates?: { address: string; score: number; location: { x: number; y: number } }[];
    error?: { message?: string };
  };
  if (body.error) throw new Error(body.error.message ?? "Address search failed");
  const best = body.candidates?.[0];
  if (!best) return null;
  return {
    lat: best.location.y,
    lng: best.location.x,
    label: best.address,
    score: best.score,
  };
}
