// Maricopa County parcel provider — free, keyless ArcGIS REST endpoint.
// Verified live July 2026 (see the app repo's Auto Blueprint plan §3.1).

import type { LatLng, ParcelProvider, ParcelRecord } from "./types";

const QUERY_URL =
  "https://gis.maricopa.gov/arcgis/rest/services/Reference/ParcelCityCounty/MapServer/0/query";

// Only these fields ever leave the county server. The layer also carries
// owner names, mailing addresses, and sale prices — do not add fields
// without checking the privacy note in the Auto Blueprint plan.
const OUT_FIELDS = [
  "APN",
  "PropertyFullStreetAddress",
  "LotSize_SqFt",
  "LivableArea_SqFt",
  "Pool",
  "Patios",
  "CoveredParkingSpots",
  "ConstructionYear",
].join(",");

// County addresses use USPS abbreviations ("26007 N RIO LN"); designers
// type whatever their client wrote. Map the common long forms down.
const SUFFIX_MAP: Record<string, string> = {
  LANE: "LN",
  DRIVE: "DR",
  ROAD: "RD",
  STREET: "ST",
  COURT: "CT",
  CIRCLE: "CIR",
  PLACE: "PL",
  BOULEVARD: "BLVD",
  AVENUE: "AVE",
  TRAIL: "TRL",
  PARKWAY: "PKWY",
  HIGHWAY: "HWY",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
};

/** "26007 N. Rio Lane, Rio Verde, AZ" → "26007 N RIO LN" */
export function normalizeStreetAddress(input: string): string {
  const streetPart = input.split(",")[0] ?? "";
  return streetPart
    .toUpperCase()
    .replace(/\./g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => SUFFIX_MAP[word] ?? word)
    .join(" ");
}

interface ArcGisFeature {
  attributes: Record<string, unknown>;
  geometry?: { rings?: [number, number][][] };
}

function toRecord(feature: ArcGisFeature): ParcelRecord | null {
  const attrs = feature.attributes;
  // rings[0] is the outer boundary; ArcGIS closes rings (last === first).
  const rawRing = feature.geometry?.rings?.[0];
  if (!rawRing || rawRing.length < 4) return null;

  const ring: LatLng[] = rawRing.map(([lng, lat]) => ({ lat, lng }));
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.lat === last.lat && first.lng === last.lng) ring.pop();

  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const poolRaw = attrs["Pool"];

  return {
    apn: String(attrs["APN"] ?? ""),
    address: String(attrs["PropertyFullStreetAddress"] ?? ""),
    ring,
    attributes: {
      lotSizeSqFt: num(attrs["LotSize_SqFt"]),
      livableAreaSqFt: num(attrs["LivableArea_SqFt"]),
      pool:
        poolRaw == null
          ? undefined
          : !["", "NO", "NONE", "0"].includes(String(poolRaw).toUpperCase()),
      patios: num(attrs["Patios"]),
      coveredParkingSpots: num(attrs["CoveredParkingSpots"]),
      constructionYear: num(attrs["ConstructionYear"]),
    },
  };
}

export const maricopaProvider: ParcelProvider = {
  name: "maricopa",

  async findByAddress(address: string): Promise<ParcelRecord[]> {
    const normalized = normalizeStreetAddress(address);
    if (!normalized) return [];

    // ArcGIS WHERE clauses take SQL string literals — double any quotes.
    const literal = normalized.replace(/'/g, "''");
    const params = new URLSearchParams({
      where: `UPPER(PropertyFullStreetAddress) LIKE '${literal}%'`,
      outFields: OUT_FIELDS,
      returnGeometry: "true",
      outSR: "4326",
      resultRecordCount: "10",
      f: "json",
    });

    const res = await fetch(`${QUERY_URL}?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Maricopa GIS responded ${res.status}`);
    }
    const body = (await res.json()) as {
      error?: { message?: string };
      features?: ArcGisFeature[];
    };
    if (body.error) {
      throw new Error(`Maricopa GIS error: ${body.error.message ?? "unknown"}`);
    }

    return (body.features ?? [])
      .map(toRecord)
      .filter((r): r is ParcelRecord => r !== null);
  },
};
