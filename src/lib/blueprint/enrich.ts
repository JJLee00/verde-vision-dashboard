// Parcel → full blueprint candidate: house footprint, imagery, warnings.
//
// The parcel provider gives a boundary and physical attributes. This module
// adds the piece designers actually care about — the HOUSE — by reading the
// Solar building mask, and it attaches the caveats that keep the result
// honest.
//
// Scope is deliberately house + boundary. Hardscape is never auto-imported:
// aerial imagery in this market runs years behind (Cave Creek: Oct 2013),
// and hardscape is exactly what changes. Houses are what don't.

import { extractFootprint } from "./footprint";
import { ringToXZMeters } from "./normalize";
import { decodeMask, decodeOrtho, fetchDataLayers, fetchLayerTiff } from "./solar";
import type { ImageryQuality } from "./solar";
import type { LatLng, ParcelRecord } from "./types";
import { utmToWgs84, wgs84ToUtm } from "./utm";

export interface BlueprintWarning {
  code:
    | "imagery-stale"
    | "construction-after-imagery"
    | "footprint-area-mismatch"
    | "footprint-unavailable";
  message: string;
}

export interface ImageryInfo {
  /** ISO capture date — MUST be shown wherever this imagery is rendered. */
  captureDate: string;
  quality: ImageryQuality;
  /** Base64 JPEG of the ortho tile, present only when imagery was requested. */
  orthoJpegBase64?: string;
  /**
   * Where the ortho sits in the app's geo frame (metres from the parcel
   * centroid, x = east, z = south), so the align map can draw parcel and
   * house polygons over it without knowing anything about projections.
   */
  orthoExtentXZ?: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export interface EnrichedParcel {
  /** House outline in geo-frame metres, or null when extraction failed. */
  houseXZ: [number, number][] | null;
  /** Roofed area of the extracted blob, for cross-checking. */
  houseAreaSqFt: number | null;
  imagery: ImageryInfo | null;
  warnings: BlueprintWarning[];
}

/** Imagery older than this is called out to the designer. */
const STALE_AFTER_YEARS = 3;

/**
 * Roofed area (mask) vs. the assessor's livable area. The mask includes
 * garage, covered patios and eaves, so it legitimately exceeds livable area
 * — on the Aug 2026 test parcel, 8306 sq ft of mask against 3870 livable
 * and 7571 total roofed on the sketch. These bounds flag a grab that is
 * obviously the wrong blob (a neighbour's roof, or a shed), not ordinary
 * overhang.
 */
const AREA_RATIO_MIN = 0.8;
const AREA_RATIO_MAX = 4.0;

function yearsBetween(iso: string, now: Date): number | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return (now.getTime() - parsed) / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Builds the warning list from what we can actually check.
 *
 * Note on what is NOT here: comparing the assessor's `pool` flag against the
 * imagery would be the sharpest staleness signal we have — the test parcel
 * records a pool that its 2013 tile does not show — but detecting water in
 * an aerial tile reliably is a real computer-vision problem, and a
 * false "your records disagree" is worse than no warning. Age and
 * construction year are exact, so those are what we ship.
 */
export function buildWarnings(
  record: ParcelRecord,
  imagery: { captureDate: string } | null,
  footprintAreaSqFt: number | null,
  now: Date = new Date()
): BlueprintWarning[] {
  const warnings: BlueprintWarning[] = [];

  if (imagery) {
    const age = yearsBetween(imagery.captureDate, now);
    if (age !== null && age > STALE_AFTER_YEARS) {
      warnings.push({
        code: "imagery-stale",
        message:
          `Aerial imagery is from ${imagery.captureDate} (about ${Math.round(age)} years old). ` +
          `The house outline is still reliable, but landscaping, pools and hardscape may have changed.`,
      });
    }

    const built = record.attributes.constructionYear;
    const imageryYear = Number(imagery.captureDate.slice(0, 4));
    if (built && Number.isFinite(imageryYear) && built > imageryYear) {
      warnings.push({
        code: "construction-after-imagery",
        message:
          `County records date construction to ${built}, after this imagery was captured (${imagery.captureDate}). ` +
          `The building outline may not match what is on site.`,
      });
    }
  }

  if (footprintAreaSqFt === null) {
    warnings.push({
      code: "footprint-unavailable",
      message:
        "No building footprint could be extracted for this parcel. The boundary is still usable; mark the house by hand.",
    });
  } else {
    const livable = record.attributes.livableAreaSqFt;
    if (livable && livable > 0) {
      const ratio = footprintAreaSqFt / livable;
      if (ratio < AREA_RATIO_MIN || ratio > AREA_RATIO_MAX) {
        warnings.push({
          code: "footprint-area-mismatch",
          message:
            `Extracted roof area (${Math.round(footprintAreaSqFt)} sq ft) looks wrong against county records ` +
            `(${Math.round(livable)} sq ft livable). Check the outline before aligning.`,
        });
      }
    }
  }

  return warnings;
}

/**
 * Fetches imagery for a parcel and extracts its house footprint.
 *
 * Failures here are NOT fatal: a parcel boundary alone is still a useful
 * draft blueprint, and the designer can mark the house by hand. Everything
 * that went wrong comes back as a warning rather than an exception.
 */
export async function enrichParcel(
  record: ParcelRecord,
  centroid: LatLng,
  { includeImagery = false, apiKey }: { includeImagery?: boolean; apiKey?: string } = {}
): Promise<EnrichedParcel> {
  let houseXZ: [number, number][] | null = null;
  let houseAreaSqFt: number | null = null;
  let imagery: ImageryInfo | null = null;

  try {
    const layers = await fetchDataLayers(centroid.lat, centroid.lng, { apiKey });
    imagery = { captureDate: layers.imageryDate, quality: layers.imageryQuality };

    const maskBuffer = await fetchLayerTiff(layers.maskUrl, apiKey);
    const { mask, grid, zone, northernHemisphere } = await decodeMask(maskBuffer);

    // Parcel ring → the tile's own pixel grid, so mask and parcel are
    // finally in one coordinate system.
    const parcelPx: [number, number][] = record.ring.map((p) => {
      const u = wgs84ToUtm(p.lat, p.lng, zone);
      return [(u.easting - grid.originX) / grid.scale, (grid.originY - u.northing) / grid.scale];
    });

    const footprint = extractFootprint(mask, grid, parcelPx);
    if (footprint) {
      // Pixels → UTM → WGS84 → the app's geo frame, reusing the SAME
      // projection the parcel goes through so both land in one frame.
      const houseRing: LatLng[] = footprint.ringPx.map(([col, row]) =>
        utmToWgs84({
          easting: grid.originX + col * grid.scale,
          northing: grid.originY - row * grid.scale,
          zone,
          northernHemisphere,
        })
      );
      houseXZ = ringToXZMeters(houseRing, centroid);
      houseAreaSqFt = footprint.areaSqFt;
    }

    if (includeImagery) {
      const rgbBuffer = await fetchLayerTiff(layers.rgbUrl, apiKey);
      const ortho = await decodeOrtho(rgbBuffer);
      const corners: LatLng[] = [
        utmToWgs84({ easting: ortho.grid.originX, northing: ortho.grid.originY, zone: ortho.zone, northernHemisphere: ortho.northernHemisphere }),
        utmToWgs84({
          easting: ortho.grid.originX + ortho.width * ortho.grid.scale,
          northing: ortho.grid.originY - ortho.height * ortho.grid.scale,
          zone: ortho.zone,
          northernHemisphere: ortho.northernHemisphere,
        }),
      ];
      const [topLeft, bottomRight] = ringToXZMeters(corners, centroid);
      imagery = {
        ...imagery,
        orthoJpegBase64: ortho.jpeg.toString("base64"),
        orthoExtentXZ: {
          minX: topLeft[0],
          minZ: topLeft[1],
          maxX: bottomRight[0],
          maxZ: bottomRight[1],
        },
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Imagery unavailable";
    return {
      houseXZ: null,
      houseAreaSqFt: null,
      imagery,
      warnings: [
        ...buildWarnings(record, imagery, null),
        { code: "footprint-unavailable", message },
      ],
    };
  }

  return {
    houseXZ,
    houseAreaSqFt,
    imagery,
    warnings: buildWarnings(record, imagery, houseAreaSqFt),
  };
}
