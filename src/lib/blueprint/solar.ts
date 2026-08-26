// Google Solar API client — aerial imagery, building mask, capture date.
//
// The Solar API's `dataLayers` endpoint is our imagery source: for a lat/lng
// it returns georeferenced GeoTIFFs (RGB ortho, per-pixel building mask,
// and a DSM we don't use yet). It is billed per call with a free tier that
// dwarfs our volume — one call per project.
//
// THE KEY MUST STAY SERVER-SIDE. That is the whole reason blueprint fetching
// lives in the dashboard rather than the headset, and why the ortho reaches
// the app as image BYTES rather than a signed URL: a URL would either expose
// the key or expire before the designer reaches the property.
//
// --- Imagery is often OLD, and that is a product fact, not a bug ----------
//
// `imageryDate` is not decoration. Measured across our market: Phoenix and
// Scottsdale ~2023, Rio Verde 2022, and both Fountain Hills and Cave Creek
// are HIGH quality but October 2013. A decade-old tile still shows the house
// correctly (houses don't move) while showing a yard that no longer exists.
// Every surface that renders this imagery must show its date, and callers
// must pass the date through rather than dropping it.

import { fromArrayBuffer, type GeoTIFFImage } from "geotiff";
import type { MaskRaster, PixelGrid } from "./footprint";

export type ImageryQuality = "HIGH" | "MEDIUM" | "LOW";

export interface DataLayersResponse {
  rgbUrl: string;
  maskUrl: string;
  dsmUrl?: string;
  imageryQuality: ImageryQuality;
  /** ISO yyyy-mm-dd of the aerial capture — surface this to designers. */
  imageryDate: string;
}

interface SolarDate {
  year: number;
  month: number;
  day: number;
}

const SOLAR_ENDPOINT = "https://solar.googleapis.com/v1/dataLayers:get";

function isoDate(d: SolarDate | undefined): string {
  if (!d) return "unknown";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/**
 * Asks the Solar API which layers exist for a location.
 *
 * `radiusMeters` sizes the tile: 70 m comfortably covers a suburban lot and
 * its neighbours (needed — the mask must be clipped to the parcel precisely
 * because neighbouring roofs land in frame).
 */
export async function fetchDataLayers(
  lat: number,
  lng: number,
  { radiusMeters = 70, apiKey = process.env.GOOGLE_SOLAR_API_KEY }: { radiusMeters?: number; apiKey?: string } = {}
): Promise<DataLayersResponse> {
  if (!apiKey) throw new Error("GOOGLE_SOLAR_API_KEY is not configured");

  const url = new URL(SOLAR_ENDPOINT);
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("radiusMeters", String(radiusMeters));
  url.searchParams.set("view", "IMAGERY_LAYERS");
  // LOW accepts anything available; we report the quality we actually got
  // rather than refusing coverage a designer could still use.
  url.searchParams.set("requiredQuality", "LOW");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) {
    const message = body?.error?.message ?? `Solar API ${response.status}`;
    throw new Error(`Solar dataLayers failed: ${message}`);
  }
  if (!body.rgbUrl || !body.maskUrl) {
    throw new Error("Solar dataLayers returned no imagery for this location");
  }

  return {
    rgbUrl: body.rgbUrl,
    maskUrl: body.maskUrl,
    dsmUrl: body.dsmUrl,
    imageryQuality: (body.imageryQuality ?? "LOW") as ImageryQuality,
    imageryDate: isoDate(body.imageryDate),
  };
}

/** Downloads one layer GeoTIFF (the URLs need the key appended). */
export async function fetchLayerTiff(
  layerUrl: string,
  apiKey = process.env.GOOGLE_SOLAR_API_KEY
): Promise<ArrayBuffer> {
  if (!apiKey) throw new Error("GOOGLE_SOLAR_API_KEY is not configured");
  const url = `${layerUrl}${layerUrl.includes("?") ? "&" : "?"}key=${apiKey}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Solar layer download failed: ${response.status}`);
  return response.arrayBuffer();
}

/**
 * Reads the pixel → projected-metre mapping out of a GeoTIFF.
 *
 * Solar tiles georeference via a ModelTransformation (tag 34264) rather than
 * the more common tie-point + pixel-scale pair. Read it through the library's
 * getOrigin/getResolution accessors rather than the raw file directory:
 * those normalise BOTH encodings, and geotiff v3 resolves directory tags
 * lazily, so the raw tag names are not reliably present on the object.
 */
export function gridFromImage(image: GeoTIFFImage): PixelGrid {
  const [originX, originY] = image.getOrigin();
  const [scaleX] = image.getResolution();
  if (!Number.isFinite(originX) || !Number.isFinite(originY) || !scaleX) {
    throw new Error("GeoTIFF has no usable georeferencing");
  }
  return { originX, originY, scale: Math.abs(scaleX) };
}

export interface DecodedMask {
  mask: MaskRaster;
  grid: PixelGrid;
  /** UTM zone the tile is projected in, from its GeoKey. */
  zone: number;
  northernHemisphere: boolean;
}

/** EPSG:326xx = WGS84/UTM north, 327xx = south. */
function zoneFromGeoKeys(image: GeoTIFFImage): { zone: number; northernHemisphere: boolean } {
  const geoKeys = (image.getGeoKeys?.() ?? {}) as { ProjectedCSTypeGeoKey?: number };
  const code = geoKeys.ProjectedCSTypeGeoKey;
  if (typeof code === "number") {
    if (code >= 32601 && code <= 32660) return { zone: code - 32600, northernHemisphere: true };
    if (code >= 32701 && code <= 32760) return { zone: code - 32700, northernHemisphere: false };
  }
  throw new Error(`Unsupported imagery projection (EPSG ${code ?? "unknown"})`);
}

/** Decodes the single-band building mask plus its georeferencing. */
export async function decodeMask(buffer: ArrayBuffer): Promise<DecodedMask> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const rasters = await image.readRasters({ interleave: true });
  const data = rasters as unknown as Uint8Array | Uint16Array | Float32Array;

  const width = image.getWidth();
  const height = image.getHeight();
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = data[i] > 0 ? 1 : 0;

  return {
    mask: { data: out, width, height },
    grid: gridFromImage(image),
    ...zoneFromGeoKeys(image),
  };
}

export interface DecodedOrtho {
  /** JPEG bytes, ready to embed in the payload. */
  jpeg: Buffer;
  width: number;
  height: number;
  grid: PixelGrid;
  zone: number;
  northernHemisphere: boolean;
}

/**
 * Decodes the RGB ortho and re-encodes it as JPEG.
 *
 * The source is a multi-megabyte DEFLATE GeoTIFF that nothing on the headset
 * can read; the app needs a plain image it can draw and, crucially, one
 * small enough to sync with the project so the align map works with no
 * signal at the property.
 */
export async function decodeOrtho(
  buffer: ArrayBuffer,
  { quality = 80, maxDimension = 1400 }: { quality?: number; maxDimension?: number } = {}
): Promise<DecodedOrtho> {
  const sharp = (await import("sharp")).default;

  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const raster = (await image.readRasters({ interleave: true })) as unknown as Uint8Array;

  const samples = image.getSamplesPerPixel();
  let rgb: Uint8Array;
  if (samples === 3) {
    rgb = raster;
  } else {
    // Defensive: take the first three bands of anything wider (RGBA).
    rgb = new Uint8Array(width * height * 3);
    for (let i = 0, o = 0; o < rgb.length; i += samples, o += 3) {
      rgb[o] = raster[i];
      rgb[o + 1] = raster[i + 1];
      rgb[o + 2] = raster[i + 2];
    }
  }

  let pipeline = sharp(Buffer.from(rgb), { raw: { width, height, channels: 3 } });
  if (Math.max(width, height) > maxDimension) {
    pipeline = pipeline.resize(maxDimension, maxDimension, { fit: "inside" });
  }
  const jpeg = await pipeline.jpeg({ quality }).toBuffer();

  return {
    jpeg,
    width,
    height,
    grid: gridFromImage(image),
    ...zoneFromGeoKeys(image),
  };
}
