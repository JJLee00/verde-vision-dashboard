// WGS84 ↔ UTM, via the Krüger series.
//
// WHY THIS EXISTS: Solar API GeoTIFFs are georeferenced in UTM (EPSG:326xx),
// while parcel providers speak WGS84. To read the building mask against a
// parcel ring, one of them has to move — so mask pixels ↔ lat/lng needs a
// real projection, in both directions.
//
// The equirectangular helper in normalize.ts is NOT a substitute: it is a
// local tangent approximation around a parcel centroid, deliberately used
// for the app's small-extent geo frame. Pixel indexing spans a whole tile
// in the file's own CRS, and must agree with the GeoTIFF's own
// georeferencing rather than approximate it.
//
// Accuracy: the 3rd-order series is sub-millimetre within a zone — far
// below the ±0.3 m the imagery itself resolves. `utmToWgs84(wgs84ToUtm(p))`
// round-trips to ~1e-9°, which the unit tests pin.

export interface UtmPoint {
  easting: number;
  northing: number;
  zone: number;
  northernHemisphere: boolean;
}

const A = 6378137.0; // WGS84 semi-major axis
const F = 1 / 298.257223563; // flattening
const K0 = 0.9996; // UTM scale factor
const E0 = 500000.0; // false easting
const N0_SOUTH = 10000000.0; // false northing, southern hemisphere

const N = F / (2 - F);
const A_RECT = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);

// Forward (ellipsoid → plane) series coefficients.
const ALPHA = [
  N / 2 - (2 * N ** 2) / 3 + (5 * N ** 3) / 16,
  (13 * N ** 2) / 48 - (3 * N ** 3) / 5,
  (61 * N ** 3) / 240,
];

// Inverse (plane → ellipsoid) series coefficients.
const BETA = [
  N / 2 - (2 * N ** 2) / 3 + (37 * N ** 3) / 96,
  N ** 2 / 48 + N ** 3 / 15,
  (17 * N ** 3) / 480,
];

const DELTA = [
  2 * N - (2 * N ** 2) / 3 - 2 * N ** 3,
  (7 * N ** 2) / 3 - (8 * N ** 3) / 5,
  (56 * N ** 3) / 15,
];

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The UTM zone a longitude falls in (1–60). */
export function utmZoneFor(lngDeg: number): number {
  return Math.floor((lngDeg + 180) / 6) + 1;
}

const centralMeridian = (zone: number) => rad((zone - 1) * 6 - 180 + 3);

export function wgs84ToUtm(latDeg: number, lngDeg: number, forceZone?: number): UtmPoint {
  const zone = forceZone ?? utmZoneFor(lngDeg);
  const lat = rad(latDeg);
  const lng = rad(lngDeg);
  const lng0 = centralMeridian(zone);

  const t = Math.sinh(
    Math.atanh(Math.sin(lat)) -
      ((2 * Math.sqrt(N)) / (1 + N)) * Math.atanh(((2 * Math.sqrt(N)) / (1 + N)) * Math.sin(lat))
  );
  const xi = Math.atan2(t, Math.cos(lng - lng0));
  const eta = Math.atanh(Math.sin(lng - lng0) / Math.sqrt(1 + t * t));

  let easting = eta;
  let northing = xi;
  for (let j = 0; j < 3; j++) {
    const k = 2 * (j + 1);
    easting += ALPHA[j] * Math.cos(k * xi) * Math.sinh(k * eta);
    northing += ALPHA[j] * Math.sin(k * xi) * Math.cosh(k * eta);
  }
  easting = E0 + K0 * A_RECT * easting;
  northing = K0 * A_RECT * northing;

  const northernHemisphere = latDeg >= 0;
  if (!northernHemisphere) northing += N0_SOUTH;

  return { easting, northing, zone, northernHemisphere };
}

export function utmToWgs84(point: UtmPoint): { lat: number; lng: number } {
  const { easting, zone, northernHemisphere } = point;
  const northing = northernHemisphere ? point.northing : point.northing - N0_SOUTH;

  const xi = northing / (K0 * A_RECT);
  const eta = (easting - E0) / (K0 * A_RECT);

  let xiP = xi;
  let etaP = eta;
  for (let j = 0; j < 3; j++) {
    const k = 2 * (j + 1);
    xiP -= BETA[j] * Math.sin(k * xi) * Math.cosh(k * eta);
    etaP -= BETA[j] * Math.cos(k * xi) * Math.sinh(k * eta);
  }

  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let lat = chi;
  for (let j = 0; j < 3; j++) {
    lat += DELTA[j] * Math.sin(2 * (j + 1) * chi);
  }

  const lng = centralMeridian(zone) + Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return { lat: deg(lat), lng: deg(lng) };
}
