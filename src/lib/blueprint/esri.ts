// The maps a house is traced on, and the address search that finds it —
// all Esri.
//
// Not Google: Google Maps Platform's terms (3.2.3(c), "No Creating Content
// From Google Maps Content") give tracing "building outlines" from its
// satellite map as their example of what is forbidden. Esri's World Imagery
// licence says the layer may be used "to support data collection and
// editing, with the results used internally or shared with others" — which
// is exactly the House outline card.
//
// The second base map, World Topographic, draws house footprints as clean
// grey shapes (and lot lines where a county has contributed them), which
// reads far better than a roof under trees. Its licence is the general Esri
// Master License Agreement with no explicit data-collection clause, and its
// sources include OpenStreetMap — so the satellite stays the default base,
// and Map is a view to check corners against. Worth confirming with Esri
// when the account is set up.
//
// Lot lines come from Regrid — Esri's parcel-data partner — as a free,
// nationwide tile layer it publishes on ArcGIS. It is a picture of the
// lines, not the lots themselves, so it guides a hand-traced boundary; at
// 6619 E Ashler Hills it matched Maricopa County's own lot line on all four
// sides (Oct 2026). Its terms are Regrid's data licence, which doesn't say
// whether it may be shown outside ArcGIS or traced from: off by default,
// and worth confirming with Regrid.
//
// With NEXT_PUBLIC_ARCGIS_API_KEY set (an ArcGIS Location Platform key —
// it is a browser key by design, restrict it by referrer) everything goes
// through Esri's keyed hosts. Without one it falls back to the public
// hosts, which answered keylessly in Oct 2026: fine for development, but
// production should carry a key, since the account is what the licence
// attaches to.

import type { LatLng } from "./types";

const apiKey = process.env.NEXT_PUBLIC_ARCGIS_API_KEY?.trim() || null;
const token = apiKey ? `?token=${encodeURIComponent(apiKey)}` : "";

// Same MapServers, same tiling — the keyed host only adds the token.
const tileUrl = (service: string) =>
  apiKey
    ? `https://ibasemaps-api.arcgis.com/arcgis/rest/services/${service}/MapServer/tile/{z}/{y}/{x}${token}`
    : `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;

const POWERED_BY =
  'Powered by <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>';

export type Basemap = "satellite" | "map";

export const BASEMAPS: Record<Basemap, { label: string; url: string; attribution: string }> = {
  satellite: {
    label: "Satellite",
    url: tileUrl("World_Imagery"),
    // Esri requires both the "Powered by Esri" credit and the sources.
    attribution: `${POWERED_BY} · Esri, Vantor, Earthstar Geographics, and the GIS User Community`,
  },
  map: {
    label: "Map",
    url: tileUrl("World_Topo_Map"),
    attribution:
      `${POWERED_BY} · Sources: Esri, HERE, Garmin, Intermap, increment P Corp., GEBCO, USGS, ` +
      "FAO, NPS, NRCAN, GeoBase, IGN, Kadaster NL, Ordnance Survey, Esri Japan, METI, " +
      "Esri China (Hong Kong), (c) OpenStreetMap contributors, and the GIS User Community",
  },
};

export const LOT_LINES = {
  url:
    "https://tiles.arcgis.com/tiles/KzeiCaQsMoeCfoCq/arcgis/rest/services/" +
    "Regrid_Nationwide_Parcel_Boundaries_v1/MapServer/tile/{z}/{y}/{x}",
  attribution: 'Lot lines © <a href="https://regrid.com" target="_blank" rel="noreferrer">Regrid</a>',
  // The service only has these three levels (14 and 18 are 404s); closer in
  // the map stretches 17, and further out the lines are a blur anyway.
  minNativeZoom: 15,
  maxNativeZoom: 17,
};

/**
 * The deepest zoom with tiles everywhere we've checked. Deeper imagery
 * exists in some cities (Irvine) and is a grey "Map data not yet available"
 * in others (Rio Verde, Oct 2026), so the map upsamples this level instead
 * of asking for it. ~25 cm a pixel at Phoenix's latitude.
 */
export const MAX_NATIVE_ZOOM = 19;

const GEOCODE_ROOT = apiKey
  ? "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer"
  : "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

export interface GeocodeHit extends LatLng {
  /** Esri's own rendering of what it matched. */
  label: string;
  /** 0–100. An exact rooftop match is 100; a street with no number is ~87. */
  score: number;
}

export interface AddressSuggestion {
  text: string;
  /** Esri's handle for this exact suggestion — makes the lookup unambiguous. */
  magicKey: string;
}

async function esriGet<T>(path: string, params: Record<string, string>, signal?: AbortSignal) {
  const url = new URL(`${GEOCODE_ROOT}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("f", "json");
  if (apiKey) url.searchParams.set("token", apiKey);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Address search failed (${res.status})`);
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "Address search failed");
  return body;
}

/** Addresses that start like `text`, for the search box's dropdown. */
export async function suggestAddresses(
  text: string,
  signal?: AbortSignal
): Promise<AddressSuggestion[]> {
  const body = await esriGet<{ suggestions?: (AddressSuggestion & { isCollection: boolean })[] }>(
    "suggest",
    // Addresses only: a business or a city is never the yard.
    { text, maxSuggestions: "5", category: "Address,Postal", countryCode: "USA" },
    signal
  );
  return (body.suggestions ?? [])
    .filter((s) => !s.isCollection)
    .map(({ text, magicKey }) => ({ text, magicKey }));
}

/**
 * Where an address is, to point the map at it. Nothing about the result is
 * kept — `forStorage=false` is the free, display-only use — because what the
 * project stores is the outline the designer traces, not this point.
 */
export async function geocodeAddress(
  address: string,
  { magicKey, signal }: { magicKey?: string; signal?: AbortSignal } = {}
): Promise<GeocodeHit | null> {
  const body = await esriGet<{
    candidates?: { address: string; score: number; location: { x: number; y: number } }[];
  }>(
    "findAddressCandidates",
    {
      SingleLine: address,
      maxLocations: "1",
      countryCode: "USA",
      forStorage: "false",
      ...(magicKey ? { magicKey } : {}),
    },
    signal
  );
  const best = body.candidates?.[0];
  if (!best) return null;
  return {
    lat: best.location.y,
    lng: best.location.x,
    label: best.address,
    score: best.score,
  };
}

export interface PlaceAddress {
  /** The street line, e.g. "6619 E Ashler Hills Dr". */
  street: string;
  /** Just the house number, e.g. "6619". */
  number: string;
  /** The full line, with city, state and ZIP. */
  label: string;
}

/**
 * The street address at a point — what the designer has actually traced,
 * as opposed to what they searched for. Point addresses only (a house's own
 * address point, not one interpolated along the street), so a neighbour's
 * roof answers with the neighbour's number. Display-only, like the search:
 * nothing about the answer is stored.
 */
export async function reverseGeocode(
  point: LatLng,
  signal?: AbortSignal
): Promise<PlaceAddress | null> {
  let body;
  try {
    body = await esriGet<{
      address?: { Address?: string; AddNum?: string; Match_addr?: string };
    }>(
      "reverseGeocode",
      {
        location: `${point.lng},${point.lat}`,
        featureTypes: "PointAddress",
        forStorage: "false",
      },
      signal
    );
  } catch (err) {
    // "Unable to find address for the specified location" arrives as an
    // error body; it means there's no address point nearby, not a failure.
    if (err instanceof Error && /find address|invalid query/i.test(err.message)) return null;
    throw err;
  }
  const a = body.address;
  if (!a?.Address || !a.AddNum) return null;
  return { street: a.Address, number: a.AddNum, label: a.Match_addr ?? a.Address };
}
